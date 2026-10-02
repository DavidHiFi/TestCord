/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import { BaseText } from "@components/BaseText";
import { Divider } from "@components/Divider";
import { Flex } from "@components/Flex";
import { FormSwitch } from "@components/FormSwitch";
import { HeadingSecondary } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import showMeYourName, { DISPLAY_NAME_STYLES_OVERRIDE_KEY } from "@plugins/showMeYourName";
import { TestcordDevs } from "@utils/constants";
import { copyWithToast } from "@utils/discord";
import { Margins } from "@utils/margins";
import { classes } from "@utils/misc";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { Button, ColorPicker, FluxDispatcher, Forms, GuildMemberStore, React, Select, TextInput, UserProfileStore, UserStore, useState } from "@webpack/common";

const GOOGLE_FONTS_URL = "https://fonts.googleapis.com/css2?family=Cherry+Bomb+One&family=Chicle&family=MedievalSharp&family=MuseoModerno:wght@400;600;700&family=Nosifer&family=Pixelify+Sans:wght@400;600;700&family=Zilla+Slab:wght@400;600;700&display=swap";

export const fontOptions = [
    { label: "gg sans (Default)", value: "gg-sans", default: true },
    { label: "Tempo", value: "tempo" },
    { label: "Sakura", value: "sakura" },
    { label: "Jellybean", value: "jellybean" },
    { label: "Modern", value: "modern" },
    { label: "Medieval", value: "medieval" },
    { label: "8Bit", value: "8bit" },
    { label: "Vampyre", value: "vampyre" }
];

export const fontMap: Record<string, string> = {
    "gg-sans": "var(--font-primary), 'GG Sans', sans-serif",
    "tempo": "'Zilla Slab', serif",
    "sakura": "'Cherry Bomb One', cursive",
    "jellybean": "'Chicle', cursive",
    "modern": "'MuseoModerno', sans-serif",
    "medieval": "'Neo Castel', 'MedievalSharp', serif",
    "8bit": "'Pixelify Sans', monospace",
    "vampyre": "'Sinistre', 'Nosifer', cursive"
};

export const effectOptions = [
    { label: "None / Solid", value: "solid", default: true },
    { label: "Gradient", value: "gradient" },
    { label: "Neon Glow", value: "neon" },
    { label: "Toon Outline", value: "toon" },
    { label: "Pop Shadow", value: "pop" },
    { label: "Soft Glow", value: "glow" },
    { label: "Prism Rainbow", value: "prism" },
    { label: "Gummy 3D", value: "gummy" }
];

const DisplayNameFonts: any = findByPropsLazy("DEFAULT", "CHERRY_BOMB", "CHICLE", "MUSEO_MODERNO");
const DisplayNameEffects: any = findByPropsLazy("SOLID", "GRADIENT", "NEON", "TOON", "POP", "GLOW", "PRISM", "GUMMY");

export function getFontId(fontKey: string): number {
    try {
        if (DisplayNameFonts) {
            switch (fontKey) {
                case "tempo": return DisplayNameFonts.ZILLA_SLAB ?? 1;
                case "sakura": return DisplayNameFonts.CHERRY_BOMB ?? 2;
                case "jellybean": return DisplayNameFonts.CHICLE ?? DisplayNameFonts.MONKEY_BARS ?? 3;
                case "modern": return DisplayNameFonts.MUSEO_MODERNO ?? 4;
                case "medieval": return DisplayNameFonts.NEO_CASTEL ?? 5;
                case "8bit": return DisplayNameFonts.MAINFRAME ?? 6;
                case "vampyre": return DisplayNameFonts.HEADBANG ?? DisplayNameFonts.SINISTRE ?? 7;
                case "gg-sans":
                default: return DisplayNameFonts.DEFAULT ?? 0;
            }
        }
    } catch { }
    switch (fontKey) {
        case "tempo": return 1;
        case "sakura": return 2;
        case "jellybean": return 3;
        case "modern": return 4;
        case "medieval": return 5;
        case "8bit": return 6;
        case "vampyre": return 7;
        default: return 0;
    }
}

export function getEffectId(effectKey: string): number {
    try {
        if (DisplayNameEffects) {
            switch (effectKey) {
                case "gradient": return DisplayNameEffects.GRADIENT ?? 1;
                case "neon": return DisplayNameEffects.NEON ?? 2;
                case "toon": return DisplayNameEffects.TOON ?? 3;
                case "pop": return DisplayNameEffects.POP ?? 4;
                case "glow": return DisplayNameEffects.GLOW ?? 5;
                case "prism": return DisplayNameEffects.PRISM ?? 6;
                case "gummy": return DisplayNameEffects.GUMMY ?? 7;
                case "solid":
                default: return DisplayNameEffects.SOLID ?? 0;
            }
        }
    } catch { }
    switch (effectKey) {
        case "gradient": return 1;
        case "neon": return 2;
        case "toon": return 3;
        case "pop": return 4;
        case "glow": return 5;
        case "prism": return 6;
        case "gummy": return 7;
        case "solid":
        default: return 0;
    }
}

export interface DecodedBioStyles {
    font?: string;
    fontId?: number;
    effect?: string;
    effectId?: number;
    colors?: number[];
}

export function decode3y3Bio(bio: string | null | undefined): DecodedBioStyles | null {
    if (!bio) return null;

    let ascii = "";
    for (const ch of bio) {
        const cp = ch.codePointAt(0)!;
        if (cp >= 0xe0000 && cp <= 0xe007f) {
            ascii += String.fromCodePoint(cp - 0xe0000);
        }
    }

    if (!ascii) return null;

    const nsMatch = ascii.match(/\[ns:([^\]]+)\]/i);
    if (!nsMatch) return null;

    const result: DecodedBioStyles = {};
    const parts = nsMatch[1].split(";");
    const freeColors: number[] = [];

    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;

        const eq = trimmed.indexOf("=");
        const colon = trimmed.indexOf(":");

        if (eq > 0 || colon > 0) {
            const sep = eq > 0 ? eq : colon;
            const key = trimmed.slice(0, sep).trim().toLowerCase();
            const val = trimmed.slice(sep + 1).trim().toLowerCase();
            if (!key || !val) continue;

            if (key === "f" || key === "font") {
                result.font = val;
                result.fontId = getFontId(val);
            } else if (key === "e" || key === "effect") {
                result.effect = val;
                result.effectId = getEffectId(val);
            } else if (key === "c" || key === "color" || key === "colors") {
                const hexMatches = val.match(/#?[a-fA-F0-9]{6}/g);
                if (hexMatches) {
                    result.colors = hexMatches.map(h => parseInt(h.replace("#", ""), 16));
                }
            }
        } else {
            const lower = trimmed.toLowerCase();
            if (lower.includes(",") || lower.startsWith("#") || /^[a-fA-F0-9]{6}$/.test(lower)) {
                for (const token of lower.split(",")) {
                    const t = token.trim();
                    if (/^#?[a-fA-F0-9]{6}$/.test(t)) {
                        freeColors.push(parseInt(t.replace("#", ""), 16));
                    }
                }
            } else if (fontOptions.some(o => o.value === lower)) {
                result.font = lower;
                result.fontId = getFontId(lower);
            } else if (effectOptions.some(o => o.value === lower)) {
                result.effect = lower;
                result.effectId = getEffectId(lower);
            }
        }
    }

    if ((!result.colors || result.colors.length === 0) && freeColors.length > 0) {
        result.colors = freeColors;
    }

    if (!result.font && !result.effect && !result.colors) {
        return null;
    }

    return result;
}

export function getExistingThemeTag(): string {
    try {
        const myId = getCurrentUserId();
        const bio = myId ? UserProfileStore.getUserProfile(myId)?.bio : "";
        if (!bio) return "";
        let ascii = "";
        for (const ch of bio) {
            const cp = ch.codePointAt(0)!;
            if (cp >= 0xe0000 && cp <= 0xe007f) {
                ascii += String.fromCodePoint(cp - 0xe0000);
            }
        }
        const match = ascii.match(/\[#([a-fA-F0-9]{1,6}),#([a-fA-F0-9]{1,6})\]/);
        if (match) {
            return `[#${match[1]},#${match[2]}]`;
        }
    } catch { }
    return "";
}

export function stripInvisible3y3(text: string): string {
    if (!text) return "";
    let res = "";
    for (const ch of text) {
        const cp = ch.codePointAt(0)!;
        if (cp < 0xe0000 || cp > 0xe007f) {
            res += ch;
        }
    }
    return res.trim();
}

export function encode3y3(options: {
    font?: string;
    effect?: string;
    colors?: number[];
    preserveTheme?: boolean;
}): string {
    let message = "";
    if (options.preserveTheme !== false) {
        const existingTheme = getExistingThemeTag();
        if (existingTheme) {
            message += existingTheme;
        }
    }

    message += buildNsTag(options);

    if (!message) return "";

    const encoded = Array.from(message)
        .map(x => x.codePointAt(0))
        .filter(x => x! >= 0x20 && x! <= 0x7f)
        .map(x => String.fromCodePoint(x! + 0xe0000))
        .join("");

    return " " + encoded;
}

export function buildNsTag(options: {
    font?: string | null;
    effect?: string | null;
    colors?: readonly number[] | null;
}): string {
    const parts: string[] = [];

    if (options.font && options.font !== "gg-sans") {
        parts.push(`f=${options.font}`);
    }
    if (options.effect && options.effect !== "solid" && options.effect !== "none") {
        parts.push(`e=${options.effect}`);
    }
    if (options.colors && options.colors.length > 0) {
        const hexes = options.colors.map(c => "#" + (c & 0xffffff).toString(16).padStart(6, "0"));
        parts.push(`c=${hexes.join(",")}`);
    }

    return parts.length > 0 ? `[ns:${parts.join(";")}]` : "";
}

export function resolveNameColors(color1: unknown, color2: unknown): number[] {
    const c1 = (typeof color1 === "number" && !isNaN(color1) && color1 >= 0) ? color1 : 0xff007f;
    const c2 = (typeof color2 === "number" && !isNaN(color2) && color2 >= 0) ? color2 : 0x00f0ff;
    return [c1, c2];
}

/** Discord renders nothing for gradient/glow/prism when colors is empty. */
function ensureEffectColors(effect: string, colors: number[]): number[] {
    if (colors.length > 0 || effect === "solid") return colors;
    return resolveNameColors(undefined, undefined);
}

const settings = definePluginSettings({
    font: {
        type: OptionType.SELECT,
        description: "Font style for your username and display name",
        options: fontOptions,
        default: "gg-sans",
        onChange: () => {
            notifyUpdate();
        }
    },
    effect: {
        type: OptionType.SELECT,
        description: "Visual effect applied to your name",
        options: effectOptions,
        default: "solid",
        onChange: () => {
            notifyUpdate();
        }
    },
    customColors: {
        type: OptionType.BOOLEAN,
        description: "Apply custom colors to your display name",
        default: false,
        onChange: () => {
            notifyUpdate();
        }
    },
    color1: {
        type: OptionType.NUMBER,
        description: "Primary Name Color",
        default: 0xff007f,
        onChange: () => {
            notifyUpdate();
        }
    },
    color2: {
        type: OptionType.NUMBER,
        description: "Secondary Name Color (used for gradient & glow)",
        default: 0x00f0ff,
        onChange: () => {
            notifyUpdate();
        }
    },
    decodeOtherUsers: {
        type: OptionType.BOOLEAN,
        description: "Decode and render 3y3 name styles from other users in chat and profiles",
        default: true,
        onChange: (value: boolean) => {
            if (!value) restoreAllMutatedTargets();
            userStyleCache.clear();
            notifyUpdate();
        }
    }
});

interface CachedUserStyle {
    font: string;
    fontId: number;
    effect: string;
    effectId: number;
    colors: number[];
}

const userStyleCache = new Map<string, CachedUserStyle | null>();

const MAX_TRACKED_TARGETS = 5000;
const mutatedTargets = new Set<any>();

let originalGetUser: typeof UserStore.getUser | null = null;
let originalGetCurrentUser: typeof UserStore.getCurrentUser | null = null;
let originalGetMember: typeof GuildMemberStore.getMember | null = null;

let originalSmynGetMessageNameElement: typeof showMeYourName.getMessageNameElement | null = null;
let originalSmynGetTypingMemberListElement: typeof showMeYourName.getTypingMemberListProfilesReactionsVoiceNameElement | null = null;
let originalSmynGetMentionElement: typeof showMeYourName.getMentionNameElement | null = null;
let originalSmynGetActiveNowElement: typeof showMeYourName.getActiveNowNameElement | null = null;

let fontLink: HTMLLinkElement | null = null;
let cachedSelfId: string | null = null;
let isStyling = false;
let namePainter: ReturnType<typeof setInterval> | null = null;

function getCurrentUserId(): string | null {
    // Cached: this runs on every name render, and reading through the store
    // each time re-enters patched code. Invalidated by CURRENT_USER_UPDATE.
    if (cachedSelfId) return cachedSelfId;
    try {
        const me = originalGetCurrentUser ? originalGetCurrentUser.call(UserStore) : UserStore.getCurrentUser();
        if (me?.id) cachedSelfId = me.id;
    } catch { }
    return cachedSelfId;
}

function loadFonts() {
    if (document.getElementById("testcord-name-style-fonts")) return;
    fontLink = document.createElement("link");
    fontLink.id = "testcord-name-style-fonts";
    fontLink.rel = "stylesheet";
    fontLink.href = GOOGLE_FONTS_URL;
    document.head.appendChild(fontLink);
}

function unloadFonts() {
    const el = document.getElementById("testcord-name-style-fonts");
    if (el) el.remove();
    fontLink = null;
}

function applyDisplayNameStylesToUser(target: any, isMe?: boolean) {
    if (!target) return;
    const isCurrentUser = isMe ?? (cachedSelfId ? (target.id === cachedSelfId || target.userId === cachedSelfId) : (getCurrentUserId() != null && (target.id === cachedSelfId || target.userId === cachedSelfId)));

    let font = "gg-sans";
    let effect = "solid";
    let colors: number[] = [];

    if (isCurrentUser) {
        const { font: stFont, effect: stEffect, customColors, color1: stColor1, color2: stColor2 } = settings.store;
        font = stFont || "gg-sans";
        effect = stEffect || "solid";

        if (customColors) {
            colors = resolveNameColors(stColor1, stColor2);
        }
    } else {
        const userId = target.id ?? target.userId;
        const cached = userStyleCache.get(userId);
        if (!cached) return;
        font = cached.font;
        effect = cached.effect;
        colors = cached.colors;
    }

    if (font === "gg-sans" && (effect === "solid" || !effect) && colors.length === 0) {
        restoreDisplayNameStylesOnUser(target);
        return;
    }

    if (target._nsOriginalDisplayNameStyles === undefined) {
        target._nsOriginalDisplayNameStyles = target.displayNameStyles ?? null;
        mutatedTargets.add(target);
        if (mutatedTargets.size > MAX_TRACKED_TARGETS) {
            const oldest = mutatedTargets.values().next().value;
            if (oldest !== undefined) restoreDisplayNameStylesOnUser(oldest);
        }
    }

    const fontId = getFontId(font);
    const effectId = getEffectId(effect);
    const existing = target._nsOriginalDisplayNameStyles;

    const next = {
        ...(existing ?? {}),
        fontId,
        font_id: fontId,
        effectId,
        effect_id: effectId,
        colors: ensureEffectColors(effect, colors),
        [DISPLAY_NAME_STYLES_OVERRIDE_KEY]: true
    };

    // Only write when something actually changed. UserStore.getCurrentUser runs
    // during render all over the client, and handing back a fresh object every
    // call makes every subscriber see a new reference, re-render, and call it
    // again. That loop locks up the whole UI.
    if (!displayNameStylesEqual(target.displayNameStyles, next)) {
        target.displayNameStyles = next;
    }
}

function displayNameStylesEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (!a || typeof a !== "object" || !b || typeof b !== "object") return false;

    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;

    for (const key of aKeys) {
        if (key === "colors") {
            const ac = a.colors;
            const bc = b.colors;
            if (!Array.isArray(ac) || !Array.isArray(bc) || ac.length !== bc.length) return false;
            for (let i = 0; i < ac.length; i++) {
                if (ac[i] !== bc[i]) return false;
            }
            continue;
        }
        if (a[key] !== b[key]) return false;
    }

    return true;
}

function restoreDisplayNameStylesOnUser(target: any) {
    if (!target) return;
    if (target._nsOriginalDisplayNameStyles !== undefined) {
        target.displayNameStyles = target._nsOriginalDisplayNameStyles;
        delete target._nsOriginalDisplayNameStyles;
        mutatedTargets.delete(target);
    }
}

function restoreAllMutatedTargets() {
    for (const target of mutatedTargets) {
        if (target._nsOriginalDisplayNameStyles !== undefined) {
            target.displayNameStyles = target._nsOriginalDisplayNameStyles;
            delete target._nsOriginalDisplayNameStyles;
        }
    }
    mutatedTargets.clear();
}

function syncRootVariables() {
    const { effect, customColors, color1, color2 } = settings.store;
    document.documentElement.dataset.nsEffect = effect || "solid";
    document.documentElement.dataset.nsCustomColors = customColors ? "true" : "false";

    if (customColors) {
        const [c1, c2] = resolveNameColors(color1, color2);
        const toHex = (c: number) => "#" + (c & 0xffffff).toString(16).padStart(6, "0");
        document.documentElement.style.setProperty("--ns-user-color-1", toHex(c1));
        document.documentElement.style.setProperty("--ns-user-color-2", toHex(c2));
    } else {
        document.documentElement.style.removeProperty("--ns-user-color-1");
        document.documentElement.style.removeProperty("--ns-user-color-2");
    }
}

/**
 * Re-injects the styles onto the current user without touching the stores.
 * Discord overwrites displayNameStyles on its own refreshes, and the surfaces
 * that render straight off the user object (user area, account popout) never
 * call getCurrentUser again, so nothing else would put them back.
 */
function reapplySelfStyles() {
    const me = originalGetCurrentUser ? originalGetCurrentUser.call(UserStore) : UserStore.getCurrentUser();
    if (!me) return;

    isStyling = true;
    try {
        applyDisplayNameStylesToUser(me, true);
    } finally {
        isStyling = false;
    }

    paintSelfName();
}

/**
 * The user area and account popout are painted by Discord's own renderer, which
 * flattens a gradient to one solid colour. Their markup carries no stable hook
 * for the gradient, so the name element is located by its text content and
 * styled directly. Styles are written with the important priority so they beat
 * Discord's inline styles, and re-applied because Discord recreates these
 * elements whenever the panel re-renders.
 */
// Verified against the live client: Discord renders every display-name effect
// through the same innerContainer_/gradient_ span, and it lightens the
// gradient stops for contrast on the way in (our #0a0809 came out as #7a6071).
// The lightening happens in its JS, so it has to be undone in the DOM.
function paintSelfName() {
    if ((settings.store.effect || "solid") !== "gradient") return;

    const me = originalGetCurrentUser ? originalGetCurrentUser.call(UserStore) : UserStore.getCurrentUser();
    // Display name only. The username is deliberately left alone so surfaces
    // that show it keep Discord's muted styling.
    const name = (me?.globalName || "").trim();
    if (!name) return;

    const { customColors, color1, color2 } = settings.store;
    const [c1, c2] = customColors
        ? resolveNameColors(color1, color2)
        : resolveNameColors(undefined, undefined);
    const h1 = "#" + (c1 & 0xffffff).toString(16).padStart(6, "0");
    const h2 = "#" + (c2 & 0xffffff).toString(16).padStart(6, "0");
    const sig = `${h1}${h2}`;
    const duration = `${Math.max(1, 1.5 * (name.length / 12)).toFixed(2)}s`;

    for (const el of document.body.querySelectorAll<HTMLElement>("*")) {
        // Only the leaf that actually paints the glyphs.
        if (el.querySelector("*")) continue;
        // showMeYourName already renders these with the right colours.
        if (el.closest(".smyn-container")) continue;

        const text = (el.textContent || "").trim();
        if (!text.startsWith(name) || text.length > name.length + 8) continue;

        if (el.dataset.nsPaint === sig) continue;
        el.dataset.nsPaint = sig;
        // Colours live on the element so the stylesheet does not depend on the
        // root variables being current.
        el.style.setProperty("--ns-c1", h1);
        el.style.setProperty("--ns-c2", h2);
        el.style.setProperty("--ns-name-duration", duration);
    }
}

function startNamePainter() {
    if (namePainter) return;
    paintSelfName();
    namePainter = setInterval(paintSelfName, 700);
}

function stopNamePainter() {
    if (!namePainter) return;
    clearInterval(namePainter);
    namePainter = null;
    for (const el of document.querySelectorAll<HTMLElement>("[data-ns-paint]")) {
        delete el.dataset.nsPaint;
        el.style.removeProperty("--ns-c1");
        el.style.removeProperty("--ns-c2");
        el.style.removeProperty("--ns-name-duration");
    }
}

function notifyUpdate() {
    syncRootVariables();
    const me = originalGetCurrentUser ? originalGetCurrentUser.call(UserStore) : UserStore.getCurrentUser();
    if (me) {
        isStyling = true;
        try {
            applyDisplayNameStylesToUser(me, true);
            try {
                FluxDispatcher.dispatch({ type: "USER_UPDATE", user: me });
            } catch { }
        } finally {
            isStyling = false;
        }
    }
    try {
        UserStore.emitChange();
        GuildMemberStore?.emitChange?.();
    } catch { }

    paintSelfName();
}

function SettingsAboutComponent() {
    const me = originalGetCurrentUser ? originalGetCurrentUser.call(UserStore) : UserStore.getCurrentUser();

    const store = settings.use(["font", "effect", "customColors", "color1", "color2"]);
    const [bioText, setBioText] = useState("");

    const selectedFont = store.font ?? "gg-sans";
    const selectedEffect = store.effect ?? "solid";
    const useCustomColors = store.customColors ?? false;
    const nameColor1 = (typeof store.color1 === "number" && !isNaN(store.color1) && store.color1 >= 0) ? store.color1 : 0xff007f;
    const nameColor2 = (typeof store.color2 === "number" && !isNaN(store.color2) && store.color2 >= 0) ? store.color2 : 0x00f0ff;

    const previewFontFamily = fontMap[selectedFont];
    const previewColors = useCustomColors ? [nameColor1, nameColor2] : [];

    const previewHex1 = previewColors[0] != null ? "#" + (previewColors[0] & 0xffffff).toString(16).padStart(6, "0") : undefined;
    const previewHex2 = previewColors[1] != null ? "#" + (previewColors[1] & 0xffffff).toString(16).padStart(6, "0") : previewHex1;

    const previewSpanStyle: React.CSSProperties = {
        fontFamily: previewFontFamily,
        fontSize: "22px",
        fontWeight: 700,
        display: "inline-block",
        color: "var(--header-primary, #f2f3f5)"
    };

    if (previewColors.length > 0) {
        if (previewColors.length >= 2 && selectedEffect !== "solid") {
            previewSpanStyle.background = `linear-gradient(90deg, ${previewHex1}, ${previewHex2})`;
            previewSpanStyle.WebkitBackgroundClip = "text";
            previewSpanStyle.backgroundClip = "text";
            previewSpanStyle.WebkitTextFillColor = "transparent";
            previewSpanStyle.color = "transparent";
        } else if (previewHex1) {
            previewSpanStyle.color = previewHex1;
        }

        if (selectedEffect === "neon" && previewHex1 && previewHex2) {
            previewSpanStyle.textShadow = `0 0 6px ${previewHex2}, 0 0 14px ${previewHex1}`;
        } else if (selectedEffect === "glow" && previewHex1) {
            previewSpanStyle.textShadow = `0 0 10px ${previewHex1}`;
        } else if (selectedEffect === "pop") {
            previewSpanStyle.textShadow = "2px 2px 0px rgba(0,0,0,0.85)";
        } else if (selectedEffect === "toon") {
            previewSpanStyle.textShadow = "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000";
        }
    } else {
        if (selectedEffect === "neon") {
            previewSpanStyle.textShadow = "0 0 6px currentColor, 0 0 14px currentColor";
        } else if (selectedEffect === "glow") {
            previewSpanStyle.textShadow = "0 0 10px currentColor";
        } else if (selectedEffect === "pop") {
            previewSpanStyle.textShadow = "2px 2px 0px rgba(0,0,0,0.85)";
        } else if (selectedEffect === "toon") {
            previewSpanStyle.textShadow = "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000";
        }
    }

    const displayName = me?.globalName ?? me?.username ?? "Username Preview";

    const getGenerated3y3 = () => encode3y3({
        font: selectedFont,
        effect: selectedEffect,
        colors: previewColors
    });

    const hasExistingTheme = Boolean(getExistingThemeTag());

    return (
        <section>
            <HeadingSecondary>Name Style Preview & Bio Generator</HeadingSecondary>
            <Paragraph>
                Customize your display name font, effects, and colors. Generate an invisible 3y3 tag to display your custom name style to other Testcord users.
            </Paragraph>

            <Divider className={classes(Margins.top16, Margins.bottom16)} />

            <Forms.FormTitle tag="h3">Live Name Preview</Forms.FormTitle>
            <div style={{
                borderRadius: "8px",
                border: "1px solid var(--background-tertiary, #111214)",
                padding: "20px 24px",
                margin: "12px 0",
                background: "var(--background-secondary-alt, #1e1f22)"
            }}>
                <span style={previewSpanStyle}>
                    {displayName}
                </span>
            </div>

            <Divider className={classes(Margins.top16, Margins.bottom16)} />

            <Forms.FormTitle tag="h3">Style Options</Forms.FormTitle>
            <Flex gap="1.5em" style={{ marginTop: "8px", marginBottom: "16px" }}>
                <div style={{ flex: 1 }}>
                    <BaseText size="sm" style={{ marginBottom: "6px", fontWeight: 600 }}>Font Style</BaseText>
                    {Select && (
                        <Select
                            placeholder="Select a font"
                            closeOnSelect={true}
                            select={(val: string) => {
                                settings.store.font = val;
                            }}
                            isSelected={(v: string) => v === selectedFont}
                            serialize={(v: string) => String(v)}
                            options={fontOptions}
                        />
                    )}
                </div>
                <div style={{ flex: 1 }}>
                    <BaseText size="sm" style={{ marginBottom: "6px", fontWeight: 600 }}>Visual Effect</BaseText>
                    {Select && (
                        <Select
                            placeholder="Select an effect"
                            closeOnSelect={true}
                            select={(val: string) => {
                                settings.store.effect = val;
                            }}
                            isSelected={(v: string) => v === selectedEffect}
                            serialize={(v: string) => String(v)}
                            options={effectOptions}
                        />
                    )}
                </div>
            </Flex>

            <FormSwitch
                title="Custom Name Colors"
                description="Override your role or default text color with custom solid colors or gradients"
                value={useCustomColors}
                onChange={(val: boolean) => {
                    settings.store.customColors = val;
                }}
            />

            {useCustomColors && (
                <div style={{ marginTop: "12px" }}>
                    <Flex gap="1.5em" style={{ alignItems: "flex-end" }}>
                        <ColorPicker
                            color={nameColor1}
                            label={<BaseText size="xs" style={{ marginTop: "4px" }}>Primary Name Color</BaseText>}
                            onChange={(color: number) => {
                                settings.store.color1 = resolveNameColors(color, undefined)[0];
                            }}
                        />
                        <ColorPicker
                            color={nameColor2}
                            label={<BaseText size="xs" style={{ marginTop: "4px" }}>Secondary (Gradient/Glow)</BaseText>}
                            onChange={(color: number) => {
                                settings.store.color2 = resolveNameColors(undefined, color)[1];
                            }}
                        />
                    </Flex>
                </div>
            )}

            <Divider className={classes(Margins.top16, Margins.bottom16)} />

            <Forms.FormTitle tag="h3">Bio Generator</Forms.FormTitle>
            <Paragraph className={Margins.bottom8}>
                Optionally enter your bio text below to generate your complete bio with invisible 3y3 characters appended:
            </Paragraph>
            {hasExistingTheme && (
                <Paragraph className={Margins.bottom8} style={{ color: "var(--text-positive, #23a55a)", fontSize: "12px" }}>
                    &bull; Preserving existing profile banner theme colors from FakeProfileThemes in your 3y3 tag.
                </Paragraph>
            )}
            <div style={{ marginBottom: "16px" }}>
                <TextInput
                    placeholder="Type your bio here (or leave blank to copy only 3y3)..."
                    value={bioText}
                    onChange={(val: string) => setBioText(val)}
                />
            </div>
            <Flex gap="1em">
                <Button
                    onClick={() => {
                        // Defaults produce an empty tag; copying "" would toast a
                        // success while putting nothing on the clipboard.
                        const tag = getGenerated3y3();
                        if (!tag) return;
                        copyWithToast(tag);
                    }}
                    color={Button.Colors.BRAND}
                    size={Button.Sizes.MEDIUM}
                >
                    Copy 3y3 Only
                </Button>
                {bioText.trim().length > 0 && (
                    <Button
                        onClick={() => {
                            const clean = stripInvisible3y3(bioText);
                            const tag = getGenerated3y3();
                            // Without a tag this is just the cleaned bio, which is
                            // not what the button promises.
                            if (!tag) return;
                            copyWithToast(clean ? `${clean}${tag}` : tag);
                        }}
                        color={Button.Colors.PRIMARY}
                        size={Button.Sizes.MEDIUM}
                    >
                        Copy Full Bio with 3y3
                    </Button>
                )}
            </Flex>

            <Divider className={classes(Margins.top16, Margins.bottom16)} />

            <HeadingSecondary>Usage</HeadingSecondary>
            <Paragraph className={Margins.top8}>
                Paste the copied string into your Discord profile bio (User Settings &rarr; Profiles &rarr; About Me).
            </Paragraph>
        </section>
    );
}

export default definePlugin({
    name: "NameStyleChanger",
    description: "Change display name font styles, effects, and colors with invisible 3y3 bio sharing support.",
    tags: ["Customisation", "Appearance"],
    authors: [TestcordDevs.x2b, TestcordDevs.sirphantom89],
    settings,
    settingsAboutComponent: SettingsAboutComponent,

    start() {
        loadFonts();
        syncRootVariables();
        startNamePainter();

        if (typeof settings.store.color1 !== "number" || isNaN(settings.store.color1) || settings.store.color1 < 0) {
            settings.store.color1 = 0xff007f;
        }
        if (typeof settings.store.color2 !== "number" || isNaN(settings.store.color2) || settings.store.color2 < 0) {
            settings.store.color2 = 0x00f0ff;
        }

        if (!originalGetUser) originalGetUser = UserStore.getUser;
        if (!originalGetCurrentUser) originalGetCurrentUser = UserStore.getCurrentUser;

        try {
            const me = originalGetCurrentUser ? originalGetCurrentUser.call(UserStore) : UserStore.getCurrentUser();
            if (me?.id) cachedSelfId = me.id;
        } catch { }

        UserStore.getUser = function (userId: string) {
            const user = originalGetUser!.apply(this, arguments as any);
            if (!user || isStyling) return user;
            isStyling = true;
            try {
                const selfId = getCurrentUserId();
                if (user.id === selfId) {
                    applyDisplayNameStylesToUser(user, true);
                } else if (settings.store.decodeOtherUsers && userStyleCache.has(user.id)) {
                    applyDisplayNameStylesToUser(user, false);
                }
            } finally {
                isStyling = false;
            }
            return user;
        };

        UserStore.getCurrentUser = function () {
            const user = originalGetCurrentUser!.apply(this, arguments as any);
            if (user && !isStyling) {
                isStyling = true;
                try {
                    if (!cachedSelfId && user.id) cachedSelfId = user.id;
                    applyDisplayNameStylesToUser(user, true);
                } finally {
                    isStyling = false;
                }
            }
            return user;
        };

        if (GuildMemberStore?.getMember) {
            if (!originalGetMember) originalGetMember = GuildMemberStore.getMember;
            GuildMemberStore.getMember = function (guildId: string, userId: string) {
                const member = originalGetMember!.apply(this, arguments as any);
                if (!member || isStyling) return member;
                isStyling = true;
                try {
                    const selfId = getCurrentUserId();
                    if (userId === selfId) {
                        applyDisplayNameStylesToUser(member, true);
                    } else if (settings.store.decodeOtherUsers && userStyleCache.has(userId)) {
                        applyDisplayNameStylesToUser(member, false);
                    }
                } finally {
                    isStyling = false;
                }
                return member;
            };
        }

        if (showMeYourName) {
            if (showMeYourName.getMessageNameElement && !originalSmynGetMessageNameElement) {
                originalSmynGetMessageNameElement = showMeYourName.getMessageNameElement;
                showMeYourName.getMessageNameElement = (props: any) => {
                    const el = originalSmynGetMessageNameElement!(props);
                    return this.wrapChildren(el, props);
                };
            }
            if (showMeYourName.getTypingMemberListProfilesReactionsVoiceNameElement && !originalSmynGetTypingMemberListElement) {
                originalSmynGetTypingMemberListElement = showMeYourName.getTypingMemberListProfilesReactionsVoiceNameElement;
                showMeYourName.getTypingMemberListProfilesReactionsVoiceNameElement = (props: any) => {
                    const el = originalSmynGetTypingMemberListElement!(props);
                    return this.wrapChildren(el, props);
                };
            }
            if (showMeYourName.getMentionNameElement && !originalSmynGetMentionElement) {
                originalSmynGetMentionElement = showMeYourName.getMentionNameElement;
                showMeYourName.getMentionNameElement = (props: any) => {
                    const el = originalSmynGetMentionElement!(props);
                    return this.wrapChildren(el, { author: { id: props?.userId } });
                };
            }
            if (showMeYourName.getActiveNowNameElement && !originalSmynGetActiveNowElement) {
                originalSmynGetActiveNowElement = showMeYourName.getActiveNowNameElement;
                showMeYourName.getActiveNowNameElement = (props: any) => {
                    const el = originalSmynGetActiveNowElement!(props);
                    return this.wrapChildren(el, props);
                };
            }
        }

        notifyUpdate();
    },

    stop() {
        unloadFonts();
        stopNamePainter();
        document.documentElement.style.removeProperty("--ns-user-color-1");
        document.documentElement.style.removeProperty("--ns-user-color-2");
        delete document.documentElement.dataset.nsEffect;
        delete document.documentElement.dataset.nsCustomColors;

        if (originalGetUser) UserStore.getUser = originalGetUser;
        if (originalGetCurrentUser) UserStore.getCurrentUser = originalGetCurrentUser;
        if (originalGetMember && GuildMemberStore) GuildMemberStore.getMember = originalGetMember;

        originalGetUser = null;
        originalGetCurrentUser = null;
        originalGetMember = null;
        cachedSelfId = null;
        isStyling = false;

        if (showMeYourName) {
            if (originalSmynGetMessageNameElement) {
                showMeYourName.getMessageNameElement = originalSmynGetMessageNameElement;
                originalSmynGetMessageNameElement = null;
            }
            if (originalSmynGetTypingMemberListElement) {
                showMeYourName.getTypingMemberListProfilesReactionsVoiceNameElement = originalSmynGetTypingMemberListElement;
                originalSmynGetTypingMemberListElement = null;
            }
            if (originalSmynGetMentionElement) {
                showMeYourName.getMentionNameElement = originalSmynGetMentionElement;
                originalSmynGetMentionElement = null;
            }
            if (originalSmynGetActiveNowElement) {
                showMeYourName.getActiveNowNameElement = originalSmynGetActiveNowElement;
                originalSmynGetActiveNowElement = null;
            }
        }

        const me = UserStore.getCurrentUser();
        if (me) restoreDisplayNameStylesOnUser(me);
        restoreAllMutatedTargets();
        userStyleCache.clear();

        try {
            UserStore.emitChange();
            GuildMemberStore?.emitChange?.();
        } catch { }
    },

    flux: {
        CURRENT_USER_UPDATE() {
            // An account switch changes who "self" is.
            cachedSelfId = null;
            reapplySelfStyles();
        },

        // Discord's first presence/session sync lands a couple of minutes after
        // start and replaces displayNameStyles with the server value, which
        // strips the injected styles from the user area and everything else
        // rendering straight off the user object. No emitChange: this event
        // already schedules the re-render, and emitting here would re-enter.
        READY() {
            reapplySelfStyles();
        },

        USER_PROFILE_FETCH_SUCCESS(event: any) {
            const userId = event?.userProfile?.user?.id ?? event?.userProfile?.userId;
            const bio = event?.userProfile?.user_profile?.bio ?? event?.userProfile?.bio;
            if (!userId || !settings.store.decodeOtherUsers) return;

            if (userId === getCurrentUserId()) return;

            const decoded = bio ? decode3y3Bio(bio) : null;
            if (decoded) {
                const font = decoded.font ?? "gg-sans";
                const fontId = decoded.fontId ?? getFontId(font);
                const effect = decoded.effect ?? "solid";
                const effectId = decoded.effectId ?? getEffectId(effect);
                const colors = decoded.colors ?? [];
                userStyleCache.set(userId, { font, fontId, effect, effectId, colors });
            } else {
                userStyleCache.set(userId, null);
            }

            // Read through the original so the patch does not re-apply first.
            const user = originalGetUser ? originalGetUser.call(UserStore, userId) : UserStore.getUser(userId);
            if (decoded) applyDisplayNameStylesToUser(user, false);
            else restoreDisplayNameStylesOnUser(user);

            // Deliberately no emitChange here. USER_PROFILE_FETCH_SUCCESS is
            // itself triggered by rendering a profile, so emitting a store
            // change re-renders that profile, which fetches again, which emits
            // again. That loop freezes the client.
        }
    },

    patches: [
        {
            find: '="SYSTEM_TAG"',
            replacement: {
                match: /(onClick:\i,onContextMenu:\i,children:)(.{1,400}?)(?=,"data-text":)/,
                replace: "$1$self.wrapChildren($2,arguments[0])"
            }
        }
    ],

    wrapChildren(children: any, context: any) {
        if (!children) return children;
        const authorId = context?.message?.author?.id ?? context?.author?.id ?? context?.user?.id ?? context?.userId;
        const currentUserId = getCurrentUserId();

        if (!authorId) return children;

        const isMe = authorId === currentUserId;
        if (!isMe && !settings.store.decodeOtherUsers) return children;

        let font = "gg-sans";

        if (isMe) {
            font = settings.store.font || "gg-sans";
        } else {
            let cached = userStyleCache.get(authorId);
            if (cached === undefined) {
                const bio = UserProfileStore.getUserProfile(authorId)?.bio;
                if (bio) {
                    const decoded = decode3y3Bio(bio);
                    if (decoded) {
                        const dFont = decoded.font ?? "gg-sans";
                        const dFontId = decoded.fontId ?? getFontId(dFont);
                        const dEffect = decoded.effect ?? "solid";
                        const dEffectId = decoded.effectId ?? getEffectId(dEffect);
                        const dColors = decoded.colors ?? [];
                        cached = { font: dFont, fontId: dFontId, effect: dEffect, effectId: dEffectId, colors: dColors };
                    } else {
                        cached = null;
                    }
                } else {
                    cached = null;
                }
                userStyleCache.set(authorId, cached);
            }
            if (!cached) return children;
            font = cached.font;
        }

        if (font === "gg-sans") {
            return children;
        }

        if (React.isValidElement(children) && (children.props as any)?.["data-namestyle"]) {
            return children;
        }

        const fontFamily = fontMap[font];
        if (!fontFamily) return children;

        return (
            <span style={{ fontFamily }} data-namestyle="true">
                {children}
            </span>
        );
    }
});
