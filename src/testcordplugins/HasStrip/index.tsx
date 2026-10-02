/*
 * Vencord, a Discord client mod
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";

const RESCAN_MS = 120_000;
const DEBOUNCE_MS = 800;

let observer: MutationObserver | undefined;
let intervalId: ReturnType<typeof setInterval> | undefined;
let debounceId: ReturnType<typeof setTimeout> | undefined;
let totalRemoved = 0;
const processed = new WeakSet<CSSStyleSheet>();

function stripSheet(sheet: CSSStyleSheet): number {
    let removed = 0;
    try {
        const walk = (owner: any, rules: CSSRuleList) => {
            for (let i = rules.length - 1; i >= 0; i--) {
                const rule: any = rules[i];
                let selector: string | null = null;
                try { selector = rule.selectorText ?? null; } catch { /* ignore */ }
                if (selector && selector.includes(":has(")) {
                    try {
                        owner.deleteRule(i);
                        removed++;
                        continue;
                    } catch { /* not deletable at this level, leave it */ }
                }
                let nested: CSSRuleList | null = null;
                try { nested = rule.cssRules ?? null; } catch { /* ignore */ }
                if (nested && nested.length) walk(rule, nested);
            }
        };
        walk(sheet, sheet.cssRules);
    } catch { /* inaccessible or detached sheet */ }
    return removed;
}

function scan(force: boolean) {
    let removed = 0;
    for (const sheet of Array.from(document.styleSheets)) {
        if (!force && processed.has(sheet)) continue;
        processed.add(sheet);
        removed += stripSheet(sheet);
    }
    if (removed > 0) {
        totalRemoved += removed;
        console.log(`[HasStrip] removed ${removed} :has() rule(s); total ${totalRemoved}`);
    }
}

function scheduleScan() {
    if (debounceId !== undefined) clearTimeout(debounceId);
    debounceId = setTimeout(() => scan(false), DEBOUNCE_MS);
}

export default definePlugin({
    name: "HasStrip",
    description: "Removes :has() selector rules from stylesheets. Blink re-tests whole ancestor chains on every DOM mutation while :has() is present; Discord ships ~116 such rules, and with a busy call + plugin widgets the client burned 40-60% of a core in style recalcs. Stripping them cuts style-recalc ~10x. Tradeoff: a handful of hover/focus micro-styling that depends on :has() no longer applies.",
    authors: [],
    start() {
        scan(false);
        observer = new MutationObserver(scheduleScan);
        observer.observe(document.head ?? document.documentElement, { childList: true, subtree: true });
        intervalId = setInterval(() => scan(true), RESCAN_MS);
    },
    stop() {
        observer?.disconnect();
        observer = undefined;
        if (intervalId !== undefined) clearInterval(intervalId);
        if (debounceId !== undefined) clearTimeout(debounceId);
        intervalId = debounceId = undefined;
    }
});
