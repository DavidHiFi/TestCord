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

// The mask is a rounded rect in a 100x100 viewbox, so its rx scales the slider
// value with the painted picture; SVG clamps 52 to 50, which is the circle max.
function avatarMask(rx: number): string {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='${rx}' fill='#fff'/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function parseHexColor(color: string): [number, number, number] | undefined {
    const match = HEX_COLOR.exec(color.trim());
    if (!match) return undefined;
    let hex = match[1];
    if (hex.length < 6) hex = [...hex.slice(0, 3)].map(c => c + c).join("");
    const value = parseInt(hex, 16);
    return [value >> 16 & 0xff, value >> 8 & 0xff, value & 0xff];
}

// The glow keeps the two-layer look from the theme's first version: one wide
// soft halo plus one tight edge shell, both from the user's color. The glow
// mix controls its own transparency, so an alpha channel in the hex is ignored.
function glowFilter(color: string): string | undefined {
    const rgb = parseHexColor(color);
    if (!rgb) return undefined;
    const [r, g, b] = rgb;
    return `drop-shadow(0 0 14px rgba(${r}, ${g}, ${b}, 0.4)) drop-shadow(0 0 3px rgba(${r}, ${g}, ${b}, 0.6))`;
}

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
    },
    hideUserBackgrounds: {
        type: OptionType.BOOLEAN,
        description: "Also hide backgrounds that users set themselves, like USRBG banners. The background switch above only turns off Discord's own background.",
        default: false
    },
    speakingIndicator: {
        type: OptionType.SELECT,
        description: "Where the green speaking glow shows on call tiles. Profile picture moves it from the tile border onto the picture edge.",
        options: [
            {
                label: "Box border",
                value: "box",
                default: true
            },
            {
                label: "Profile picture",
                value: "picture"
            }
        ]
    },
    enableGlow: {
        type: OptionType.BOOLEAN,
        description: "Turn the glow behind floating profile pictures on or off. Applies when the background switch is on.",
        default: true
    },
    glowColor: {
        type: OptionType.STRING,
        description: "Hex color code for the glow, for example #45475a. The glow mixes its own transparency levels.",
        placeholder: "#45475a",
        default: "#45475a",
        isValid(value: string) {
            return HEX_COLOR.test(value.trim()) ? true : "Enter a hex color like #45475a.";
        }
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

        const hideBg = settings.store.hideTileBackground;
        const hideUserBg = settings.store.hideUserBackgrounds;
        // The glow is independent of the background switch: it wraps the picture
        // whether the tile box is visible or not.
        const glow = settings.store.enableGlow ? glowFilter(settings.store.glowColor ?? "") : undefined;
        const ringPic = settings.store.speakingIndicator === "picture";
        // The speaking glow merges into the same filter string: the backdrop
        // wrapper is unmasked, so its drop-shadow trails the picture outline.
        const filterParts: string[] = [];
        if (glow) filterParts.push(glow);
        if (ringPic && isSpeaking) filterParts.push("drop-shadow(0 0 2px var(--green-360, #23a55a)) drop-shadow(0 0 8px var(--green-360, #23a55a))");
        return {
            "--full-res-avatar": `url("${avatarUrl}")`,
            "--vc-pfp-radius": `${Math.round(settings.store.cornerRadius)}px`,
            "--vc-pfp-avatar-mask": avatarMask(Math.round(settings.store.avatarRadius)),
            "--vc-pfp-avatar-radius": `${Math.round(settings.store.avatarRadius)}%`,
            "--vc-pfp-zoom": `${Math.round(settings.store.zoom) / 100}`,
            // The background shorthand resets every background key in the merged
            // style object and erased USRBG's inline banner with Discord's own
            // paint (measured live, work/rvcpfp-usrbg-toggle-20261008). The color
            // longhand clears only the native box, and the image key is sent only
            // when user backgrounds are meant to hide, so USRBG's own keys
            // survive untouched otherwise.
            backgroundColor: hideBg ? "transparent" : "",
            ...(hideUserBg ? { backgroundImage: "none" } : {}),
            "--vc-pfp-hide-bg": hideBg ? "1" : "",
            "--vc-pfp-speaking": isSpeaking ? "1" : "",
            "--vc-pfp-ring-pic": ringPic ? "1" : "",
            // Marks this plugin version for theme handoff: themes drop their own
            // fallback glow when the slot is present. The filter string carries the
            // configured color; themes and any other stylesheet consume it.
            "--vc-pfp-glow-slot": "1",
            "--vc-pfp-glow-filter": filterParts.length ? filterParts.join(" ") : ""
        };
    },
});
