/* eslint-disable simple-header/header -- This standalone user plugin is MIT licensed. */
/*
 * StereoGuard
 * Copyright (c) 2026 Kurtzon Audio
 * Copyright (c) 2026 DavidHiFi
 * SPDX-License-Identifier: MIT
 */

import { DataStore } from "@api/index";
import { plugins } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import { UserAreaButton, UserAreaRenderProps } from "@api/UserArea";
import { openPluginModal } from "@components/settings";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { makeRange, OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Button, MediaEngineStore, React, RelationshipStore, showToast, Toasts, UserStore } from "@webpack/common";

import { VolumeHold } from "./protection";

const logger = new Logger("StereoGuard");

const IGNORED_KEY = "StereoGuard_ignored";
const HELD_KEY = "StereoGuard_held_volumes";
const POLL_MS = 50;
const SCAN_MS = 500;
const STALE_MS = 3000;
const WINDOW_MS = 2000;
const PAN_WINDOW_MS = 4000;
const TRIGGER_COOLDOWN_MS = 3000;
const NOISE_GATE = 0.02;
const RELEASE = 0.3;
const LEVEL_FLOOR_DB = -45;

const STEREO_GUARD_KEYS = ["enabled"] as const;

interface AudioOutput {
    id: string;
    stream: MediaStream;
}

interface VoiceStats {
    rtp?: { inbound?: Record<string, unknown> | unknown[]; };
}

interface GuardVolume {
    isHolding?: (userId: string) => boolean;
    getHeldBaseline?: (userId: string) => number | undefined;
}

interface VoiceConnection {
    context: string;
    outputs?: Record<string, AudioOutput>;
    localMutes?: Record<string, boolean>;
    audioContext?: AudioContext;
    emitter?: {
        on?: (event: string, handler: (payload: VoiceStats) => void) => void;
        off?: (event: string, handler: (payload: VoiceStats) => void) => void;
    };
    getUserIdBySsrc?: (ssrc: number) => string | null;
}

interface Meter {
    output: AudioOutput;
    source: MediaStreamAudioSourceNode;
    processor: ScriptProcessorNode;
    frameAt: { value: number; };
    silent: GainNode;
    bufLeft: Float32Array<ArrayBuffer>;
    bufRight: Float32Array<ArrayBuffer>;
    mono: boolean;
    score: number;
    pans: number[];
    panAt: number[];
    loudTicks: number[];
    lastTriggerAt: number;
}

const meters = new Map<string, Meter>();
const mutedByUs = new Map<string, number>();
const volumeHolds = new Map<string, VolumeHold>();
const ignored = new Set<string>();
const savedVolume = new Map<string, number>();

const { setLocalVolume } = findByPropsLazy("setLocalVolume");
const levels = new Map<string, number>();
const levelAt = new Map<string, number>();

let connection: VoiceConnection | null = null;
let boundConnection: VoiceConnection | null = null;
let intervalId: ReturnType<typeof setInterval> | undefined;
let lastScanAt = 0;
let captureRetryAt = 0;

let mixMeter: Meter | null = null;
let mixStream: MediaStream | null = null;
let mixContext: AudioContext | null = null;
let mixScore = 0;
let captureDeviceLabel = "";
let captureStarting = false;
let persistQueue = Promise.resolve();

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Watch the call and mute anyone whose audio is obnoxiously wide, panned, or panning around.",
        default: true,
        onChange() {
            if (!settings.store.enabled) unmuteAll("silent");
        }
    },
    desktopCapture: {
        type: OptionType.BOOLEAN,
        description: "Show the desktop output mix score for reference. A mixed capture cannot identify a participant and never triggers a mute.",
        default: true,
        onChange() {
            stopCapture();
            void syncCapture();
        }
    },
    captureDevice: {
        type: OptionType.STRING,
        description: "Optional capture device name for desktop detection (for example 'Discord Input (VAIO 2)'). Leave empty to auto-match the current Discord output device.",
        default: "",
        onChange() {
            stopCapture();
            void syncCapture();
        }
    },
    threshold: {
        type: OptionType.SLIDER,
        description: "How much stereo counts as obnoxious. Hard panning, panning around, and wide stereo music all push the score up; centered mono voice stays near zero. Check the live scores above.",
        markers: makeRange(30, 100, 5),
        default: 65,
        stickToMarkers: true
    },
    sensitivity: {
        type: OptionType.SLIDER,
        description: "How much stereo audio is needed before a mute. Higher reacts to shorter bursts.",
        markers: makeRange(1, 10, 1),
        default: 5,
        stickToMarkers: true
    },
    autoUnmute: {
        type: OptionType.SELECT,
        description: "How long fresh participant-owned frames must stay below the release threshold before volume returns smoothly. Missing frames keep the hold. Off requires manual restore.",
        options: [
            { label: "Off (stay muted)", value: 0 },
            { label: "3 seconds", value: 3 },
            { label: "5 seconds", value: 5 },
            { label: "10 seconds", value: 10, default: true },
            { label: "30 seconds", value: 30 },
            { label: "1 minute", value: 60 },
            { label: "2 minutes", value: 120 },
            { label: "5 minutes", value: 300 }
        ]
    },
    ignoreFriends: {
        type: OptionType.BOOLEAN,
        description: "Never mute your friends.",
        default: true
    },
    notify: {
        type: OptionType.BOOLEAN,
        description: "Show a toast when the guard mutes, unmutes, or auto-unmutes someone.",
        default: true
    }
});

function toPercent(level: number) {
    if (!Number.isFinite(level) || level <= 0) return 0;

    const db = 20 * Math.log10(Math.min(level, 1));
    return Math.max(0, Math.min(100, Math.round(((db - LEVEL_FLOOR_DB) / -LEVEL_FLOOR_DB) * 100)));
}

function displayName(userId: string) {
    const user = UserStore.getUser(userId);
    return user?.globalName ?? user?.username ?? userId;
}

function formatDuration(seconds: number) {
    if (seconds % 60 === 0) {
        const minutes = seconds / 60;
        return `${minutes} minute${minutes === 1 ? "" : "s"}`;
    }

    return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

function isIgnored(userId: string) {
    if (ignored.has(userId)) return true;
    if (UserStore.getCurrentUser()?.id === userId) return true;

    const user = UserStore.getUser(userId);
    if (user?.bot) return true;

    return settings.store.ignoreFriends && RelationshipStore.isFriend(userId);
}

function isLocalMuted(userId: string) {
    return connection?.localMutes?.[userId] ?? MediaEngineStore.isLocalMute(userId);
}

function getConnection(): VoiceConnection | null {
    const engine = MediaEngineStore.getMediaEngine();
    if (!engine?.connections) return null;

    for (const conn of engine.connections as Iterable<VoiceConnection>) {
        if (conn?.context === "default") return conn;
    }

    return null;
}

function channelCount(output: AudioOutput) {
    return output.stream.getAudioTracks()[0]?.getSettings?.().channelCount ?? 0;
}

function makeAnalyserPair(context: AudioContext, stream: MediaStream) {
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(2048, 2, 2);
    const bufLeft = new Float32Array(2048);
    const bufRight = new Float32Array(2048);
    const frameAt = { value: 0 };
    const silent = context.createGain();
    silent.gain.value = 0;
    processor.onaudioprocess = event => {
        bufLeft.set(event.inputBuffer.getChannelData(0));
        bufRight.set(event.inputBuffer.getChannelData(event.inputBuffer.numberOfChannels > 1 ? 1 : 0));
        frameAt.value = Date.now();
    };
    source.connect(processor);
    processor.connect(silent);
    silent.connect(context.destination);
    return { source, processor, silent, bufLeft, bufRight, frameAt };
}

function createMeter(conn: VoiceConnection, userId: string) {
    if (!conn.outputs) return;

    const output = conn.outputs[userId];
    if (!output?.stream?.getAudioTracks().length || !conn.audioContext) return;

    const pair = makeAnalyserPair(conn.audioContext, output.stream);

    meters.set(userId, {
        output,
        ...pair,
        mono: channelCount(output) !== 2,
        score: 0,
        pans: [],
        panAt: [],
        loudTicks: [],
        lastTriggerAt: 0
    });
}

function dropMeter(userId: string) {
    const meter = meters.get(userId);
    if (!meter) return;

    meters.delete(userId);

    try {
        meter.source.disconnect();
        meter.processor.onaudioprocess = null;
        meter.processor.disconnect();
        meter.silent.disconnect();
    } catch (e) {
        logger.error("failed to release a meter", e);
    }
}

function syncMeters(conn: VoiceConnection) {
    if (!conn.outputs) return;

    for (const userId of Object.keys(conn.outputs)) {
        const meter = meters.get(userId);
        if (!meter || meter.output !== conn.outputs[userId]) {
            dropMeter(userId);
            createMeter(conn, userId);
        } else {
            meter.mono = channelCount(conn.outputs[userId]) !== 2;
        }
    }

    for (const userId of [...meters.keys()]) {
        if (!conn.outputs[userId]) dropMeter(userId);
    }
}

function readScore(meter: Meter, now: number) {
    if (meter.mono || now - meter.frameAt.value > 200) return 0;

    const { length } = meter.bufLeft;
    let sumLL = 0;
    let sumRR = 0;
    for (let i = 0; i < length; i++) {
        const l = meter.bufLeft[i];
        const r = meter.bufRight[i];
        sumLL += l * l;
        sumRR += r * r;
    }

    const rmsL = Math.sqrt(sumLL / length);
    const rmsR = Math.sqrt(sumRR / length);
    const total = rmsL + rmsR;
    if (total < NOISE_GATE) return 0;

    const pan = (rmsR - rmsL) / total;
    const imbalance = Math.abs(pan);

    let sumMid = 0;
    let sumSide = 0;
    for (let i = 0; i < length; i++) {
        const mid = (meter.bufLeft[i] + meter.bufRight[i]) * 0.5;
        const side = (meter.bufLeft[i] - meter.bufRight[i]) * 0.5;
        sumMid += mid * mid;
        sumSide += side * side;
    }

    const midRms = Math.sqrt(sumMid / length);
    const sideRms = Math.sqrt(sumSide / length);
    const stereo = midRms + sideRms > 0 ? Math.min(1, (sideRms / (midRms + sideRms)) * 2) : 0;

    meter.pans.push(pan);
    meter.panAt.push(now);
    while (meter.panAt.length && now - meter.panAt[0] > PAN_WINDOW_MS) {
        meter.pans.shift();
        meter.panAt.shift();
    }

    let min = 1;
    let max = -1;
    for (const value of meter.pans) {
        if (value < min) min = value;
        if (value > max) max = value;
    }

    const swing = meter.pans.length > 1 ? Math.min(1, (max - min) / 2) : 0;

    return Math.max(stereo, imbalance, swing);
}

async function resolveCaptureDevice(): Promise<string | null> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter(d => d.kind === "audioinput");
    const wanted = settings.store.captureDevice.trim();

    if (wanted) {
        const match = inputs.find(d => d.deviceId === wanted || d.label === wanted || d.label.includes(wanted));
        if (match) {
            captureDeviceLabel = match.label;
            return match.deviceId;
        }
    }

    const outputId = MediaEngineStore.getOutputDeviceId();
    let outputName = "";

    try {
        const outputs = await MediaEngineStore.getMediaEngine().getAudioOutputDevices();
        const match = outputs?.find(d => d.id === outputId || ("originalId" in d && d.originalId === outputId));
        outputName = match?.name ?? "";
    } catch (e) {
        logger.debug("Could not resolve the output device name", e);
    }

    if (outputName) {
        const cleaned = outputName.replace(/^Default\s*\((.*)\)$/i, "$1");
        const wanted = cleaned.replace(/\bOutput\b/i, "Input");
        const match = inputs.find(d => d.label === wanted)
            ?? inputs.find(d => /input/i.test(d.label) && d.label.startsWith(wanted.split(" (")[0]));
        if (match) {
            captureDeviceLabel = match.label;
            return match.deviceId;
        }
    }

    return null;
}

async function syncCapture() {
    if (!settings.store.desktopCapture || !connection || connection.outputs) {
        stopCapture();
        return;
    }

    if (mixMeter || captureStarting || Date.now() < captureRetryAt) return;

    captureStarting = true;
    try {
        const deviceId = await resolveCaptureDevice();
        if (!deviceId) {
            logger.warn("no capture device found for desktop stereo detection");
            return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                deviceId: { exact: deviceId },
                channelCount: 2,
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            },
            video: false
        });

        if (!settings.store.desktopCapture || !connection || connection.outputs) {
            stream.getTracks().forEach(t => t.stop());
            return;
        }

        const context = new AudioContext();
        void context.resume();
        const pair = makeAnalyserPair(context, stream);
        const capturedChannels = stream.getAudioTracks()[0]?.getSettings?.().channelCount ?? 0;

        mixStream = stream;
        mixContext = context;
        mixScore = 0;
        mixMeter = {
            output: { id: "mix", stream },
            ...pair,
            mono: capturedChannels !== 2,
            score: 0,
            pans: [],
            panAt: [],
            loudTicks: [],
            lastTriggerAt: 0
        };

        logger.info(`desktop stereo detection listening to ${captureDeviceLabel} (${capturedChannels}ch)`);
    } catch (e) {
        logger.error("failed to open the capture device", e);
        captureDeviceLabel = "";
        captureRetryAt = Date.now() + 30000;
    } finally {
        captureStarting = false;
    }
}

function stopCapture() {
    mixMeter = null;
    mixScore = 0;

    try {
        mixStream?.getTracks().forEach(t => t.stop());
        mixContext?.close();
    } catch (e) {
        logger.error("failed to release the capture device", e);
    }

    mixStream = null;
    mixContext = null;
    captureDeviceLabel = "";
}

function onStats(payload: VoiceStats) {
    const now = Date.now();
    const inbound = payload?.rtp?.inbound;
    if (!inbound) return;

    const entries: Array<[unknown, unknown]> = Array.isArray(inbound)
        ? inbound.map(e => [null, e])
        : Object.entries(inbound);

    for (const [key, value] of entries) {
        const list = Array.isArray(value) ? value : [value];
        for (const entry of list) {
            if (!entry || typeof entry !== "object") continue;
            const sample = entry as Record<string, unknown>;
            const mapped = connection?.getUserIdBySsrc?.(Number(sample.ssrc));
            const keyed = typeof key === "string" && UserStore.getUser(key) ? key : null;
            if (mapped && keyed && mapped !== keyed) continue;
            const userId = mapped ?? keyed;
            if (!userId) continue;

            levels.set(userId, Number(sample.audioLevel) || 0);
            levelAt.set(userId, now);
        }
    }
}

function bindConnection(conn: VoiceConnection | null) {
    if (conn === boundConnection) return;

    boundConnection?.emitter?.off?.("stats", onStats);
    boundConnection = conn;
    conn?.emitter?.on?.("stats", onStats);
}

function sampleMix(now: number) {
    const meter = mixMeter;
    if (!meter) return;

    const score = readScore(meter, now);
    meter.score = score >= meter.score ? score : meter.score + (score - meter.score) * RELEASE;
    mixScore = meter.score;

}

function otherGuardHolds(userId: string): boolean {
    return Boolean((plugins.MicSpamGuard as GuardVolume)?.isHolding?.(userId));
}

function heldBaseline(userId: string): number {
    const other = (plugins.MicSpamGuard as GuardVolume)?.getHeldBaseline?.(userId);
    return typeof other === "number" && Number.isFinite(other) && other >= 0 ? other : MediaEngineStore.getLocalVolume(userId);
}

function updateProtection(now: number) {
    for (const [userId, hold] of [...volumeHolds]) {
        const current = MediaEngineStore.getLocalVolume(userId);
        if (Math.abs(current - hold.applied) >= 0.5) {
            volumeHolds.delete(userId);
            mutedByUs.delete(userId);
            savedVolume.delete(userId);
            persistHeld();
            continue;
        }
        const next = hold.tick(now, settings.store.autoUnmute * 1000);
        if (next.done) {
            unmute(userId, "auto");
        } else if (!otherGuardHolds(userId) && next.volume !== hold.applied) {
            hold.applied = next.volume;
            setLocalVolume(userId, next.volume);
        }
    }
}

function mute(userId: string, score: number) {
    const meter = meters.get(userId);
    if (!settings.store.enabled || !meter || meter.mono || connection?.outputs?.[userId] !== meter.output || isIgnored(userId) || mutedByUs.has(userId) || isLocalMuted(userId)) return;

    const base = heldBaseline(userId);
    if (!Number.isFinite(base) || base <= 0) return;
    savedVolume.set(userId, base);
    volumeHolds.set(userId, new VolumeHold(base, Date.now(), 200));
    setLocalVolume(userId, 0);
    mutedByUs.set(userId, Date.now());
    persistHeld();
    logger.debug(`muted ${userId} at ${Math.round(score * 100)}% stereo`);

    if (settings.store.notify) {
        showToast(`StereoGuard muted ${displayName(userId)} for obnoxious stereo (${Math.round(score * 100)}%).`, Toasts.Type.MESSAGE);
    }
}

function unmute(userId: string, mode: "manual" | "auto" | "silent") {
    if (!mutedByUs.delete(userId)) return;

    const hold = volumeHolds.get(userId);
    volumeHolds.delete(userId);
    if (!otherGuardHolds(userId) && (!hold || Math.abs(MediaEngineStore.getLocalVolume(userId) - hold.applied) < 0.5)) {
        setLocalVolume(userId, savedVolume.get(userId) ?? 100);
    }
    savedVolume.delete(userId);
    persistHeld();

    if (mode === "silent" || !settings.store.notify) return;

    showToast(
        mode === "auto"
            ? `StereoGuard auto-unmuted ${displayName(userId)} after ${formatDuration(settings.store.autoUnmute)}.`
            : `StereoGuard unmuted ${displayName(userId)}.`,
        Toasts.Type.MESSAGE
    );
}

function sample(userId: string, meter: Meter, now: number, needed: number) {
    const score = readScore(meter, now);
    meter.score = score >= meter.score ? score : meter.score + (score - meter.score) * RELEASE;

    const ownedFresh = !meter.mono && connection?.outputs?.[userId] === meter.output && now - meter.frameAt.value <= 200;
    if (ownedFresh) volumeHolds.get(userId)?.observe(score <= Math.max(0, settings.store.threshold / 100 - 0.15), meter.frameAt.value);
    if (!ownedFresh) { meter.loudTicks = []; return; }

    if (score >= settings.store.threshold / 100 && !isIgnored(userId) && !mutedByUs.has(userId) && !isLocalMuted(userId)) {
        meter.loudTicks.push(now);
    }

    if (score < settings.store.threshold / 100) meter.loudTicks = [];
    while (meter.loudTicks.length && now - meter.loudTicks[0] >= WINDOW_MS) meter.loudTicks.shift();

    if (meter.loudTicks.length >= needed && now - meter.lastTriggerAt > TRIGGER_COOLDOWN_MS) {
        meter.loudTicks = [];
        meter.lastTriggerAt = now;
        mute(userId, score);
    }
}

function poll() {
    try {
        const conn = getConnection();
        if (conn !== connection) {
            unmuteAll("silent");
            for (const userId of [...meters.keys()]) dropMeter(userId);
            connection = conn;
            levels.clear();
            levelAt.clear();
            stopCapture();
            lastScanAt = 0;
        }
        bindConnection(conn);

        const now = Date.now();

        for (const [userId] of levels) {
            if (now - (levelAt.get(userId) ?? 0) >= STALE_MS) levels.set(userId, 0);
        }

        for (const userId of [...volumeHolds.keys()]) {
            if (!conn?.outputs?.[userId] || isIgnored(userId) || isLocalMuted(userId)) unmute(userId, "silent");
        }

        void syncCapture();

        if (mixMeter) sampleMix(now);

        if (!connection) return;

        if (connection.outputs && now - lastScanAt >= SCAN_MS) {
            lastScanAt = now;
            syncMeters(connection);
        }

        const { enabled, sensitivity } = settings.store;
        if (!enabled || !connection.outputs) return;

        const needed = Math.max(1, 11 - Math.round(sensitivity));
        for (const [userId, meter] of meters) sample(userId, meter, now, needed);
        updateProtection(now);
    } catch (e) {
        logger.error("poll failed", e);
    }
}

function persistHeld() {
    const held = Object.fromEntries(savedVolume);
    persistQueue = persistQueue.then(() => DataStore.set(HELD_KEY, held)).catch(e => logger.error("failed to save held volumes", e));
}

async function saveIgnored() {
    try {
        await DataStore.set(IGNORED_KEY, [...ignored]);
    } catch (e) {
        logger.error("failed to save the ignore list", e);
    }
}

function toggleIgnored(userId: string) {
    if (!ignored.delete(userId)) ignored.add(userId);
    if (isIgnored(userId)) unmute(userId, "silent");
    void saveIgnored();
}

function unmuteAll(mode: "manual" | "silent" = "manual") {
    for (const userId of [...mutedByUs.keys()]) unmute(userId, mode);
}

function ScoreRow({ userId }: { userId: string; }) {
    const score = Math.round((meters.get(userId)?.score ?? 0) * 100);
    const { threshold } = settings.store;
    const hot = score >= threshold;
    const ignoredUser = isIgnored(userId);
    const muted = mutedByUs.has(userId);

    return (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0" }}>
            <div style={{ width: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--header-primary)" }}>
                {displayName(userId)}
            </div>
            <div style={{ position: "relative", flex: 1, height: 10, borderRadius: 5, background: "var(--background-modifier-accent)", overflow: "hidden" }}>
                <div style={{ width: `${score}%`, height: "100%", background: hot ? "var(--status-danger)" : "var(--status-positive)" }} />
                <div style={{ position: "absolute", top: 0, left: `${threshold}%`, width: 2, height: "100%", background: "var(--text-muted)" }} />
            </div>
            <div style={{ width: 68, color: ignoredUser ? "var(--text-muted)" : "var(--header-secondary)", fontVariantNumeric: "tabular-nums" }}>
                {score}%
            </div>
            <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} onClick={() => toggleIgnored(userId)}>
                {ignored.has(userId) ? "Allow" : "Ignore"}
            </Button>
            {muted && <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} onClick={() => unmute(userId, "manual")}>Unmute</Button>}
        </div>
    );
}

function GuardPanel() {
    const [, forceUpdate] = React.useReducer(x => x + 1, 0);

    React.useEffect(() => {
        const id = setInterval(forceUpdate, 250);
        return () => clearInterval(id);
    }, []);

    const live = [...meters.keys()];
    const mixPercent = Math.round(mixScore * 100);
    const { threshold } = settings.store;

    return (
        <div style={{ marginBottom: 16 }}>
            <div style={{ color: "var(--header-primary)", fontWeight: 600, fontSize: 16 }}>Live stereo scores</div>
            <div style={{ color: "var(--header-secondary)", fontSize: 13, marginBottom: 8 }}>
                Hard panning, swinging across the field, and wide stereo music score high. Centered mono voice scores near zero. The thin line is your threshold.
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0" }}>
                <div style={{ width: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--header-primary)" }}>
                    Output mix {captureDeviceLabel ? "" : "(not capturing)"}
                </div>
                <div style={{ position: "relative", flex: 1, height: 10, borderRadius: 5, background: "var(--background-modifier-accent)", overflow: "hidden" }}>
                    <div style={{ width: `${mixPercent}%`, height: "100%", background: mixPercent >= threshold ? "var(--status-danger)" : "var(--status-positive)" }} />
                    <div style={{ position: "absolute", top: 0, left: `${threshold}%`, width: 2, height: "100%", background: "var(--text-muted)" }} />
                </div>
                <div style={{ width: 68, color: "var(--header-secondary)", fontVariantNumeric: "tabular-nums" }}>{mixPercent}%</div>
            </div>

            {live.length === 0
                ? <div style={{ color: "var(--text-muted)" }}>Per-user detection needs a web audio client. The desktop output mix is informational and cannot mute participants.</div>
                : live.map(userId => <ScoreRow key={userId} userId={userId} />)}

            {mutedByUs.size > 0 && (
                <div style={{ marginTop: 12 }}>
                    <div style={{ color: "var(--header-primary)", fontWeight: 600, fontSize: 16, marginBottom: 4 }}>Muted by the guard</div>
                    {[...mutedByUs.keys()].map(userId => (
                        <div key={userId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "4px 0" }}>
                            <span style={{ color: "var(--status-danger)" }}>{displayName(userId)}</span>
                            <Button size={Button.Sizes.SMALL} color={Button.Colors.BRAND} onClick={() => unmute(userId, "manual")}>Unmute</Button>
                        </div>
                    ))}
                    <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} onClick={() => unmuteAll("manual")} style={{ marginTop: 4 }}>Unmute all</Button>
                </div>
            )}

            {ignored.size > 0 && (
                <div style={{ marginTop: 12 }}>
                    <div style={{ color: "var(--header-primary)", fontWeight: 600, fontSize: 16, marginBottom: 4 }}>Never muted</div>
                    {[...ignored].map(userId => (
                        <div key={userId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "4px 0" }}>
                            <span>{displayName(userId)}</span>
                            <Button size={Button.Sizes.SMALL} color={Button.Colors.PRIMARY} onClick={() => toggleIgnored(userId)}>Allow again</Button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function StereoGuardIcon({ className }: { className?: string; }) {
    return (
        <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none">
            <rect x="4.4" y="7" width="2.4" height="10" rx="1.2" fill="currentColor" />
            <rect x="17.2" y="7" width="2.4" height="10" rx="1.2" fill="currentColor" />
            <path d="M9.6 12h4.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M11 10.1 9.1 12l1.9 1.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M13 10.1 14.9 12 13 13.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function StereoGuardButton({ iconForeground, hideTooltips, nameplate }: UserAreaRenderProps) {
    const { enabled } = settings.use(STEREO_GUARD_KEYS);

    return (
        <UserAreaButton
            icon={<StereoGuardIcon className={iconForeground} />}
            tooltipText={hideTooltips ? void 0 : "Stereo Guard"}
            aria-label="Stereo Guard"
            role="switch"
            aria-checked={enabled}
            redGlow={!enabled}
            plated={nameplate != null}
            onClick={() => openPluginModal(plugins.StereoGuard)}
            onContextMenu={event => {
                event.preventDefault();
                settings.store.enabled = !enabled;
                showToast(
                    `Stereo Guard ${settings.store.enabled ? "enabled" : "disabled"}.`,
                    Toasts.Type.MESSAGE
                );
            }}
        />
    );
}

export default definePlugin({
    name: "StereoGuard",
    description: "Protects against sustained stereo imbalance on participant-owned audio streams.",
    authors: [TestcordDevs.Kurtzon, TestcordDevs.DavidHiFi],
    tags: ["Voice", "Utility"],
    settings,
    settingsAboutComponent: GuardPanel,

    userAreaButton: {
        icon: StereoGuardIcon,
        render: StereoGuardButton
    },

    isHolding(userId: string) { return volumeHolds.has(userId); },
    getHeldBaseline(userId: string) { return savedVolume.get(userId); },

    async start() {
        try {
            const saved = await DataStore.get(IGNORED_KEY);
            if (Array.isArray(saved)) {
                for (const userId of saved) if (typeof userId === "string") ignored.add(userId);
            }
        } catch (e) {
            logger.error("failed to load the ignore list", e);
        }

        try {
            const held = await DataStore.get(HELD_KEY);
            if (held && typeof held === "object") {
                for (const [userId, volume] of Object.entries(held as Record<string, number>)) {
                    if (typeof volume === "number") setLocalVolume(userId, volume);
                }
                await DataStore.del(HELD_KEY);
            }
        } catch (e) {
            logger.error("failed to restore held volumes", e);
        }

        intervalId = setInterval(poll, POLL_MS);
    },

    stop() {
        if (intervalId !== undefined) {
            clearInterval(intervalId);
            intervalId = undefined;
        }

        stopCapture();
        bindConnection(null);

        for (const userId of [...meters.keys()]) dropMeter(userId);
        connection = null;

        for (const userId of [...mutedByUs.keys()]) unmute(userId, "silent");
        mutedByUs.clear();
        levels.clear();
        levelAt.clear();
    }
});
