/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { migratePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { EquicordDevs } from "@utils/constants";
import definePlugin from "@utils/types";

import { handlePlaybackRateUpdate, stopPlayback, useBackgroundPlayback } from "./playback";
import { VoiceMessageIcon, VoiceMessagesInBackgroundPlayer } from "./player";

interface PlaybackRateUpdate {
    playbackType: string;
    rate: number;
}

const WrappedVoiceMessagesInBackgroundPlayer = ErrorBoundary.wrap(VoiceMessagesInBackgroundPlayer, { noop: true });

migratePluginSettings("VoiceMessagesInBackground", "Voice Messages In-Background");
export default definePlugin({
    id: "VoiceMessagesInBackground",
    name: "VoiceMessagesInBackground",
    description: "Keeps voice messages playing across chats with a synchronized mini player.",
    authors: [EquicordDevs.ELJoOker],
    tags: ["Voice", "Media", "Chat"],
    dependencies: ["AudioPlayerAPI", "HeaderBarAPI"],

    patches: [{
        // playbackCacheKey: is unique to the voice message player module,
        // so this patch only targets it (avoids noEffect on unrelated modules
        // that merely share the intl string).
        find: "playbackCacheKey:",
        replacement: {
            match: /(playbackCacheKey:\i}[\s\S]{0,400}?)(\[(\i),(\i)\]=(\i)\.useState\(([\s\S]{0,40}?>0)\))([\s\S]{0,200}?)(\[(\i),(\i)\]=(\i)\.useState\((\i)\))/,
            replace: "$1$2;$self.useBackgroundPlayback([$3,$4],$9,arguments[0]?.src,arguments[0]?.playbackCacheKey,$10)$7$8"
        }
    }],

    headerBarButton: {
        icon: VoiceMessageIcon,
        location: "channeltoolbar",
        priority: 30,
        render: () => <WrappedVoiceMessagesInBackgroundPlayer />
    },

    flux: {
        MEDIA_PLAYBACK_RATE_UPDATE({ playbackType, rate }: PlaybackRateUpdate) {
            if (playbackType === "voice_message") handlePlaybackRateUpdate(rate);
        }
    },

    useBackgroundPlayback,
    stop: stopPlayback
});
