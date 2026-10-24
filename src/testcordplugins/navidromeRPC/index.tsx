/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { ApplicationAssetUtils, FluxDispatcher, showToast, Toasts } from "@webpack/common";

import { APPLICATION_ID, coverArtUrl, getNowPlaying, type NowPlaying } from "./api";
import { ServerConfig } from "./components/ServerConfig";

const SOCKET_ID = "NavidromeRPC";
const RETRY_DELAY = 5000;
const MIN_POLL = 500;

export const settings = definePluginSettings({
    serverURL: {
        type: OptionType.STRING,
        default: "",
        description: ""
    },
    username: {
        type: OptionType.STRING,
        default: "",
        description: ""
    },
    name: {
        description: "Application name. Placeholders: %TRACK% %ARTIST% %ARTISTS% %ALBUM%",
        type: OptionType.STRING,
        default: "Navidrome"
    },
    delay: {
        description: "How often to ask the server what is playing, in milliseconds",
        type: OptionType.NUMBER,
        default: 1000
    },
    shouldCalculateTimestamps: {
        description: "Send start and end times so Discord can draw a progress bar",
        type: OptionType.BOOLEAN,
        default: false
    },
    showArtwork: {
        description: "Upload the album art as the activity image",
        type: OptionType.BOOLEAN,
        default: true
    },
    server: {
        type: OptionType.COMPONENT,
        description: "",
        component: ServerConfig
    }
}).withPrivateSettings<{ trackId: string; startedAt: number }>();

function clearActivity() {
    FluxDispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", activity: null, socketId: SOCKET_ID });
}

function fill(template: string, track: NowPlaying) {
    return template
        .replaceAll("%TRACK%", track.title)
        .replaceAll("%ARTIST%", track.artists[0] ?? track.albumArtist)
        .replaceAll("%ARTISTS%", track.artists.join(", "))
        .replaceAll("%ALBUM%", track.album);
}

async function buildActivity(track: NowPlaying) {
    const { name, shouldCalculateTimestamps, showArtwork } = settings.plain;

    let largeImage: string | undefined;
    if (showArtwork && track.coverId) {
        try {
            [largeImage] = await ApplicationAssetUtils.fetchAssetIds(APPLICATION_ID, [await coverArtUrl(track.coverId)]);
        } catch {
            // artwork is a nice to have, a failed upload should not cost us the whole activity
        }
    }

    const activity: Record<string, unknown> = {
        application_id: APPLICATION_ID,
        name: fill(name, track),
        type: 2,
        status_display_type: 1,
        details: track.title,
        state: track.artists.join(", "),
        assets: {
            ...(largeImage ? { large_image: largeImage } : {}),
            large_text: track.album
        }
    };

    if (shouldCalculateTimestamps) {
        // the server only reports how many minutes ago a track started, so the start time is
        // pinned the first time we see a given track and held until the track actually changes
        if (settings.plain.trackId !== track.id) {
            settings.store.trackId = track.id;
            settings.store.startedAt = Date.now() - track.minutesAgo * 60_000;
        }

        activity.timestamps = {
            start: String(settings.plain.startedAt),
            end: String(settings.plain.startedAt + track.duration * 1000)
        };
    }

    return activity;
}

let timer: number | undefined;
let running = false;

function schedule(delay: number) {
    if (!running) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(tick, Math.max(MIN_POLL, delay));
}

async function tick() {
    if (!running) return;

    try {
        const track = await getNowPlaying();
        if (!running) return;

        const activity = track ? await buildActivity(track) : null;
        if (!running) return;

        FluxDispatcher.dispatch({ type: "LOCAL_ACTIVITY_UPDATE", activity, socketId: SOCKET_ID });
        schedule(settings.plain.delay);
    } catch (error) {
        if (!running) return;

        clearActivity();
        showToast(`NavidromeRPC: ${(error as Error).message}`, Toasts.Type.FAILURE);
        schedule(RETRY_DELAY);
    }
}

/** Used by the login form once the credentials check out. */
export function restart() {
    window.clearTimeout(timer);
    if (running) void tick();
}

export default definePlugin({
    id: "NavidromeRPC",
    name: "NavidromeRPC",
    description: "Show what your Navidrome server is playing in your rich presence",
    tags: ["Activity", "Media"],
    authors: [TestcordDevs.x2b],
    settings,

    start() {
        if (!settings.plain.serverURL || !settings.plain.username) {
            showToast("NavidromeRPC needs a server URL and username first", Toasts.Type.FAILURE);
            return;
        }

        running = true;
        void tick();
    },

    stop() {
        running = false;
        window.clearTimeout(timer);
        timer = undefined;
        clearActivity();
        settings.store.trackId = "";
    }
});
