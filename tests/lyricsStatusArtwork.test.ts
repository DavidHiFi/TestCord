/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";

import { artistMatches, findArtwork } from "../src/testcordplugins/lyricsStatus/artwork.ts";

type Result = { trackName?: string; artistName?: string; collectionName?: string; artworkUrl100?: string; };

const art = (name: string) => `https://is1-ssl.mzstatic.com/image/thumb/${name}/100x100bb.jpg`;

function fakeSearch(byTerm: Record<string, Result[]>) {
    const calls: string[] = [];
    const search = async (term: string, entity: "song" | "album") => {
        calls.push(`${entity}:${term}`);
        return byTerm[`${entity}:${term}`] ?? [];
    };
    return { search, calls };
}

test("well tagged track takes the matching release and the 600px image", async () => {
    const { search } = fakeSearch({
        "song:Khalid love lies": [
            { trackName: "Love Lies (Rick Ross Remix)", artistName: "Khalid & Normani", collectionName: "Love Lies (Rick Ross Remix) - Single", artworkUrl100: art("remix") },
            { trackName: "Love Lies", artistName: "Khalid & Normani", collectionName: "Love Lies - Single", artworkUrl100: art("single") },
        ],
    });
    const found = await findArtwork("Love Lies", "Khalid, Normani", search);
    assert.equal(found?.album, "Love Lies - Single");
    assert.equal(found?.url, "https://is1-ssl.mzstatic.com/image/thumb/single/600x600bb.jpg");
});

test("uploader tags fall back to the artist named in the title", async () => {
    const { search } = fakeSearch({
        "song:M I A paper planes": [{ trackName: "Paper Planes", artistName: "M.I.A.", collectionName: "Kala", artworkUrl100: art("kala") }],
    });
    // "M I A" and "M.I.A." simplify to the same words.
    assert.equal((await findArtwork("M I A - Paper Planes", "Diplo", search))?.album, "Kala");
});

test("game soundtrack falls back to the soundtrack album cover", async () => {
    const { search, calls } = fakeSearch({
        "album:far cry 4": [
            { collectionName: "Far Cry 3 (Original Game Soundtrack)", artworkUrl100: art("fc3") },
            { collectionName: "Far Cry 4 (Original Game Soundtrack)", artworkUrl100: art("fc4") },
        ],
    });
    const found = await findArtwork("Far Cry 4 Soundtrack - Sermon On The Mount", "Solo Militia Music ♫✧✦", search);
    assert.equal(found?.album, "Far Cry 4 (Original Game Soundtrack)");
    assert.ok(calls.includes("album:far cry 4"));
});

test("a same-titled song by someone else is not used", async () => {
    const { search } = fakeSearch({
        "song:Kobie Dee jody": [{ trackName: "Jody", artistName: "Someone Else", collectionName: "Other", artworkUrl100: art("x") }],
    });
    assert.equal(await findArtwork("Jody", "Kobie Dee", search), null);
});

test("artists match on whole words only", () => {
    assert.ok(artistMatches("Eminem & Juice WRLD", ["Eminem"]));
    assert.ok(!artistMatches("Brooklyn Duo", ["ok"]));
    assert.ok(!artistMatches("", ["Eminem"]));
});
