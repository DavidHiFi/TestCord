/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { settings } from "@testcordplugins/PanelLayout/modules/musicControls/settings";
import {
    LyricBackground,
    LyricsAttribution,
    LyricsAttributionPerson,
    LyricsData,
    LyricWord,
    Provider,
    SyncedLyric,
} from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/providers/types";

type Source = "spicy_lyrics" | "apple_music" | "spotify" | "unknown";

interface Contributor {
    id: string;
    username: string;
    url?: string;
    avatar?: string;
    hasProfileBanner?: boolean;
}

interface Attribution {
    Uploader: Contributor;
    Maker?: Contributor;
}

interface Syllable {
    Text: string;
    StartTime?: number;
    EndTime?: number;
    IsPartOfWord?: boolean;
    TransliteratedText?: string;
}

interface VocalGroup {
    Syllables: Syllable[];
    StartTime?: number;
    EndTime?: number;
    TransliteratedText?: string;
    TranslatedText?: string;
    HasTransliterations?: true;
    HasTranslations?: true;
}

interface SyllableLine {
    Type: "Vocal";
    OppositeAligned?: boolean;
    Lead: VocalGroup;
    Background?: VocalGroup[];
    HasTransliterations?: true;
    HasTranslations?: true;
}

interface LineLine {
    Type: "Vocal";
    OppositeAligned?: boolean;
    Text: string;
    StartTime?: number;
    EndTime?: number;
    TransliteratedText?: string;
    TranslatedText?: string;
    HasTransliterations?: true;
    HasTranslations?: true;
}

interface StaticLine {
    Text: string;
    TransliteratedText?: string;
    TranslatedText?: string;
    HasTransliterations?: true;
    HasTranslations?: true;
}

interface SyllableLyrics {
    id: string;
    source: Source;
    SongWriters?: string[];
    UploadAttribution?: Attribution;
    HasTransliterations?: true;
    HasTranslations?: true;
    Type: "Syllable";
    StartTime?: number;
    EndTime?: number;
    Content: SyllableLine[];
}

interface LineLyrics {
    id: string;
    source: Source;
    SongWriters?: string[];
    UploadAttribution?: Attribution;
    HasTransliterations?: true;
    HasTranslations?: true;
    Type: "Line";
    StartTime?: number;
    EndTime?: number;
    Content: LineLine[];
}

interface StaticLyrics {
    id: string;
    source: Source;
    SongWriters?: string[];
    UploadAttribution?: Attribution;
    HasTransliterations?: true;
    HasTranslations?: true;
    Type: "Static";
    Lines: StaticLine[];
}

type Lyrics = SyllableLyrics | LineLyrics | StaticLyrics;

interface SpicyLyricsAPIResp {
    Body: Lyrics;
    Status: number;
    Type: string;
}

interface SpicyLyricsAPIError {
    Body?: {
        error?: string;
        message?: string;
    };
    Status: number;
    Type: string;
}

// ---------------------------------------------------------------------------
// Attribution helpers
// ---------------------------------------------------------------------------

function buildAttributionPerson(
    contributor: Contributor | undefined
): LyricsAttributionPerson | undefined {
    if (!contributor?.username) return undefined;

    return {
        username: contributor.username,
        url: contributor.url || undefined,
        avatar: contributor.avatar || undefined,
        id: contributor.id || undefined,
    };
}

function buildSpicyLyricsAttribution(body: Lyrics): LyricsAttribution | undefined {
    const attr = body.UploadAttribution;
    const songWriters = body.SongWriters?.filter(w => !!w?.trim());

    const uploader = buildAttributionPerson(attr?.Uploader);
    const maker = buildAttributionPerson(attr?.Maker);

    if (!uploader && !maker && !songWriters?.length && !body.source) return undefined;

    return {
        provider: body.source,
        uploader,
        maker,
        songWriters: songWriters?.length ? songWriters : undefined,
    };
}

// ---------------------------------------------------------------------------
// Word / line helpers
// ---------------------------------------------------------------------------

function buildWords(
    syllables: Syllable[],
    getText: (syllable: Syllable) => string | undefined = s => s.Text
): LyricWord[] {
    const words: LyricWord[] = [];

    syllables.forEach(syllable => {
        const piece = (getText(syllable) ?? "").trim();
        if (!piece) return;

        words.push({
            text: syllable.IsPartOfWord ? piece : piece + " ",
            startTime: syllable.StartTime ?? 0,
            endTime: syllable.EndTime ?? syllable.StartTime ?? 0,
            IsPartOfWord: syllable.IsPartOfWord ?? false,
        });
    });

    return words;
}

function joinWordsText(words: LyricWord[]): string {
    return words.map(w => w.text).join("").trim();
}

function buildBackground(
    groups: VocalGroup[] | undefined,
    getText: (syllable: Syllable) => string | undefined = s => s.Text
): LyricBackground[] | undefined {
    if (!groups?.length) return undefined;

    const result: LyricBackground[] = [];
    for (const bg of groups) {
        const words = buildWords(bg.Syllables ?? [], getText);
        if (!words.length) continue;

        const text = joinWordsText(words);
        if (text === "" || text === "♪") continue;

        result.push({
            text,
            words,
            startTime: bg.StartTime ?? words[0].startTime,
            endTime: bg.EndTime ?? words[words.length - 1].endTime,
        });
    }

    return result.length ? result : undefined;
}

const STALE_LINE_SEC = 8;
const NOTE_LEAD_IN_SEC = 2;

function getLineEndTime(line: SyncedLyric): number {
    let end = line.words?.length ? line.words[line.words.length - 1].endTime : line.time;
    for (const bg of line.background ?? []) end = Math.max(end, bg.endTime);
    return end;
}

function insertGapNotes(lines: SyncedLyric[]): SyncedLyric[] {
    if (!lines.length) return lines;
    // No-op for untimed lyrics — nothing to interpolate between.
    if (lines[0].untimed) return lines;

    const result: SyncedLyric[] = [];

    if (lines[0].time > STALE_LINE_SEC) result.push({ time: 0, text: null });

    for (let i = 0; i < lines.length; i++) {
        result.push(lines[i]);

        const next = lines[i + 1];
        if (!next) continue;

        const end = getLineEndTime(lines[i]);
        const gap = next.time - end;
        if (gap > STALE_LINE_SEC) {
            result.push({ time: end + Math.min(NOTE_LEAD_IN_SEC, gap / 2), text: null });
        }
    }

    return result;
}

function buildSyllableLine(
    line: SyllableLine,
    getText: (s: Syllable) => string | undefined
): SyncedLyric | null {
    if (line.Type !== "Vocal" || !line.Lead) return null;

    const words = buildWords(line.Lead.Syllables ?? [], getText);
    const background = buildBackground(line.Background, getText);
    const text = joinWordsText(words);

    return {
        time: line.Lead.StartTime ?? words[0]?.startTime ?? background?.[0]?.startTime ?? 0,
        text: (text === "" || text === "♪") ? null : text,
        words: words.length ? words : undefined,
        background,
        oppositeAligned: line.OppositeAligned || undefined,
    };
}

function fromSyllableLine(line: SyllableLine): SyncedLyric | null {
    return buildSyllableLine(line, s => s.Text);
}

function fromLineLine(line: LineLine): SyncedLyric | null {
    if (line.Type !== "Vocal") return null;

    const text = (line.Text ?? "").trim();
    return {
        time: line.StartTime ?? 0,
        text: (text === "" || text === "♪") ? null : text,
        oppositeAligned: line.OppositeAligned || undefined,
    };
}

function fromStaticLine(line: StaticLine): SyncedLyric {
    const text = (line.Text ?? "").trim();
    return {
        time: 0,
        text: (text === "" || text === "♪") ? null : text,
        untimed: true,
    };
}

function fromSyllableLineRomanized(line: SyllableLine): SyncedLyric | null {
    return buildSyllableLine(line, s => s.TransliteratedText ?? s.Text);
}

function fromLineLineRomanized(line: LineLine): SyncedLyric | null {
    if (line.Type !== "Vocal") return null;

    const text = (line.TransliteratedText ?? line.Text ?? "").trim();
    return {
        time: line.StartTime ?? 0,
        text: (text === "" || text === "♪") ? null : text,
        oppositeAligned: line.OppositeAligned || undefined,
    };
}

function fromStaticLineRomanized(line: StaticLine): SyncedLyric {
    const text = (line.TransliteratedText ?? line.Text ?? "").trim();
    return {
        time: 0,
        text: (text === "" || text === "♪") ? null : text,
        untimed: true,
    };
}

function hasAnyTransliteratedText(body: Lyrics): boolean {
    switch (body.Type) {
        case "Syllable":
            return body.Content.some(
                line =>
                    line.Type === "Vocal" &&
                    (!!line.Lead?.Syllables?.some(s => !!s.TransliteratedText) ||
                        !!line.Background?.some(bg =>
                            bg.Syllables?.some(s => !!s.TransliteratedText)
                        ))
            );
        case "Line":
            return body.Content.some(line => line.Type === "Vocal" && !!line.TransliteratedText);
        case "Static":
            return body.Lines.some(line => !!line.TransliteratedText);
        default:
            return false;
    }
}

function buildSpicyRomanizedLyrics(body: Lyrics): SyncedLyric[] | null {
    if (!hasAnyTransliteratedText(body)) return null;

    let lines: SyncedLyric[];

    switch (body.Type) {
        case "Syllable":
            lines = body.Content.map(fromSyllableLineRomanized).filter(
                (l): l is SyncedLyric => l !== null
            );
            break;
        case "Line":
            lines = body.Content.map(fromLineLineRomanized).filter(
                (l): l is SyncedLyric => l !== null
            );
            break;
        case "Static":
            lines = body.Lines.map(fromStaticLineRomanized);
            break;
        default:
            return null;
    }

    return lines.length >= 2 ? insertGapNotes(lines) : null;
}

// ---------------------------------------------------------------------------
// Main fetch function
// ---------------------------------------------------------------------------

export async function getLyricsSpicyLyrics(
    trackId: string,
    apiKey: string
): Promise<LyricsData | null> {
    const id = trackId?.trim();
    const key = apiKey?.trim();
    if (!id) return null;
    if (!key) {
        if (settings.store.showFailedToasts) {
            showNotification({
                color: "#ee2902",
                title: "Spicy Lyrics",
                body: "API key is missing.",
                noPersist: true,
            });
        }
        return null;
    }

    try {
        let body: Lyrics | null = null;
        const nativeHelper = (VencordNative?.pluginHelpers as any)?.PanelLayout;

        if (IS_DISCORD_DESKTOP && typeof nativeHelper?.fetchSpicyLyrics === "function") {
            try {
                const res = await nativeHelper.fetchSpicyLyrics(id, key);
                if (res?.status === 200 && res.data?.Body) {
                    body = res.data.Body;
                } else if (res?.error) {
                    console.warn("[Spicy Lyrics] request failed", res.status, res.error);
                    if (settings.store.showFailedToasts) {
                        showNotification({
                            color: "#ee2902",
                            title: "Spicy Lyrics",
                            body: res.error,
                            noPersist: true,
                        });
                    }
                    return null;
                }
            } catch {}
        }

        if (!body) {
            const auth = key.startsWith("Bearer ") ? key : `Bearer ${key}`;
            const resp = await fetch(
                `https://api.spicylyrics.org/v1/lyrics/${encodeURIComponent(id)}`,
                {
                    headers: {
                        Authorization: auth,
                        Accept: "application/json",
                    },
                }
            );

            if (!resp.ok) {
                const errBody = (await resp.json().catch(() => null)) as SpicyLyricsAPIError | null;
                const errMsg = errBody?.Body?.message ?? errBody?.Body?.error ?? resp.statusText;
                console.error("[Spicy Lyrics] request failed", resp.status, errMsg);
                if (settings.store.showFailedToasts) {
                    showNotification({
                        color: "#ee2902",
                        title: "Spicy Lyrics",
                        body: "Api key is wrong, please try to update. Please report if the problem persists.",
                        noPersist: true,
                    });
                }
                return null;
            }

            const data = (await resp.json()) as SpicyLyricsAPIResp;
            body = data.Body;
        }

        if (!body) return null;

        let lines: SyncedLyric[];

        switch (body.Type) {
            case "Syllable":
                lines = body.Content.map(fromSyllableLine).filter(
                    (l): l is SyncedLyric => l !== null
                );
                break;
            case "Line":
                if (settings.store.showFailedToasts) {
                    showNotification({
                        color: "#ee2902",
                        title: "Spicy Lyrics",
                        body: "Spicy lyrics doesn't have timed words for this song.",
                        noPersist: true,
                    });
                }
                lines = body.Content.map(fromLineLine).filter(
                    (l): l is SyncedLyric => l !== null
                );
                break;
            case "Static":
                if (settings.store.showFailedToasts) {
                    showNotification({
                        color: "#ee2902",
                        title: "Spicy Lyrics",
                        body: "Spicy lyrics doesn't have timed words for this song.",
                        noPersist: true,
                    });
                }
                lines = body.Lines.map(fromStaticLine);
                break;
            default:
                if (settings.store.showFailedToasts) {
                    showNotification({
                        color: "#ee2902",
                        title: "Spicy Lyrics",
                        body: "Spicy lyrics doesn't have lyrics for this song.",
                        noPersist: true,
                    });
                }
                return null;
        }

        if (lines.length < 2) return null;

        if (
            body.Type !== "Static" &&
            lines[0].time === 0 &&
            lines[lines.length - 1].time === 0
        ) {
            return null;
        }

        const spicyRomanizedLines = buildSpicyRomanizedLyrics(body);

        // Structured attribution — consumed by the lyrics UI.
        const attributions: Partial<Record<Provider, LyricsAttribution>> = {};
        const spicyAttribution = buildSpicyLyricsAttribution(body);
        if (spicyAttribution) attributions[Provider.SpicyLyrics] = spicyAttribution;

        return {
            useLyric: Provider.SpicyLyrics,
            lyricsVersions: {
                [Provider.SpicyLyrics]: insertGapNotes(lines),
                ...(spicyRomanizedLines
                    ? { [Provider.SpicyRomanized]: spicyRomanizedLines }
                    : {}),
            },
            ...(Object.keys(attributions).length ? { attributions } : {}),
        };
    } catch (e) {
        console.error("[Spicy Lyrics]: ", e);
        return null;
    }
}
