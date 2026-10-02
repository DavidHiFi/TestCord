/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { definePluginSettings, migratePluginSetting } from "@api/Settings";
import { Heading } from "@components/Heading";
import { Margins } from "@components/margins";
import { Notice } from "@components/Notice";
import { Paragraph } from "@components/Paragraph";
import { TestcordDevs } from "@utils/constants";
import { sendMessage } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { useAwaiter, useForceUpdater } from "@utils/react";
import definePlugin, { OptionType } from "@utils/types";
import { Button, TextArea, TextInput, UserStore } from "@webpack/common";

type ReplyRule = {
    id: string;
    trigger: string;
    reply: string;
};

const logger = new Logger("AutoReplyContent");
const RULES_KEY = "AutoReplyContent_rules";
const MIGRATED_KEY = "AutoReplyContent_migrated";
const PROCESSED_MESSAGE_TTL_MS = 5 * 60_000;
const MAX_PROCESSED_MESSAGE_IDS = 10_000;
const MAX_DISCORD_MESSAGE_LENGTH = 2_000;

let rules: ReplyRule[] = [];
let isPluginRunning = false;

const lastMessageIds: Map<string, string> = new Map();
const userCooldowns: Map<string, number> = new Map();
const channelCooldowns: Map<string, number> = new Map();
const processedMessageIds: Map<string, number> = new Map();
const sentReplyTimestamps: number[] = [];
const pendingTimeouts: Set<ReturnType<typeof setTimeout>> = new Set();

const PATTERN_STYLE = {
    background: "var(--background-code, var(--background-secondary))",
    padding: "1px 4px",
    borderRadius: "3px",
};

const TRIGGER_HELP: [string, string][] = [
    ["what", "the message has to be exactly what"],
    ["what*", "the message starts with what"],
    ["*what", "the message ends with what"],
    ["*what*", "what is somewhere in the message"],
    ["what* *one", "starts with what and ends with one"],
];

function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

async function loadRules(): Promise<ReplyRule[]> {
    const stored = await DataStore.get(RULES_KEY);
    if (Array.isArray(stored) && stored.length > 0) return stored;
    if (await DataStore.get(MIGRATED_KEY)) return [];

    const { legacyTrigger, legacyReply } = settings.plain;
    const trigger = legacyTrigger?.trim();
    const reply = legacyReply?.trim();
    const migrated = trigger && reply ? [{ id: generateId(), trigger, reply }] : [];
    await DataStore.setMany([[RULES_KEY, migrated], [MIGRATED_KEY, true]]);
    return migrated;
}

function matchesTrigger(content: string, trigger: string, caseInsensitive: boolean): boolean {
    const text = caseInsensitive ? content.toLowerCase() : content;
    const chunks = (caseInsensitive ? trigger.toLowerCase() : trigger).split("*");

    if (chunks.length === 1) return text === chunks[0];
    if (!text.startsWith(chunks[0])) return false;

    let cursor = chunks[0].length;
    for (const chunk of chunks.slice(1, -1)) {
        if (!chunk) continue;
        const at = text.indexOf(chunk, cursor);
        if (at < 0) return false;
        cursor = at + chunk.length;
    }

    return text.endsWith(chunks[chunks.length - 1]);
}

function parseLines(value: string): string[] {
    return value
        .split(/\r?\n/)
        .map(part => part.trim())
        .filter(Boolean);
}

function parseIds(value: string): Set<string> {
    return new Set(
        value
            .split(/[,\s]+/)
            .map(part => part.trim())
            .filter(Boolean)
    );
}

function pickRandom<T>(items: T[]): T {
    return items[Math.floor(Math.random() * items.length)];
}

function applyTemplate(template: string, message: any): string {
    const userName = message.author?.global_name || message.author?.username || "user";
    const mention = message.author?.id ? `<@${message.author.id}>` : userName;
    const channel = message.channel_id ? `<#${message.channel_id}>` : "";
    const messageContent = message.content || "";

    return template
        .replace(/\{user\}/g, userName)
        .replace(/\{mention\}/g, mention)
        .replace(/\{channel\}/g, channel)
        .replace(/\{message\}/g, messageContent);
}

function pruneRateLimitEntries(now: number): void {
    while (sentReplyTimestamps.length > 0 && now - sentReplyTimestamps[0] >= 60_000) {
        sentReplyTimestamps.shift();
    }
}

function isRateLimited(now: number, maxRepliesPerMinute: number): boolean {
    if (maxRepliesPerMinute <= 0) return false;

    pruneRateLimitEntries(now);
    return sentReplyTimestamps.length >= maxRepliesPerMinute;
}

function isInCooldown(now: number, lastEventTime: number | undefined, cooldownMs: number): boolean {
    if (cooldownMs <= 0 || lastEventTime == null) return false;
    return now - lastEventTime < cooldownMs;
}

function messageMentionsUser(message: any, userId?: string): boolean {
    if (!userId) return false;

    const mentions = Array.isArray(message?.mentions) ? message.mentions : [];
    if (mentions.some((mention: any) => mention?.id === userId)) return true;

    const content = typeof message?.content === "string" ? message.content : "";
    return content.includes(`<@${userId}>`) || content.includes(`<@!${userId}>`);
}

function clampMessageLength(content: string): string {
    if (content.length <= MAX_DISCORD_MESSAGE_LENGTH) return content;
    return content.slice(0, MAX_DISCORD_MESSAGE_LENGTH).trimEnd();
}

function pruneProcessedMessages(now: number): void {
    for (const [messageId, processedAt] of processedMessageIds) {
        if (now - processedAt < PROCESSED_MESSAGE_TTL_MS) break;
        processedMessageIds.delete(messageId);
    }

    while (processedMessageIds.size > MAX_PROCESSED_MESSAGE_IDS) {
        const oldestMessageId = processedMessageIds.keys().next().value;
        if (!oldestMessageId) break;
        processedMessageIds.delete(oldestMessageId);
    }
}

function hasProcessedMessage(messageId: string, now: number): boolean {
    pruneProcessedMessages(now);
    if (processedMessageIds.has(messageId)) return true;

    processedMessageIds.set(messageId, now);
    pruneProcessedMessages(now);
    return false;
}

function RulesHelp() {
    return (
        <Notice.Warning className={Margins.bottom16}>
            <p>* is anything, spaces included, so you can put it wherever you need it.</p>
            {TRIGGER_HELP.map(([trigger, note]) => (
                <p key={trigger}>
                    <code style={PATTERN_STYLE}>{trigger}</code> {note}
                </p>
            ))}
            <p>Replies are one per line, one of them gets picked at random. {"{user} {mention} {channel} {message}"} get filled in for you.</p>
        </Notice.Warning>
    );
}

function RulesComponent() {
    const update = useForceUpdater();

    const [, , pending] = useAwaiter<ReplyRule[] | null>(async () => {
        rules = await loadRules();
        return rules;
    }, { fallbackValue: null, deps: [] });

    function save() {
        DataStore.set(RULES_KEY, rules).catch(error => logger.error("Could not save rules", error));
    }

    function addRule() {
        rules.push({ id: generateId(), trigger: "", reply: "" });
        save();
        update();
    }

    function removeRule(id: string) {
        rules = rules.filter(rule => rule.id !== id);
        save();
        update();
    }

    function editRule(id: string, patch: Partial<ReplyRule>) {
        const rule = rules.find(rule => rule.id === id);
        if (!rule) return;

        Object.assign(rule, patch);
        update();
    }

    function resetRules() {
        rules = [];
        save();
        update();
    }

    return (
        <div>
            {!pending && rules.length === 0 && <Paragraph>No rules yet, add one below.</Paragraph>}
            {rules.map((rule, index) => (
                <div key={rule.id} style={{ marginBottom: "12px", padding: "12px", border: "1px solid var(--background-modifier-accent)", borderRadius: "4px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                        <Heading>Rule {index + 1}</Heading>
                        <Button
                            onClick={() => removeRule(rule.id)}
                            look={Button.Looks.FILLED}
                            color={Button.Colors.RED}
                            size={Button.Sizes.SMALL}
                        >
                            Delete
                        </Button>
                    </div>

                    <Paragraph>Trigger</Paragraph>
                    <TextInput
                        placeholder="what* *one"
                        value={rule.trigger}
                        onChange={trigger => editRule(rule.id, { trigger })}
                        onBlur={save}
                    />

                    <Paragraph>Reply, one per line</Paragraph>
                    <TextArea
                        placeholder="what"
                        rows={2}
                        value={rule.reply}
                        onChange={reply => editRule(rule.id, { reply })}
                        onBlur={save}
                    />
                </div>
            ))}

            <div style={{ display: "flex", gap: "8px" }}>
                <Button onClick={addRule}>Add Rule</Button>
                <Button onClick={resetRules} look={Button.Looks.FILLED} color={Button.Colors.RED}>
                    Reset All
                </Button>
            </div>
        </div>
    );
}

const settings = definePluginSettings({
    rules: {
        type: OptionType.COMPONENT,
        component: RulesComponent,
    },
    channelId: {
        type: OptionType.STRING,
        description: "Optional single channel ID (also merged into Channel Whitelist)",
        default: "",
    },
    channelWhitelist: {
        type: OptionType.STRING,
        description: "Optional channel IDs (comma/newline separated)",
        default: "",
    },
    delayMs: {
        type: OptionType.NUMBER,
        description: "Delay before sending the response (in milliseconds)",
        default: 500,
    },
    caseInsensitive: {
        type: OptionType.BOOLEAN,
        description: "Match triggers without case sensitivity",
        default: false,
    },
    onlyInDMs: {
        type: OptionType.BOOLEAN,
        description: "Only trigger in DMs",
        default: false,
    },
    excludeDMs: {
        type: OptionType.BOOLEAN,
        description: "Do not trigger in DMs",
        default: false,
    },
    onlyWhenMentioned: {
        type: OptionType.BOOLEAN,
        description: "Only trigger when your user is mentioned",
        default: false,
    },
    triggerOnSelfMessages: {
        type: OptionType.BOOLEAN,
        description: "Allow your own messages to trigger auto-replies",
        default: false,
    },
    triggerOnBotMessages: {
        type: OptionType.BOOLEAN,
        description: "Allow bot messages to trigger auto-replies",
        default: false,
    },
    perUserCooldownMs: {
        type: OptionType.NUMBER,
        description: "Cooldown for each user before auto-reply can trigger again (0 disables)",
        default: 10_000,
    },
    perChannelCooldownMs: {
        type: OptionType.NUMBER,
        description: "Cooldown for each channel before auto-reply can trigger again (0 disables)",
        default: 0,
    },
    maxRepliesPerMinute: {
        type: OptionType.NUMBER,
        description: "Maximum auto-replies per minute globally (0 disables)",
        default: 0,
    },
}).withPrivateSettings<{
    legacyTrigger: string;
    legacyReply: string;
}>();

migratePluginSetting("AutoReplyContent", "legacyTrigger", "triggerPrefix");
migratePluginSetting("AutoReplyContent", "legacyReply", "responseMessages");
migratePluginSetting("AutoReplyContent", "legacyReply", "responseMessage");

export default definePlugin({
    name: "AutoReplyContent",
    description: "Automatically sends a reply when a message matches one of your trigger rules",
    authors: [TestcordDevs.x2b, TestcordDevs.dxrx99],
    settings,
    settingsAboutComponent: RulesHelp,

    start() {
        isPluginRunning = true;
        loadRules()
            .then(loaded => { rules = loaded; })
            .catch(error => logger.error("Could not load rules", error));
    },

    stop() {
        isPluginRunning = false;
        rules = [];

        for (const timeoutId of pendingTimeouts) {
            clearTimeout(timeoutId);
        }

        pendingTimeouts.clear();
        lastMessageIds.clear();
        userCooldowns.clear();
        channelCooldowns.clear();
        processedMessageIds.clear();
        sentReplyTimestamps.length = 0;
    },

    flux: {
        MESSAGE_CREATE({ message }: any) {
            if (!isPluginRunning) return;

            const {
                channelId,
                channelWhitelist,
                delayMs,
                caseInsensitive,
                onlyInDMs,
                excludeDMs,
                onlyWhenMentioned,
                triggerOnSelfMessages,
                triggerOnBotMessages,
                perUserCooldownMs,
                perChannelCooldownMs,
                maxRepliesPerMinute,
            } = settings.store;

            if (!message?.content || typeof message.content !== "string") return;
            if (!message.channel_id || typeof message.channel_id !== "string") return;
            if (!message.id || typeof message.id !== "string") return;
            if (hasProcessedMessage(message.id, Date.now())) return;
            if (!message.author?.id) return;
            if (!triggerOnBotMessages && message.author?.bot) return;

            const currentUserId = UserStore?.getCurrentUser?.()?.id;
            if (!triggerOnSelfMessages && currentUserId && message.author.id === currentUserId) return;
            if (onlyWhenMentioned && !messageMentionsUser(message, currentUserId)) return;
            if (onlyInDMs && excludeDMs) return;

            const isDM = !message.guild_id;
            if (onlyInDMs && !isDM) return;
            if (excludeDMs && isDM) return;

            const allowedChannels = parseIds(channelWhitelist);
            const trimmedChannelId = channelId.trim();
            if (trimmedChannelId) allowedChannels.add(trimmedChannelId);
            if (allowedChannels.size > 0 && !allowedChannels.has(message.channel_id)) return;

            lastMessageIds.set(message.channel_id, message.id);

            const rule = rules.find(rule => matchesTrigger(message.content, rule.trigger.trim(), caseInsensitive));
            const responses = rule ? parseLines(rule.reply) : [];
            if (responses.length === 0) return;

            const triggeredMessageId = message.id;
            const safeDelayMs = Math.max(0, Number(delayMs) || 0);

            const timeoutId = setTimeout(async () => {
                pendingTimeouts.delete(timeoutId);
                if (!isPluginRunning) return;

                const latestId = lastMessageIds.get(message.channel_id);
                if (latestId !== triggeredMessageId) return;

                const now = Date.now();
                const safePerUserCooldownMs = Math.max(0, Number(perUserCooldownMs) || 0);
                const safePerChannelCooldownMs = Math.max(0, Number(perChannelCooldownMs) || 0);
                const safeMaxRepliesPerMinute = Math.max(0, Number(maxRepliesPerMinute) || 0);

                if (isInCooldown(now, userCooldowns.get(message.author.id), safePerUserCooldownMs)) return;
                if (isInCooldown(now, channelCooldowns.get(message.channel_id), safePerChannelCooldownMs)) return;
                if (isRateLimited(now, safeMaxRepliesPerMinute)) return;

                const renderedResponse = clampMessageLength(applyTemplate(pickRandom(responses), message).trim());
                if (!renderedResponse) return;

                try {
                    await sendMessage(message.channel_id, { content: renderedResponse });
                } catch (error) {
                    logger.error("Could not send auto reply", error);
                    return;
                }

                userCooldowns.set(message.author.id, now);
                if (userCooldowns.size > 1000) {
                    const keys = Array.from(userCooldowns.keys()).slice(0, 200);
                    for (const k of keys) userCooldowns.delete(k);
                }
                channelCooldowns.set(message.channel_id, now);
                pruneRateLimitEntries(now);
                sentReplyTimestamps.push(now);
            }, safeDelayMs);

            pendingTimeouts.add(timeoutId);
        },
    },
});
