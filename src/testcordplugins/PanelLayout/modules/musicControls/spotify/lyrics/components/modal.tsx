/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BaseText } from "@components/BaseText";
import { Provider } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/providers/types";
import { useSpicyWordFrame } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/spicyAnimator/useSpicyWordFrame";
import { SpotifyStore, Track } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/SpotifyStore";
import { openImageModal } from "@utils/discord";
import { RenderModalProps } from "@vencord/discord-types";
import { Modal, React } from "@webpack/common";

import { cl, leadAlignCl, LyricsAttributionFooter, MAX_BACKGROUND_GROUPS, NoteSvg, scrollClasses, SpicyWordSpans, useLyrics } from "./util";

const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

function getTitleNode(track: Track | null) {
    if (!track) {
        return <BaseText size="sm" weight="semibold">No track playing</BaseText>;
    }
    return (
        <div className={cl("header-content")}>
            {track?.album?.image?.url && (
                <img
                    src={track.album.image.url}
                    alt={track.album.name}
                    className={cl("album-image")}
                    onClick={() => openImageModal({
                        url: track.album.image.url,
                        width: track.album.image.width,
                        height: track.album.image.height,
                    })}
                />
            )}
            <div>
                <BaseText size="sm" weight="semibold">{track.name}</BaseText>
                <BaseText size="sm">by {track.artists.map(a => a.name).join(", ")}</BaseText>
                <BaseText size="sm">on {track.album.name}</BaseText>
            </div>
        </div>
    );
}

const modalCurrentLine = cl("modal-line-current");
const modalLine = cl("modal-line");

export function LyricsModal({ props }: { props: RenderModalProps; }) {
    const { track, lyricsInfo, lyricRefs, currLrcIndex, trailingLrcIndex, isPlaying, positionRef, isUntimed } = useLyrics({ scroll: true });
    const currentLyrics = lyricsInfo?.lyricsVersions[lyricsInfo.useLyric];
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

    const isSpicyProvider = lyricsInfo?.useLyric === Provider.SpicyLyrics || lyricsInfo?.useLyric === Provider.SpicyRomanized;

    return (
        <Modal {...props} size="md" title={getTitleNode(track)}>
            <div className={`${cl("lyrics-modal-container")} ${scrollClasses.auto}`}>
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
                                        size={isActiveWordLine ? "md" : "sm"}
                                        weight={isActiveWordLine ? "semibold" : "normal"}
                                        className={[isActiveWordLine ? modalCurrentLine : modalLine, leadAlignCl(line, isSpicyProvider)].join(" ")}
                                    >
                                        {!isUntimed && (
                                            <span className={cl("modal-timestamp")} onClick={() => SpotifyStore.seek(line.time * 1000)}>
                                                {formatTime(line.time)}
                                            </span>
                                        )}
                                        {hasWordTiming
                                            ? <SpicyWordSpans words={line.words!} refsArray={rowWordRefs} />
                                            : (line.text || NoteSvg())}
                                    </BaseText>
                                    {line.background?.map((bg, bI) => (
                                        <BaseText
                                            key={bI}
                                            size={isActiveWordLine ? "sm" : "xs"}
                                            weight={isActiveWordLine ? "normal" : "light"}
                                            className={[isActiveWordLine ? modalCurrentLine : modalLine, leadAlignCl(line, isSpicyProvider)].join(" ")}
                                        >
                                            {!isUntimed && (
                                                <span className={cl("modal-timestamp")} onClick={() => SpotifyStore.seek(bg.startTime * 1000)}>
                                                    {formatTime(bg.startTime)}
                                                </span>
                                            )}
                                            {isActiveWordLine && bI < MAX_BACKGROUND_GROUPS
                                                ? <SpicyWordSpans words={bg.words} refsArray={rowBgRefs[bI]} variant="bg" />
                                                : bg.text}
                                        </BaseText>
                                    ))}
                                </div>
                            );
                        })}
                        <LyricsAttributionFooter
                            lyricsInfo={lyricsInfo}
                            className={cl("modal-attribution")}
                        />
                    </>
                ) : (
                    <BaseText size="sm" className={cl("modal-no-lyrics")}>
                        No lyrics available :(
                    </BaseText>
                )}
            </div>
        </Modal>
    );
}
