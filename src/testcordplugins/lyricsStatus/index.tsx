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
import { findStoreLazy } from "@webpack";
import { ApplicationAssetUtils, FluxDispatcher, PresenceStore, UserSettingsActionCreators, UserStore } from "@webpack/common";

import { artistMatches, findArtwork, itunesSearch, simplify } from "./artwork";

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
    dopamineCovers: {
        type: OptionType.BOOLEAN,
        description: "Show the album cover on Dopamine's Discord activity (looked up on Apple's public iTunes search)",
        default: true,
        onChange: republishDopamine,
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
// Discord itself sends at most 5 presence changes per 20 seconds and then
// sends the newest one when the window frees (measured 2026-10-24), so a
// slower pace here does not help other people and only delays your own view.
const STATUS_MIN_INTERVAL_MS = 1000;
const LYRICS_RETRY_DELAY_MS = 15000;

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
// A lookup can fail for transient reasons (offline, LrcLib hiccup). Remember
// when, so the track is retried later instead of being remembered forever as
// "this song has no lyrics".
const lyricsFailedAt = new Map<string, number>();

const LRC_TIMESTAMP = /\[(\d+):(\d+(?:\.\d+)?)\]/g;

function parseLrc(lrc: string): SyncedLine[] {
    const lines: SyncedLine[] = [];
    for (const raw of lrc.split("\n")) {
        // A single line may carry several timestamps (repeated choruses), e.g.
        // [00:12.00][01:20.00]Same lyric.
        const stamps = [...raw.matchAll(LRC_TIMESTAMP)];
        if (!stamps.length) continue;
        const last = stamps[stamps.length - 1];
        // An empty line marks an instrumental break. Keeping it stops the last
        // sung line from sitting in the status through the whole break.
        const text = raw.slice((last.index ?? 0) + last[0].length).trim();
        for (const stamp of stamps) {
            lines.push({ time: (parseInt(stamp[1]) * 60 + parseFloat(stamp[2])) * 1000, text });
        }
    }
    return lines.sort((a, b) => a.time - b.time);
}

function cleanTrackName(name: string): string {
    return name
        .replace(/\s*[-–([\s]+(?:remaster(?:ed)?|remix|live|version|edit|radio edit|acoustic|demo|instrumental|extended|deluxe|anniversary|original mix)\b.*/i, "")
        .trim();
}

// Local files are often tagged "Uploader" / "Artist - Title", so the part after
// the last dash is tried as the title with the part before it as the artist.
function lyricGuesses(track: string, artist: string) {
    const guesses = [{ track: cleanTrackName(track), artist }];
    const parts = track.split(/\s+[-–—|]\s+/);
    if (parts.length > 1) guesses.push({ track: cleanTrackName(parts[parts.length - 1]), artist: parts[0] });
    return guesses;
}

// LrcLib answers 503 now and then (measured 2026-10-24); one quick retry
// saves waiting for the next 15 second retry window.
async function fetchLrcLib(url: string, signal?: AbortSignal): Promise<Response> {
    const res = await fetch(url, { signal });
    if (res.status < 500) return res;
    await new Promise(r => setTimeout(r, 1000));
    return fetch(url, { signal });
}

async function lookupLrcLib(track: string, artist: string, signal?: AbortSignal): Promise<SyncedLine[] | null> {
    const query = new URLSearchParams({ track_name: track, artist_name: artist });
    const res = await fetchLrcLib(`https://lrclib.net/api/get?${query}`, signal);
    if (res.ok) {
        const data = await res.json() as { syncedLyrics?: string | null; instrumental?: boolean; };
        if (data.syncedLyrics) return parseLrc(data.syncedLyrics);
        if (data.instrumental) return null;
    } else if (res.status !== 404) {
        throw new Error(`LrcLib returned ${res.status}`);
    }
    // The exact endpoint misses tracks whose title or artist differs slightly.
    const search = await fetchLrcLib(`https://lrclib.net/api/search?${query}`, signal);
    if (!search.ok) throw new Error(`LrcLib search returned ${search.status}`);
    const results: unknown = await search.json();
    if (!Array.isArray(results)) throw new Error("LrcLib search returned no result list");
    const title = simplify(cleanTrackName(track));
    const match = (results as { trackName: string; artistName: string; syncedLyrics?: string | null; }[]).find(result =>
        !!result.syncedLyrics &&
        simplify(cleanTrackName(result.trackName)) === title &&
        artistMatches(result.artistName, [artist]),
    );
    return match?.syncedLyrics ? parseLrc(match.syncedLyrics) : null;
}

async function fetchLyrics(track: string, artist: string, id: string, signal?: AbortSignal): Promise<SyncedLine[] | null> {
    if (lyricsCache.has(id)) return lyricsCache.get(id) ?? null;
    const failedAt = lyricsFailedAt.get(id);
    if (failedAt !== undefined && Date.now() - failedAt < LYRICS_RETRY_DELAY_MS) return null;
    try {
        let lines: SyncedLine[] | null = null;
        let failure: unknown = null;
        for (const guess of lyricGuesses(track, artist)) {
            try {
                lines = await lookupLrcLib(guess.track, guess.artist, signal);
            } catch (e) {
                if (signal?.aborted) throw e;
                failure = e;
                continue;
            }
            if (lines) break;
        }
        // Only a clean miss on every guess means "no lyrics"; an error is retried.
        if (!lines && failure) throw failure;
        lyricsFailedAt.delete(id);
        lyricsCache.set(id, lines);
        return lines;
    } catch (e) {
        if (signal?.aborted) return null;
        // Never cache a network failure as "this track has no lyrics".
        logger.warn("LrcLib fetch failed (will retry):", e);
        lyricsFailedAt.set(id, Date.now());
        return null;
    }
}

// ── Status ────────────────────────────────────────────────────────────────────

const CustomStatusSetting = getUserSettingLazy("status", "customStatus")!;

let lastSentLine: string | null = null;
let savedOriginalStatus: any = null;
let statusWriteInFlight = false;
let lastStatusWriteAt = 0;
let pendingStatusText: string | null = null;
let statusFlushTimer: ReturnType<typeof setTimeout> | null = null;

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

// Discord's own "frequent user action" save delay. A lyric line still changes
// the status at once, on screen and for everyone else; only the copy saved on
// Discord's servers is written at most every 10 seconds. Saving every line
// was answered with 429 after five quick lines (measured 2026-10-24).
const LYRIC_SAVE_DELAY_S = 10;

function saveStatus(payload: ReturnType<typeof buildStatusPayload>, batched: boolean): Promise<unknown> {
    if (batched) {
        try {
            const { updateAsync } = UserSettingsActionCreators.PreloadedUserSettingsActionCreators;
            if (typeof updateAsync === "function") {
                return Promise.resolve(updateAsync("status", (s: { customStatus: unknown; }) => { s.customStatus = payload; }, LYRIC_SAVE_DELAY_S));
            }
        } catch {
            // Settings module not found; the plain setting below still works.
        }
    }
    return Promise.resolve(CustomStatusSetting.updateSetting(payload));
}

async function writeCustomStatus(text: string, createdAtMs?: string, batched = false): Promise<boolean> {
    if (!CustomStatusSetting) {
        logger.warn("CustomStatusSetting unavailable; cannot write status");
        return false;
    }
    try {
        await saveStatus(buildStatusPayload(text, createdAtMs), batched);
        return true;
    } catch (err) {
        logger.warn("updateSetting failed, retrying once:", err);
        try {
            await new Promise(r => setTimeout(r, 400));
            await saveStatus(buildStatusPayload(text, createdAtMs), batched);
            return true;
        } catch (err2) {
            logger.error("Custom status write failed twice:", err2);
            return false;
        }
    }
}

async function writeStatusAndTrack(text: string) {
    statusWriteInFlight = true;
    saveOriginalStatus();
    const ok = await writeCustomStatus(text, undefined, true);
    statusWriteInFlight = false;
    if (ok) {
        lastSentLine = text;
        lastStatusWriteAt = Date.now();
    } else {
        lastSentLine = null;
    }
    // A newer line may have arrived while this write was in flight; releasing
    // the queue here keeps the flush self-driving instead of waiting for tick().
    if (pendingStatusText !== null) scheduleStatusFlush(STATUS_MIN_INTERVAL_MS);
}

function scheduleStatusFlush(delayMs: number) {
    if (statusFlushTimer !== null) return;
    statusFlushTimer = setTimeout(() => {
        statusFlushTimer = null;
        void flushPendingStatus();
    }, Math.max(delayMs, 0));
}

async function flushPendingStatus() {
    // An in-flight write releases the queue itself when it completes.
    if (statusWriteInFlight) return;
    if (pendingStatusText === null) return;
    const wait = STATUS_MIN_INTERVAL_MS - (Date.now() - lastStatusWriteAt);
    if (wait > 0) {
        scheduleStatusFlush(wait);
        return;
    }
    const text = pendingStatusText;
    pendingStatusText = null;
    if (text === lastSentLine) return;
    await writeStatusAndTrack(text);
}

// Rate-limited, newest-wins. A line that arrives inside the rate-limit window
// is held as pending and written when the window opens, instead of being
// dropped (which skipped lyric lines on fast songs).
function setStatus(text: string) {
    if (text === lastSentLine && pendingStatusText === null) return;
    pendingStatusText = text;
    void flushPendingStatus();
}

async function customStatus() {
    lastSentLine = null;
    const ok = await writeCustomStatus(settings.store.customMessage || "", "0");
    if (ok) lastStatusWriteAt = Date.now();
    savedOriginalStatus = null;
}

function handleStopStatus() {
    pendingStatusText = null;
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
let lineTimer: ReturnType<typeof setTimeout> | null = null;
let currentLines: SyncedLine[] | null = null;
let lyricGeneration = 0;
let lyricsAbortController: AbortController | null = null;

function buildStatusText(line: string): string {
    // Single pass. Substituting {lyrics} first would let a lyric line that
    // happens to contain "{song}" / "{artist}" replace itself on a later pass.
    return settings.store.format.replace(/\{(lyrics|song|artist)\}/g, (_, token: string) => {
        if (token === "lyrics") return line;
        if (token === "song") return currentTrackName;
        return currentArtist;
    }).trim();
}

// Shows the line for the current position and sets a timer for the exact
// moment the next one starts, so lines change on time instead of up to a
// second late on the next tick.
function showCurrentLine() {
    if (lineTimer !== null) { clearTimeout(lineTimer); lineTimer = null; }
    if (!settings.store.active || !isPlaying || !currentLines?.length) return;
    const position = getPosition() + getCurrentDelay();
    let index = -1;
    while (index + 1 < currentLines.length && currentLines[index + 1].time <= position) index++;
    setStatus(buildStatusText(index >= 0 ? currentLines[index].text : ""));
    const next = currentLines[index + 1];
    if (next) lineTimer = setTimeout(showCurrentLine, next.time - position + 20);
}

// The previous track's lyric is still in the status after a track change. It
// is replaced by the new track's first line, or cleared once the new track
// turns out to have no lyrics, so the status no longer flashes the stop
// message between two songs.
let staleLyric = false;

function onLyrics(lines: SyncedLine[] | null) {
    currentLines = lines;
    if (lines) {
        staleLyric = false;
        showCurrentLine();
    } else if (staleLyric) {
        staleLyric = false;
        handleStopStatus();
    }
}

function requestLyrics() {
    if (!currentTrackId || currentLines || lyricsAbortController) return;
    if (lyricsCache.has(currentTrackId)) {
        onLyrics(lyricsCache.get(currentTrackId) ?? null);
        return;
    }
    const requestedTrackId = currentTrackId;
    const generation = ++lyricGeneration;
    const abortController = new AbortController();
    lyricsAbortController = abortController;
    fetchLyrics(currentTrackName, currentArtist, requestedTrackId, abortController.signal)
        .then(lines => {
            if (!settings.store.active || generation !== lyricGeneration || currentTrackId !== requestedTrackId) return;
            onLyrics(lines);
        })
        .finally(() => {
            if (lyricsAbortController === abortController) lyricsAbortController = null;
        });
}

function tick() {
    if (!settings.store.active) return;
    updateActivePlayback();
    if (!isPlaying) return;
    if (!currentLines) {
        // Retries a lookup that failed transiently while the track keeps playing.
        requestLyrics();
        return;
    }
    showCurrentLine();
}

// ── Dopamine ──────────────────────────────────────────────────────────────────
// Stock Dopamine 3 publishes its own Discord activity over RPC with the title,
// artist, play state and start time. That is the lyric clock, so no Dopamine
// patch or companion app is needed. With covers on, Dopamine's activity gets
// the album cover on its way through Discord: there is still exactly one
// activity and it stays Dopamine's.

const LocalActivityStore = findStoreLazy("LocalActivityStore");

interface RpcActivity {
    application_id?: string;
    details?: string;
    state?: string;
    timestamps?: { start?: number; };
    assets?: { large_image?: string; large_text?: string; small_image?: string; small_text?: string; };
}

interface LocalActivityAction {
    type: "LOCAL_ACTIVITY_UPDATE";
    socketId?: unknown;
    activity: RpcActivity | null;
}

const COVER_LOOKUP_DELAY_MS = 1500;
const COVER_RETRY_DELAY_MS = 15000;
const COVER_MAX_ATTEMPTS = 3;
const COVER_CACHE_MAX = 500;
const searchItunes = itunesSearch();

// Dopamine's last update exactly as it sent it, so the cover can be added or
// removed by sending it again through the same RPC slot.
let dopamineAction: LocalActivityAction | null = null;
const coverCache = new Map<string, { asset: string; album: string; } | null>();
const coverAttempts = new Map<string, { count: number; at: number; }>();
let coverTimer: ReturnType<typeof setTimeout> | null = null;
let coverBusy = false;

function coverKey(activity: RpcActivity): string {
    return `${activity.details ?? ""}\n${activity.state ?? ""}`;
}

function withCover(activity: RpcActivity): RpcActivity {
    const cover = coverCache.get(coverKey(activity));
    if (!cover) return activity;
    return {
        ...activity,
        assets: { ...activity.assets, large_image: cover.asset, large_text: cover.album || activity.assets?.large_text },
    };
}

function interceptActivity(action: { type: string; }): boolean {
    if (action.type !== "LOCAL_ACTIVITY_UPDATE") return false;
    const update = action as LocalActivityAction;
    if (update.activity?.application_id === DOPAMINE_APP_ID) {
        dopamineAction = { ...update };
        if (settings.store.dopamineCovers) {
            update.activity = withCover(update.activity);
            scheduleCoverLookup(COVER_LOOKUP_DELAY_MS);
        }
    } else if (update.activity || !dopamineAction || update.socketId !== dopamineAction.socketId) {
        return false;
    } else {
        dopamineAction = null;
    }
    // Stores update after the interceptors, and a status write dispatches, so
    // react once this dispatch has finished.
    setTimeout(tick, 0);
    return false;
}

function removeInterceptor() {
    const interceptors: unknown[] = (FluxDispatcher as any)._interceptors ?? [];
    const index = interceptors.indexOf(interceptActivity);
    if (index !== -1) interceptors.splice(index, 1);
}

function republishDopamine() {
    if (dopamineAction) FluxDispatcher.dispatch({ ...dopamineAction });
}

function scheduleCoverLookup(delayMs: number) {
    if (coverTimer !== null) clearTimeout(coverTimer);
    coverTimer = setTimeout(() => {
        coverTimer = null;
        void lookupCover();
    }, delayMs);
}

// One lookup at a time, for the track playing now. The short delay skips
// tracks the user flicks past.
async function lookupCover() {
    const activity = dopamineAction?.activity;
    if (coverBusy || !activity?.details || !settings.store.dopamineCovers) return;
    const key = coverKey(activity);
    if (coverCache.has(key)) return;
    const attempts = coverAttempts.get(key);
    if (attempts && Date.now() - attempts.at < COVER_RETRY_DELAY_MS) return;
    coverBusy = true;
    let failed = false;
    try {
        const artwork = await findArtwork(activity.details, activity.state ?? "", searchItunes);
        const [asset] = artwork ? await ApplicationAssetUtils.fetchAssetIds(DOPAMINE_APP_ID, [artwork.url]) : [];
        if (coverCache.size >= COVER_CACHE_MAX) coverCache.delete(coverCache.keys().next().value!);
        coverCache.set(key, artwork && asset ? { asset, album: artwork.album } : null);
        coverAttempts.delete(key);
        if (asset && dopamineAction?.activity && coverKey(dopamineAction.activity) === key) republishDopamine();
    } catch (e) {
        failed = true;
        const count = (attempts?.count ?? 0) + 1;
        logger.warn(`Cover lookup failed (attempt ${count}):`, e);
        if (count >= COVER_MAX_ATTEMPTS) coverCache.set(key, null);
        else coverAttempts.set(key, { count, at: Date.now() });
    } finally {
        coverBusy = false;
        // The track may have changed while this lookup ran.
        const now = dopamineAction?.activity;
        if (now?.details && !coverCache.has(coverKey(now))) {
            scheduleCoverLookup(failed && coverKey(now) === key ? COVER_RETRY_DELAY_MS : COVER_LOOKUP_DELAY_MS);
        }
    }
}

function findDopamineActivity(): RpcActivity | undefined {
    if (dopamineAction?.activity) return dopamineAction.activity;
    // Before Dopamine sends its next update (plugin enabled mid-song), read
    // what Discord already has.
    const isDopamine = (a: RpcActivity) => a?.application_id === DOPAMINE_APP_ID;
    let local: RpcActivity[] = [];
    try {
        local = LocalActivityStore.getActivities() ?? [];
    } catch {
        // Store renamed in a Discord update; the presence below still works.
    }
    const userId = UserStore.getCurrentUser()?.id;
    return local.find(isDopamine) ?? (userId ? (PresenceStore.getActivities(userId) ?? []).find(isDopamine) : undefined);
}

function getDopaminePlayback() {
    const activity = findDopamineActivity();
    if (!activity?.details) return null;
    const start = activity.timestamps?.start;
    const startMillis = start ? start < 1e12 ? start * 1000 : start : 0;
    return {
        id: `dopamine:${activity.details}:${activity.state ?? ""}`,
        name: activity.details,
        artist: (activity.state ?? "").split(/[;,]/)[0].trim(),
        playing: !!startMillis,
        position: startMillis ? Math.max(0, Date.now() - startMillis) : lastPosition,
    };
}

// ── Flux ──────────────────────────────────────────────────────────────────────

interface SpotifyPlayerState {
    track: { id: string; name: string; artists: { name: string; }[]; } | null;
    isPlaying: boolean;
    position: number;
}

let spotifyPlayerState: SpotifyPlayerState | null = null;
let spotifyStateTs = 0;

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
        staleLyric = lastSentLine !== null || pendingStatusText !== null || statusLooksLikeLyric();
        // A queued line from the old track must not land after the change.
        pendingStatusText = null;
        if (lineTimer !== null) { clearTimeout(lineTimer); lineTimer = null; }
        currentLines = null;
        lyricsAbortController?.abort();
        lyricsAbortController = null;
        lyricGeneration++;
        if (isPlaying) requestLyrics();
    }

    if (!isPlaying && (wasPlaying || trackChanged)) {
        if (lineTimer !== null) { clearTimeout(lineTimer); lineTimer = null; }
        staleLyric = false;
        handleStopStatus();
    }
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
    tick();
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
                    if (lineTimer !== null) { clearTimeout(lineTimer); lineTimer = null; }
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
    description: "Shows Dopamine, TIDAL, or Spotify lyrics in your Discord custom status and adds album covers to Dopamine's activity. Lyrics fetched from LrcLib.",
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
            loadCustomSongDelays();
            FluxDispatcher.addInterceptor(interceptActivity);
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
        removeInterceptor();
        // Give Dopamine its own icon back.
        republishDopamine();
        dopamineAction = null;
        if (coverTimer !== null) { clearTimeout(coverTimer); coverTimer = null; }
        FluxDispatcher.unsubscribe("SPOTIFY_PLAYER_STATE", onSpotifyPlayerState as any);
        FluxDispatcher.unsubscribe("SPOTIFY_LYRICS_DELAYS_LOADED", loadCustomSongDelays as any);
        FluxDispatcher.unsubscribe("SPOTIFY_LYRICS_CUSTOM_DELAY_CHANGE", onCustomDelayChange as any);
        if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
        if (lineTimer !== null) { clearTimeout(lineTimer); lineTimer = null; }
        if (statusFlushTimer !== null) { clearTimeout(statusFlushTimer); statusFlushTimer = null; }
        // Disabling the plugin mid-playback used to leave the last lyric line
        // stuck as the custom status, because this only ran when nothing was
        // playing. The documented stop behaviour now always applies.
        handleStopStatus();
        currentLines = null;
        staleLyric = false;
        lyricsCache.clear();
        lyricsFailedAt.clear();
        lastSentLine = null;
        isPlaying = false;
        currentTrackId = "";
        spotifyPlayerState = null;
        spotifyStateTs = 0;
        savedOriginalStatus = null;
        statusWriteInFlight = false;
    },
});
