/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { DataStore } from "@api/index";
import { addMessageAccessory, removeMessageAccessory } from "@api/MessageAccessories";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { Parser, React, Text } from "@webpack/common";

const DATA_KEY = "UserFlags_data";
const LEGACY_KEY = "USERFLAGS";

/** the old build wrote the Map itself, which came back from idb as either a Map or a string */
async function load(): Promise<Map<string, Flag>> {
    const legacy = await DataStore.get(LEGACY_KEY);
    if (legacy) {
        const restored = new Map<string, Flag>(
            (typeof legacy === "string" ? JSON.parse(legacy) : Array.from(legacy as Map<string, Flag>)) as [string, Flag][]
        );

        await DataStore.set(DATA_KEY, [...restored]);
        await DataStore.del(LEGACY_KEY);
        return restored;
    }

    const entries = await DataStore.get(DATA_KEY);
    return new Map(
        (Array.isArray(entries) ? entries : []).filter(
            (entry): entry is [string, Flag] => Array.isArray(entry) && typeof entry[0] === "string"
        )
    );
}

const FlagType = {
    danger: { label: "Danger", color: "#ff7473", emoji: "\u{1F6D1}" },
    warning: { label: "Warning", color: "#ffb02e", emoji: "⚠️" },
    info: { label: "Info", color: "#62a8ff", emoji: "ℹ️" },
    positive: { label: "Positive", color: "#62ff74", emoji: "✅" }
} as const;

type FlagType = keyof typeof FlagType;

interface Flag {
    type: FlagType;
    text: string;
}

let flags = new Map<string, Flag>();
let flushTimer: number | undefined;
let flushing: Promise<unknown> | null = null;

const subscribers = new Set<() => void>();
const subscribe = (callback: () => void) => {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
};

function notifyChanged() {
    for (const callback of subscribers) callback();
}

async function flush() {
    flushing ??= DataStore.set(DATA_KEY, [...flags]).finally(() => { flushing = null; });
    await flushing;
}

function scheduleFlush() {
    if (flushTimer !== undefined) return;
    // reactions arrive in bursts, so coalesce the writes instead of hitting idb per event
    flushTimer = window.setTimeout(() => {
        flushTimer = undefined;
        void flush();
    }, 1000);
}

function setFlag(userId: string, flag: Flag | null) {
    if (flag) flags.set(userId, flag);
    else flags.delete(userId);

    notifyChanged();
    scheduleFlush();
}

function FlagBadge({ userId }: { userId: string }) {
    const flag = React.useSyncExternalStore(subscribe, () => flags.get(userId));
    if (!flag) return null;

    const kind = FlagType[flag.type];
    return (
        <Text variant="text-md/bold" style={{ color: kind.color }}>
            {Parser.parse(`${kind.emoji} ${flag.text}`)}
        </Text>
    );
}

export default definePlugin({
    id: "UserFlags",
    name: "UserFlags",
    description: "Attach a label under a user's messages",
    tags: ["Utility", "Appearance"],
    authors: [TestcordDevs.x2b],
    dependencies: ["MessageAccessoriesAPI"],

    async start() {
        flags = await load();
        addMessageAccessory("UserFlags", props => <FlagBadge userId={props.message.author.id} />, 4);
    },

    stop() {
        if (flushTimer !== undefined) {
            clearTimeout(flushTimer);
            flushTimer = undefined;
        }
        removeMessageAccessory("UserFlags");
    },

    commands: [
        {
            name: "flag set",
            description: "Attach a label to a user",
            inputType: ApplicationCommandInputType.BOT,
            options: [
                {
                    name: "user",
                    description: "Who to label",
                    type: ApplicationCommandOptionType.USER,
                    required: true
                },
                {
                    name: "type",
                    description: "How the label should look",
                    type: ApplicationCommandOptionType.STRING,
                    required: true,
                    choices: Object.entries(FlagType).map(([value, kind]) => ({
                        name: value,
                        label: kind.label,
                        displayName: kind.label,
                        value
                    }))
                },
                {
                    name: "message",
                    description: "What the label should say",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                }
            ],
            async execute(args, ctx) {
                const user = findOption(args, "user", "");
                const text = findOption(args, "message", "").trim();
                if (!text) return sendBotMessage(ctx.channel.id, { content: "The label cannot be empty." });

                setFlag(user, { type: findOption<FlagType>(args, "type", "info"), text });
                await flush();
                await sendBotMessage(ctx.channel.id, { content: `Labelled <@${user}> as ${text}.` });
            }
        },
        {
            name: "flag delete",
            description: "Remove the label from a user",
            inputType: ApplicationCommandInputType.BOT,
            options: [
                {
                    name: "user",
                    description: "Who to unlabel",
                    type: ApplicationCommandOptionType.USER,
                    required: true
                }
            ],
            async execute(args, ctx) {
                const user = findOption(args, "user", "");
                if (!flags.has(user)) return sendBotMessage(ctx.channel.id, { content: `<@${user}> has no label.` });

                setFlag(user, null);
                await flush();
                await sendBotMessage(ctx.channel.id, { content: `Removed the label from <@${user}>.` });
            }
        }
    ]
});
