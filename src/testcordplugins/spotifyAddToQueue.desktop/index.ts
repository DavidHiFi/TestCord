/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { showToast, Toasts } from "@webpack/common";

const EMBED_ORIGIN = "https://open.spotify.com";
const MESSAGE_PREFIX = "vc-spotifyaddtoqueue__";
const TRACK_ID = /^[A-Za-z0-9]{1,64}$/;

const SpotifySocket = findByPropsLazy("getActiveSocketAndDevice");
const SpotifyAPI = findByPropsLazy("vcSpotifyMarker");

const settings = definePluginSettings({
    cooldown: {
        description: "Ignore repeat clicks for this many milliseconds",
        type: OptionType.NUMBER,
        default: 750
    },
    notifyOnSuccess: {
        description: "Show a toast when a track lands in the queue",
        type: OptionType.BOOLEAN,
        default: false
    }
});

let lastQueued = 0;

async function queue(trackId: string) {
    const now = Date.now();
    if (now - lastQueued < settings.plain.cooldown) return;
    lastQueued = now;

    const { socket } = SpotifySocket.getActiveSocketAndDevice();
    if (!socket) {
        showToast("Open Spotify on this device first", Toasts.Type.FAILURE);
        return;
    }

    try {
        await SpotifyAPI.post(socket.accountId, socket.accessToken, {
            url: "https://api.spotify.com/v1/me/player/queue",
            query: { uri: `spotify:track:${trackId}` }
        });

        if (settings.plain.notifyOnSuccess) showToast("Added to your Spotify queue", Toasts.Type.SUCCESS);
    } catch {
        // Spotify rejects this for local files, podcasts and when premium is missing, so the
        // API message is not worth surfacing verbatim
        showToast("Spotify would not accept that track", Toasts.Type.FAILURE);
    }
}

/**
 * The embed is cross origin, so the only thing tying a message to Spotify is its origin.
 * Without that check any framed page could drive this listener.
 */
function onMessage(event: MessageEvent) {
    if (event.origin !== EMBED_ORIGIN) return;
    if (typeof event.data !== "string" || !event.data.startsWith(MESSAGE_PREFIX)) return;

    const trackId = event.data.slice(MESSAGE_PREFIX.length);
    if (!TRACK_ID.test(trackId)) return;

    void queue(trackId);
}

export default definePlugin({
    id: "SpotifyAddToQueue",
    name: "SpotifyAddToQueue",
    description: "Adds a button to Spotify embeds that queues the track",
    tags: ["Media", "Utility"],
    authors: [TestcordDevs.x2b],
    settings,

    start() {
        window.addEventListener("message", onMessage);
    },

    stop() {
        window.removeEventListener("message", onMessage);
    },

    patches: [
        {
            find: ".PLAYER_DEVICES",
            replacement: [
                {
                    match: /get:(\i)\.bind\(null,(\i\.\i)\.get\)/,
                    replace: "post:$1.bind(null,$2.post),vcSpotifyMarker:1,$&",
                    // the music controls module adds the same marker, and whichever patch runs
                    // second simply finds nothing left to match
                    noWarn: true
                }
            ]
        }
    ]
});
