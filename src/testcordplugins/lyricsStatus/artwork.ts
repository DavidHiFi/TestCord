/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface Artwork {
    url: string;
    album: string;
}

interface SongResult {
    trackName?: string;
    artistName?: string;
    collectionName?: string;
    artworkUrl100?: string;
}

type Search = (term: string, entity: "song" | "album") => Promise<SongResult[]>;

const SEPARATOR = /\s+[-–—|]\s+|\s*\|\s*/;
// Words that describe a soundtrack or an upload rather than naming it.
const FILLER = new Set([
    "soundtrack", "ost", "original", "official", "game", "video", "music", "theme", "score", "main",
    "menu", "song", "trailer", "teaser", "the", "from", "motion", "picture", "series", "extended",
    "hd", "hq", "audio", "lyrics", "lyric", "full", "version", "remastered", "remaster", "of", "a", "and",
]);

export function simplify(value: string): string {
    return value
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, " ")
        .replace(/\s(?:feat\.?|ft\.?|featuring)\s.*$/, " ")
        .replace(/&/g, " and ")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
}

// Like simplify, but keeps bracketed qualifiers such as "(Remix)".
function literal(value: string | undefined): string {
    return (value ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function significantWords(value: string): string[] {
    return simplify(value).split(" ").filter(word => word && !FILLER.has(word) && (word.length > 2 || /\d/.test(word)));
}

export function artistMatches(resultArtist: string | undefined, hints: string[]): boolean {
    const artist = simplify(resultArtist ?? "");
    if (!artist) return false;
    // Whole words only, so "ok" does not match inside "brooklyn".
    return hints.some(hint => {
        const h = simplify(hint);
        return h.length >= 2 && (` ${artist} `.includes(` ${h} `) || ` ${h} `.includes(` ${artist} `));
    });
}

// Every meaningful word of the soundtrack name ("Far Cry 4") appears in the album name.
function contextMatches(collection: string | undefined, context: string): boolean {
    const words = significantWords(context);
    if (!words.length) return false;
    const album = ` ${simplify(collection ?? "")} `;
    return words.every(word => album.includes(` ${word} `));
}

function toArtwork(result: SongResult): Artwork | null {
    const small = result.artworkUrl100 ?? "";
    if (!/^https:\/\/[^/]+\.mzstatic\.com\//.test(small)) return null;
    return { url: small.replace(/\/100x100bb\./, "/600x600bb."), album: result.collectionName ?? "" };
}

// Cover for a track known only by title and artist, from Apple's iTunes search
// (no key, CORS enabled). Local files are often tagged "Uploader" /
// "Artist - Title [Official Video]" or name a game or film soundtrack, so a few
// guesses are tried, and a result counts only when its title and artist (or
// soundtrack name) match. A wrong cover is worse than the player's own icon.
export async function findArtwork(title: string, artists: string, search: Search): Promise<Artwork | null> {
    const hints = [artists, ...artists.split(/\s*[,;&]\s*/)].filter(Boolean);
    const parts = title.split(SEPARATOR).map(part => part.trim()).filter(Boolean);
    const songTitle = parts.length > 1 ? parts[parts.length - 1] : title;
    const context = parts.length > 1 ? parts.slice(0, -1).join(" ") : "";
    const tried = new Set<string>();

    const trySongs = async (term: string, accept: (result: SongResult) => boolean) => {
        const key = simplify(term);
        if (!key || tried.has(key)) return null;
        tried.add(key);
        const accepted = (await search(term, "song")).filter(accept);
        // Prefer the release whose full title matches, so "Love Lies" does not
        // take the cover of "Love Lies (Rick Ross Remix)".
        const exact = accepted.filter(r => literal(r.trackName) === literal(title) || literal(r.trackName) === literal(songTitle));
        for (const result of [...exact, ...accepted]) {
            const artwork = toArtwork(result);
            if (artwork) return artwork;
        }
        return null;
    };

    const fullTitle = simplify(title);
    const shortTitle = simplify(songTitle);
    const hit =
        // Well tagged: "Eminem, Juice WRLD" / "Godzilla".
        await trySongs(`${hints[1] ?? artists} ${fullTitle}`, r =>
            simplify(r.trackName ?? "") === fullTitle && artistMatches(r.artistName, hints))
        // Uploader as artist, real artist in the title: "M I A - Paper Planes".
        ?? (context ? await trySongs(`${context} ${shortTitle}`, r =>
            simplify(r.trackName ?? "") === shortTitle &&
            (artistMatches(r.artistName, [context, ...hints]) || contextMatches(r.collectionName, context))) : null);
    if (hit) return hit;

    // Game or film music: "Far Cry 4 Soundtrack - Sermon On The Mount".
    // Fall back to the soundtrack album's cover when the track itself is not listed.
    const soundtrack = significantWords(context || title).join(" ");
    if (soundtrack && /soundtrack|\bost\b|\btheme\b|\bscore\b/i.test(context || title) && !tried.has(`album:${soundtrack}`)) {
        tried.add(`album:${soundtrack}`);
        for (const album of await search(soundtrack, "album")) {
            if (/soundtrack|score|music from/i.test(album.collectionName ?? "") && contextMatches(album.collectionName, soundtrack)) {
                const artwork = toArtwork(album);
                if (artwork) return artwork;
            }
        }
    }
    return null;
}

export function itunesSearch(fetchImpl: typeof fetch = fetch): Search {
    return async (term, entity) => {
        const query = new URLSearchParams({ term, entity, limit: "25" });
        const response = await fetchImpl(`https://itunes.apple.com/search?${query}`, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error(`iTunes search returned ${response.status}`);
        const data = await response.json() as { results?: SongResult[]; };
        return data.results ?? [];
    };
}
