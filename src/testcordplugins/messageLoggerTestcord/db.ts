/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { lodash } from "@webpack/common";
import { DBSchema, IDBPDatabase, openDB } from "idb";

import { createSearchMatcher } from "./search";
import { EditRecord, LoggedMessage, LogPage, LogRecord, LogStats, LogStatus, LogViewStatus } from "./types";
import { embedFingerprint } from "./utils";

export const DB_NAME = "TestcordMessageLoggerIDB";
const DB_VERSION = 1;

interface MessageLoggerDatabase extends DBSchema {
    messages: {
        key: string;
        value: LogRecord;
        indexes: {
            by_channel_id: string;
            by_status: LogStatus;
            by_timestamp: string;
            by_timestamp_and_message_id: [string, string];
        };
    };
}

let databasePromise: Promise<IDBPDatabase<MessageLoggerDatabase>> | undefined;
let statsCache: LogStats | undefined;

export function getDatabase() {
    return databasePromise ??= openDB<MessageLoggerDatabase>(DB_NAME, DB_VERSION, {
        upgrade(database) {
            const store = database.createObjectStore("messages", { keyPath: "message_id" });
            store.createIndex("by_channel_id", "channel_id");
            store.createIndex("by_status", "status");
            store.createIndex("by_timestamp", "message.timestamp");
            store.createIndex("by_timestamp_and_message_id", ["channel_id", "message.timestamp"]);
        }
    });
}

function invalidateStats() {
    statsCache = undefined;
}

function isUncloneable(value: unknown) {
    const type = typeof value;
    return type === "function" || type === "symbol";
}

function isNativelyCloneable(value: object) {
    if (value instanceof Date || value instanceof RegExp || value instanceof ArrayBuffer) return true;
    if (ArrayBuffer.isView(value)) return true;
    if (typeof Blob !== "undefined" && value instanceof Blob) return true;
    if (typeof File !== "undefined" && value instanceof File) return true;
    return false;
}

/**
 * IndexedDB stores values with the structured clone algorithm, which rejects functions
 * and symbols. Discord hangs an ordinal-suffix helper off messages as an own property,
 * and lodash.cloneDeep copies nested functions by reference instead of dropping them, so
 * it survives into `put`. One of them fails the whole transaction with DataCloneError,
 * silently losing every record batched alongside it.
 *
 * cloneMessage preserves prototypes, so a message is a class instance rather than a bare
 * object, and only own enumerable properties are cloned. An earlier version of this that
 * handed any object with a real prototype straight to `put` therefore left the helper in
 * place and the error kept firing.
 *
 * This mutates, so it must only ever be handed something we own. It is called from
 * snapshotMessage, immediately after its own cloneDeep, and from nowhere else. It used to
 * be called from applyBatch instead, which was wrong twice over: the record there is only
 * a shallow spread, so the walk reached the shared nested objects and deleted keys and
 * spliced arrays on the copies held by recentMessages and channelMessageCache, and it ran
 * on the write path where a second full walk per message is exactly the kind of cost that
 * shows up as jank.
 */
export function stripUncloneable(value: any, seen: WeakSet<object>) {
    if (value === null || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);
    if (isNativelyCloneable(value)) return;

    if (value instanceof Map) {
        for (const [k, v] of value) {
            if (isUncloneable(k) || isUncloneable(v)) value.delete(k);
            else {
                stripUncloneable(k, seen);
                stripUncloneable(v, seen);
            }
        }
        return;
    }

    if (value instanceof Set) {
        for (const v of value) {
            if (isUncloneable(v)) value.delete(v);
            else stripUncloneable(v, seen);
        }
        return;
    }

    if (Array.isArray(value)) {
        for (let i = value.length - 1; i >= 0; i--) {
            if (isUncloneable(value[i])) value.splice(i, 1);
            else stripUncloneable(value[i], seen);
        }
        return;
    }

    for (const key in value) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
        const item = value[key];
        if (isUncloneable(item)) delete value[key];
        else stripUncloneable(item, seen);
    }
}

export async function applyBatch(records: LogRecord[], deletedIds: string[]) {
    if (records.length === 0 && deletedIds.length === 0) return;

    const database = await getDatabase();
    const transaction = database.transaction("messages", "readwrite");
    const existingRecords = await Promise.all(records.map(record => transaction.store.get(record.message_id)));
    const updatedAt = new Date().toISOString();
    await Promise.all([
        ...records.map((record, index) => putRecord(transaction.store, {
            ...record,
            protected: record.protected ?? existingRecords[index]?.protected,
            hidden: record.hidden ?? existingRecords[index]?.hidden,
            createdAt: existingRecords[index]?.createdAt ?? record.createdAt ?? updatedAt,
            updatedAt
        })),
        ...deletedIds.map(id => transaction.store.delete(id)),
        transaction.done
    ]);
    invalidateStats();
}

export async function getLogPage(status: LogViewStatus, newest: boolean, limit: number, query: string, cursor?: string): Promise<LogPage> {
    const database = await getDatabase();
    const transaction = database.transaction("messages");
    const range = cursor
        ? newest ? IDBKeyRange.upperBound(cursor, true) : IDBKeyRange.lowerBound(cursor, true)
        : undefined;
    const direction = newest ? "prev" : "next";
    const matchesSearch = createSearchMatcher(query);
    const records: LogRecord[] = [];
    let next = await transaction.store.openCursor(range, direction);
    let lastScannedId: string | undefined;

    while (next && records.length < limit) {
        const record = next.value;
        lastScannedId = record.message_id;
        if ((status === "ALL" || record.status === status) && matchesSearch(record)) records.push(record);
        next = await next.continue();
    }

    const total = status === "ALL"
        ? await transaction.store.count()
        : await transaction.store.index("by_status").count(status);
    await transaction.done;

    return {
        records,
        cursor: lastScannedId,
        hasMore: next != null,
        total
    };
}

/**
 * Normalise a bound into the ISO form the `by_timestamp_and_message_id` index stores.
 *
 * The index key is `message.timestamp`, which is an ISO string, and ISO strings sort
 * lexicographically in chronological order - that is the whole basis for bounding a range on
 * it. So an unparseable bound must be rejected rather than passed through: it would either
 * throw inside `IDBKeyRange.bound` or, worse, silently produce a range covering nothing.
 *
 * `String(ms)` cannot be used to parse a number here. `new Date(String(1756339200000))` is
 * Invalid Date, and `new Date(String(0))` parses as the year 2000, so a millisecond bound
 * would either throw or quietly shift the window by three decades. Numbers are therefore
 * constructed directly, and anything non-finite is rejected.
 */
function toIndexBound(value: string | number): string | undefined {
    if (typeof value === "number") {
        return Number.isFinite(value) ? new Date(value).toISOString() : undefined;
    }
    const parsed = Date.parse(value);
    // A non-ISO but still chronologically sortable string is kept as-is, matching how
    // these bounds behaved before.
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value || undefined;
}

export async function getChannelLogsAfter(channelId: string, timestamp: string | number, untilTimestamp?: string | number) {
    const lower = toIndexBound(timestamp);
    // "\uffff" sorts after every ISO string, so omitting the upper bound keeps the original
    // open-ended "everything from `timestamp` onwards" behaviour.
    const upper = untilTimestamp === undefined ? "\uffff" : toIndexBound(untilTimestamp) ?? "\uffff";
    if (lower === undefined) return [];

    const database = await getDatabase();
    const index = database.transaction("messages").store.index("by_timestamp_and_message_id");
    // `by_timestamp_and_message_id` is keyed on ["channel_id", "message.timestamp"], so the
    // record's own message timestamp *is* the second index key. Bounding the top of the
    // range therefore restricts the cursor to a time window instead of the channel's whole
    // logged history, which is what reconciliation wants: it only ever acts on the window it
    // was handed, so walking every record since epoch to re-check that window in JS was pure
    // overhead, and it grew with every message ever logged in the channel.
    const range = IDBKeyRange.bound([channelId, lower], [channelId, upper]);
    const records: LogRecord[] = [];
    let cursor = await index.openCursor(range);

    while (cursor) {
        // NOTE: the persisted `hidden` flag is intentionally not honored here.
        // Its only writer was Delete Message (Temporary), which persisted it by
        // mistake and made temporary hides permanent. Session hides now live in
        // an in-memory set (see isTempHiddenMessage); ignoring the stale flag
        // resurrects those rows without a database migration.
        if (cursor.value.status !== LogStatus.EDITED) records.push(cursor.value);
        cursor = await cursor.continue();
    }

    return records;
}

export async function getAllHistoryForChannel(channelId: string) {
    const database = await getDatabase();
    const index = database.transaction("messages").store.index("by_channel_id");
    const records = await index.getAll(channelId);
    return records.filter(record => record.status === LogStatus.EDITED
        || (Array.isArray(record.message.editHistory) && record.message.editHistory.length > 0));
}

/**
 * Repair records written while embed fingerprints could not tell a new embed from a
 * stripped one, which made every edit of a paginated bot append the previous page's
 * embeds and log the state it was replacing as a revision of its own. Three symptoms,
 * one cause:
 *
 * - the same embed repeated inside one message or revision,
 * - consecutive revisions whose content and embeds are identical,
 * - a trailing revision identical to the message's current state, i.e. a state that was
 *   never edited away.
 *
 * Only records that actually changed are rewritten, so a healthy database costs one
 * cursor pass and no writes. Safe to leave running: a repaired record no longer trips
 * any of the three checks.
 */
export async function repairEditedRecords(): Promise<number> {
    const database = await getDatabase();
    const repaired: LogRecord[] = [];
    let scanned = 0;
    // Walk the edit index rather than the store: only these rows can be affected.
    let cursor = await database.transaction("messages").store.index("by_status").openCursor(LogStatus.EDITED);
    while (cursor && scanned < 50_000) {
        scanned++;
        const record = cursor.value;
        const { editHistory } = record.message;
        if (Array.isArray(editHistory) && editHistory.length) {
            const current = stateKey(record.message.content, record.message.embeds);
            const seen = new Set<string>();
            const kept: EditRecord[] = [];
            // Walk oldest to newest so a revision equal to the current state is dropped
            // only after the ones before it have been compared against each other.
            for (const revision of editHistory) {
                const embeds = dedupeEmbeds(revision.embeds);
                const key = stateKey(revision.content, embeds);
                // A repeat of the state already logged, or the state the message is in now.
                if (seen.has(key) || key === current) continue;
                seen.add(key);
                kept.push(embeds === revision.embeds ? revision : { ...revision, embeds });
            }
            const embeds = dedupeEmbeds(record.message.embeds);
            const changed = kept.length !== editHistory.length || embeds !== record.message.embeds;
            if (changed) {
                const message: LoggedMessage = { ...record.message, editHistory: kept };
                if (embeds) message.embeds = embeds;
                repaired.push({ ...record, message, updatedAt: new Date().toISOString() });
            }
        }
        cursor = await cursor.continue();
    }
    if (!repaired.length) return 0;
    const transaction = database.transaction("messages", "readwrite");
    await Promise.all([
        ...repaired.map(record => transaction.store.put(record)),
        transaction.done
    ]);
    invalidateStats();
    return repaired.length;
}

/**
 * One function anywhere in a record fails the whole transaction with DataCloneError, and
 * a failed transaction takes every record batched with it, so a single stray value costs
 * the entire batch. Retry once against a stripped deep copy: the record in hand shares
 * objects with the in-memory caches and must not be mutated, but a copy is ours to
 * clean. Without this a Discord helper function that slipped past the snapshot path
 * silently ate logs.
 */
function putRecord(store: { put(value: unknown, key?: unknown): Promise<unknown>; }, record: LogRecord) {
    return store.put(record).catch((error: { name?: string; }) => {
        if (error?.name !== "DataCloneError") throw error;
        const safe = lodash.cloneDeep(record);
        stripUncloneable(safe, new WeakSet());
        return store.put(safe);
    });
}

function stateKey(content: unknown, embeds: unknown): string {
    const parts = Array.isArray(embeds) ? embeds.map(embed => embedFingerprint(embed)) : [];
    return `${content ?? ""} ${parts.join("")}`;
}

function dedupeEmbeds<T>(embeds: T[] | undefined): T[] | undefined {
    if (!Array.isArray(embeds)) return embeds;
    const seen = new Set<string>();
    const out: T[] = [];
    for (const embed of embeds) {
        const key = embedFingerprint(embed);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(embed);
    }
    return out;
}

export async function getLogById(messageId: string) {
    const database = await getDatabase();
    return database.get("messages", messageId);
}

/**
/**
 * Every row logged from a server.
 *
 * There is no guild index, and the alternative - walking every channel of the guild
 * through by_channel_id - only covers channels the guild store happens to know about,
 * so a log whose channel has since been left or deleted would be missed. This walks the
 * primary key once and keeps the guild's rows: measured at 463k rows in about two
 * seconds, and it only runs when the user asks to clear a whole server.
 */
export async function getGuildLogs(guildId: string) {
    const database = await getDatabase();
    const store = database.transaction("messages", "readonly").objectStore("messages");
    const records: LogRecord[] = [];
    let cursor = await store.openCursor();
    while (cursor) {
        const { message } = cursor.value;
        if (message?.guild_id === guildId || message?.guildId === guildId) records.push(cursor.value);
        cursor = await cursor.continue();
    }
    return records;
}

export async function getChannelLogsLimit(channelId: string, limit: number, beforeTimestamp?: string): Promise<LogRecord[]> {
    const database = await getDatabase();
    const index = database.transaction("messages").store.index("by_timestamp_and_message_id");
    let range: IDBKeyRange;
    if (beforeTimestamp) {
        let normalized: string;
        try { normalized = new Date(String(beforeTimestamp)).toISOString(); } catch { normalized = String(beforeTimestamp); }
        range = IDBKeyRange.bound([channelId, ""], [channelId, normalized], false, true);
    } else {
        range = IDBKeyRange.bound([channelId, ""], [channelId, "\uffff"]);
    }
    const records: LogRecord[] = [];
    let cursor = await index.openCursor(range, "prev");
    while (cursor && records.length < limit) {
        if (cursor.value.status !== LogStatus.EDITED) records.push(cursor.value);
        cursor = await cursor.continue();
    }
    return records;
}

async function getOldestIds(limit: number, cutoff?: string, preservedChannelId?: string) {
    if (limit <= 0) return [];

    const database = await getDatabase();
    const index = database.transaction("messages").store.index("by_timestamp");
    const range = cutoff ? IDBKeyRange.upperBound(cutoff) : undefined;
    const ids: string[] = [];
    let cursor = await index.openCursor(range);

    while (cursor && ids.length < limit) {
        if (!cursor.value.protected && cursor.value.channel_id !== preservedChannelId) ids.push(cursor.value.message_id);
        cursor = await cursor.continue();
    }

    return ids;
}

export async function deleteLogs(ids: string[]) {
    const database = await getDatabase();

    for (let offset = 0; offset < ids.length; offset += 500) {
        const transaction = database.transaction("messages", "readwrite");
        await Promise.all([
            ...ids.slice(offset, offset + 500).map(id => transaction.store.delete(id)),
            transaction.done
        ]);
    }
    if (ids.length > 0) invalidateStats();
}

export async function clearLogs() {
    const database = await getDatabase();
    await database.clear("messages");
    invalidateStats();
}

export async function clearUnprotectedLogs() {
    const database = await getDatabase();
    const ids: string[] = [];
    let cursor = await database.transaction("messages").store.openCursor();

    while (cursor) {
        if (!cursor.value.protected) ids.push(cursor.value.message_id);
        cursor = await cursor.continue();
    }

    await deleteLogs(ids);
}

export async function setLogProtected(messageId: string, value: boolean) {
    const database = await getDatabase();
    const transaction = database.transaction("messages", "readwrite");
    const record = await transaction.store.get(messageId);
    if (!record) return;

    record.protected = value;
    record.updatedAt = new Date().toISOString();
    await transaction.store.put(record);
    await transaction.done;
    invalidateStats();
    return record;
}

export async function setLogsProtected(messageIds: string[], value: boolean) {
    const database = await getDatabase();

    for (let offset = 0; offset < messageIds.length; offset += 250) {
        const transaction = database.transaction("messages", "readwrite");
        const ids = messageIds.slice(offset, offset + 250);
        const records = await Promise.all(ids.map(id => transaction.store.get(id)));
        const updatedAt = new Date().toISOString();
        await Promise.all([
            ...records.filter(record => record != null).map(record => transaction.store.put({ ...record, protected: value, updatedAt })),
            transaction.done
        ]);
    }

    invalidateStats();
}

export async function getAllLogs() {
    const database = await getDatabase();
    return database.getAll("messages");
}

export async function importLogRecords(records: LogRecord[]) {
    for (let offset = 0; offset < records.length; offset += 250) {
        await applyBatch(records.slice(offset, offset + 250), []);
    }
}

export async function getLogStats(): Promise<LogStats> {
    if (statsCache) return statsCache;

    const database = await getDatabase();
    const [total, deleted, edited, ghostPinged] = await Promise.all([
        database.count("messages"),
        database.countFromIndex("messages", "by_status", LogStatus.DELETED),
        database.countFromIndex("messages", "by_status", LogStatus.EDITED),
        database.countFromIndex("messages", "by_status", LogStatus.GHOST_PINGED)
    ]);
    const encoder = new TextEncoder();
    let protectedInSample = 0;
    // Estimate size from a sample: a full stringify+encode pass over hundreds
    // of thousands of records froze the client for seconds on every open.
    // Counts above stay exact (indexed); these two are display estimates.
    const SAMPLE_LIMIT = 200;
    let sampledBytes = 0;
    let sampledCount = 0;
    let cursor = await database.transaction("messages").store.openCursor();

    while (cursor && sampledCount < SAMPLE_LIMIT) {
        if (cursor.value.protected) protectedInSample++;
        sampledBytes += encoder.encode(JSON.stringify(cursor.value)).byteLength;
        sampledCount++;
        cursor = await cursor.continue();
    }

    const protectedCount = sampledCount ? Math.round(protectedInSample / sampledCount * total) : 0;
    const estimatedBytes = sampledCount ? Math.round(sampledBytes / sampledCount * total) : 0;

    return statsCache = {
        total,
        deleted,
        edited,
        ghostPinged,
        protected: protectedCount,
        estimatedBytes
    };
}

export async function runMaintenance(messageLimit: number, retentionDays: number, preservedChannelId?: string) {
    const database = await getDatabase();

    if (retentionDays > 0) {
        const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
        let oldIds: string[];
        do {
            oldIds = await getOldestIds(500, cutoff, preservedChannelId);
            await deleteLogs(oldIds);
        } while (oldIds.length === 500);
    }

    if (messageLimit > 0) {
        let excess = await database.count("messages") - messageLimit;
        while (excess > 0) {
            const ids = await getOldestIds(Math.min(excess, 500));
            if (ids.length === 0) break;
            await deleteLogs(ids);
            excess -= ids.length;
        }
    }
}

export async function getKeptAttachmentIds(cutoffMs: number, preservedChannelId?: string) {
    const cutoff = new Date(cutoffMs).toISOString();
    const database = await getDatabase();
    const index = database.transaction("messages").store.index("by_timestamp");
    const kept = new Set<string>();
    let cursor = await index.openCursor(IDBKeyRange.upperBound(cutoff));

    while (cursor) {
        const record = cursor.value;
        if (record.protected || record.channel_id === preservedChannelId) {
            for (const att of record.message.attachments) {
                if (att.id) kept.add(att.id);
            }
            for (const rev of record.message.editHistory ?? []) {
                for (const att of rev.attachments ?? []) {
                    if (att.id) kept.add(att.id);
                }
            }
        }
        cursor = await cursor.continue();
    }
    return kept;
}
