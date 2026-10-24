/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { managedStyleRootNode } from "@api/Styles";
import { SpotifyStore } from "@testcordplugins/PanelLayout/modules/musicControls/spotify/SpotifyStore";
import { TestcordDevs } from "@utils/constants";
import { createAndAppendStyle } from "@utils/css";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";

import { Accent, extractAccent, mixAccent } from "./color";

const logger = new Logger("LivingAccent");

const SAMPLE_SIZE = 24;
const FADE_STEPS = 8;
const FADE_INTERVAL = 50;
const PAUSE_GRACE_MS = 30_000;

const settings = definePluginSettings({
    recolorThemes: {
        type: OptionType.BOOLEAN,
        description: "Also recolor brand tokens and theme accent variables, not just Testcord panels",
        default: true
    }
});

let styleNode: HTMLStyleElement | null = null;
let current: Accent | null = null;
let fadeTimer: ReturnType<typeof setInterval> | null = null;
let pausedSince = 0;
let lastImage: string | null = null;
const cache = new Map<string, Accent>();

function css(accent: Accent) {
    const base = `
        --brand-experiment: ${accent.accent} !important;
        --brand-500: ${accent.accent} !important;
        --accent-color: ${accent.accent} !important;
        --tc-accent: ${accent.accent} !important;
        --tc-accent-soft: ${accent.soft} !important;
        --tc-accent-glow: ${accent.glow} !important;
        --testcord-accent: ${accent.accent} !important;
    `;
    const themed = settings.store.recolorThemes
        ? `--brand-experiment-500: ${accent.accent} !important; --brand-560: ${accent.soft} !important;`
        : "";
    return `:root{${base}${themed}}`;
}

function paint(accent: Accent | null) {
    if (!styleNode) return;
    styleNode.textContent = accent ? css(accent) : "";
    current = accent;
}

function stopFade() {
    if (fadeTimer === null) return;
    clearInterval(fadeTimer);
    fadeTimer = null;
}

function fadeTo(target: Accent | null) {
    stopFade();

    if (!target || !current) return paint(target);

    const from = current;
    let step = 0;

    fadeTimer = setInterval(() => {
        step++;
        if (step >= FADE_STEPS) {
            stopFade();
            return paint(target);
        }
        paint(mixAccent(from, target, step / FADE_STEPS));
    }, FADE_INTERVAL);
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Failed to load image"));
        img.src = src;
    });
}

async function loadImageCors(url: string): Promise<HTMLImageElement | null> {
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        try {
            return await loadImage(objectUrl);
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    } catch {
        return null;
    }
}

function samplePixels(image: HTMLImageElement) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SAMPLE_SIZE;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    return ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
}

async function accentFor(url: string): Promise<Accent | null> {
    const cached = cache.get(url);
    if (cached) return cached;

    const image = await loadImageCors(url);
    if (!image) return null;

    let pixels: Uint8ClampedArray | null;
    try {
        pixels = samplePixels(image);
    } catch (err) {
        logger.warn("Could not read the album art", err);
        return null;
    }

    if (!pixels) return null;

    const accent = extractAccent(pixels);
    if (accent) {
        if (cache.size > 40) cache.clear();
        cache.set(url, accent);
    }
    return accent;
}

async function update() {
    const { track } = SpotifyStore;
    const playing = SpotifyStore.isPlaying && SpotifyStore.device?.is_active;

    if (!track || !playing) {
        if (!pausedSince) pausedSince = Date.now();
        if (Date.now() - pausedSince >= PAUSE_GRACE_MS && current) fadeTo(null);
        return;
    }

    pausedSince = 0;

    const url = track.album?.image?.url;
    if (!url || url === lastImage) return;
    lastImage = url;

    const accent = await accentFor(url);
    if (accent && lastImage === url) fadeTo(accent);
}

export default definePlugin({
    id: "LivingAccent",
    name: "LivingAccent",
    description: "Testcord's accent colour follows the album art of whatever you are playing on Spotify.",
    authors: [TestcordDevs.sirphantom89],
    tags: ["Appearance"],
    settings,

    flux: {
        SPOTIFY_PLAYER_STATE() {
            update();
        }
    },

    start() {
        styleNode = createAndAppendStyle("tc-living-accent", managedStyleRootNode);
        update();
    },

    stop() {
        stopFade();
        styleNode?.remove();
        styleNode = null;
        current = null;
        lastImage = null;
        pausedSince = 0;
        cache.clear();
    }
});
