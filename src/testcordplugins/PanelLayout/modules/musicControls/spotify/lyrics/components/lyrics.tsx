/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import { TooltipContainer } from "@components/TooltipContainer";
import { settings } from "@testcordplugins/PanelLayout/modules/musicControls/settings";
import { SpotifyLrcStore } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/providers/store";
import { Provider } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/providers/types";
import { useSpicyWordFrame } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/spicyAnimator/useSpicyWordFrame";
import { SpotifyStore } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/SpotifyStore";
import { ContextMenuApi, openModalLazy, React, useEffect, useState, useStateFromStores } from "@webpack/common";

import { LyricsContextMenu } from "./ctxMenu";
import { LyricsModal } from "./modal";
import { cl, leadAlignCl, LyricsAttributionFooter, MAX_BACKGROUND_GROUPS, NoteSvg, SpicyWordSpans, useLyrics } from "./util";

const prevCl = cl("prev");
const nextCl = cl("next");
const currentCl = cl("current");

function LyricsDisplay({ scroll = true, style }: { scroll?: boolean; style?: React.CSSProperties; }) {
    const { showMusicNoteOnNoLyrics } = settings.use(["showMusicNoteOnNoLyrics"]);
    const containerRef = React.useRef<HTMLDivElement>(null);

    const { lyricsInfo, lyricRefs, currLrcIndex, trailingLrcIndex, isPlaying, positionRef, isUntimed } = useLyrics({ scroll, containerRef });

    const currentLyrics = lyricsInfo?.lyricsVersions[lyricsInfo.useLyric] || null;
    const wordRefsRef = React.useRef<(HTMLSpanElement | null)[]>([]);
    const bgWordRefs0 = React.useRef<(HTMLSpanElement | null)[]>([]);
    const bgWordRefs1 = React.useRef<(HTMLSpanElement | null)[]>([]);
    const bgWordRefs2 = React.useRef<(HTMLSpanElement | null)[]>([]);
    const bgWordRefs3 = React.useRef<(HTMLSpanElement | null)[]>([]);
    const bgWordRefsBySlot = [bgWordRefs0, bgWordRefs1, bgWordRefs2, bgWordRefs3];
    const trailingWordRefsRef = React.useRef<(HTMLSpanElement | null)[]>([]);
    const trailingBgWordRefs0 = React.useRef<(HTMLSpanElement | null)[]>([]);
    const trailingBgWordRefs1 = React.useRef<(HTMLSpanElement | null)[]>([]);
    const trailingBgWordRefs2 = React.useRef<(HTMLSpanElement | null)[]>([]);
    const trailingBgWordRefs3 = React.useRef<(HTMLSpanElement | null)[]>([]);
    const trailingBgWordRefsBySlot = [trailingBgWordRefs0, trailingBgWordRefs1, trailingBgWordRefs2, trailingBgWordRefs3];

    const activeLine = currLrcIndex != null ? currentLyrics?.[currLrcIndex] : undefined;
    const trailingLine = trailingLrcIndex != null ? currentLyrics?.[trailingLrcIndex] : undefined;
    const getPositionMs = () => positionRef.current;

    useSpicyWordFrame(activeLine?.words, wordRefsRef, getPositionMs, isPlaying);
    useSpicyWordFrame(trailingLine?.words, trailingWordRefsRef, getPositionMs, isPlaying);
    for (let bI = 0; bI < MAX_BACKGROUND_GROUPS; bI++) {
        useSpicyWordFrame(activeLine?.background?.[bI]?.words, bgWordRefsBySlot[bI], getPositionMs, isPlaying);
        useSpicyWordFrame(trailingLine?.background?.[bI]?.words, trailingBgWordRefsBySlot[bI], getPositionMs, isPlaying);
    }

    const makeClassName = (index: number): string => {
        if (isUntimed) return "";
        if (index === trailingLrcIndex) return currentCl;
        if (currLrcIndex == null) return prevCl;

        const diff = index - currLrcIndex;

        if (diff === 0) return currentCl;
        return diff > 0 ? nextCl : prevCl;
    };

    const isSpicyProvider = lyricsInfo?.useLyric === Provider.SpicyLyrics || lyricsInfo?.useLyric === Provider.SpicyRomanized;

    return (
        <div
            className={isSpicyProvider ? "vc-spotify-lyrics vc-spotify-lyrics-spicy" : "vc-spotify-lyrics"}
            style={style}
            onClick={() => openModalLazy(async () => props => <LyricsModal props={props} />)}
            onContextMenu={e => ContextMenuApi.openContextMenu(e, () => <LyricsContextMenu />)}
        >
            <div
                ref={containerRef}
                className={isSpicyProvider ? "vc-spotify-lyrics-inner vc-spotify-lyrics-spicy" : "vc-spotify-lyrics-inner"}
            >
                {currentLyrics ? (
                    <>
                        {currentLyrics.map((line, i) => {
                            const isCurrentLine = !isUntimed && currLrcIndex === i;
                            const isTrailingLine = !isUntimed && trailingLrcIndex === i;
                            const isActiveWordLine = isCurrentLine || isTrailingLine;
                            const hasWordTiming = isActiveWordLine && !!line.words?.length;
                            const rowWordRefs = isCurrentLine ? wordRefsRef : trailingWordRefsRef;
                            const rowBgRefs = isCurrentLine ? bgWordRefsBySlot : trailingBgWordRefsBySlot;

                            return (
                                <div ref={lyricRefs[i]} key={i} className={cl("line-row")}>
                                    <BaseText
                                        size={isActiveWordLine ? "sm" : "xs"}
                                        className={[makeClassName(i), leadAlignCl(line, isSpicyProvider, "center")].join(" ")}
                                    >
                                        {hasWordTiming
                                            ? <SpicyWordSpans words={line.words!} refsArray={rowWordRefs} />
                                            : (line.text || NoteSvg())}
                                    </BaseText>
                                    {line.background?.map((bg, bI) => (
                                        <BaseText
                                            key={bI}
                                            size={isActiveWordLine ? "xs" : "xxs"}
                                            className={[makeClassName(i), leadAlignCl(line, isSpicyProvider, "center")].join(" ")}
                                        >
                                            {isActiveWordLine && bI < MAX_BACKGROUND_GROUPS
                                                ? <SpicyWordSpans words={bg.words} refsArray={rowBgRefs[bI]} variant="bg" />
                                                : bg.text}
                                        </BaseText>
                                    ))}
                                </div>
                            );
                        })}
                        <LyricsAttributionFooter lyricsInfo={lyricsInfo} />
                    </>
                ) : showMusicNoteOnNoLyrics ? (
                    <TooltipContainer text="No synced lyrics found">
                        <NoteSvg />
                    </TooltipContainer>
                ) : null}
            </div>
        </div>
    );
}

export function SpotifyLyrics({ scroll = true }: { scroll?: boolean; } = {}) {
    SpotifyLrcStore.init();
    const track = useStateFromStores(
        [SpotifyStore],
        () => SpotifyStore.track,
        null,
        (prev, next) => (prev?.id ? prev.id === next?.id : prev?.name === next?.name)
    );

    const device = useStateFromStores(
        [SpotifyStore],
        () => SpotifyStore.device,
        null,
        (prev, next) => prev?.id === next?.id
    );

    const isPlaying = useStateFromStores([SpotifyStore], () => SpotifyStore.isPlaying);
    const [shouldHide, setShouldHide] = useState(false);

    useEffect(() => {
        setShouldHide(false);
        if (!isPlaying) {
            const timeout = setTimeout(() => setShouldHide(true), 1000 * 60 * 5);
            return () => clearTimeout(timeout);
        }
    }, [isPlaying]);

    if (!track || !device?.is_active || shouldHide) return null;

    const exportTrackImageStyle = {
        "--vc-spotify-track-image": `url(${track?.album?.image?.url || ""})`,
    } as React.CSSProperties;

    return <LyricsDisplay scroll={scroll} style={exportTrackImageStyle} />;
}
