/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";

const RESCAN_MS = 120_000;
const DEBOUNCE_MS = 800;
const logger = new Logger("HasStrip");

let observer: MutationObserver | undefined;
let intervalId: ReturnType<typeof setInterval> | undefined;
let debounceId: ReturnType<typeof setTimeout> | undefined;
let totalRemoved = 0;
let processed = new WeakSet<CSSStyleSheet>();
const removedRules: Array<{ owner: CSSStyleSheet | CSSGroupingRule; index: number; text: string; }> = [];

function stripSheet(sheet: CSSStyleSheet): number {
    let removed = 0;
    try {
        const walk = (owner: CSSStyleSheet | CSSGroupingRule, rules: CSSRuleList) => {
            for (let i = rules.length - 1; i >= 0; i--) {
                const rule = rules[i];
                let selector: string | null = null;
                try { selector = "selectorText" in rule && typeof rule.selectorText === "string" ? rule.selectorText : null; } catch { /* inaccessible rule */ }
                if (selector && selector.includes(":has(")) {
                    try {
                        const text = rule.cssText;
                        owner.deleteRule(i);
                        removedRules.push({ owner, index: i, text });
                        removed++;
                        continue;
                    } catch { /* not deletable at this level, leave it */ }
                }
                let nested: CSSRuleList | null = null;
                try { nested = "cssRules" in rule ? (rule as CSSGroupingRule).cssRules : null; } catch { /* inaccessible rule */ }
                if (nested && nested.length) walk(rule as CSSGroupingRule, nested);
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
        logger.info(`Removed ${removed} :has() rules; total ${totalRemoved}`);
    }
}

function scheduleScan() {
    if (debounceId !== undefined) clearTimeout(debounceId);
    debounceId = setTimeout(() => scan(false), DEBOUNCE_MS);
}

export default definePlugin({
    name: "HasStrip",
    description: "Removes :has() stylesheet rules to reduce style recalculation cost, with visual tradeoffs.",
    authors: [TestcordDevs.DavidHiFi],
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
        for (const { owner, index, text } of removedRules.reverse()) {
            try {
                owner.insertRule(text, Math.min(index, owner.cssRules.length));
            } catch (e) {
                logger.debug("Could not restore a stylesheet rule", e);
            }
        }
        removedRules.length = 0;
        processed = new WeakSet();
        totalRemoved = 0;
    }
});
