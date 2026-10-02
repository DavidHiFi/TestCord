/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface LyricWord {
    text: string;
    startTime: number;
    endTime: number;
    IsPartOfWord: boolean;
}

export interface LyricBackground {
    text: string;
    words: LyricWord[];
    startTime: number;
    endTime: number;
}

export interface SyncedLyric {
    time: number;
    text: string | null;
    words?: LyricWord[];
    background?: LyricBackground[];
    oppositeAligned?: boolean;
    untimed?: boolean;
}

export enum Provider {
    Lrclib = "LRCLIB",
    Spotify = "Spotify",
    SpicyLyrics = "Spicy Lyrics",
    Translated = "Translated",
    Romanized = "Romanized",
    SpicyRomanized = "Spicy Lyrics Romanized",
    None = "None",
}

export interface LyricsAttributionPerson {
    username: string;
    url?: string;
    avatar?: string;
    id?: string;
}

export interface LyricsAttribution {
    provider: string;
    uploader?: LyricsAttributionPerson;
    maker?: LyricsAttributionPerson;
    songWriters?: string[];
}

export interface LyricsData {
    lyricsVersions: Partial<Record<Provider, SyncedLyric[] | null>>;
    useLyric: Provider;
    attributions?: Partial<Record<Provider, LyricsAttribution>>;
}
