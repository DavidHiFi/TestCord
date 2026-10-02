/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { LyricWord } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/lyrics/providers/types";
import { React } from "@webpack/common";

import { getWordProgress, getWordState, resetWord, stepWord } from "./WordAnimator";

export function useSpicyWordFrame(
    words: LyricWord[] | undefined | null,
    wordRefs: React.RefObject<(HTMLSpanElement | null)[]>,
    getPositionMs: () => number,
    isPlaying: boolean
): void {
    const mountedForRef = React.useRef<LyricWord[] | undefined | null>(null);

    React.useEffect(() => {
        if (!words?.length) {
            mountedForRef.current = null;
            return;
        }

        let rafId: number | undefined;
        let lastFrameTime = performance.now();

        let needsReset = mountedForRef.current !== words;
        mountedForRef.current = words;

        const frame = (now: number) => {
            const deltaTimeSec = Math.min((now - lastFrameTime) / 1000, 0.05);
            lastFrameTime = now;

            const posSec = getPositionMs() / 1000;

            if (needsReset) {
                needsReset = false;
                for (let j = 0; j < words.length; j++) {
                    const jEl = wordRefs.current?.[j];
                    if (!jEl) continue;
                    resetWord(
                        jEl,
                        getWordState(posSec, words[j].startTime, words[j].endTime),
                        getWordProgress(posSec, words[j].startTime, words[j].endTime)
                    );
                }
            }

            for (let i = 0; i < words.length; i++) {
                const el = wordRefs.current?.[i];
                if (!el) continue;

                const state = getWordState(posSec, words[i].startTime, words[i].endTime);
                const progress = getWordProgress(posSec, words[i].startTime, words[i].endTime);
                stepWord(el, state, progress, deltaTimeSec);
            }

            if (isPlaying) rafId = requestAnimationFrame(frame);
        };

        rafId = requestAnimationFrame(frame);

        return () => {
            if (rafId !== undefined) cancelAnimationFrame(rafId);
        };
    }, [words, isPlaying]);
}
