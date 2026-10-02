/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { settings } from "@testcordplugins/PanelLayout/modules/musicControls/settings";
import { SpotifyLrcStore } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/providers/store";
import {
    LyricsAttribution,
    LyricsAttributionPerson,
    LyricsData,
    LyricWord,
    Provider,
    SyncedLyric,
} from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/providers/types";
import { SpotifyStore } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/SpotifyStore";
import { classNameFactory } from "@utils/css";
import { findCssClassesLazy } from "@webpack";
import { FluxDispatcher, MaskedLink, React, useEffect, useState, useStateFromStores } from "@webpack/common";

export const scrollClasses = findCssClassesLazy("auto", "customTheme");

export const cl = classNameFactory("vc-spotify-lyrics-");

const DATASTORE_KEY = "vc-spotify-custom-song-delays";
const customSongDelays: Record<string, number> = {};

DataStore.get<Record<string, number>>(DATASTORE_KEY).then(saved => {
    if (saved) {
        Object.assign(customSongDelays, saved);
    }
    FluxDispatcher?.dispatch?.({ type: "SPOTIFY_LYRICS_DELAYS_LOADED" });
});

export const MAX_BACKGROUND_GROUPS = 4;

function getLineEndTime(line: SyncedLyric): number {
    let end = line.words?.length ? line.words[line.words.length - 1].endTime : line.time;
    for (const bg of line.background ?? []) end = Math.max(end, bg.endTime);
    return end;
}

export function SpicyWordSpans({ words, refsArray, variant = "lead" }: {
    words: LyricWord[];
    refsArray: React.MutableRefObject<(HTMLSpanElement | null)[]>;
    variant?: "lead" | "bg";
}) {
    return (
        <>
            {words.map((word, w) => (
                <React.Fragment key={w}>
                    <span
                        ref={(el: HTMLSpanElement | null) => { refsArray.current[w] = el; }}
                        className={[
                            "vc-spicy-word",
                            word.IsPartOfWord && "vc-spicy-part-of-word",
                            variant === "bg" && "vc-spicy-bg-word"
                        ].filter(Boolean).join(" ")}
                    >
                        {word.text}
                    </span>
                    {word.IsPartOfWord ? "" : " "}
                </React.Fragment>
            ))}
        </>
    );
}

export function leadAlignCl(
    line: Pick<SyncedLyric, "oppositeAligned">,
    isSpicyProvider: boolean,
    fallback: "left" | "center" = "left"
): string {
    if (!isSpicyProvider) return fallback === "center" ? cl("align-center") : cl("align-left");
    return line.oppositeAligned ? cl("align-right") : cl("align-left");
}

export function NoteSvg() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 480 720" fill="currentColor" className={cl("music-note")}>
            <path d="m160,-240 q -66,0 -113,-47 -47,-47 -47,-113 0,-66 47,-113 47,-47 113,-47 23,0 42.5,5.5 19.5,5.5 37.5,16.5 v -422 h 240 v 160 H 320 v 400 q 0,66 -47,113 -47,47 -113,47 z" />
        </svg>
    );
}

function humanizeSource(source: string): string {
    if (!source) return "";
    return source
        .split(/[_\s]+/)
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
}

export function getCurrentAttribution(lyricsInfo: LyricsData | null): LyricsAttribution | undefined {
    if (!lyricsInfo?.attributions) return undefined;
    const use = lyricsInfo.useLyric;
    if (use === Provider.SpicyLyrics || use === Provider.SpicyRomanized) {
        return lyricsInfo.attributions[Provider.SpicyLyrics];
    }
    return lyricsInfo.attributions[use];
}

function AttributionPersonLine({ label, person }: { label: string; person: LyricsAttributionPerson; }) {
    const href = person.url ?? (person.id ? `https://discord.com/users/${person.id}` : undefined);

    return (
        <div className={cl("attribution-line")}>
            <span className={cl("attribution-label")}>{label} </span>
            {person.avatar && (
                <img
                    src={person.avatar}
                    alt=""
                    className={cl("attribution-avatar")}
                />
            )}
            {href ? (
                <MaskedLink href={href}>{person.username}</MaskedLink>
            ) : (
                <span>{person.username}</span>
            )}
        </div>
    );
}

export function LyricsAttributionFooter({
    lyricsInfo,
    className,
}: {
    lyricsInfo: LyricsData | null;
    className?: string;
}) {
    if (!lyricsInfo) return null;

    const attr = getCurrentAttribution(lyricsInfo);
    if (!attr) return null;

    const hasCredit = !!attr.uploader || !!attr.maker;
    const hasWriters = !!attr.songWriters?.length;
    const hasProvider = !!attr.provider;

    if (!hasCredit && !hasWriters && !hasProvider) return null;

    return (
        <div className={[cl("attribution"), className].filter(Boolean).join(" ")}>
            {hasProvider && (
                <div className={cl("attribution-line")}>
                    <span className={cl("attribution-label")}>Source: </span>
                    <span>{humanizeSource(attr.provider)}</span>
                </div>
            )}
            {hasWriters && (
                <div className={cl("attribution-line")}>
                    <span className={cl("attribution-label")}>
                        {attr.songWriters!.length > 1 ? "Writers: " : "Writer: "}
                    </span>
                    <span>{attr.songWriters!.join(", ")}</span>
                </div>
            )}
            {attr.uploader && <AttributionPersonLine label="Uploaded by: " person={attr.uploader} />}
            {attr.maker && <AttributionPersonLine label="Synced by: " person={attr.maker} />}
        </div>
    );
}

const getIndexes = (lyrics: SyncedLyric[], position: number, delay: number) => {
    const posInSec = (position + delay) / 1000;

    let left = 0, right = lyrics.length - 1;
    let currentIndex: number | null = null;

    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const curr = lyrics[mid];
        const next = lyrics[mid + 1];

        if (curr.time <= posInSec && (!next || next.time > posInSec)) {
            currentIndex = mid;
            break;
        }

        if (curr.time > posInSec) {
            right = mid - 1;
        } else {
            left = mid + 1;
        }
    }

    const nextIdx = currentIndex !== null ? currentIndex + 1 : left;
    const nextLyricIdx = nextIdx < lyrics.length ? nextIdx : null;

    if (currentIndex !== null && posInSec - lyrics[currentIndex].time > 8) {
        return [null, nextLyricIdx];
    }

    return [currentIndex, nextLyricIdx];
};

function scrollLineIntoContainer(
    container: HTMLElement | null,
    el: HTMLElement | null
) {
    if (!container || !el) return;
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    const target = container.scrollTop + (eRect.top - cRect.top) - (cRect.height - eRect.height) / 2;
    container.scrollTo({ top: target, behavior: "smooth" });
}

export function useLyrics({ scroll = true, containerRef }: { scroll?: boolean; containerRef?: React.RefObject<HTMLElement | null>; } = {}) {
    const [track, storePosition, isPlaying] = useStateFromStores(
        [SpotifyStore], () => [
            SpotifyStore.track,
            SpotifyStore.mPosition,
            SpotifyStore.isPlaying,
        ]);
    const lyricsInfo = useStateFromStores([SpotifyLrcStore], () => SpotifyLrcStore.lyricsInfo);

    const { lyricDelay } = settings.use(["lyricDelay"]);

    const [currLrcIndex, setCurrLrcIndex] = useState<number | null>(null);
    const [trailingLrcIndex, setTrailingLrcIndex] = useState<number | null>(null);
    const [nextLyric, setNextLyric] = useState<number | null>(null);
    const [lyricRefs, setLyricRefs] = useState<React.RefObject<HTMLDivElement | null>[]>([]);
    const [, forceUpdate] = useState({});
    const positionRef = React.useRef(0);

    const trackKey = track?.id || track?.name;
    const songCustomDelay = (trackKey && customSongDelays[trackKey]) || 0;
    const totalDelay = lyricDelay + songCustomDelay;

    useEffect(() => {
        const handleDelayUpdate = (action: { type: string; trackKey?: string; delay?: number; }) => {
            if (action.type === "SPOTIFY_LYRICS_CUSTOM_DELAY_CHANGE" && action.trackKey) {
                customSongDelays[action.trackKey] = action.delay!;
            }
            forceUpdate({});
        };

        FluxDispatcher.subscribe("SPOTIFY_LYRICS_CUSTOM_DELAY_CHANGE", handleDelayUpdate);
        FluxDispatcher.subscribe("SPOTIFY_LYRICS_DELAYS_LOADED", handleDelayUpdate);

        return () => {
            FluxDispatcher.unsubscribe("SPOTIFY_LYRICS_CUSTOM_DELAY_CHANGE", handleDelayUpdate);
            FluxDispatcher.unsubscribe("SPOTIFY_LYRICS_DELAYS_LOADED", handleDelayUpdate);
        };
    }, []);

    const currentLyrics = lyricsInfo?.lyricsVersions[lyricsInfo.useLyric];
    const isUntimed = !!currentLyrics?.[0]?.untimed;

    useEffect(() => {
        if (currentLyrics) {
            setLyricRefs(currentLyrics.map(() => React.createRef()));
        }
    }, [currentLyrics]);

    useEffect(() => {
        let rafId: number | undefined;

        const tick = () => {
            if (currentLyrics && !isUntimed) {
                const pos = SpotifyStore.position;
                const [currentIndex, nextLyricIndex] = getIndexes(currentLyrics, pos, totalDelay);

                setCurrLrcIndex(prev => prev === currentIndex ? prev : currentIndex);
                setNextLyric(prev => prev === nextLyricIndex ? prev : nextLyricIndex);

                positionRef.current = pos + totalDelay;
                const posInSec = positionRef.current / 1000;

                let trailingIndex: number | null = null;
                if (currentIndex != null && currentIndex > 0) {
                    const prevLine = currentLyrics[currentIndex - 1];
                    if (posInSec < getLineEndTime(prevLine)) trailingIndex = currentIndex - 1;
                }
                setTrailingLrcIndex(prev => prev === trailingIndex ? prev : trailingIndex);
            } else {
                setCurrLrcIndex(prev => prev === null ? prev : null);
                setTrailingLrcIndex(prev => prev === null ? prev : null);
                setNextLyric(prev => prev === null ? prev : null);
            }

            if (isPlaying) {
                rafId = requestAnimationFrame(tick);
            }
        };

        tick();

        return () => {
            if (rafId !== undefined) cancelAnimationFrame(rafId);
        };
    }, [currentLyrics, isUntimed, totalDelay, isPlaying, storePosition]);

    useEffect(() => {
        if (!scroll || currLrcIndex === null) return;
        const idx = currLrcIndex >= 0 ? currLrcIndex : nextLyric;
        if (idx == null || idx < 0) return;

        const el = lyricRefs[idx]?.current;
        if (!el) return;

        if (containerRef) {
            const container = containerRef.current;
            if (!container) return;

            const isLastLine = idx === lyricRefs.length - 1;
            if (isLastLine) {
                container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
                return;
            }

            scrollLineIntoContainer(container, el);
        } else {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
    }, [currLrcIndex, nextLyric, scroll, lyricRefs, containerRef]);

    return { track, lyricsInfo, lyricRefs, currLrcIndex, trailingLrcIndex, nextLyric, isPlaying, positionRef, isUntimed };
}
