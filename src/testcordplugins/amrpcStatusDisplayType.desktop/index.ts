/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher, showToast, Toasts } from "@webpack/common";

const APPLE_MUSIC_SOCKET = "AppleMusic";

const DISPLAY_TYPES = { off: 0, artist: 1, track: 2 } as const;

const settings = definePluginSettings({
    statusDisplayType: {
        description: "What to show instead of the generic listening message",
        type: OptionType.SELECT,
        options: [
            { label: "Nothing", value: "off", default: true },
            { label: "Artist name", value: "artist" },
            { label: "Track name", value: "track" }
        ]
    },
    notifyOnChange: {
        description: "Show a notification when Apple Music RPC starts or stops",
        type: OptionType.BOOLEAN,
        default: false
    }
});

let reentrant = false;
let wasListening = false;

export default definePlugin({
    id: "AMRPCStatusDisplayType",
    name: "AMRPCStatusDisplayType",
    description: "Show the track or artist name in the member list for Apple Music",
    tags: ["Activity", "Customisation"],
    authors: [TestcordDevs.x2b],
    settings,
    disabled: () => !isPluginEnabled("AppleMusicRichPresence"),
    flux: {
        LOCAL_ACTIVITY_UPDATE({ activity, socketId }) {
            if (reentrant || socketId !== APPLE_MUSIC_SOCKET) return;

            if (settings.store.notifyOnChange && !!activity !== wasListening) {
                wasListening = !!activity;
                showToast(
                    activity ? "Apple Music started playing" : "Apple Music stopped",
                    activity ? Toasts.Type.SUCCESS : Toasts.Type.MESSAGE
                );
            }

            if (!activity) return;

            reentrant = true;
            try {
                FluxDispatcher.dispatch({
                    type: "LOCAL_ACTIVITY_UPDATE",
                    activity: {
                        ...activity,
                        status_display_type: DISPLAY_TYPES[settings.store.statusDisplayType]
                    },
                    socketId: APPLE_MUSIC_SOCKET
                });
            } finally {
                reentrant = false;
            }
        }
    }
});
