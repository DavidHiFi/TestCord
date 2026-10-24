/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { DataStore } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { TestcordDevs } from "@utils/constants";
import { pluralize } from "@utils/misc";
import { useAwaiter } from "@utils/react";
import definePlugin, { OptionType } from "@utils/types";
import { MessageStore, Parser, showToast, Toasts, UserStore } from "@webpack/common";

const DATA_KEY = "ReactionTracker_data";
const LEGACY_KEY = "huskchart";
const DEFAULT_LABEL = "reaction";

interface Counts {
    users: Record<string, number>;
    channels: Record<string, number>;
}

function emptyCounts(): Counts {
    return { users: {}, channels: {} };
}

/** the old build kept a 5000 entry event log under `huskchart`, this folds its totals in */
async function migrateLegacy() {
    const legacy = await DataStore.get(LEGACY_KEY);
    if (!legacy || typeof legacy !== "object") return null;

    const { userCounts, channelCounts } = legacy as { userCounts?: Record<string, number>; channelCounts?: Record<string, number> };
    if (!userCounts && !channelCounts) return null;

    const migrated = { users: { ...userCounts }, channels: { ...channelCounts } };
    await DataStore.set(DATA_KEY, migrated);
    await DataStore.del(LEGACY_KEY);
    return migrated;
}

function normalize(value: unknown): Counts {
    if (!value || typeof value !== "object") return emptyCounts();

    const source = value as Partial<Counts>;
    const pick = (record: unknown) => (record && typeof record === "object" ? record as Record<string, number> : {});

    return { users: pick(source.users), channels: pick(source.channels) };
}

function add(counts: Counts, userId: string, channelId: string) {
    counts.users[userId] = (counts.users[userId] ?? 0) + 1;
    counts.channels[channelId] = (counts.channels[channelId] ?? 0) + 1;
}

function decrement(counts: Counts, userId: string, channelId: string) {
    for (const [record, id] of [[counts.users, userId], [counts.channels, channelId]] as const) {
        const next = (record[id] ?? 0) - 1;
        if (next > 0) record[id] = next;
        else delete record[id];
    }
}

function ranked(counts: Record<string, number>) {
    return Object.entries(counts)
        .map(([id, count]) => ({ id, count }))
        .sort((a, b) => b.count - a.count);
}

function Leaderboard({ title, counts, mention }: { title: string; counts: Record<string, number>; mention: (id: string) => string }) {
    const data = ranked(counts);
    if (data.length === 0) return null;

    const label = settings.plain.label || DEFAULT_LABEL;
    const row = (entry: { id: string; count: number }) => (
        <div key={entry.id} className="vc-reactiontracker-row">
            {Parser.parse(mention(entry.id))}
            <span>{entry.count} {pluralize(entry.count, label)}</span>
        </div>
    );

    const overflow = data.slice(6);

    return (
        <>
            <p className="vc-reactiontracker-title">{title}</p>
            <div className="vc-reactiontracker-rows">
                {data.slice(0, 6).map(row)}
                {overflow.length > 0 && (
                    <details>
                        <summary>{overflow.length} more</summary>
                        {overflow.map(row)}
                    </details>
                )}
            </div>
        </>
    );
}

function Stats() {
    const [counts] = useAwaiter(
        async () => (await migrateLegacy()) ?? normalize(await DataStore.get(DATA_KEY)),
        { fallbackValue: emptyCounts() }
    );

    if (Object.keys(counts.users).length === 0) {
        return <p className="vc-reactiontracker-empty">Nothing tracked yet.</p>;
    }

    return (
        <>
            <Leaderboard title="Top reactors" counts={counts.users} mention={id => `<@${id}>`} />
            <Leaderboard title="Top channels" counts={counts.channels} mention={id => `<#${id}>`} />
        </>
    );
}

const settings = definePluginSettings({
    emojiToTrack: {
        description: "Only count reactions whose emoji name contains this",
        type: OptionType.STRING,
        default: DEFAULT_LABEL,
        placeholder: "emojiname (no colons)"
    },
    label: {
        description: "What to call one tracked reaction",
        type: OptionType.STRING,
        default: DEFAULT_LABEL
    },
    stats: {
        type: OptionType.COMPONENT,
        description: "",
        component: Stats
    },
    clear: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => (
            <Button
                variant="dangerPrimary"
                onClick={async () => {
                    await DataStore.set(DATA_KEY, emptyCounts());
                    showToast("Cleared. Reopen settings to see the change.", Toasts.Type.SUCCESS);
                }}
            >
                Clear all data
            </Button>
        )
    }
});

export default definePlugin({
    id: "ReactionTracker",
    name: "ReactionTracker",
    description: "Count who reacts to your messages with a given emoji",
    tags: ["Reactions", "Utility"],
    authors: [TestcordDevs.x2b],
    settings,

    flux: {
        MESSAGE_REACTION_ADD({ channelId, messageId, userId, emoji }) {
            const message = MessageStore.getMessage(channelId, messageId);
            if (!message || message.author.id !== UserStore.getCurrentUser()?.id) return;
            if (!emoji.name?.includes(settings.plain.emojiToTrack)) return;

            void DataStore.update(DATA_KEY, value => {
                const counts = normalize(value);
                add(counts, userId, channelId);
                return counts;
            });
        },

        MESSAGE_REACTION_REMOVE({ channelId, messageId, userId, emoji }) {
            const message = MessageStore.getMessage(channelId, messageId);
            if (!message || message.author.id !== UserStore.getCurrentUser()?.id) return;
            if (!emoji.name?.includes(settings.plain.emojiToTrack)) return;

            void DataStore.update(DATA_KEY, value => {
                const counts = normalize(value);
                decrement(counts, userId, channelId);
                return counts;
            });
        }
    }
});
