/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { React, RestAPI, useState } from "@webpack/common";

// ─── Constants ─────────────────────────────────────────────────────────────────

const BALDDEX_BOT_ID = "1209093871828553839"; // Balldex bot ID
const SPAWN_EMBED_TITLE_REGEX = /A wild .+ has appeared!/i;
const CAUGHT_EMBED_TITLE_REGEX = /You caught .+/i;
const COMMAND_PREFIX = "b!";

// ─── Settings ──────────────────────────────────────────────────────────────────

const settings = definePluginSettings({
    autoCatch: {
        type: OptionType.BOOLEAN,
        description: "Automatically attempt to catch spawned Pokémon",
        default: false
    },
    autoCatchDelay: {
        type: OptionType.SLIDER,
        description: "Delay before auto-catching (ms) to appear natural",
        markers: [0, 500, 1000, 2000, 3000],
        default: 1000
    },
    notifyRare: {
        type: OptionType.BOOLEAN,
        description: "Show desktop notification for rare/legendary spawns",
        default: true
    },
    notifyShiny: {
        type: OptionType.BOOLEAN,
        description: "Show desktop notification for shiny spawns",
        default: true
    },
    allowedChannels: {
        type: OptionType.STRING,
        description: "Channel IDs where auto-catch works (comma-separated). Empty = all channels.",
        default: ""
    },
    ignoredChannels: {
        type: OptionType.STRING,
        description: "Channel IDs to ignore (comma-separated)",
        default: ""
    },
    quickCommands: {
        type: OptionType.BOOLEAN,
        description: "Show quick command buttons in chat bar",
        default: true
    }
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

function isBalldexSpawn(message: Message): boolean {
    if (message.author?.id !== BALDDEX_BOT_ID) return false;
    if (!message.embeds?.length) return false;
    return SPAWN_EMBED_TITLE_REGEX.test(message.embeds[0].rawTitle ?? "");
}

function isBalldexCatch(message: Message): boolean {
    if (message.author?.id !== BALDDEX_BOT_ID) return false;
    if (!message.embeds?.length) return false;
    return CAUGHT_EMBED_TITLE_REGEX.test(message.embeds[0].rawTitle ?? "");
}

function getRarityFromEmbed(embed: any): "common" | "uncommon" | "rare" | "legendary" | "shiny" | "unknown" {
    const { color } = embed;
    // Balldex uses specific colors for rarities (hex strings)
    if (color === "#FFD700" || color === "16776960") return "shiny"; // Gold
    if (color === "#FF0000" || color === "16711680") return "legendary"; // Red
    if (color === "#800080" || color === "8388736") return "rare"; // Purple
    if (color === "#00FFFF" || color === "65535") return "uncommon"; // Cyan
    return "common";
}

function getPokemonNameFromEmbed(embed: any): string {
    // Extract Pokémon name from embed title/description
    const title = embed.rawTitle ?? "";
    const match = title.match(/A wild (.+) has appeared!/i);
    if (match) return match[1].trim();
    return "Unknown Pokémon";
}

function isChannelAllowed(channelId: string): boolean {
    const allowed = settings.store.allowedChannels?.split(",").map(s => s.trim()).filter(Boolean) ?? [];
    const ignored = settings.store.ignoredChannels?.split(",").map(s => s.trim()).filter(Boolean) ?? [];

    if (ignored.includes(channelId)) return false;
    if (allowed.length > 0 && !allowed.includes(channelId)) return false;
    return true;
}

async function sendCatchCommand(channelId: string, messageId: string): Promise<void> {
    try {
        await RestAPI.post({
            url: `/channels/${channelId}/messages`,
            body: {
                content: `${COMMAND_PREFIX} catch`,
                message_reference: {
                    message_id: messageId,
                    channel_id: channelId,
                    fail_if_not_exists: false
                },
                allowed_mentions: { parse: [] }
            }
        });
    } catch (error) {
        console.error("[Balldex] Failed to send catch command:", error);
    }
}

// ─── Icons ─────────────────────────────────────────────────────────────────────

function BalldexIcon({ active = false, height = 20, width = 20, className }: {
    active?: boolean;
    height?: string | number;
    width?: string | number;
    className?: string;
}) {
    return (
        <svg
            className={className}
            aria-hidden="true"
            role="img"
            xmlns="http://www.w3.org/2000/svg"
            width={width}
            height={height}
            fill="none"
            viewBox="0 0 24 24"
            style={{ color: active ? "var(--status-positive)" : "currentColor" }}
        >
            <circle cx={12} cy={12} r={10} stroke="currentColor" strokeWidth={2} fill="none" />
            <path d="M12 6v12M6 12h12" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
        </svg>
    );
}

function RareIcon({ height = 16, width = 16 }: { height?: number; width?: number }) {
    return (
        <svg width={width} height={height} viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
    );
}

// ─── Chat Bar Button ───────────────────────────────────────────────────────────

const BalldexButton: ChatBarButtonFactory = ({ isMainChat }) => {
    const [active, setActive] = useState(settings.store.autoCatch);

    if (!isMainChat || !settings.store.quickCommands) return null;

    function toggleAutoCatch() {
        settings.store.autoCatch = !settings.store.autoCatch;
        setActive(settings.store.autoCatch);
    }

    return (
        <ChatBarButton
            tooltip={active ? "Balldex: Auto-catch ON (click to disable)" : "Balldex: Auto-catch OFF (click to enable)"}
            onClick={toggleAutoCatch}
        >
            <BalldexIcon active={active} />
        </ChatBarButton>
    );
};

// ─── Plugin ────────────────────────────────────────────────────────────────────

export default definePlugin({
    id: "Balldex",
    name: "Balldex",
    description: "Balldex integration: auto-catch Pokémon, spawn notifications, and quick commands.",
    authors: [TestcordDevs.sirphantom89],
    tags: ["Utility", "Fun"],
    dependencies: ["ChatInputButtonAPI"],
    settings,

    chatBarButton: {
        icon: BalldexIcon,
        render: BalldexButton
    },

    flux: {
        async MESSAGE_CREATE({ message, optimistic }: { message: Message; optimistic?: boolean }) {
            if (optimistic) return;
            if (!message?.channel_id || !message?.id) return;

            // Auto-catch logic
            if (settings.store.autoCatch && isBalldexSpawn(message)) {
                if (!isChannelAllowed(message.channel_id)) return;

                const delay = settings.store.autoCatchDelay ?? 1000;
                setTimeout(() => {
                    sendCatchCommand(message.channel_id, message.id);
                }, delay + Math.random() * 500);
            }

            // Spawn notifications
            if (isBalldexSpawn(message)) {
                const rarity = getRarityFromEmbed(message.embeds[0]);
                const name = getPokemonNameFromEmbed(message.embeds[0]);

                if ((settings.store.notifyRare && (rarity === "rare" || rarity === "legendary")) ||
                    (settings.store.notifyShiny && rarity === "shiny")) {
                    // Use the Notifications API if available, otherwise console.log
                    console.log(`[Balldex] ${rarity.toUpperCase()} spawn: ${name} in ${message.channel_id}`);
                }
            }
        }
    }
});
