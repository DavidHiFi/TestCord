/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
    findGroupChildrenByChildId,
    NavContextMenuPatchCallback,
} from "@api/ContextMenu";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import type { Channel, Message } from "@vencord/discord-types";
import { MessageType } from "@vencord/discord-types/enums";
import { ChannelStore, Menu, RestAPI, UserStore } from "@webpack/common";

const settings = definePluginSettings({
    isEnabled: {
        type: OptionType.BOOLEAN,
        description: "Enable MessageCleaner plugin",
        default: true,
    },
    targetChannelId: {
        type: OptionType.STRING,
        description: "Channel ID to clean (leave empty to use context menu)",
        default: "",
    },
    delayBetweenDeletes: {
        type: OptionType.SLIDER,
        description: "Delay between each deletion (ms) - to avoid rate limit",
        default: 1000,
        markers: [100, 500, 1000, 2000, 5000],
        minValue: 100,
        maxValue: 10000,
        stickToMarkers: false,
    },
    batchSize: {
        type: OptionType.SLIDER,
        description: "Number of messages to process per batch",
        default: 50,
        markers: [10, 25, 50, 100],
        minValue: 1,
        maxValue: 100,
        stickToMarkers: false,
    },
    onlyOwnMessages: {
        type: OptionType.BOOLEAN,
        description: "Delete only your own messages",
        default: true,
    },
    showProgress: {
        type: OptionType.BOOLEAN,
        description: "Show progress in real time",
        default: true,
    },
    debugMode: {
        type: OptionType.BOOLEAN,
        description: "Debug mode (detailed logs)",
        default: false,
    },
    skipSystemMessages: {
        type: OptionType.BOOLEAN,
        description: "Ignore system messages (join/leave, etc.)",
        default: true,
    },
    maxAge: {
        type: OptionType.SLIDER,
        description: "Maximum age of messages to delete (days, 0 = no limit)",
        default: 0,
        markers: [0, 1, 7, 30, 90],
        minValue: 0,
        maxValue: 365,
        stickToMarkers: false,
    },
    deleteRetries: {
        type: OptionType.SLIDER,
        description: "Retries per message when a delete fails, after confirming the message is still there (0 = give up immediately)",
        default: 3,
        markers: [0, 1, 3, 5],
        minValue: 0,
        maxValue: 10,
        stickToMarkers: false,
    },
    verifyAfterFailure: {
        type: OptionType.BOOLEAN,
        description: "After a failed delete, check whether the message is actually gone before retrying (a request can succeed even when the response fails)",
        default: true,
    },
});

// Global variables for control
let isCleaningInProgress = false;
let shouldStopCleaning = false;
let cleaningGeneration = 0;
let cleaningDelayTimeout: ReturnType<typeof setTimeout> | null = null;
let cleaningDelayResolve: (() => void) | null = null;
let cleaningStats = {
    total: 0,
    deleted: 0,
    failed: 0,
    skipped: 0,
    startTime: 0,
};

// Log function with prefix
function log(message: string, level: "info" | "warn" | "error" = "info") {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = `[MessageCleaner ${timestamp}]`;

    switch (level) {
        case "warn":
            console.warn(prefix, message);
            break;
        case "error":
            console.error(prefix, message);
            break;
        default:
            console.log(prefix, message);
    }
}

function waitCleaningDelay(ms: number) {
    if (shouldStopCleaning) return Promise.resolve();
    return new Promise<void>(resolve => {
        cleaningDelayResolve = resolve;
        cleaningDelayTimeout = setTimeout(() => {
            cleaningDelayTimeout = null;
            cleaningDelayResolve = null;
            resolve();
        }, ms);
    });
}

function clearCleaningDelay() {
    if (cleaningDelayTimeout) {
        clearTimeout(cleaningDelayTimeout);
        cleaningDelayTimeout = null;
    }
    cleaningDelayResolve?.();
    cleaningDelayResolve = null;
}

// Debug log
function debugLog(message: string) {
    if (settings.store.debugMode) {
        log(`🔍 ${message}`, "info");
    }
}

// System messages that are not real chat. Everything else the API returns as a non-zero
// type is still ordinary user content and must stay deletable - notably REPLY (19), which
// is what a reply to someone else's message comes back as.
const SYSTEM_MESSAGE_TYPES: ReadonlySet<number> = new Set([
    MessageType.RECIPIENT_ADD,
    MessageType.RECIPIENT_REMOVE,
    MessageType.CALL,
    MessageType.CHANNEL_NAME_CHANGE,
    MessageType.CHANNEL_ICON_CHANGE,
    MessageType.GUILD_INCIDENT_ALERT_MODE_ENABLED,
    MessageType.GUILD_INCIDENT_ALERT_MODE_DISABLED,
    MessageType.GUILD_INCIDENT_REPORT_RAID,
    MessageType.GUILD_INCIDENT_REPORT_FALSE_ALARM
]);

// Function to check if a message can be deleted
function canDeleteMessage(message: Message, currentUserId: string): boolean {
    try {
        // System messages
        if (settings.store.skipSystemMessages && SYSTEM_MESSAGE_TYPES.has(message.type)) {
            debugLog(
                `Message ${message.id} ignored: system message (type: ${message.type})`
            );
            return false;
        }

        // Only own messages
        if (
            settings.store.onlyOwnMessages &&
            message.author?.id !== currentUserId
        ) {
            debugLog(
                `Message ${message.id} ignored: not your message (author: ${message.author?.id})`
            );
            return false;
        }

        // Maximum age
        if (settings.store.maxAge > 0) {
            let messageTime: number;

            // Handle different timestamp formats
            if (typeof message.timestamp === "string") {
                messageTime = new Date(message.timestamp).getTime();
            } else if (
                message.timestamp &&
                typeof message.timestamp === "object" &&
                "toISOString" in message.timestamp
            ) {
                messageTime = new Date(message.timestamp.toISOString()).getTime();
            } else if (typeof message.timestamp === "number") {
                messageTime = message.timestamp;
            } else {
                debugLog(`Message ${message.id} ignored: invalid timestamp`);
                return false;
            }

            // Check if timestamp is valid
            if (isNaN(messageTime) || messageTime <= 0) {
                debugLog(
                    `Message ${message.id} ignored: invalid timestamp (${message.timestamp})`
                );
                return false;
            }

            const messageAge = Date.now() - messageTime;
            const maxAgeMs = settings.store.maxAge * 24 * 60 * 60 * 1000;

            if (messageAge > maxAgeMs) {
                debugLog(
                    `Message ${message.id} ignored: too old (${Math.round(
                        messageAge / (24 * 60 * 60 * 1000)
                    )} days)`
                );
                return false;
            }
        }

        debugLog(`Message ${message.id} can be deleted`);
        return true;
    } catch (error) {
        debugLog(`Error checking message ${message.id}: ${error}`);
        return false;
    }
}

// Discord silently caps a message page at 50 no matter what `limit` asks for, so asking for
// more makes the "short page means we reached the end" check fire on a full page.
const PAGE_LIMIT_MAX = 50;
const FETCH_ATTEMPTS = 3;

function pageLimit(): number {
    return Math.min(settings.store.batchSize, PAGE_LIMIT_MAX);
}

interface RestError {
    status?: number;
    message?: string;
    retry_after?: number;
    retryAfter?: number;
}

function asRestError(error: unknown): RestError {
    return typeof error === "object" && error !== null ? (error as RestError) : {};
}

function errorStatus(error: unknown): number | undefined {
    return asRestError(error).status;
}

function errorText(error: unknown): string {
    return asRestError(error).message ?? String(error);
}

// Discord tells us how long it wants us to wait in the error body. Retrying after
// delayBetweenDeletes instead is what makes a rate limited message get written off as failed
// while it is still sitting there in the channel.
function retryDelayFor(error: unknown, fallback: number): number {
    const { retry_after: snake, retryAfter: camel } = asRestError(error);
    const seconds = snake ?? camel;
    return typeof seconds === "number" && seconds > 0 ? seconds * 1000 : fallback;
}

// Function to delete a message. Resolves to true on success, or to the thrown error on failure
// so the caller can read the retry delay out of it.
async function deleteMessage(
    channelId: string,
    messageId: string
): Promise<unknown> {
    try {
        debugLog(
            `Attempting to delete message ${messageId} in channel ${channelId}`
        );

        await RestAPI.del({
            url: `/channels/${channelId}/messages/${messageId}`,
        });

        debugLog(`✅ Message ${messageId} deleted successfully`);
        return true;
    } catch (error) {
        const statusCode = errorStatus(error) ?? "N/A";

        debugLog(
            `❌ Error deleting message ${messageId}: ${errorText(error)} (Status: ${statusCode})`
        );

        if (statusCode === 403) {
            debugLog(`❌ Permission denied to delete message ${messageId}`);
        } else if (statusCode === 404) {
            debugLog(`❌ Message ${messageId} not found (already deleted?)`);
        } else if (statusCode === 429) {
            debugLog("❌ Rate limit reached for deletion");
        }

        return error;
    }
}

/**
 * Confirm whether a message is really still present.
 *
 * A delete can fail for reasons that have nothing to do with the message surviving: the
 * response can be lost, the connection can drop, or Discord can 429 after applying the
 * delete. Retrying blindly in that case double-deletes (harmless but wasteful) and, worse,
 * reporting a successful delete as a failure makes the stats wrong. Discord answers 404 for
 * a message that no longer exists, so that is the authoritative answer.
 *
 * Any other failure is treated as inconclusive - i.e. still present - because guessing
 * "deleted" would silently hide a real failure.
 */
async function isMessageGone(channelId: string, messageId: string): Promise<boolean> {
    try {
        await RestAPI.get({ url: `/channels/${channelId}/messages/${messageId}` });
        return false;
    } catch (error) {
        return errorStatus(error) === 404;
    }
}

type DeleteOutcome = "deleted" | "gone" | "failed";

/**
 * Delete one message, retrying while it is genuinely still there.
 *
 * A retry waits for whatever Discord asked for (`retry_after`) and falls back to
 * `delayBetweenDeletes`, so a burst of failures cannot turn into a burst of requests and a
 * rate limited message gets the time it needs instead of being written off. `isCancelled` is
 * checked before and after every await so Stop stays responsive during a retry sequence.
 */
async function deleteMessageWithRetry(
    channelId: string,
    messageId: string,
    isCancelled: () => boolean
): Promise<DeleteOutcome> {
    const maxRetries = settings.store.deleteRetries;
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (isCancelled()) return "failed";

        if (attempt > 0) {
            const wait = retryDelayFor(lastError, settings.store.delayBetweenDeletes);
            debugLog(
                `Retrying delete for ${messageId} in ${wait}ms (attempt ${attempt}/${maxRetries})`
            );
            await waitCleaningDelay(wait);
            if (isCancelled()) return "failed";
        }

        lastError = await deleteMessage(channelId, messageId);
        if (lastError === true) return "deleted";
        if (isCancelled()) return "failed";

        if (settings.store.verifyAfterFailure && await isMessageGone(channelId, messageId)) {
            debugLog(`Message ${messageId} is gone despite the error; counting as deleted`);
            return "gone";
        }
    }

    log(
        `❌ Gave up on ${messageId} after ${maxRetries + 1} attempt(s): ` +
        `${errorText(lastError)} (Status: ${errorStatus(lastError) ?? "N/A"})`,
        "warn"
    );
    return "failed";
}

/**
 * Fetch one page of messages, newest first.
 *
 * An empty array means Discord has no more history. `null` means the page could not be
 * fetched, i.e. "unknown" - the caller has to retry the same cursor instead of treating the
 * channel as exhausted, otherwise a single dropped request ends the whole run and everything
 * below that point stays in the channel.
 */
async function getChannelMessages(
    channelId: string,
    before?: string
): Promise<Message[] | null> {
    const limit = pageLimit();
    const url = `/channels/${channelId}/messages?limit=${limit}${before ? `&before=${before}` : ""}`;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
        if (attempt > 0) {
            const wait = retryDelayFor(lastError, settings.store.delayBetweenDeletes);
            log(
                `⚠️ Could not fetch page ${before ?? "newest"}: ${errorText(lastError)}, retrying in ${wait}ms`,
                "warn"
            );
            await waitCleaningDelay(wait);
            if (shouldStopCleaning) break;
        }

        try {
            debugLog(`Retrieving messages from: ${url}`);
            const response = await RestAPI.get({ url });

            if (!response || !Array.isArray(response.body)) {
                debugLog(`Empty or invalid response for ${url}`);
                return [];
            }

            debugLog(`Retrieved ${response.body.length} messages from channel ${channelId}`);
            return response.body;
        } catch (error) {
            lastError = error;
        }
    }

    const statusCode = errorStatus(lastError) ?? "N/A";
    log(
        `❌ Error retrieving messages: ${errorText(lastError)} (Status: ${statusCode})`,
        "error"
    );

    if (statusCode === 403) {
        log(`❌ Permission denied to access channel ${channelId}`, "error");
    } else if (statusCode === 404) {
        log(`❌ Channel ${channelId} not found`, "error");
    } else if (statusCode === 429) {
        log("❌ Rate limit reached for retrieving messages", "error");
    }

    return null;
}

// Function to display progress
function updateProgress() {
    if (!settings.store.showProgress) return;

    const { total, deleted, failed, skipped, startTime } = cleaningStats;
    const processed = deleted + failed + skipped;
    const percentage = total > 0 ? Math.round((processed / total) * 100) : 0;

    // Calculate elapsed and estimated time
    const elapsed = Date.now() - startTime;
    const elapsedStr =
        elapsed < 60000
            ? `${Math.round(elapsed / 1000)}s`
            : `${Math.round(elapsed / 60000)}min`;

    let etaStr = "";
    if (processed > 0 && percentage > 0) {
        const remaining = total - processed;
        const rate = processed / (elapsed / 1000); // messages per second
        const eta = remaining / rate;
        etaStr =
            eta < 60
                ? ` (~${Math.round(eta)}s remaining)`
                : ` (~${Math.round(eta / 60)}min remaining)`;
    }

    showNotification({
        title: `🧹 Cleaning in progress (${percentage}%)`,
        body: `Processed: ${processed}/${total} | Deleted: ${deleted} | Failed: ${failed} | Skipped: ${skipped}\n⏱️ ${elapsedStr}${etaStr}`,
        icon: undefined,
    });
}

// Main cleaning function
async function cleanChannel(channelId: string) {
    const generation = cleaningGeneration;
    if (!settings.store.isEnabled) {
        log("Plugin disabled", "warn");
        return;
    }

    if (isCleaningInProgress) {
        log("A cleaning is already in progress", "warn");
        showNotification({
            title: "⚠️ Cleaning in progress",
            body: "A cleaning is already in progress. Use 'Stop cleaning' if necessary.",
            icon: undefined,
        });
        return;
    }

    try {
        const channel = ChannelStore.getChannel(channelId);
        const currentUserId = UserStore.getCurrentUser()?.id;

        if (!channel) {
            log("Channel not found", "error");
            return;
        }

        if (!currentUserId) {
            log("Unable to get current user ID", "error");
            return;
        }

        const channelName =
            channel.name ||
            channel.recipients
                ?.map((id: string) => {
                    const user = UserStore.getUser(id);
                    return user?.username || "Unknown user";
                })
                .join(", ") ||
            "Private channel";

        // Reset the stop flag up front. A run started right after a stopped one otherwise sees
        // the stale true and every wait resolves instantly / every fetch bails immediately.
        shouldStopCleaning = false;

        // Initial estimation of message count
        log(`🔍 Analyzing channel "${channelName}"...`);
        let estimatedTotal = 0;
        let estimateReachedEnd = false;
        let lastMessageId: string | undefined;

        showNotification({
            title: "🔍 Analysis in progress",
            body: `Analyzing channel "${channelName}" to estimate message count...`,
            icon: undefined,
        });

        // Count messages approximately
        for (let i = 0; i < 10; i++) {
            // Maximum 10 batches for estimation
            const messages = await getChannelMessages(channelId, lastMessageId);
            if (generation !== cleaningGeneration || shouldStopCleaning) return;
            if (messages === null) {
                // The fetch failed, so how much history exists is unknown. Leave
                // estimateReachedEnd false and let the real walk find out.
                break;
            }
            if (messages.length === 0) {
                estimateReachedEnd = true;
                break;
            }

            const validMessages = messages.filter(msg =>
                canDeleteMessage(msg, currentUserId)
            );
            estimatedTotal += validMessages.length;
            lastMessageId = messages[messages.length - 1].id;

            if (messages.length < pageLimit()) {
                estimateReachedEnd = true;
                break;
            }
        }

        // Only bail out when the estimate actually walked the whole channel. The estimate is
        // capped at 10 pages, so hitting that cap with a count of zero only means "nothing in
        // the newest 500 messages", not "nothing to delete" - and `onlyOwnMessages` makes that
        // the common case in a busy channel. Treating it as empty is what made the plugin
        // report nothing to do and leave the rest of the history untouched.
        if (estimatedTotal === 0 && estimateReachedEnd) {
            log("No messages to delete found", "warn");
            showNotification({
                title: "ℹ️ MessageCleaner",
                body: "No messages to delete in this channel",
                icon: undefined,
            });
            return;
        }

        log(`📊 Estimation: ${estimatedTotal} messages to delete`);
        log(
            `⚙️ Configuration: delay ${settings.store.delayBetweenDeletes}ms, batch ${settings.store.batchSize}`
        );

        // Initialize statistics
        isCleaningInProgress = true;
        cleaningStats = {
            total: estimatedTotal,
            deleted: 0,
            failed: 0,
            skipped: 0,
            startTime: Date.now(),
        };

        log(
            `🧹 Starting cleaning of "${channelName}" - ${estimatedTotal} message(s) estimated`
        );

        showNotification({
            title: "🧹 Cleaning started",
            body: `Deleting ~${estimatedTotal} messages in progress...`,
            icon: undefined,
        });

        lastMessageId = undefined;
        let totalProcessed = 0;
        let consecutivePageFailures = 0;

        // Main cleaning loop.
        //
        // Ending the walk on a short page is not safe: Discord caps pages at 50 and can hand
        // back fewer than the limit while history remains, so a short page does not mean the
        // channel is drained. Only an empty page does.
        while (!shouldStopCleaning) {
            try {
                const messages = await getChannelMessages(channelId, lastMessageId);
                if (generation !== cleaningGeneration || shouldStopCleaning) break;

                if (messages === null) {
                    // The cursor has not moved, so the next iteration refetches the same page.
                    if (++consecutivePageFailures >= FETCH_ATTEMPTS) {
                        log(
                            `Giving up after ${FETCH_ATTEMPTS} consecutive page failures`,
                            "error"
                        );
                        break;
                    }
                    continue;
                }
                consecutivePageFailures = 0;

                if (messages.length === 0) {
                    log("No more messages to process");
                    break;
                }

                debugLog(`Processing ${messages.length} messages...`);

                const validMessages = messages.filter(msg =>
                    canDeleteMessage(msg, currentUserId)
                );
                cleaningStats.skipped += messages.length - validMessages.length;
                debugLog(
                    `${validMessages.length} deletable messages out of ${messages.length}`
                );

                // Advance before deleting so an unexpected throw part way through a page
                // cannot replay the page we already worked through.
                lastMessageId = messages[messages.length - 1].id;

                // Delete messages one by one
                for (const message of validMessages) {
                    if (shouldStopCleaning) {
                        log("Stop requested by user");
                        break;
                    }

                    const outcome = await deleteMessageWithRetry(
                        channelId,
                        message.id,
                        () => shouldStopCleaning || generation !== cleaningGeneration
                    );
                    if (generation !== cleaningGeneration || shouldStopCleaning) break;

                    if (outcome === "failed") {
                        cleaningStats.failed++;
                        debugLog(`❌ Failed to delete message ${message.id}`);
                    } else {
                        cleaningStats.deleted++;
                        debugLog(
                            outcome === "gone"
                                ? `✅ Message ${message.id} was already gone`
                                : `✅ Message ${message.id} deleted`
                        );
                    }

                    totalProcessed++;

                    // Anti-rate-limit delay
                    if (settings.store.delayBetweenDeletes > 0) {
                        await waitCleaningDelay(settings.store.delayBetweenDeletes);
                        if (generation !== cleaningGeneration || shouldStopCleaning) break;
                    }

                    // Update progress every 10 messages
                    if (totalProcessed % 10 === 0) {
                        updateProgress();
                    }
                }
            } catch (error) {
                log(
                    `❌ Unexpected error while cleaning: ${errorText(error)} (Status: ${errorStatus(error) ?? "N/A"})`,
                    "error"
                );

                if (++consecutivePageFailures >= FETCH_ATTEMPTS) break;
                await waitCleaningDelay(settings.store.delayBetweenDeletes);
                if (generation !== cleaningGeneration || shouldStopCleaning) break;
            }
        }

        // Cleaning completed
        isCleaningInProgress = false;

        const { deleted, failed, skipped, startTime } = cleaningStats;
        const finalTotal = deleted + failed + skipped;
        const totalTime = Date.now() - startTime;
        const totalTimeStr =
            totalTime < 60000
                ? `${Math.round(totalTime / 1000)} seconds`
                : `${Math.round(totalTime / 60000)} min ${Math.round(
                    (totalTime % 60000) / 1000
                )}s`;

        const avgTimePerMessage = deleted > 0 ? Math.round(totalTime / deleted) : 0;
        const successRate =
            finalTotal > 0 ? Math.round((deleted / finalTotal) * 100) : 0;

        log(`✅ Cleaning completed:
• Messages processed: ${finalTotal}
• Deleted: ${deleted}
• Failed: ${failed}
• Skipped: ${skipped}
• Total time: ${totalTimeStr}
• Success rate: ${successRate}%
• Average time/message: ${avgTimePerMessage}ms`);

        const title = shouldStopCleaning
            ? "⏹️ Cleaning stopped"
            : "✅ Cleaning completed";
        let body =
            failed > 0
                ? `${deleted} deleted, ${failed} failed, ${skipped} skipped`
                : `${deleted} messages deleted successfully`;

        // Add performance stats if cleaning took more than 10 seconds
        if (totalTime > 10000) {
            body += `\n⏱️ ${totalTimeStr} (${successRate}% success)`;
        }

        showNotification({
            title,
            body,
            icon: undefined,
        });
    } catch (error) {
        isCleaningInProgress = false;
        log(`❌ Global error during cleaning: ${error}`, "error");

        showNotification({
            title: "❌ MessageCleaner - Error",
            body: "An error occurred during cleaning",
            icon: undefined,
        });
    }
}

// Function to stop cleaning
function stopCleaning() {
    if (isCleaningInProgress) {
        cleaningGeneration++;
        shouldStopCleaning = true;
        clearCleaningDelay();
        log("⏹️ Cleaning stop requested");

        showNotification({
            title: "⏹️ Stopping in progress",
            body: "Cleaning will stop after the current message",
            icon: undefined,
        });
    }
}

// Context menu patch for channels
const ChannelContextMenuPatch: NavContextMenuPatchCallback = (
    children,
    { channel }: { channel: Channel; }
) => {
    if (!channel) return;

    const group =
        findGroupChildrenByChildId("leave-channel", children) ??
        findGroupChildrenByChildId("mark-channel-read", children) ??
        children;

    if (group) {
        const menuItems = [<Menu.MenuSeparator key="separator" />];

        if (isCleaningInProgress) {
            // Display stats of cleaning in progress
            const { total, deleted, failed, skipped, startTime } = cleaningStats;
            const processed = deleted + failed + skipped;
            const percentage = total > 0 ? Math.round((processed / total) * 100) : 0;
            const elapsed = Math.round((Date.now() - startTime) / 1000);

            menuItems.push(
                <Menu.MenuItem
                    key="cleaning-status"
                    id="vc-cleaning-status"
                    label={`🔄 Cleaning in progress: ${percentage}% (${processed}/${total})`}
                    color="brand"
                    disabled={true}
                />,
                <Menu.MenuItem
                    key="stop-cleaning"
                    id="vc-stop-cleaning"
                    label="⏹️ Stop cleaning"
                    color="danger"
                    action={stopCleaning}
                />
            );
        } else {
            // Normal cleaning option
            menuItems.push(
                <Menu.MenuItem
                    key="clean-messages"
                    id="vc-clean-messages"
                    label="🧹 Clean messages"
                    color="danger"
                    action={() => cleanChannel(channel.id)}
                />
            );
        }

        group.push(...menuItems);
    }
};

export default definePlugin({
    name: "MessageCleaner",
    description:
        "Cleans all messages in a channel with intelligent rate limiting management, real-time statistics and secure confirmation",
    tags: ["Chat", "Utility"],
    authors: [
        {
            name: "Bash",
            id: 1327483363518582784n,
        },
        TestcordDevs.x2b
    ],
    dependencies: ["ContextMenuAPI"],
    settings,

    contextMenus: {
        "channel-context": ChannelContextMenuPatch,
        "gdm-context": ChannelContextMenuPatch,
        "user-context": ChannelContextMenuPatch,
    },

    start() {
        log("🚀 MessageCleaner plugin started");

        // Test dependencies
        log("🔍 Testing dependencies:");
        log(`- RestAPI: ${typeof RestAPI}`);
        log(`- ChannelStore: ${typeof ChannelStore}`);
        log(`- UserStore: ${typeof UserStore}`);
        log(`- Menu: ${typeof Menu}`);

        // If a channel is configured in settings, offer to clean it
        if (settings.store.targetChannelId.trim()) {
            const channel = ChannelStore.getChannel(settings.store.targetChannelId);
            if (channel) {
                const channelName = channel.name || "Private channel";
                log(
                    `🎯 Target channel configured: "${channelName}" (${settings.store.targetChannelId})`
                );
            } else {
                log("⚠️ Target channel configured but not found", "warn");
            }
        }

        debugLog(`Configuration:
• Delay: ${settings.store.delayBetweenDeletes}ms
• Batch: ${settings.store.batchSize}
• Own messages: ${settings.store.onlyOwnMessages}
• Max age: ${settings.store.maxAge} days
• Debug mode: ${settings.store.debugMode}`);

        showNotification({
            title: "🧹 MessageCleaner enabled",
            body: "Right-click on a channel to clean messages",
            icon: undefined,
        });
    },

    stop() {
        log("🛑 MessageCleaner plugin stopped");

        // Stop cleaning in progress
        if (isCleaningInProgress) {
            cleaningGeneration++;
            shouldStopCleaning = true;
            clearCleaningDelay();
        }

        showNotification({
            title: "🧹 MessageCleaner disabled",
            body: "Plugin stopped",
            icon: undefined,
        });
    },
});
