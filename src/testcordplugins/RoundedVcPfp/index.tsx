/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { EquicordDevs, TestcordDevs } from "@utils/constants";
import { getUserAvatarUrl } from "@utils/misc";
import definePlugin, { makeRange, OptionType } from "@utils/types";
import { ChannelRTCStore, ChannelStore, UserStore, VoiceStateStore } from "@webpack/common";

import style from "./style.css?managed";

const settings = definePluginSettings({
    cornerRadius: {
        type: OptionType.SLIDER,
        description: "Tile corner rounding in pixels. 0 is flat like FullVCPFP; 12 is a clean, visible round.",
        markers: makeRange(0, 36, 2),
        default: 12,
        stickToMarkers: true
    },
    zoom: {
        type: OptionType.SLIDER,
        description: "Avatar zoom in percent. 100 is the current size; lower values zoom the picture out inside the tile.",
        markers: makeRange(50, 100, 5),
        default: 100,
        stickToMarkers: true
    }
});

export default definePlugin({
    name: "RoundedVCPFP",
    description: "Fork of FullVCPFP: fills the vc tile with the full-size avatar, with lightly rounded corners instead of square ones",
    tags: ["Appearance", "Voice"],
    authors: [EquicordDevs.mochienya, TestcordDevs.DavidHiFi],
    settings,
    managedStyle: style,
    patches: [
        {
            find: "\"data-selenium-video-tile\":",
            replacement: {
                // USRBG patches this component from the function head and wins the
                // patch-order race, so a head-anchored lookahead stops matching after
                // its Object.assign lands (notes/2026-10-08-voice-tile-avatars.md).
                // Anchor after the destructuring like the local userplugin copy;
                // Object.assign merges the style keys in any apply order.
                match: /(?<=let\{children:(\i),className:(\i),style:(\i),noBorder:(\i)=!1,participantUserId:(\i),ref:(\i)\}=(\i);)/,
                replace: "Object.assign($3=$3||{},$self.getVoiceBackgroundStyles($7));",
            }
        },
    ],

    getVoiceBackgroundStyles({ className, participantUserId }: { className?: string; participantUserId?: string; }) {
        if (!className?.includes("tile") || !participantUserId) return;

        const user = UserStore.getUser(participantUserId);
        if (!user) return;
        const legacyUser: typeof user & { getDefaultAvatarURL?: () => string; } = user;

        const channelId = VoiceStateStore.getVoiceStateForUser(participantUserId)?.channelId;
        const guildId = channelId ? ChannelStore.getChannel(channelId)?.guild_id : undefined;
        const isSpeaking = channelId
            ? ChannelRTCStore.getSpeakingParticipants(channelId).some(p => p.user.id === participantUserId && p.speaking)
            : false;

        // Fallback chain from the local FullVCPFP fix: getUserAvatarUrl's guild
        // branch can return undefined, which used to render blank tiles.
        const avatarUrl = getUserAvatarUrl(user, guildId, isSpeaking, 1024)
            || user.getAvatarURL?.(guildId, 1024, isSpeaking)
            || user.getAvatarURL?.(undefined, 1024, isSpeaking)
            || (typeof legacyUser.getDefaultAvatarURL === "function" ? legacyUser.getDefaultAvatarURL() : undefined)
            || "https://cdn.discordapp.com/embed/avatars/0.png";

        return {
            "--full-res-avatar": `url("${avatarUrl}")`,
            "--vc-pfp-radius": `${Math.round(settings.store.cornerRadius)}px`,
            "--vc-pfp-zoom": `${Math.round(settings.store.zoom) / 100}`
        };
    },
});
