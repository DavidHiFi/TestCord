/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { EquicordDevs } from "@utils/constants";
import { getUserAvatarUrl } from "@utils/misc";
import definePlugin from "@utils/types";
import { ChannelRTCStore, ChannelStore, IconUtils, UserStore, VoiceStateStore } from "@webpack/common";

import style from "./style.css?managed";

export default definePlugin({
    name: "FullVCPFP",
    description: "Makes avatars take up the entire vc tile",
    tags: ["Appearance", "Voice"],
    authors: [EquicordDevs.mochienya],
    managedStyle: style,
    patches: [
        {
            find: "\"data-selenium-video-tile\":",
            replacement: {
                match: /(?<=function\((\i),\i\)\{)/,
                replace: "Object.assign($1.style=$1.style||{},$self.getVoiceBackgroundStyles($1));",
            }
        },
    ],

    getVoiceBackgroundStyles({ participantUserId }: { className?: string; participantUserId?: string; }) {
        if (!participantUserId) return;

        const user = UserStore.getUser(participantUserId);
        if (!user) return;

        const channelId = VoiceStateStore.getVoiceStateForUser(participantUserId)?.channelId;
        const guildId = channelId ? ChannelStore.getChannel(channelId)?.guild_id : undefined;
        const isSpeaking = channelId
            ? ChannelRTCStore.getSpeakingParticipants(channelId).some(p => p.user.id === participantUserId && p.speaking)
            : false;

        // The stylesheet hides the tile's own avatar for every video tile, so this
        // variable must always hold a loadable URL. getUserAvatarUrl returns undefined
        // for members whose per-server avatar lookup yields nothing (its guild-member
        // branch has no fallback), which used to render `url(undefined)` = blank tile.
        const avatarUrl = getUserAvatarUrl(user, guildId, isSpeaking, 1024)
            || user.getAvatarURL?.(guildId, 1024, isSpeaking)
            || user.getAvatarURL?.(undefined, 1024, isSpeaking)
            || IconUtils.getDefaultAvatarURL(user.id, user.discriminator)
            || "https://cdn.discordapp.com/embed/avatars/0.png";

        return {
            "--full-res-avatar": `url("${avatarUrl}")`
        };
    },
});
