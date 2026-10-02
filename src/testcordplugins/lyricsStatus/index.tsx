/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import { UserAreaButton, UserAreaRenderProps } from "@api/UserArea";
import { getUserSettingLazy } from "@api/UserSettings";
import { settings as musicControlsSettings } from "@testcordplugins/PanelLayout/modules/musicControls/settings";
import { TidalStore } from "@testcordplugins/PanelLayout/modules/musicControls/tidal/TidalStore";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher, PresenceStore, UserStore } from "@webpack/common";

const logger = new Logger("LyricsStatus");

const settings = definePluginSettings({
    active: {
        type: OptionType.BOOLEAN,
        description: "Persisted active state for Lyrics Status",
        default: true,
        hidden: true,
    },
    format: {
        type: OptionType.STRING,
        description: "Status template. {lyrics} = current lyric, {song} = track name, {artist} = artist name.",
        default: "🎵 {lyrics}",
        onChange(value) {
            if (typeof value === "string" && value.includes("??")) {
                settings.store.format = "🎵 {lyrics}";
            }
        },
    },
    source: {
        type: OptionType.SELECT,
        description: "Music player used for lyric status",
        options: [
            { label: "Automatic", value: "auto", default: true },
            { label: "Dopamine", value: "dopamine" },
            { label: "TIDAL", value: "tidal" },
            { label: "Spotify", value: "spotify" },
        ],
    },
    customMessageOnStop: {
        type: OptionType.BOOLEAN,
        description: "Set a custom message as your status when music stops or you disable the plugin",
        default: true,
        disabled() {
            return settings.store.lastStatusOnStop;
        }
    },
    customMessage: {
        type: OptionType.STRING,
        description: "The custom message (leave blank to clear).",
        default: "",
        hidden() {
            return !settings.store.customMessageOnStop;
        },
    },
    lastStatusOnStop: {
        type: OptionType.BOOLEAN,
        description: "Restore status from before music started when music stops or you disable the plugin",
        default: false,
        disabled() {
            return settings.store.customMessageOnStop;
        }
    },
    showPanelButton: {
        type: OptionType.BOOLEAN,
        description: "Add a button in the user area panel",
        default: true,
    },
});

// ── Playback tracking ─────────────────────────────────────────────────────────

let isPlaying = false;
let lastPosition = 0;
let lastPositionTs = 0;
let currentTrackId = "";
let currentTrackName = "";
let currentArtist = "";
const DOPAMINE_APP_ID = "826521040275636325";
const DOPAMINE_BRIDGE_URL = "http://127.0.0.1:35499";

interface DopamineBridgeState {
    title: string;
    artists: string;
    playing: boolean;
    startTime: number;
    artworkUrl: string | null;
}

let bridgeState: DopamineBridgeState | null = null;
let bridgeSeenAt = 0;
let bridgeRefreshing = false;
let bridgeIntervalId: ReturnType<typeof setInterval> | null = null;

function getPosition(): number {
    if (!isPlaying) return lastPosition;
    return lastPosition + (Date.now() - lastPositionTs);
}

// ── Lyric delay (global + per-song, shared with the music controls lyrics provider) ──

const CUSTOM_DELAY_DATASTORE_KEY = "vc-spotify-custom-song-delays";
const customSongDelays: Record<string, number> = {};

function getTrackKey(id: string, name: string): string {
    return id || name;
}

function getCurrentDelay(): number {
    const globalDelay = musicControlsSettings.store.lyricDelay ?? 0;
    const songDelay = customSongDelays[getTrackKey(currentTrackId, currentTrackName)] ?? 0;
    return globalDelay + songDelay;
}

function loadCustomSongDelays() {
    DataStore.get<Record<string, number>>(CUSTOM_DELAY_DATASTORE_KEY).then(saved => {
        if (saved) Object.assign(customSongDelays, saved);
    });
}

function onCustomDelayChange({ trackKey, delay }: { trackKey: string; delay: number; }) {
    customSongDelays[trackKey] = delay;
}

// ── Lyrics ────────────────────────────────────────────────────────────────────

interface SyncedLine { time: number; text: string; }

const lyricsCache = new Map<string, SyncedLine[] | null>();

function parseLrc(lrc: string): SyncedLine[] {
    const lines: SyncedLine[] = [];
    for (const raw of lrc.split("\n")) {
        const m = raw.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)/);
        if (!m) continue;
        const time = (parseInt(m[1]) * 60 + parseFloat(m[2])) * 1000;
        const text = m[3].trim();
        if (text) lines.push({ time, text });
    }
    return lines.sort((a, b) => a.time - b.time);
}

function cleanTrackName(name: string): string {
    return name
        .replace(/\s*[-–([\s]+(?:remaster(?:ed)?|remix|live|version|edit|radio edit|acoustic|demo|instrumental|extended|deluxe|anniversary|original mix)\b.*/i, "")
        .trim();
}

async function fetchLyrics(track: string, artist: string, id: string, signal?: AbortSignal): Promise<SyncedLine[] | null> {
    if (lyricsCache.has(id)) return lyricsCache.get(id) ?? null;
    const cleanedTrack = cleanTrackName(track);
    try {
        const query = new URLSearchParams({ track_name: cleanedTrack, artist_name: artist });
        const res = await fetch(`https://lrclib.net/api/get?${query}`, { signal });
        let data = res.ok ? await res.json() as { syncedLyrics?: string; } : null;
        if (!data?.syncedLyrics && (res.ok || res.status === 404)) {
            const search = await fetch(`https://lrclib.net/api/search?${query}`, { signal });
            if (search.ok) {
                const results = await search.json() as { trackName: string; artistName: string; syncedLyrics?: string; }[];
                const normalizedTitle = cleanedTrack.toLowerCase();
                const normalizedArtist = artist.toLowerCase();
                data = results.find(result =>
                    cleanTrackName(result.trackName).toLowerCase() === normalizedTitle &&
                    result.artistName.toLowerCase() === normalizedArtist &&
                    !!result.syncedLyrics,
                ) ?? null;
            }
        }
        const lines = data?.syncedLyrics ? parseLrc(data.syncedLyrics) : null;
        if (res.ok || res.status === 404) lyricsCache.set(id, lines);
        return lines;
    } catch (e) {
        if (signal?.aborted) return null;
        logger.warn("LrcLib fetch failed:", e);
        lyricsCache.set(id, null);
        return null;
    }
}

function getCurrentLine(lines: SyncedLine[], posMs: number): string | null {
    let current: string | null = null;
    for (const line of lines) {
        if (line.time <= posMs) current = line.text;
        else break;
    }
    return current;
}

// ── Status ────────────────────────────────────────────────────────────────────

const CustomStatusSetting = getUserSettingLazy("status", "customStatus")!;

let lastSentLine: string | null = null;
let savedOriginalStatus: any = null;
let statusWriteInFlight = false;
let lastStatusWriteAt = 0;

function saveOriginalStatus() {
    if (savedOriginalStatus === null && CustomStatusSetting) {
        try {
            const current = CustomStatusSetting.getSetting();
            savedOriginalStatus = current ? { ...current } : null;
        } catch {
            savedOriginalStatus = null;
        }
    }
}

function restoreOriginalStatus() {
    if (savedOriginalStatus !== null && CustomStatusSetting) {
        lastSentLine = null;
        Promise.resolve(CustomStatusSetting.updateSetting(savedOriginalStatus)).catch(err => {
            logger.warn("Failed to restore original custom status:", err);
        });
        savedOriginalStatus = null;
    }
}

function buildStatusPayload(text: string, createdAtMs = String(Date.now())) {
    return {
        text: text.slice(0, 128),
        expiresAtMs: "0",
        emojiId: "0",
        emojiName: "",
        createdAtMs,
    };
}

async function writeCustomStatus(text: string, createdAtMs?: string): Promise<boolean> {
    if (!CustomStatusSetting) {
        logger.warn("CustomStatusSetting unavailable; cannot write status");
        return false;
    }
    try {
        await CustomStatusSetting.updateSetting(buildStatusPayload(text, createdAtMs));
        return true;
    } catch (err) {
        logger.warn("updateSetting failed, retrying once:", err);
        try {
            await new Promise(r => setTimeout(r, 400));
            await CustomStatusSetting.updateSetting(buildStatusPayload(text, createdAtMs));
            return true;
        } catch (err2) {
            logger.error("Custom status write failed twice:", err2);
            return false;
        }
    }
}

async function setStatus(text: string) {
    if (text === lastSentLine || statusWriteInFlight) return;
    const now = Date.now();
    if (now - lastStatusWriteAt < 1500) return;

    statusWriteInFlight = true;
    saveOriginalStatus();
    const ok = await writeCustomStatus(text);
    statusWriteInFlight = false;
    if (ok) {
        lastSentLine = text;
        lastStatusWriteAt = Date.now();
    } else {
        lastSentLine = null;
    }
}

async function customStatus() {
    lastSentLine = null;
    const ok = await writeCustomStatus(settings.store.customMessage || "", "0");
    if (ok) lastStatusWriteAt = Date.now();
    savedOriginalStatus = null;
}

function handleStopStatus() {
    if (settings.store.lastStatusOnStop) {
        restoreOriginalStatus();
    } else if (settings.store.customMessageOnStop) {
        void customStatus();
    }
}

function statusLooksLikeLyric() {
    const prefix = settings.store.format.split("{lyrics}")[0];
    return !!prefix && !!CustomStatusSetting?.getSetting()?.text?.startsWith(prefix);
}

// ── Tick loop ─────────────────────────────────────────────────────────────────

let intervalId: ReturnType<typeof setInterval> | null = null;
let currentLines: SyncedLine[] | null = null;
let lyricGeneration = 0;
let lyricsAbortController: AbortController | null = null;

function tick() {
    if (!settings.store.active) return;
    updateActivePlayback();
    if (!isPlaying || !currentLines) return;
    const line = getCurrentLine(currentLines, getPosition() + getCurrentDelay());
    if (!line) return;
    const text = settings.store.format
        .replace("{lyrics}", line)
        .replace("{song}", currentTrackName)
        .replace("{artist}", currentArtist);
    void setStatus(text);
}

// Dopamine's own RPC (patched by dopamine-rpc-patch) is the single presence
// writer: it sends the stock icon immediately and replays the activity with
// the iTunes cover once the artwork lookup resolves. LyricsStatus stays
// lyrics-only and reads the bridge as its playback clock; it never publishes
// a second Discord activity.

// ── Flux ──────────────────────────────────────────────────────────────────────

interface SpotifyPlayerState {
    track: { id: string; name: string; artists: { name: string; }[]; } | null;
    isPlaying: boolean;
    position: number;
}

let spotifyPlayerState: SpotifyPlayerState | null = null;
let spotifyStateTs = 0;

function getDopaminePlayback() {
    if (bridgeState && Date.now() - bridgeSeenAt < 5000) {
        return {
            id: `dopamine:${bridgeState.title}:${bridgeState.artists}`,
            name: bridgeState.title,
            artist: bridgeState.artists.split(/[;,]/)[0].trim(),
            playing: bridgeState.playing,
            position: bridgeState.playing ? Math.max(0, Date.now() - bridgeState.startTime) : 0,
        };
    }
    const userId = UserStore.getCurrentUser()?.id;
    if (!userId) return null;
    const activities = PresenceStore.getActivities(userId) ?? [];
    const activity = activities.find(a => a.application_id === DOPAMINE_APP_ID && a.type === 2);
    if (!activity?.details || !activity.state) return null;

    const start = activity.timestamps?.start;
    const startMillis = start ? start < 1e12 ? start * 1000 : start : 0;
    return {
        id: `dopamine:${activity.details}:${activity.state}`,
        name: activity.details,
        artist: activity.state.split(/[;,]/)[0].trim(),
        playing: !!startMillis,
        position: startMillis ? Math.max(0, Date.now() - startMillis) : lastPosition,
    };
}

async function refreshDopamineBridge() {
    if (bridgeRefreshing) return;
    bridgeRefreshing = true;
    try {
        const response = await fetch(`${DOPAMINE_BRIDGE_URL}/current`, { signal: AbortSignal.timeout(1500) });
        if (!response.ok) throw new Error(`Dopamine bridge returned ${response.status}`);
        const data = await response.json() as Partial<DopamineBridgeState>;
        bridgeState = data.title && data.artists ? data as DopamineBridgeState : null;
        bridgeSeenAt = Date.now();
        if (settings.store.active) updateActivePlayback();
    } catch {
        if (Date.now() - bridgeSeenAt >= 5000) {
            bridgeState = null;
        }
    } finally {
        bridgeRefreshing = false;
    }
}

function getTidalPlayback() {
    const { track } = TidalStore;
    if (!track) return null;
    return {
        id: `tidal:${track.id}`,
        name: track.name,
        artist: track.artist,
        playing: TidalStore.isPlaying,
        position: TidalStore.position,
    };
}

function updatePlayback(newId: string, name: string, artist: string, playing: boolean, position: number) {
    const trackChanged = newId !== currentTrackId;
    const wasPlaying = isPlaying;

    isPlaying = playing;
    lastPosition = position;
    lastPositionTs = Date.now();
    currentTrackId = newId;
    currentTrackName = name;
    currentArtist = artist;

    if (trackChanged) {
        if (lastSentLine !== null || statusLooksLikeLyric()) handleStopStatus();
        currentLines = null;
        lyricsAbortController?.abort();
        const generation = ++lyricGeneration;
        if (currentTrackId) {
            const abortController = new AbortController();
            lyricsAbortController = abortController;
            fetchLyrics(currentTrackName, currentArtist, currentTrackId, abortController.signal)
                .then(lines => {
                    if (settings.store.active && generation === lyricGeneration && currentTrackId === newId) currentLines = lines;
                })
                .finally(() => {
                    if (lyricsAbortController === abortController) lyricsAbortController = null;
                });
        }
    }

    if (!isPlaying && (wasPlaying || trackChanged)) handleStopStatus();
}

function updateActivePlayback() {
    const dopamine = getDopaminePlayback();
    const tidal = getTidalPlayback();
    const spotify = spotifyPlayerState;
    const spotifyPlayback = spotify?.track ? {
        id: spotify.track.id,
        name: spotify.track.name,
        artist: spotify.track.artists?.[0]?.name ?? "",
        playing: spotify.isPlaying ?? false,
        position: (spotify.position ?? 0) + (spotify.isPlaying ? Date.now() - spotifyStateTs : 0),
    } : null;
    const sources = { dopamine, tidal, spotify: spotifyPlayback };
    const selected = settings.store.source === "auto"
        ? dopamine?.playing ? dopamine : tidal?.playing ? tidal : spotifyPlayback?.playing ? spotifyPlayback : dopamine ?? tidal ?? spotifyPlayback
        : sources[settings.store.source];
    updatePlayback(selected?.id ?? "", selected?.name ?? "", selected?.artist ?? "", selected?.playing ?? false, selected?.position ?? 0);
}

function onSpotifyPlayerState(e: SpotifyPlayerState) {
    spotifyPlayerState = e;
    spotifyStateTs = Date.now();
    updateActivePlayback();
}

function Icon({ className, active }: { className?: string; active: boolean; }) {
    const lineLength = 30;
    const lineStyle: React.CSSProperties = {
        strokeDasharray: lineLength,
        strokeDashoffset: active ? lineLength : 0,
        transition: "stroke-dashoffset 0.1s ease-in-out",
    };

    return (
        <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <mask id="lyricsStatusLine">
                <rect width="100%" fill="#ffffff" height="100%" />
                <line
                    className="blackLine"
                    x1="22"
                    y1="2"
                    x2="2"
                    y2="22"
                    stroke="#000000"
                    strokeWidth="6"
                    strokeLinecap="round"
                    style={lineStyle}
                />
            </mask>

            <path
                fill={!active ? "var(--status-danger)" : "currentColor"}
                mask="url(#lyricsStatusLine)"
                d="M8.65 1.51A2 2 0 0 0 6 3.41v9.88A3.98 3.98 0 0 0 4.5 13C2.57 13 1 14.34 1 16s1.57 3 3.5 3S8 17.66 8 16V5.4l11 3.81v7.08a3.98 3.98 0 0 0-1.5-.29c-1.93 0-3.5 1.34-3.5 3s1.57 3 3.5 3 3.5-1.34 3.5-3V7.03c0-.74-.47-1.4-1.18-1.65L8.65 1.51Z"
            />

            <line
                x1="22"
                y1="2"
                x2="2"
                y2="22"
                stroke="var(--status-danger, currentColor)"
                strokeWidth="2"
                strokeLinecap="round"
                style={lineStyle}
            />
        </svg>
    );
}

function LyricsStatusToggleButton({ iconForeground, hideTooltips, nameplate }: UserAreaRenderProps) {
    const { active, showPanelButton } = settings.use(["active", "showPanelButton"]);
    if (!showPanelButton) return null;

    return (
        <UserAreaButton
            className="button__201d5 wrapper__201d5"
            tooltipText={hideTooltips ? void 0 : active ? "Disable Lyrics Status" : "Enable Lyrics Status"}
            aria-label="Lyrics Status"
            icon={<Icon className={iconForeground} active={active} />}
            role="switch"
            aria-checked={active}
            redGlow={!active}
            plated={nameplate != null}
            onClick={() => {
                const nextState = !settings.store.active;
                settings.store.active = nextState;

                if (!nextState) {
                    if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
                    handleStopStatus();
                } else {
                    tick();
                    if (intervalId === null) intervalId = setInterval(tick, 1000);
                }
            }}
        />
    );
}

export default definePlugin({
    name: "LyricsStatus",
    description: "Shows Dopamine, TIDAL, or Spotify lyrics in your Discord custom status. Lyrics fetched from LrcLib.",
    tags: ["Activity", "Utility"],
    authors: [
        { name: "Sharp", id: 0n },
        { name: "DavidHiFi", id: 1553713171938938891n },
    ],
    settings,
    dependencies: ["UserSettingsAPI"],

    userAreaButton: {
        icon: (props: { className?: string; }) => <Icon {...props} active={settings.store.active} />,
        render: LyricsStatusToggleButton
    },

    start() {
        try {
            if (settings.store.source === "tidal") settings.store.source = "auto";
            loadCustomSongDelays();
            void refreshDopamineBridge();
            bridgeIntervalId = setInterval(refreshDopamineBridge, 1000);
            FluxDispatcher.subscribe("SPOTIFY_PLAYER_STATE", onSpotifyPlayerState as any);
            FluxDispatcher.subscribe("SPOTIFY_LYRICS_DELAYS_LOADED", loadCustomSongDelays as any);
            FluxDispatcher.subscribe("SPOTIFY_LYRICS_CUSTOM_DELAY_CHANGE", onCustomDelayChange as any);
            if (settings.store.active) {
                tick();
                if (intervalId === null) intervalId = setInterval(tick, 1000);
            }
            logger.info(`Started (source=${settings.store.source}, active=${settings.store.active})`);
        } catch (e) {
            logger.error("start failed:", e);
            throw e;
        }
    },

    stop() {
        lyricGeneration++;
        lyricsAbortController?.abort();
        lyricsAbortController = null;
        FluxDispatcher.unsubscribe("SPOTIFY_PLAYER_STATE", onSpotifyPlayerState as any);
        FluxDispatcher.unsubscribe("SPOTIFY_LYRICS_DELAYS_LOADED", loadCustomSongDelays as any);
        FluxDispatcher.unsubscribe("SPOTIFY_LYRICS_CUSTOM_DELAY_CHANGE", onCustomDelayChange as any);
        if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
        if (bridgeIntervalId !== null) { clearInterval(bridgeIntervalId); bridgeIntervalId = null; }
        if (!isPlaying) handleStopStatus();
        currentLines = null;
        lyricsCache.clear();
        lastSentLine = null;
        isPlaying = false;
        currentTrackId = "";
        spotifyPlayerState = null;
        spotifyStateTs = 0;
        bridgeState = null;
        bridgeSeenAt = 0;
        savedOriginalStatus = null;
        statusWriteInFlight = false;
    },
});
