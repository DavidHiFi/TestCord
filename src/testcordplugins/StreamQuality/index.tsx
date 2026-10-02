/* eslint-disable simple-header/header -- Independently written MIT plugin. */
/* Copyright (c) 2026 DavidHiFi. SPDX-License-Identifier: MIT */

import { definePluginSettings } from "@api/Settings";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { findStoreLazy } from "@webpack";

import { patches } from "./patches";
import {
    advertiseStreams,
    badgeFps,
    badgeResolution,
    encodingOverride,
    goLiveSource,
    keyframeInterval,
    maxBitrate,
    patchConstraints,
    QualitySettings,
    videoCodec
} from "./quality";

const log = new Logger("CustomStreamQuality");
const StreamRTCConnectionStore = findStoreLazy("StreamRTCConnectionStore");

const resolutions = [
    { label: "32p", value: 32 }, { label: "144p", value: 144 },
    { label: "240p", value: 240 }, { label: "360p", value: 360 },
    { label: "480p", value: 480 }, { label: "720p", value: 720 },
    { label: "1080p", value: 1080 }, { label: "1440p", value: 1440 },
    { label: "4K", value: 2160 }, { label: "8K", value: 4320 },
    { label: "Custom", value: 0 }
];
const fpsMarkers = [1, 5, 10, 15, 20, 30, 60, 120, 240, 360];

const settings = definePluginSettings({
    fpsEnabled: { type: OptionType.BOOLEAN, description: "Override the encoded frame rate.", default: true, onChange: refresh },
    fps: { type: OptionType.SLIDER, description: "Encoded frames per second.", default: 60, markers: fpsMarkers, stickToMarkers: true, onChange: refresh },
    resolutionEnabled: { type: OptionType.BOOLEAN, description: "Override the encoded resolution.", default: true, onChange: refresh },
    resolution: { type: OptionType.SELECT, description: "Encoded resolution.", options: resolutions.map(r => ({ ...r, default: r.value === 1080 })), onChange: refresh },
    resolutionWidth: { type: OptionType.STRING, description: "Custom encoded width.", default: "1920", hidden: () => settings.store.resolution !== 0, onChange: refresh },
    resolutionHeight: { type: OptionType.STRING, description: "Custom encoded height.", default: "1080", hidden: () => settings.store.resolution !== 0, onChange: refresh },
    bitrateEnabled: { type: OptionType.BOOLEAN, description: "Override the video bitrate.", default: true, onChange: refresh },
    bitrate: { type: OptionType.SLIDER, description: "Video bitrate in kbps.", default: 5000, markers: [500, 1000, 2500, 5000, 7500, 10000, 20000, 40000, 60000, 80000, 100000], stickToMarkers: false, onChange: refresh },
    codecEnabled: { type: OptionType.BOOLEAN, description: "Force a video codec from your next stream. Viewers whose client cannot decode it see no video.", default: false },
    videoCodec: { type: OptionType.SELECT, description: "Video codec.", options: [{ label: "H264", value: "H264", default: true }, { label: "H265", value: "H265" }, { label: "VP8", value: "VP8" }, { label: "VP9", value: "VP9" }, { label: "AV1", value: "AV1" }] },
    keyframeIntervalEnabled: { type: OptionType.BOOLEAN, description: "Override the keyframe interval.", default: false, onChange: refresh },
    keyframeInterval: { type: OptionType.SLIDER, description: "Keyframe interval in milliseconds. Zero uses the encoder default.", default: 0, markers: [0, 500, 1000, 2000, 5000, 10000], stickToMarkers: true, onChange: refresh },
    hdrEnabled: { type: OptionType.BOOLEAN, description: "Capture in HDR. Applies from the next screen share.", default: false },
    spoofBadgeEnabled: { type: OptionType.BOOLEAN, description: "Show viewers a different resolution and frame rate on the stream badge. Your real encoding does not change.", default: false, onChange: refresh },
    spoofBadgeResolution: { type: OptionType.SELECT, description: "Resolution on the badge.", options: resolutions.map(r => ({ ...r, default: r.value === 2160 })), onChange: refresh },
    spoofBadgeWidth: { type: OptionType.STRING, description: "Custom badge width.", default: "3840", hidden: () => settings.store.spoofBadgeResolution !== 0, onChange: refresh },
    spoofBadgeHeight: { type: OptionType.STRING, description: "Custom badge height.", default: "2160", hidden: () => settings.store.spoofBadgeResolution !== 0, onChange: refresh },
    spoofBadgeFps: { type: OptionType.SLIDER, description: "Frame rate on the badge.", default: 120, markers: fpsMarkers, stickToMarkers: true, onChange: refresh }
});

let active = false;

function config(): QualitySettings {
    return settings.store as QualitySettings;
}

/** True for the media connection that sends your own screen share. */
function isOwnStream(connection: any): boolean {
    return active && connection?.context === "stream" && connection.streamUserId != null && connection.streamUserId === connection.userId;
}

function guard<T>(what: string, fallback: T, run: () => T): T {
    try {
        return run();
    } catch (error) {
        log.error(`Could not apply ${what}`, error);
        return fallback;
    }
}

/** Re-applies encoder settings and re-sends the badge values for streams you are broadcasting. */
function refresh(): void {
    let connections: Record<string, any>;
    try {
        connections = StreamRTCConnectionStore.getRTCConnections?.() ?? {};
    } catch {
        return;
    }
    for (const rtc of Object.values(connections)) {
        if (!rtc?.isOwner) continue;
        const media = rtc._connection;
        if (!media || media.destroyed) continue;
        guard("live update", undefined, () => {
            // lastDesktopEncodingOptions holds Discord's own values, so this re-runs the capture override.
            const last = media.lastDesktopEncodingOptions;
            if (last) media.setDesktopEncodingOptions(last.width, last.height, last.framerate);
            media.updateVideoQuality?.();
            if (media.serverKeyframeInterval !== undefined || config().keyframeIntervalEnabled) {
                media.setKeyframeInterval?.(media.serverKeyframeInterval ?? 0);
            }
            // Viewers only get new badge values when opcode 12 is sent again.
            const params = media.videoStreamParameters;
            if (params?.length) {
                const video = params.find((p: any) => p.quality === 100) ?? params[0];
                rtc.sendVideo(media.audioSSRC ?? 0, video.ssrc ?? 0, video.rtxSsrc ?? 0, params);
            }
        });
    }
}

export default definePlugin({
    name: "CustomStreamQuality",
    description: "Set your stream's resolution, frame rate, bitrate and codec, and choose what the stream badge shows viewers.",
    tags: ["Voice", "Utility"],
    authors: [{ name: "DavidHiFi", id: 1553713171938938891n }],
    settings,
    patches,

    advertise(rtc: any, streams: unknown) {
        if (!active || rtc?.context !== "stream") return streams;
        return guard("badge values", streams, () => advertiseStreams(streams, config()));
    },

    badgeFps(fps: number) {
        return active ? guard("own badge", fps, () => badgeFps(fps, config())) : fps;
    },

    badgeResolution(maxResolution: Record<string, any>) {
        return active ? guard("own badge", maxResolution, () => badgeResolution(maxResolution, config())) : maxResolution;
    },

    constraints<T>(connection: any, result: T): T {
        return isOwnStream(connection) ? guard("encoder limits", result, () => patchConstraints(result, config())) : result;
    },

    encoding(connection: any, width: number, height: number, framerate: number) {
        const original: [number, number, number] = [width, height, framerate];
        return isOwnStream(connection) ? guard("capture size", original, () => encodingOverride(width, height, framerate, config())) : original;
    },

    maxBitrate(connection: any, bitrate: number) {
        return isOwnStream(connection) ? maxBitrate(bitrate, config()) : bitrate;
    },

    codec(connection: any, _audioCodec: string, codec: string, context: string) {
        if (!isOwnStream(connection) || context !== "stream") return codec;
        return guard("codec", codec, () => videoCodec(codec, connection.codecs, config()));
    },

    keyframe(connection: any, interval: number) {
        if (!isOwnStream(connection)) return interval;
        // Callers always pass the server's value; keep it so turning the override off restores it.
        connection.serverKeyframeInterval = interval;
        return keyframeInterval(interval, config());
    },

    goLiveSource<T>(connection: any, source: T): T {
        return isOwnStream(connection) ? guard("HDR capture", source, () => goLiveSource(source, config())) : source;
    },

    start() {
        active = true;
        refresh();
    },

    stop() {
        active = false;
        refresh();
    }
});
