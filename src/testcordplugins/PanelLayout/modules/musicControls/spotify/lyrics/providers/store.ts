/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { settings } from "@testcordplugins/PanelLayout/modules/musicControls/settings";
import { getLyrics, lyricFetchers, providers, updateLyrics } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/api";
import { SpotifyStore, type Track } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/SpotifyStore";
import { proxyLazyWebpack } from "@webpack";
import { Flux, FluxDispatcher } from "@webpack/common";

import { lyricsAlternativeFetchers } from "./translator";
import { LyricsData, Provider } from "./types";

export const lyricsAlternative = [Provider.Translated, Provider.Romanized, Provider.SpicyRomanized];

function showNotif(title: string, body: string) {
    if (settings.store.showFailedToasts) {
        showNotification({
            color: "#ee2902",
            title,
            body,
            noPersist: true
        });
    }
}

export const SpotifyLrcStore = proxyLazyWebpack(() => {
    let lyricsInfo: LyricsData | null = null;
    let fetchingsTracks: string[] = [];
    let loadedTrackId: string | null = null;

    class SpotifyLrcStore extends Flux.Store {
        init() { }
        get lyricsInfo() {
            return lyricsInfo;
        }
    }

    const store = new SpotifyLrcStore(FluxDispatcher, {
        async SPOTIFY_PLAYER_STATE(e: { track: Track | null; force?: boolean; }) {
            if (!e.track) {
                loadedTrackId = null;
                if (lyricsInfo) {
                    lyricsInfo = null;
                    store.emitChange();
                }
                return;
            }

            const trackId = e.track.id;

            if (!e.force && trackId === loadedTrackId) return;
            if (fetchingsTracks.includes(trackId)) return;

            loadedTrackId = trackId;
            lyricsInfo = null;
            store.emitChange();

            fetchingsTracks.push(trackId);
            try {
                lyricsInfo = await getLyrics(e.track);
            } finally {
                fetchingsTracks = fetchingsTracks.filter(id => id !== trackId);
            }

            if (loadedTrackId !== trackId) return;

            if (!lyricsInfo) {
                showNotif("No lyrics found", `Could not find lyrics for ${e.track.name}`);
                store.emitChange();
                return;
            }

            const { lyricsConversion } = settings.store;
            if (lyricsConversion !== Provider.None) {
                FluxDispatcher.dispatch({
                    // @ts-ignore
                    type: "SPOTIFY_LYRICS_PROVIDER_CHANGE",
                    provider: lyricsConversion,
                    silent: true
                });
            }

            store.emitChange();
        },

        // @ts-ignore
        async SPOTIFY_LYRICS_PROVIDER_CHANGE(e: { provider: Provider; silent?: boolean; }) {
            const { track } = SpotifyStore;
            if (!track) return;
            const { provider } = e;
            const notify = e.silent ? () => { } : showNotif;
            const currentInfo = (lyricsInfo && loadedTrackId === track.id) ? lyricsInfo : await getLyrics(track);
            if (currentInfo?.useLyric === provider) return;

            if (currentInfo?.lyricsVersions[provider]) {
                lyricsInfo = { ...currentInfo, useLyric: provider };

                await updateLyrics(track.id, currentInfo.lyricsVersions[provider]!, provider);
                store.emitChange();
                return;
            }

            if (provider === Provider.Translated || provider === Provider.Romanized) {
                const originalLyrics = currentInfo?.lyricsVersions[settings.store.lyricsProvider] ||
                    providers.map(p => currentInfo?.lyricsVersions[p]).find(Boolean);

                if (!originalLyrics || !currentInfo) {
                    notify("No lyrics", `No lyrics to ${provider === Provider.Translated ? "translate" : "romanize"}`);
                    return;
                }

                const lyricsCheckText = originalLyrics.map(line => line.text).join(" ");

                if (provider === Provider.Romanized && !/[^\u0000-\u007F]/.test(lyricsCheckText)) {
                    lyricsInfo = {
                        ...currentInfo,
                        useLyric: settings.store.lyricsProvider,
                        lyricsVersions: {
                            ...currentInfo.lyricsVersions,
                        },
                    };
                    store.emitChange();
                    return;
                }

                const fetchResult = await lyricsAlternativeFetchers[provider](originalLyrics);

                if (!fetchResult) {
                    notify("Lyrics fetch failed", `Failed to fetch ${provider === Provider.Translated ? "translation" : "romanization"}`);
                    return;
                }

                lyricsInfo = {
                    ...currentInfo,
                    useLyric: provider,
                    lyricsVersions: {
                        ...currentInfo.lyricsVersions,
                        [provider]: fetchResult
                    }
                };

                await updateLyrics(track.id, fetchResult, provider);

                store.emitChange();
                return;
            }

            if (provider === Provider.SpicyRomanized) {
                const spicy = await lyricFetchers[Provider.SpicyLyrics](track);
                const spicyLines = spicy?.lyricsVersions[Provider.SpicyLyrics];
                const romanized = spicy?.lyricsVersions[Provider.SpicyRomanized];

                if (!spicy || !romanized) {
                    notify("No romanization", "Spicy Lyrics has no romanized lyrics for this song");
                    return;
                }

                if (spicyLines) await updateLyrics(track.id, spicyLines, Provider.SpicyLyrics);
                await updateLyrics(track.id, romanized, Provider.SpicyRomanized);

                lyricsInfo = {
                    useLyric: Provider.SpicyRomanized,
                    lyricsVersions: {
                        ...currentInfo?.lyricsVersions,
                        ...spicy.lyricsVersions
                    }
                };
                store.emitChange();
                return;
            }

            const fetcher = lyricFetchers[provider as keyof typeof lyricFetchers];
            if (typeof fetcher !== "function") {
                notify("Lyrics fetch failed", `No way to fetch ${provider} lyrics`);
                return;
            }

            const newLyricsInfo = await fetcher(track);
            if (!newLyricsInfo) {
                notify("Lyrics fetch failed", `Failed to fetch ${provider} lyrics`);
                return;
            }

            lyricsInfo = newLyricsInfo;

            updateLyrics(track.id, newLyricsInfo.lyricsVersions[provider]!, provider);

            store.emitChange();
        }
    });

    return store;
});

export function refreshSpotifyLyrics() {
    const { track } = SpotifyStore;
    if (track) {
        FluxDispatcher.dispatch({
            // @ts-ignore
            type: "SPOTIFY_PLAYER_STATE",
            track,
            force: true
        });
    }
}
