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
    avatarRadius: {
        type: OptionType.SLIDER,
        description: "Profile picture corner rounding. 0 is a flat square like FullVCPFP; 50 and higher is a full circle.",
        markers: makeRange(0, 52, 2),
        default: 5,
        stickToMarkers: true
    },
    cornerRadius: {
        type: OptionType.SLIDER,
        description: "Tile corner rounding in pixels. 0 is flat like FullVCPFP; 12 is a clean, visible round.",
        markers: makeRange(0, 52, 2),
        default: 12,
        stickToMarkers: true
    },
    zoom: {
        type: OptionType.SLIDER,
        description: "Avatar zoom in percent. 100 is the current size; lower values zoom the picture out inside the tile.",
        markers: makeRange(25, 100, 5),
        default: 100,
        stickToMarkers: true
    },
    hideTileBackground: {
        type: OptionType.BOOLEAN,
        description: "Turn off the background box behind profile pictures in call tiles and show only the picture.",
        default: false
    }
});

// The mask is a rounded rect in a 100x100 viewbox, so its rx scales the slider
// value with the painted picture; SVG clamps 52 to 50, which is the circle max.
function avatarMask(rx: number): string {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='${rx}' fill='#fff'/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

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

        const hideBg = settings.store.hideTileBackground;
        return {
            "--full-res-avatar": `url("${avatarUrl}")`,
            "--vc-pfp-radius": `${Math.round(settings.store.cornerRadius)}px`,
            "--vc-pfp-avatar-mask": avatarMask(Math.round(settings.store.avatarRadius)),
            "--vc-pfp-avatar-radius": `${Math.round(settings.store.avatarRadius)}%`,
            "--vc-pfp-zoom": `${Math.round(settings.store.zoom) / 100}`,
            // Empty string clears the inline background so the toggle off restores
            // Discord's paint; "none" hides the tile's own box when the switch is on.
            background: hideBg ? "none" : "",
            "--vc-pfp-hide-bg": hideBg ? "1" : ""
        };
    },
});
