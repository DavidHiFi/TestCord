/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType, PluginNative } from "@utils/types";

const Native = VencordNative.pluginHelpers.SentFromMyUname as PluginNative<typeof import("./native")>;

const ESCAPE_PREFIX = "nouname";

let cached: { value: string; at: number } | null = null;

async function signature() {
    const { signatureToUse } = settings.plain;
    const wantsUname = signatureToUse === "uname" && (IS_DISCORD_DESKTOP || IS_VESKTOP);

    if (cached && Date.now() - cached.at < 60_000) return cached.value;

    let value = navigator.userAgent;
    if (wantsUname) {
        try {
            value = await Native.getUname();
        } catch {
            value = navigator.userAgent;
        }
    }

    cached = { value, at: Date.now() };
    return value;
}

function listed(value: string) {
    return value.split(",").map(entry => entry.trim()).filter(Boolean);
}

const settings = definePluginSettings({
    signatureToUse: {
        description: "What to show after Sent from my",
        type: OptionType.SELECT,
        options: [
            { label: "Try uname first, fall back to the user agent", value: "uname", default: true },
            { label: "Always use the user agent", value: "useragent" }
        ]
    },
    channelWhitelist: {
        description: "Only sign messages in these channels (comma separated, empty for all)",
        type: OptionType.STRING,
        default: ""
    }
});

export default definePlugin({
    id: "SentFromMyUname",
    name: "SentFromMyUname",
    description: "Sign every message you send with your uname or user agent",
    tags: ["Chat", "Customisation"],
    authors: [TestcordDevs.x2b],
    settings,

    async onBeforeMessageSend(channelId, message) {
        const { channelWhitelist } = settings.plain;

        if (channelWhitelist && !listed(channelWhitelist).includes(channelId)) return;

        if (message.content.startsWith(`${ESCAPE_PREFIX} `)) {
            message.content = message.content.slice(ESCAPE_PREFIX.length + 1);
            return;
        }

        message.content += `\n\nSent from my ${await signature()}`;
    },

    stop() {
        cached = null;
    }
});
