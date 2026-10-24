/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { settings } from "@testcordplugins/PanelLayout/modules/musicControls/settings";
import { computeLineStates, computeLineTimes, isInterludeLine, LineTimes, pickScrollIndex } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/lineTiming";
import { SpotifyLrcStore } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/providers/store";
import {
    LyricsAttribution,
    LyricsAttributionPerson,
    LyricsData,
    LyricWord,
    Provider,
    SyncedLyric,
} from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/providers/types";
import { SmoothScroller } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/smoothScroll";
import { isLetterCapable, segmentGraphemes } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/spicyAnimator/WordAnimator";
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

export function SpicyWordSpans({ words, refsArray, variant = "lead" }: {
    words: LyricWord[];
    refsArray: React.MutableRefObject<(HTMLSpanElement | null)[]>;
    variant?: "lead" | "bg";
}) {
    const { lyricsAnimation } = settings.use(["lyricsAnimation"]);

    const renderSpan = (word: LyricWord, w: number) => {
        const letters = lyricsAnimation && isLetterCapable(word.text, word.startTime, word.endTime)
            ? segmentGraphemes(word.text.trimEnd())
            : null;

        return (
            <span
                ref={(el: HTMLSpanElement | null) => { refsArray.current[w] = el; }}
                data-vc-letters={letters ? "1" : undefined}
                className={[
                    "vc-spicy-word",
                    letters && "vc-spicy-letter-group",
                    word.IsPartOfWord && "vc-spicy-part-of-word",
                    variant === "bg" && "vc-spicy-bg-word"
                ].filter(Boolean).join(" ")}
            >
                {letters
                    ? letters.map((letter, i) => <span key={i} className="vc-spicy-letter">{letter}</span>)
                    : word.text}
            </span>
        );
    };

    const nodes: React.ReactNode[] = [];
    let w = 0;
    while (w < words.length) {
        const first = w;
        while (w < words.length - 1 && words[w].IsPartOfWord) w++;
        const last = w;
        w++;

        const trailingSpace = words[last].IsPartOfWord ? "" : " ";

        if (first === last) {
            nodes.push(
                <React.Fragment key={first}>
                    {renderSpan(words[first], first)}
                    {trailingSpace}
                </React.Fragment>
            );
            continue;
        }

        const syllables: React.ReactNode[] = [];
        for (let k = first; k <= last; k++) {
            syllables.push(<React.Fragment key={k}>{renderSpan(words[k], k)}</React.Fragment>);
        }
        nodes.push(
            <React.Fragment key={first}>
                <span className="vc-spicy-word-group">{syllables}</span>
                {trailingSpace}
            </React.Fragment>
        );
    }

    return <>{nodes}</>;
}

export function leadAlignCl(
    line: Pick<SyncedLyric, "oppositeAligned">,
    isSpicyProvider: boolean,
    fallback: "left" | "center" = "left"
): string {
    if (!isSpicyProvider) return fallback === "center" ? cl("align-center") : cl("align-left");
    return line.oppositeAligned ? cl("align-right") : cl("align-left");
}

export function InterludeDots() {
    return (
        <span className={cl("dots")}>
            {[0, 1, 2].map(i => <span key={i} data-vc-dot className={cl("dot")} />)}
        </span>
    );
}

export function interludeAlignCl(lines: SyncedLyric[], index: number, isSpicyProvider: boolean): string {
    if (!isSpicyProvider) return cl("align-center");
    const next = lines.slice(index + 1).find(l => !isInterludeLine(l) && l.text !== null);
    return next?.oppositeAligned ? cl("align-right") : cl("align-left");
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

function sourceLabel(source: string): string {
    if (source === "spicy_lyrics") return "Community lyrics";
    return humanizeSource(source);
}

function AttributionHandle({ person }: { person: LyricsAttributionPerson; }) {
    const href = person.url ?? (person.id ? `https://discord.com/users/${person.id}` : undefined);
    const handle = `@${person.username}`;

    return (
        <>
            {person.avatar && (
                <img
                    src={person.avatar}
                    alt=""
                    className={cl("attribution-avatar")}
                />
            )}
            {href ? (
                <MaskedLink href={href}>{handle}</MaskedLink>
            ) : (
                <span className={cl("attribution-bright")}>{handle}</span>
            )}
        </>
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

    const credited = attr.maker ?? attr.uploader;
    const uploadedBy = attr.maker && attr.uploader && attr.uploader.username !== attr.maker.username
        ? attr.uploader
        : undefined;
    const hasWriters = !!attr.songWriters?.length;
    const hasProvider = !!attr.provider;

    if (!credited && !hasWriters && !hasProvider) return null;

    return (
        <div className={[cl("attribution"), className].filter(Boolean).join(" ")}>
            {hasWriters && (
                <div className={cl("attribution-writers")}>
                    <span className={cl("attribution-dim")}>Written by </span>
                    <span className={cl("attribution-bright")}>{attr.songWriters!.join(", ")}</span>
                </div>
            )}
            {(hasProvider || credited) && (
                <div className={cl("attribution-meta")}>
                    {hasProvider && <span className={cl("attribution-dim")}>Provided by {sourceLabel(attr.provider)}</span>}
                    {hasProvider && credited && <span className={cl("attribution-dim")}>·</span>}
                    {credited && (
                        <>
                            <span className={cl("attribution-dim")}>Made by</span>
                            <AttributionHandle person={credited} />
                        </>
                    )}
                    {uploadedBy && (
                        <>
                            <span className={cl("attribution-dim")}>·</span>
                            <span className={cl("attribution-dim")}>Uploaded by</span>
                            <AttributionHandle person={uploadedBy} />
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

export function lineStateClass(statesKey: string, index: number, isUntimed: boolean): string {
    if (isUntimed) return "";
    const state = statesKey[index];
    return cl(state === "a" ? "line-active" : state === "s" ? "line-sung" : "line-next");
}

const USER_SCROLL_COOLDOWN_MS = 750;
const CLOCK_SNAP_MS = 2500;
const CLOCK_EASE = 0.04;
const CLOCK_MAX_SLOW = 0.5;
const CLOCK_MAX_FAST = 1;

function resolveScroller(el: HTMLElement | null): HTMLElement | null {
    for (let node = el; node; node = node.parentElement) {
        const { overflowY } = getComputedStyle(node);
        if ((overflowY === "auto" || overflowY === "scroll" || overflowY === "hidden") && node.scrollHeight > node.clientHeight) {
            return node;
        }
    }
    return el;
}

function getCenteredScrollTop(container: HTMLElement, el: HTMLElement, offset: number): number {
    let top = 0;
    let node: HTMLElement | null = el;
    while (node && node !== container) {
        top += node.offsetTop;
        node = node.offsetParent as HTMLElement | null;
    }

    if (node !== container) {
        const c = container.getBoundingClientRect();
        const e = el.getBoundingClientRect();
        top = container.scrollTop + (e.top - c.top);
    }

    return top - (container.clientHeight / 2 - el.offsetHeight / 2) - offset;
}

function getScrollGoal(container: HTMLElement, el: HTMLElement, index: number, lineCount: number, offset: number): number {
    if (index === lineCount - 1) return Math.max(0, container.scrollHeight - container.clientHeight);
    return getCenteredScrollTop(container, el, offset);
}

function isInView(container: HTMLElement, el: HTMLElement) {
    const c = container.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    return e.bottom > c.top + 5 && e.top < c.bottom - 5;
}

export function useLyrics({ scroll = true, containerRef, centerOffset = 0 }: {
    scroll?: boolean;
    containerRef?: React.RefObject<HTMLElement | null>;
    centerOffset?: number;
} = {}) {
    const [track, storePosition, isPlaying] = useStateFromStores(
        [SpotifyStore], () => [
            SpotifyStore.track,
            SpotifyStore.mPosition,
            SpotifyStore.isPlaying,
        ]);
    const lyricsInfo = useStateFromStores([SpotifyLrcStore], () => SpotifyLrcStore.lyricsInfo);

    const { lyricDelay, smoothScroll } = settings.use(["lyricDelay", "smoothScroll"]);

    const [currLrcIndex, setCurrLrcIndex] = useState<number | null>(null);
    const [statesKey, setStatesKey] = useState("");
    const [lyricRefs, setLyricRefs] = useState<React.RefObject<HTMLDivElement | null>[]>([]);
    const [, forceUpdate] = useState({});
    const positionRef = React.useRef(0);
    const statesRef = React.useRef("");

    const scrollerRef = React.useRef<SmoothScroller | null>(null);
    const lastScrolledRef = React.useRef<number | null>(null);
    const lastTickPosRef = React.useRef<number | null>(null);
    const lastSeekEpochRef = React.useRef(-1);
    const clockRef = React.useRef<{ pos: number; t: number; } | null>(null);
    const scrollContainerRef = React.useRef<HTMLElement | null>(null);
    const targetIndexRef = React.useRef<number | null>(null);
    const jumpedRef = React.useRef(true);
    const lastUserScrollRef = React.useRef(0);
    const userScrolledRef = React.useRef(false);
    const latestRef = React.useRef({ index: currLrcIndex, refs: lyricRefs });
    latestRef.current = { index: currLrcIndex, refs: lyricRefs };

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

    const lineTimes = React.useMemo<LineTimes[] | null>(
        () => currentLyrics && !isUntimed ? computeLineTimes(currentLyrics) : null,
        [currentLyrics, isUntimed]
    );

    useEffect(() => {
        if (currentLyrics) {
            setLyricRefs(currentLyrics.map(() => React.createRef()));
        }
    }, [currentLyrics]);

    useEffect(() => {
        lastScrolledRef.current = null;
        lastTickPosRef.current = null;
        clockRef.current = null;
        scrollContainerRef.current = null;
        targetIndexRef.current = null;
        jumpedRef.current = true;
        userScrolledRef.current = false;
        scrollerRef.current?.stop();
        setCurrLrcIndex(null);
    }, [currentLyrics]);

    useEffect(() => {
        let rafId: number | undefined;

        const tick = () => {
            if (lineTimes) {
                const prev = lastTickPosRef.current;
                const sought = lastSeekEpochRef.current !== SpotifyStore.seekEpoch;
                lastSeekEpochRef.current = SpotifyStore.seekEpoch;

                const now = performance.now();
                const target = SpotifyStore.lyricsPosition(SpotifyStore.position);
                const clock = clockRef.current;
                let pos = target;
                if (isPlaying && clock && !sought && !SpotifyStore.isLineHeld) {
                    const elapsed = now - clock.t;
                    const predicted = clock.pos + elapsed;
                    const drift = target - predicted;
                    if (Math.abs(drift) < CLOCK_SNAP_MS) {
                        const correction = Math.min(
                            Math.max(drift * CLOCK_EASE, -elapsed * CLOCK_MAX_SLOW),
                            elapsed * CLOCK_MAX_FAST
                        );
                        pos = Math.max(clock.pos, predicted + correction);
                    }
                }
                clockRef.current = { pos, t: now };

                const jumped = sought || prev === null || Math.abs(pos - prev) > 1000;
                if (jumped) jumpedRef.current = true;
                lastTickPosRef.current = pos;

                positionRef.current = pos + totalDelay;

                const states = computeLineStates(lineTimes, positionRef.current / 1000);
                statesRef.current = states;
                setStatesKey(prevStates => prevStates === states ? prevStates : states);

                let index = pickScrollIndex(states, lineTimes);

                if (index !== null && SpotifyStore.isLineHeld) {
                    let best = -1;
                    for (let i = 0; i < states.length; i++) {
                        if (states[i] === "a" && (best === -1 || lineTimes[i].start >= lineTimes[best].start)) best = i;
                    }
                    if (best !== -1) index = best;
                }

                if (index !== null) {
                    const target = targetIndexRef.current;
                    if (jumped || target === null || index >= target) targetIndexRef.current = index;
                    else index = target;
                }

                if (index !== null) setCurrLrcIndex(prevIndex => prevIndex === index ? prevIndex : index);
            } else {
                statesRef.current = "";
                setStatesKey(prevStates => prevStates === "" ? prevStates : "");
                setCurrLrcIndex(prevIndex => prevIndex === null ? prevIndex : null);
            }

            if (isPlaying) {
                rafId = requestAnimationFrame(tick);
            }
        };

        tick();

        return () => {
            if (rafId !== undefined) cancelAnimationFrame(rafId);
        };
    }, [lineTimes, totalDelay, isPlaying, storePosition]);

    useEffect(() => {
        const el = containerRef?.current;
        if (!el || !scroll) return;

        const onUserScroll = () => {
            lastUserScrollRef.current = performance.now();
            userScrolledRef.current = true;
            scrollerRef.current?.stop();
        };

        el.addEventListener("wheel", onUserScroll, { passive: true });
        el.addEventListener("touchmove", onUserScroll, { passive: true });
        return () => {
            el.removeEventListener("wheel", onUserScroll);
            el.removeEventListener("touchmove", onUserScroll);
        };
    }, [containerRef, scroll]);

    const getContainer = (el: HTMLElement | null) => {
        const cached = scrollContainerRef.current;
        if (cached && cached.isConnected && el && cached.contains(el)) return cached;
        const found = resolveScroller(el);
        scrollContainerRef.current = found;
        return found;
    };

    const getScroller = (container: HTMLElement) => {
        let scroller = scrollerRef.current;
        if (!scroller || scroller.container !== container) {
            scroller?.stop();
            scroller = scrollerRef.current = new SmoothScroller(container);
        }
        return scroller;
    };

    useEffect(() => {
        if (!scroll || currLrcIndex === null || !lineTimes) return;

        const el = lyricRefs[currLrcIndex]?.current;
        if (!el) return;

        const container = getContainer(containerRef?.current ?? null);
        if (!container) {
            el.scrollIntoView({ behavior: smoothScroll ? "smooth" : "instant", block: "center" });
            return;
        }

        if (performance.now() - lastUserScrollRef.current < USER_SCROLL_COOLDOWN_MS) return;
        if (userScrolledRef.current && !isInView(container, el)) return;
        userScrolledRef.current = false;

        const instant = !smoothScroll || lastScrolledRef.current === null || jumpedRef.current;
        jumpedRef.current = false;
        lastScrolledRef.current = currLrcIndex;

        getScroller(container).scrollTo(() => getScrollGoal(container, el, currLrcIndex, lyricRefs.length, centerOffset), instant);
    }, [currLrcIndex, lyricRefs, scroll, containerRef, lineTimes, centerOffset, smoothScroll]);

    useEffect(() => {
        const el = containerRef?.current;
        if (!el || !scroll || typeof ResizeObserver === "undefined") return;

        const observer = new ResizeObserver(() => {
            const { index, refs } = latestRef.current;
            const line = index === null ? null : refs[index]?.current;
            const container = getContainer(el);
            if (!line || !container) return;
            if (Math.abs(getScrollGoal(container, line, index!, refs.length, centerOffset) - container.scrollTop) < 2) return;
            getScroller(container).scrollTo(() => getScrollGoal(container, line, index!, refs.length, centerOffset), true);
        });

        observer.observe(el);
        return () => observer.disconnect();
    }, [containerRef, scroll, centerOffset]);

    useEffect(() => () => scrollerRef.current?.stop(), []);

    return {
        track,
        lyricsInfo,
        lyricRefs,
        currLrcIndex,
        statesKey,
        statesRef,
        lineTimes,
        isPlaying,
        positionRef,
        storePosition,
        isUntimed,
    };
}
