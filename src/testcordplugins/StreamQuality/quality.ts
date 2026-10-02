/* eslint-disable simple-header/header -- Independently written MIT plugin. */
/* Copyright (c) 2026 DavidHiFi. SPDX-License-Identifier: MIT */

export interface QualitySettings {
    fpsEnabled: boolean;
    fps: number;
    resolutionEnabled: boolean;
    resolution: number;
    resolutionWidth: string;
    resolutionHeight: string;
    bitrateEnabled: boolean;
    bitrate: number;
    codecEnabled: boolean;
    videoCodec: string;
    keyframeIntervalEnabled: boolean;
    keyframeInterval: number;
    hdrEnabled: boolean;
    spoofBadgeEnabled: boolean;
    spoofBadgeResolution: number;
    spoofBadgeWidth: string;
    spoofBadgeHeight: string;
    spoofBadgeFps: number;
}

export interface Size {
    width: number;
    height: number;
}

type Data = Record<string, any>;

const widths = new Map([
    [32, 56], [144, 256], [240, 426], [360, 640], [480, 854],
    [720, 1280], [1080, 1920], [1440, 2560], [2160, 3840], [4320, 7680]
]);

function dimension(value: string, fallback: number): number {
    const n = Number(value);
    return Number.isSafeInteger(n) && n > 0 && n <= 16384 ? n : fallback;
}

export function resolution(choice: number, width: string, height: string): Size {
    if (choice === 0) return { width: dimension(width, 1920), height: dimension(height, 1080) };
    const presetWidth = widths.get(choice);
    return presetWidth ? { width: presetWidth, height: choice } : { width: 1920, height: 1080 };
}

/** Resolution the encoder should use, or null to keep Discord's choice. */
export function actualSize(s: QualitySettings): Size | null {
    return s.resolutionEnabled ? resolution(s.resolution, s.resolutionWidth, s.resolutionHeight) : null;
}

export function actualFps(s: QualitySettings): number | null {
    return s.fpsEnabled ? s.fps : null;
}

export function bitrateBps(s: QualitySettings): number | null {
    return s.bitrateEnabled ? s.bitrate * 1000 : null;
}

/** Resolution viewers are told about: the spoof when enabled, otherwise the real override. */
export function advertisedSize(s: QualitySettings): Size | null {
    if (s.spoofBadgeEnabled) return resolution(s.spoofBadgeResolution, s.spoofBadgeWidth, s.spoofBadgeHeight);
    return actualSize(s);
}

export function advertisedFps(s: QualitySettings): number | null {
    return s.spoofBadgeEnabled ? s.spoofBadgeFps : actualFps(s);
}

function isVideo(p: unknown): p is Data {
    return !!p && typeof p === "object" && (p as Data).type !== "audio";
}

/**
 * Returns the stream list for voice gateway opcode 12. Viewers build the stream
 * badge from these values. Discord's own array is left untouched, so the local
 * encoder keeps the real values.
 */
export function advertiseStreams(streams: unknown, s: QualitySettings): unknown {
    if (!Array.isArray(streams)) return streams;
    const size = advertisedSize(s);
    const fps = advertisedFps(s);
    const bps = bitrateBps(s);
    if (!size && fps == null && bps == null) return streams;

    return streams.map(p => {
        if (!isVideo(p)) return p;
        const copy = { ...p };
        if (size) {
            copy.maxResolution = { type: "fixed", width: size.width, height: size.height };
            copy.maxPixelCount = size.width * size.height;
        }
        if (fps != null) copy.maxFrameRate = fps;
        if (bps != null) copy.maxBitrate = bps;
        return copy;
    });
}

/** Writes the real encoder settings into a transport options object. */
export function patchEncoding(options: Data, s: QualitySettings): void {
    const size = actualSize(s);
    const fps = actualFps(s);
    const bps = bitrateBps(s);
    if (size) {
        options.encodingVideoWidth = size.width;
        options.encodingVideoHeight = size.height;
        options.remoteSinkWantsPixelCount = size.width * size.height;
    }
    if (fps != null) {
        options.encodingVideoFrameRate = fps;
        options.captureVideoFrameRate = fps;
        options.remoteSinkWantsMaxFramerate = fps;
    }
    if (bps != null) {
        options.encodingVideoBitRate = bps;
        options.encodingVideoMinBitRate = bps;
        options.encodingVideoMaxBitRate = bps;
    }
}

/**
 * Applies the overrides to a result of Discord's applyQualityConstraints. The
 * quality object can be Discord's cached go-live quality, so it is copied.
 */
export function patchConstraints<T>(result: T, s: QualitySettings): T {
    if (!result || typeof result !== "object") return result;
    const size = actualSize(s);
    const fps = actualFps(s);
    const bps = bitrateBps(s);
    if (!size && fps == null && bps == null) return result;

    const { quality, constraints } = result as Data;
    if (constraints && typeof constraints === "object") patchEncoding(constraints, s);
    if (!quality || typeof quality !== "object") return result;

    const part = (p: Data | undefined) => p && {
        ...p,
        ...(size ? { width: size.width, height: size.height, pixelCount: size.width * size.height } : {}),
        ...(fps != null ? { framerate: fps } : {})
    };
    return {
        ...result,
        quality: {
            ...quality,
            capture: part(quality.capture),
            encode: part(quality.encode),
            ...(bps != null ? { bitrateMin: bps, bitrateMax: bps, bitrateTarget: bps } : {})
        }
    };
}

/** Arguments for Discord's setDesktopEncodingOptions(width, height, framerate). */
export function encodingOverride(width: number, height: number, framerate: number, s: QualitySettings): [number, number, number] {
    const size = actualSize(s);
    return [size?.width ?? width, size?.height ?? height, actualFps(s) ?? framerate];
}

export function maxBitrate(bitrate: number, s: QualitySettings): number {
    return bitrateBps(s) ?? bitrate;
}

export function keyframeInterval(interval: number, s: QualitySettings): number {
    return s.keyframeIntervalEnabled ? s.keyframeInterval : interval;
}

/** Picks the forced codec when the voice server negotiated it for encoding. */
export function videoCodec(serverCodec: string, codecs: unknown, s: QualitySettings): string {
    if (!s.codecEnabled || !Array.isArray(codecs)) return serverCodec;
    const usable = codecs.some(c => c?.type === "video" && c.name === s.videoCodec && c.encode !== false);
    return usable ? s.videoCodec : serverCodec;
}

/** Go-live source settings with HDR capture requested. Discord's object is copied. */
export function goLiveSource<T>(source: T, s: QualitySettings): T {
    const description = (source as Data | undefined)?.desktopDescription;
    if (!s.hdrEnabled || !description || typeof description !== "object") return source;
    return { ...source, desktopDescription: { ...description, hdrCaptureMode: "always" } };
}

/** Values for the badge on your own stream tile, so it matches what viewers see. */
export function badgeFps(fps: number, s: QualitySettings): number {
    return advertisedFps(s) ?? fps;
}

export function badgeResolution(maxResolution: Data, s: QualitySettings): Data {
    const size = advertisedSize(s);
    return size ? { type: "fixed", width: size.width, height: size.height } : maxResolution;
}
