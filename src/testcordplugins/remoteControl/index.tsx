/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import type { Message } from "@vencord/discord-types";
import { ChannelStore, UserStore } from "@webpack/common";

import { clearCommandState, dispatchCommand, markStarted } from "./commands";
import { startScheduler, stopScheduler } from "./scheduler";
import { settings } from "./settings";
import {
    clearRuntimeState,
    consumeRecentSend,
    deleteMessage,
    getAllowedUserIds,
    isChannelAllowed,
    logger,
    parseCommand,
    type RemoteContext,
    replyError,
    scheduleDeletion
} from "./utils";

interface MessageCreatePayload {
    optimistic?: boolean;
    channelId: string;
    message: Message;
}

async function handleMessage({ optimistic, channelId, message }: MessageCreatePayload) {
    if (optimistic) return;
    if (message.id.startsWith("-")) return;

    const currentUser = UserStore.getCurrentUser();
    if (!currentUser) return;

    const isSelf = message.author.id === currentUser.id;
    if (!isSelf && !getAllowedUserIds().has(message.author.id)) return;

    const prefix = settings.store.prefix || ".";
    const parsed = parseCommand(message.content, prefix);
    if (!parsed) return;

    if (consumeRecentSend(channelId, message.content)) return;

    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return;

    const bypass = parsed.name === "bind" || parsed.name === "unbind";
    if (!bypass && !isChannelAllowed(channel)) return;

    if (isSelf && settings.store.deleteCommandMessages) {
        const delay = Math.max(0, settings.store.commandDeleteDelay) * 1000;
        if (delay > 0) scheduleDeletion(() => deleteMessage(channelId, message.id), delay);
        else deleteMessage(channelId, message.id);
    }

    const ctx: RemoteContext = {
        channelId,
        messageId: message.id,
        channel,
        guildId: channel.guild_id,
        parsed
    };

    try {
        await dispatchCommand(ctx);
    } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        logger.error(`Command ${parsed.name} failed`, error);
        await replyError(ctx, text);
    }
}

export default definePlugin({
    id: "remoteControl",
    name: "RemoteControl",
    description: "Control your Discord client by messaging yourself commands. Other users can be granted access in settings.",
    authors: [TestcordDevs.x2b],
    tags: ["Commands", "Utility"],

    settings,

    dependencies: ["CommandsAPI", "UserSettingsAPI"],

    flux: {
        MESSAGE_CREATE(payload: MessageCreatePayload) {
            handleMessage(payload).catch(error => logger.error("Remote command handler failed", error));
        }
    },

    start() {
        markStarted();
        startScheduler();
    },

    stop() {
        stopScheduler();
        clearCommandState();
        clearRuntimeState();
    }
});
