/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings, SettingsStore } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { ColorPicker, React } from "@webpack/common";

const STYLE_ID = "smooth-typing-style";
const CARET_ID = "smooth-typing-caret";
const SMOOTH_STYLE_ID = "vc-smoothtype";
const SMOOTH_CARET_ID = "vc-smoothtype-caret";

let caretEl: HTMLDivElement | null = null;
let rafId: number | null = null;
let tracking = false;

const settings = definePluginSettings({
    smoothTyping: {
        type: OptionType.BOOLEAN,
        description: "Smooth typing caret (the full SmoothType implementation). When on, all other caret settings below are ignored",
        default: true,
        restartNeeded: false,
        onChange() { applySettings(); }
    },
    transitionDelay: {
        type: OptionType.NUMBER,
        description: "Smooth typing: transition delay (ms)",
        default: 75,
        onChange() { applySmoothCSS(); }
    },
    animationType: {
        type: OptionType.SELECT,
        description: "Smooth typing: animation type",
        options: [
            { label: "Ease", value: "ease", default: true },
            { label: "Linear", value: "linear" },
            { label: "Ease-in", value: "ease-in" },
            { label: "Ease-out", value: "ease-out" },
            { label: "Ease-in-out", value: "ease-in-out" }
        ],
        onChange() { applySmoothCSS(); }
    },
    motionBlur: {
        type: OptionType.BOOLEAN,
        description: "Smooth typing: blur the caret while it moves.",
        default: false,
        onChange() { applySmoothCSS(); }
    },
    motionBlurAmount: {
        type: OptionType.SLIDER,
        description: "Smooth typing: caret motion blur strength (px).",
        markers: [1, 2, 3, 4, 6],
        default: 2,
        stickToMarkers: false,
        onChange() { applySmoothCSS(); }
    },
    smoothCaret: {
        type: OptionType.BOOLEAN,
        description: "Enable smooth caret (cursor) animation",
        default: true,
        onChange() { applySettings(); }
    },
    smoothChars: {
        type: OptionType.BOOLEAN,
        description: "Enable smooth character fade-in while typing",
        default: true,
        onChange() { applySettings(); }
    },
    caretSpeed: {
        type: OptionType.NUMBER,
        description: "Caret transition speed (ms) — lower = faster",
        default: 80,
        onChange() { applySettings(); }
    },
    caretEasing: {
        type: OptionType.SELECT,
        description: "Caret transition easing",
        options: [
            { label: "Ease", value: "ease", default: true },
            { label: "Linear", value: "linear" },
            { label: "Ease-in", value: "ease-in" },
            { label: "Ease-out", value: "ease-out" },
            { label: "Ease-in-out", value: "ease-in-out" }
        ],
        onChange() { applySettings(); }
    },
    fadeSpeed: {
        type: OptionType.NUMBER,
        description: "Character fade-in speed (ms) — lower = faster",
        default: 80,
        onChange() { applySettings(); }
    },
    caretColor: {
        type: OptionType.COMPONENT,
        description: "Caret color",
        default: 0xffffff,
        component: () => (
            <ColorPicker
                color={settings.store.caretColor}
                onChange={(color: any) => {
                    settings.store.caretColor = color;
                    applySettings();
                    applySmoothCSS();
                }}
                showEyeDropper={true}
            />
        )
    },
    smoothScrollbar: {
        type: OptionType.BOOLEAN,
        description: "Enable smooth scrollbar in the text area",
        default: true,
        onChange() { applySettings(); }
    },
    scrollbarColor: {
        type: OptionType.STRING,
        description: "Scrollbar color",
        default: "#3b3b3b",
        onChange() { applySettings(); }
    }
});

function getCaretColor() {
    const color = settings.store.caretColor;
    if (!color) return "var(--text-normal, #fff)";
    return `#${color.toString(16).padStart(6, "0")}`;
}

// One-time migration from the deleted SmoothType plugin: pull its tuned values into
// the smooth typing keys and drop its leftover store entry so this only runs once.
// Runs from start(): touching settings.store at module scope throws, because plugin
// settings are not initialized until the plugin manager starts the plugin.
function migrateLegacySmoothType() {
    const legacy = (SettingsStore.plain.plugins as Record<string, any>).SmoothType;
    if (!legacy) return;
    if (typeof legacy.caretColor === "number") settings.store.caretColor = legacy.caretColor;
    if (typeof legacy.transitionDelay === "number") settings.store.transitionDelay = legacy.transitionDelay;
    if (typeof legacy.animationType === "string") settings.store.animationType = legacy.animationType;
    delete (SettingsStore.plain.plugins as Record<string, any>).SmoothType;
    SettingsStore.markAsChanged();
}

function injectCSS() {
    removeCSS();
    // SmoothType owns everything visual while enabled; the legacy stylesheet
    // (char fade, scrollbar, legacy caret) must stay out of the cascade or its
    // rules fight the smooth caret's color/opacity/width.
    if (settings.store.smoothTyping) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    const { fadeSpeed, smoothChars, smoothScrollbar, scrollbarColor } = settings.store;

    style.textContent = `
        /* Hide original caret. caret-color inherits, so setting it on the editor covers the
           whole subtree; the previous "[class*=...] *" put a universal-key selector in the
           bucket that gets retested against every element on every style recalc. */
        [class*="slateTextArea"] {
            caret-color: transparent !important;
        }
${smoothChars ? `
        /* Smooth char fade-in */
        [class*="slateTextArea"] span[data-slate-string="true"] {
            animation: smoothCharIn ${fadeSpeed}ms ease-out both;
        }` : ""}

        @keyframes smoothCharIn {
            from {
                opacity: 0.6;
                filter: blur(0.4px);
            }
            to {
                opacity: 1;
                filter: blur(0px);
            }
        }
        /* Custom caret */
        #${CARET_ID} {
            position: fixed;
            width: 2px;
            border-radius: 2px;
            background: ${getCaretColor()};
            pointer-events: none;
            z-index: 9999;
            animation: caretBlink 1s step-end infinite;
            transition: left var(--caret-speed, 80ms) var(--caret-easing, ease),
                        top var(--caret-speed, 80ms) var(--caret-easing, ease),
                        height var(--caret-speed, 80ms) var(--caret-easing, ease),
                        background 300ms ease;
        }

        @keyframes caretBlink {
            0%, 100% { opacity: 1; }
            50%       { opacity: 0; }
        }

        ${smoothScrollbar ? `
        /* Smooth Scrollbar */
        [class*="slateTextArea"] {
            overflow-y: auto;
            scroll-behavior: smooth;
            scrollbar-width: thin;
            scrollbar-color: ${scrollbarColor} transparent;
        }

        [class*="slateTextArea"]::-webkit-scrollbar {
            width: 4px;
        }

        [class*="slateTextArea"]::-webkit-scrollbar-track {
            background: transparent;
        }

        [class*="slateTextArea"]::-webkit-scrollbar-thumb {
            background: ${scrollbarColor};
            border-radius: 4px;
            transition: background 200ms ease;
        }

        [class*="slateTextArea"]::-webkit-scrollbar-thumb:hover {
            background: ${scrollbarColor}cc;
        }
        ` : ""}
    `;
    document.head.appendChild(style);
}

function removeCSS() {
    document.getElementById(STYLE_ID)?.remove();
}

function createCaret() {
    removeCaret();
    caretEl = document.createElement("div");
    caretEl.id = CARET_ID;
    document.body.appendChild(caretEl);
}

function removeCaret() {
    document.getElementById(CARET_ID)?.remove();
    caretEl = null;
}

function updateCaretPosition() {
    if (!caretEl) return;

    // Check that the focus is within the chat input
    const focused = document.activeElement;
    const isInChat = focused?.closest("[class*='slateTextArea']") ||
        focused?.closest("[class*='textArea']");

    if (!isInChat) {
        caretEl.style.display = "none";
        return;
    }

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(true);

    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return;

    const node = sel.anchorNode;
    if (!node) return;
    const parent = node.parentElement?.closest("[class*='slateTextArea']");
    if (!parent) {
        caretEl.style.display = "none";
        return;
    }

    caretEl.style.display = "block";
    caretEl.style.left = `${rect.left}px`;
    caretEl.style.top = `${rect.top}px`;
    caretEl.style.height = `${rect.height || 20}px`;
}

function isChatInputFocused() {
    const focused = document.activeElement;
    return !!(focused?.closest("[class*='slateTextArea']") || focused?.closest("[class*='textArea']"));
}

// The caret only moves when the selection, layout or focus changes, and every one of
// those fires an event. A permanent rAF loop re-ran getSelection + getBoundingClientRect
// 60 times a second while the chat box was focused, forcing a synchronous layout on every
// frame — that was the typing lag. Now each event schedules at most one coalesced update.
function scheduleCaretUpdate() {
    if (!tracking || rafId !== null) return;
    rafId = requestAnimationFrame(() => {
        rafId = null;
        if (!tracking) return;
        if (isChatInputFocused()) updateCaretPosition();
        else if (caretEl) caretEl.style.display = "none";
    });
}

function onFocusChange() {
    if (!tracking) return;
    if (isChatInputFocused()) scheduleCaretUpdate();
    else if (caretEl) caretEl.style.display = "none";
}

function startTracking() {
    stopTracking();
    tracking = true;
    document.addEventListener("selectionchange", scheduleCaretUpdate);
    document.addEventListener("keydown", resetBlinkOnKey);
    document.addEventListener("focusin", onFocusChange);
    document.addEventListener("focusout", onFocusChange);
    window.addEventListener("resize", scheduleCaretUpdate);
    window.addEventListener("scroll", scheduleCaretUpdate, true);
    scheduleCaretUpdate();
}

function stopTracking() {
    tracking = false;
    if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
    document.removeEventListener("selectionchange", scheduleCaretUpdate);
    document.removeEventListener("keydown", resetBlinkOnKey);
    document.removeEventListener("focusin", onFocusChange);
    document.removeEventListener("focusout", onFocusChange);
    window.removeEventListener("resize", scheduleCaretUpdate);
    window.removeEventListener("scroll", scheduleCaretUpdate, true);
}

function resetBlinkOnKey() {
    if (!caretEl) return;
    caretEl.style.animation = "none";
    void caretEl.offsetHeight;
    caretEl.style.animation = "";
}

/* -------------------------------------------------------------------------- */
/*                          SmoothType (verbatim port)                        */
/* -------------------------------------------------------------------------- */

function toHex(n: number) {
    return `#${n.toString(16).padStart(6, "0")}`;
}

function buildSmoothCSS(): string {
    const color = toHex(settings.store.caretColor ?? 0xffffff);
    const ms = settings.store.transitionDelay ?? 60;
    const easing = settings.store.animationType ?? "ease";
    const blur = settings.store.motionBlur ? settings.store.motionBlurAmount ?? 2 : 0;
    return `
@keyframes vc-blink {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0; }
}
#${SMOOTH_CARET_ID}.is-blinking {
    animation: vc-blink 1s ease-in-out infinite;
}
#${SMOOTH_CARET_ID} {
    position: fixed;
    top: 0; left: 0;
    transform: translate3d(0, 0, 0);
    width: 2px;
    border-radius: 2px;
    background: ${color};
    pointer-events: none;
    z-index: 99999;
    display: none;
    transition: transform ${ms}ms ${easing}, height ${ms}ms ${easing}, filter 160ms ease-out;
}
${blur > 0 ? `#${SMOOTH_CARET_ID}.is-moving {
    filter: blur(${blur}px);
    transition: transform ${ms}ms ${easing}, height ${ms}ms ${easing}, filter 40ms linear;
}
` : ""}
/* Children are covered too: Discord's own stylesheets re-color the caret on
   inner editor nodes (.editor__*, slate leaves), which brings the native
   blinking caret back on top of ours while smooth typing is active. */
[data-slate-editor], [data-slate-editor] * { caret-color: transparent !important; }
::highlight(vc-smoothtype-hide) { color: transparent; }
`;
}

function getSmoothCaret(): HTMLDivElement {
    let el = document.getElementById(SMOOTH_CARET_ID) as HTMLDivElement | null;
    if (!el) {
        el = document.createElement("div");
        el.id = SMOOTH_CARET_ID;
        document.body.appendChild(el);
    }
    return el;
}

let blinkTimer: ReturnType<typeof setTimeout> | null = null;
let motionBlurTimer: ReturnType<typeof setTimeout> | null = null;

function startBlink() { getSmoothCaret().classList.add("is-blinking"); }

function stopBlink() {
    getSmoothCaret().classList.remove("is-blinking");
    if (blinkTimer) clearTimeout(blinkTimer);
    blinkTimer = setTimeout(startBlink, 1000);
}

function markCaretMoving(el: HTMLElement) {
    if (!settings.store.motionBlur || !(settings.store.motionBlurAmount > 0)) return;
    el.classList.add("is-moving");
    if (motionBlurTimer) clearTimeout(motionBlurTimer);
    motionBlurTimer = setTimeout(() => {
        motionBlurTimer = null;
        el.classList.remove("is-moving");
    }, Math.max(60, settings.store.transitionDelay ?? 60) + 30);
}

function applyCaretPosition() {
    const el = getSmoothCaret();
    const activeEditor = document.activeElement?.closest<HTMLElement>("[data-slate-editor]") ?? null;
    // Re-pinning here self-heals when React swaps the focused editor node
    // without a blur/focusin cycle.
    if (!activeEditor) {
        el.style.display = "none"; return;
    }
    hideNativeCaretInline(activeEditor);
    const sel = window.getSelection();
    if (!sel?.rangeCount) { el.style.display = "none"; return; }
    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(false);
    const rects = range.getClientRects();
    let rect: DOMRect | null = rects.length > 0 ? rects[rects.length - 1] : null;
    if (!rect || rect.height === 0) {
        const node = range.startContainer;
        const parent = (node.nodeType === Node.TEXT_NODE ? node.parentElement : node) as HTMLElement | null;
        if (parent) rect = parent.getBoundingClientRect();
    }
    if (!rect || rect.height === 0) { el.style.display = "none"; return; }
    const newTransform = `translate3d(${rect.right}px, ${rect.top}px, 0)`;
    if (el.style.transform !== newTransform) {
        if (el.style.display !== "none") {
            stopBlink();
            markCaretMoving(el);
        }
    }
    el.style.display = "block";
    el.style.transform = newTransform;
    el.style.height = rect.height + "px";
}

let observer: MutationObserver | null = null;
let caretQueued = false;
let caretFrame: number | null = null;

let observedEditor: Element | null = null;

function hideSmoothCaret() {
    const el = document.getElementById(SMOOTH_CARET_ID) as HTMLDivElement | null;
    if (el) el.style.display = "none";
}

function scheduleApplyCaretPosition() {
    if (!document.activeElement?.closest("[data-slate-editor]")) {
        hideSmoothCaret();
        return;
    }
    if (caretQueued) return;

    caretQueued = true;
    caretFrame = requestAnimationFrame(() => {
        caretFrame = null;
        caretQueued = false;
        applyCaretPosition();
    });
}

// The caret moves on selection changes (typing, arrows, clicks), which the direct
// listeners already handle synchronously. The observer only needs to catch the rarer
// case where the editor reflows without a selection change (line wrap, input growth).
// Observing the focused editor element instead of document.body means Discord's constant
// body-subtree churn (typing indicators, message list, popouts) never wakes it, which is
// what caused the typing lag spikes.
function observeEditor() {
    if (observedEditor && !observedEditor.isConnected) {
        observer?.disconnect();
        observedEditor = null;
    }
    const editor = document.activeElement?.closest("[data-slate-editor]") ?? null;
    if (editor === observedEditor) return;
    observer?.disconnect();
    observedEditor = editor;
    if (editor) observer?.observe(editor, { childList: true, subtree: true, characterData: true });
}

function startObserver() {
    observer = new MutationObserver(() => {
        scheduleApplyCaretPosition();
    });
}

function stopObserver() {
    observer?.disconnect();
    observer = null;
    observedEditor = null;
    if (caretFrame !== null) {
        cancelAnimationFrame(caretFrame);
        caretFrame = null;
    }
    caretQueued = false;
}

// Editors currently carrying an inline caret-color override. The stylesheet rule
// hides the native caret, but Discord's own sheets set caret colors on inner
// editor nodes and load after ours - the inline !important pin wins every
// cascade battle regardless of order or specificity.
const inlineHiddenEditors = new Set<HTMLElement>();

function pruneInlineHiddenEditors() {
    for (const editor of inlineHiddenEditors) {
        if (!editor.isConnected) {
            editor.style.removeProperty("caret-color");
            inlineHiddenEditors.delete(editor);
        }
    }
}

function hideNativeCaretInline(editor: HTMLElement) {
    pruneInlineHiddenEditors();
    if (!inlineHiddenEditors.has(editor)) {
        editor.style.setProperty("caret-color", "transparent", "important");
        inlineHiddenEditors.add(editor);
    }
}

function restoreInlineHiddenEditors() {
    for (const editor of inlineHiddenEditors) {
        editor.style.removeProperty("caret-color");
    }
    inlineHiddenEditors.clear();
}

const CHAR_HIDE_HIGHLIGHT = "vc-smoothtype-hide";
const supportsCharHighlight = typeof Highlight !== "undefined" && "highlights" in CSS;
// A single typed grapheme. Pastes and IME bursts are not animated: they would need a
// range spanning several characters with a different layout per line.
const MAX_FADE_CHARS = 2;

let hideHighlight: Highlight | null = null;
let charOverlay: HTMLSpanElement | null = null;
let charHiddenRange: Range | null = null;
let charOverlayAnimation: Animation | null = null;
let charFadeCleanup: ReturnType<typeof setTimeout> | null = null;
let charRangeFrame: number | null = null;
let charFadeAttempts = 0;
let pendingChars = 0;

function getHideHighlight() {
    if (!hideHighlight) {
        hideHighlight = new Highlight();
        CSS.highlights.set(CHAR_HIDE_HIGHLIGHT, hideHighlight);
    }
    return hideHighlight;
}

function getCharOverlay() {
    if (!charOverlay) {
        charOverlay = document.createElement("span");
        charOverlay.setAttribute("aria-hidden", "true");
        charOverlay.style.cssText = [
            "position: fixed",
            "left: 0",
            "top: 0",
            "margin: 0",
            "padding: 0",
            "white-space: pre",
            "pointer-events: none",
            "z-index: 99998",
            "opacity: 0",
            "will-change: opacity, transform"
        ].join(";");
        document.body.appendChild(charOverlay);
    }
    return charOverlay;
}

function stopCharFade() {
    charOverlayAnimation?.cancel();
    charOverlayAnimation = null;
    if (charFadeCleanup) {
        clearTimeout(charFadeCleanup);
        charFadeCleanup = null;
    }
    charHiddenRange = null;
    hideHighlight?.clear();
    if (supportsCharHighlight) CSS.highlights.delete(CHAR_HIDE_HIGHLIGHT);
    hideHighlight = null;
    charOverlay?.remove();
    charOverlay = null;
    pendingChars = 0;
    charFadeAttempts = 0;
}

// A leaf keeps all of its text in one text node, so the typed character cannot be
// styled on its own. It is hidden with a custom highlight while a positioned copy
// fades in on top. The copy is reused because creating a node and animation per
// keystroke forces the compositor to build a new layer, which stutters badly.
function fadeInTypedRange(range: Range) {
    const duration = settings.store.fadeSpeed;
    if (!(duration > 0)) return;
    const rects = range.getClientRects();
    const rect = rects[rects.length - 1];
    const parent = range.startContainer.parentElement;
    if (!rect || !parent) return;

    // Finish the previous letter early; only the newest character needs to fade.
    if (charHiddenRange) hideHighlight?.delete(charHiddenRange);
    charOverlayAnimation?.cancel();
    charOverlayAnimation = null;
    if (charFadeCleanup) {
        clearTimeout(charFadeCleanup);
        charFadeCleanup = null;
    }

    const style = getComputedStyle(parent);
    const overlay = getCharOverlay();
    overlay.textContent = range.toString();
    // individual properties instead of the `font` shorthand: browsers hand back an
    // empty string for it on some elements, which dropped the copy to the body font
    overlay.style.fontFamily = style.fontFamily;
    overlay.style.fontSize = style.fontSize;
    overlay.style.fontWeight = style.fontWeight;
    overlay.style.fontStyle = style.fontStyle;
    overlay.style.lineHeight = `${rect.height}px`;
    overlay.style.color = style.color;
    overlay.style.letterSpacing = style.letterSpacing;
    overlay.style.height = `${rect.height}px`;
    overlay.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;

    getHideHighlight().add(range);
    charHiddenRange = range;

    const animation = overlay.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration, easing: "ease-out", fill: "forwards" }
    );
    charOverlayAnimation = animation;
    const finish = () => {
        if (charOverlayAnimation !== animation) return;
        if (charFadeCleanup) {
            clearTimeout(charFadeCleanup);
            charFadeCleanup = null;
        }
        charOverlayAnimation = null;
        hideHighlight?.delete(range);
        if (charHiddenRange === range) charHiddenRange = null;
        animation.cancel();
        overlay.style.opacity = "0";
        overlay.textContent = "";
    };
    animation.onfinish = finish;
    // a paused page never finishes the animation, which would leave the glyph
    // hidden forever; clean up regardless
    charFadeCleanup = setTimeout(finish, duration + 300);
}

// Returns false while the selection has not caught up with the typed character yet,
// so the caller can retry on a later frame.
function applyCharFade() {
    const count = pendingChars;
    if (!count) return true;
    const sel = window.getSelection();
    const node = sel?.focusNode;
    if (!sel?.rangeCount || !node || node.nodeType !== Node.TEXT_NODE) return false;
    const editor = (node as Text).parentElement?.closest("[data-slate-editor]");
    if (!editor || !editor.contains(document.activeElement)) return false;
    if (sel.focusOffset < count) return false;

    pendingChars = 0;
    const range = document.createRange();
    range.setStart(node, sel.focusOffset - count);
    range.setEnd(node, sel.focusOffset);
    fadeInTypedRange(range);
    return true;
}

function scheduleCharFade() {
    if (charRangeFrame !== null) return;
    charRangeFrame = requestAnimationFrame(() => {
        charRangeFrame = null;
        if (applyCharFade()) {
            charFadeAttempts = 0;
        } else if (pendingChars && ++charFadeAttempts < 3) {
            scheduleCharFade();
        } else {
            charFadeAttempts = 0;
            pendingChars = 0;
        }
    });
}

function closestSlateEditor(target: EventTarget | null): HTMLElement | null {
    if (!(target instanceof Element)) return null;
    const fromTarget = target.closest<HTMLElement>("[data-slate-editor]");
    return fromTarget ?? document.activeElement?.closest<HTMLElement>("[data-slate-editor]") ?? null;
}

const smoothHandlers = {
    sel: () => {
        scheduleApplyCaretPosition();
        if (pendingChars) scheduleCharFade();
    },
    char: (e: InputEvent) => {
        if (!settings.store.smoothChars || !supportsCharHighlight) return;
        if (e.inputType !== "insertText" || !e.data || e.data.length > MAX_FADE_CHARS) return;
        if (!(e.target instanceof Element) || !e.target.closest("[data-slate-editor]")) return;
        // Measuring the range is left to the next frame: doing it here forced a style
        // recalc and layout inside the input handler, and that is what made fast typing
        // stutter. The frame still runs before the browser paints, so the character is
        // hidden before it is ever shown un-animated.
        pendingChars = e.data.length;
        charFadeAttempts = 0;
        scheduleCharFade();
    },
    focus: (e: FocusEvent) => {
        const editor = closestSlateEditor(e.target);
        if (editor) hideNativeCaretInline(editor);
        observeEditor();
        scheduleApplyCaretPosition();
    },
    blur: () => {
        // Re-check after focus settles so tabbing between editors does not
        // flash the native caret; unpins editors that lost focus entirely.
        setTimeout(() => {
            pruneInlineHiddenEditors();
            const active = document.activeElement;
            for (const editor of [...inlineHiddenEditors]) {
                if (active !== editor && !editor.contains(active)) {
                    editor.style.removeProperty("caret-color");
                    inlineHiddenEditors.delete(editor);
                }
            }
        }, 0);
        observeEditor();
        hideSmoothCaret();
    },
    key: () => scheduleApplyCaretPosition(),
    click: (e: MouseEvent) => {
        if (!(e.target instanceof Element) || !e.target.closest("[data-slate-editor]")) {
            hideSmoothCaret();
            return;
        }
        observeEditor();
        scheduleApplyCaretPosition();
    },
};

function startListeners() {
    document.addEventListener("selectionchange", smoothHandlers.sel);
    document.addEventListener("beforeinput", smoothHandlers.char, true);
    document.addEventListener("input", smoothHandlers.char, true);
    document.addEventListener("focusin", smoothHandlers.focus);
    document.addEventListener("focusout", smoothHandlers.blur);
    document.addEventListener("keyup", smoothHandlers.key, true);
    document.addEventListener("click", smoothHandlers.click, true);
}

function stopListeners() {
    document.removeEventListener("selectionchange", smoothHandlers.sel);
    document.removeEventListener("beforeinput", smoothHandlers.char, true);
    document.removeEventListener("input", smoothHandlers.char, true);
    document.removeEventListener("focusin", smoothHandlers.focus);
    document.removeEventListener("focusout", smoothHandlers.blur);
    document.removeEventListener("keyup", smoothHandlers.key, true);
    document.removeEventListener("click", smoothHandlers.click, true);
}

function applySmoothCSS() {
    document.getElementById(SMOOTH_STYLE_ID)?.remove();
    const s = document.createElement("style");
    s.id = SMOOTH_STYLE_ID;
    s.textContent = buildSmoothCSS();
    document.head.appendChild(s);
}

function removeSmoothCSS() {
    document.getElementById(SMOOTH_STYLE_ID)?.remove();
}

function startSmoothTyping() {
    applySmoothCSS();
    // Remove strays from earlier sessions before reusing the id.
    document.querySelectorAll(`#${SMOOTH_CARET_ID}`).forEach((el, i) => {
        if (i > 0) el.remove();
    });
    getSmoothCaret();
    if (settings.store.smoothChars && supportsCharHighlight) getCharOverlay();
    startObserver();
    observeEditor();
    startListeners();
    // The editor may already be focused when the toggle flips on.
    const editor = closestSlateEditor(document.activeElement);
    if (editor) hideNativeCaretInline(editor);
}

function stopSmoothTyping() {
    stopObserver();
    stopListeners();
    removeSmoothCSS();
    restoreInlineHiddenEditors();
    stopCharFade();
    if (charRangeFrame !== null) {
        cancelAnimationFrame(charRangeFrame);
        charRangeFrame = null;
    }
    if (motionBlurTimer) {
        clearTimeout(motionBlurTimer);
        motionBlurTimer = null;
    }
    if (blinkTimer) clearTimeout(blinkTimer);
    document.getElementById(SMOOTH_CARET_ID)?.remove();
}

function applySettings() {
    const { smoothCaret, caretSpeed, caretEasing, smoothTyping } = settings.store;

    document.documentElement.style.setProperty("--caret-speed", `${caretSpeed}ms`);
    document.documentElement.style.setProperty("--caret-easing", caretEasing ?? "ease");

    injectCSS();

    if (smoothTyping) {
        // SmoothType owns the caret completely; the legacy caret path stays off.
        removeCaret();
        stopTracking();
        stopSmoothTyping();
        startSmoothTyping();
        return;
    }

    stopSmoothTyping();

    if (smoothCaret) {
        createCaret();
        startTracking();
    } else {
        removeCaret();
        stopTracking();
    }
}

function cleanup() {
    removeCSS();
    removeCaret();
    stopTracking();
    stopSmoothTyping();
    document.documentElement.style.removeProperty("--caret-speed");
    document.documentElement.style.removeProperty("--caret-easing");
}

export default definePlugin({
    id: "TypingSettings",
    name: "TypingSettings",
    description: "Smooth caret movement, character animation, change color cursor typing.",
    authors: [TestcordDevs.SirPhantom89],
    settings,

    start() {
        migrateLegacySmoothType();
        applySettings();
    },

    stop() {
        cleanup();
    }
});
