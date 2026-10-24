/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { escapeRegExp } from "@utils/text";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher } from "@webpack/common";

const CATEGORIES = {
    blockSlurs: {
        label: "Slurs",
        nouns: ["retard", "retarded", "faggot", "fag", "tranny", "spic", "wetback", "chink", "kike", "coon", "gook", "paki"],
        verbs: [],
        patterns: ["\\bn[i1!]{1,2}g[a@3e]{2,}\\w*"]
    },
    blockSexual: {
        label: "Sexual terms",
        nouns: ["cum", "cunt", "dick", "pussy", "slut", "whore", "boobs", "boobies", "tits", "blowjob", "porn", "boner"],
        verbs: ["fuck", "fucks", "fucking", "cumming"]
    },
    blockInsults: {
        label: "General insults",
        nouns: ["idiot", "moron", "imbecile", "dumbass", "loser", "pathetic", "worthless", "garbage", "trash"],
        verbs: ["kill", "murder", "destroy", "ruin", "obliterate"]
    },
    blockBrainrot: {
        label: "Brainrot",
        nouns: ["skibidi", "gyatt", "rizzler", "rizz", "mewing", "mew", "ohio", "boykisser", "nettspend", "hawk tuah"],
        verbs: []
    },
    blockOthers: {
        label: "Personal annoyances",
        nouns: ["kotlin", "avast", "iphone", "apple music"],
        verbs: []
    }
} as const;

type CategoryKey = keyof typeof CATEGORIES;
// only the slur category carries patterns, so this has to be optional
type Category = { label: string; nouns: readonly string[]; verbs: readonly string[]; patterns?: readonly string[] };

const NOUNS = [
    "pasta", "kebab", "cake", "potato", "waffle", "computer", "keyboard", "woman", "monster truck",
    "umbrella", "mosque", "queen", "storm", "physics", "bathroom", "airport", "owner", "mom",
    "good", "java", "hamburger", "plant", "dragon", "wizard", "noodle", "penguin", "robot"
] as const;

const VERBS = [
    "love", "hug", "teach", "marry", "dance", "explode", "melt", "brush", "date", "freeze", "tickle",
    "free", "feed", "water", "high five", "respect", "admire", "thank", "comfort", "welcome"
] as const;

const NOTE = "\n-# **GoodPerson made this message good. Reload your client to clear changes**";

const settings = definePluginSettings({
    incoming: {
        description: "Filter incoming messages",
        type: OptionType.BOOLEAN,
        default: true
    },
    blockSlurs: {
        description: "Block targeted slurs",
        type: OptionType.BOOLEAN,
        default: true
    },
    blockSexual: {
        description: "Block sexual words",
        type: OptionType.BOOLEAN,
        default: true
    },
    blockInsults: {
        description: "Block more general insults",
        type: OptionType.BOOLEAN,
        default: true
    },
    blockBrainrot: {
        description: "Block things commonly said by Gen Alpha children",
        type: OptionType.BOOLEAN,
        default: true
    },
    blockOthers: {
        description: "Block other personally disliked words",
        type: OptionType.BOOLEAN,
        default: true
    }
});

const category = (key: CategoryKey) => CATEGORIES[key] as Category;
const enabled = () => (Object.keys(CATEGORIES) as CategoryKey[]).filter(key => settings.plain[key]);

/** longest first, so "fucking" cannot match as "fuck" and leave "ing" dangling off the end */
const alternation = (words: readonly string[]) => [...new Set(words)]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");

const words = (list: readonly string[]) => new RegExp(`\\b(${alternation(list)})\\b`, "gi");

interface Rule {
    regex: RegExp;
    pool: readonly string[];
}

/**
 * Module scope on purpose. The settings store is persisted as JSON, and a RegExp does not
 * survive that: it comes back as a truthy `{}` that matches nothing, which silently disables
 * the whole plugin until a setting is toggled.
 */
let compiled: { key: string; rules: Rule[] } = { key: "", rules: [] };

function compile() {
    const active = enabled();
    const key = active.join(",");
    if (compiled.key === key) return;

    const rules: Rule[] = [];

    for (const name of active) {
        const { nouns, verbs, patterns = [] } = category(name);

        if (nouns.length) rules.push({ regex: words(nouns), pool: NOUNS });
        if (verbs.length) rules.push({ regex: words(verbs), pool: VERBS });
        if (patterns.length) rules.push({ regex: new RegExp(`(${patterns.join("|")})`, "gi"), pool: NOUNS });
    }

    compiled = { key, rules };
}

const pick = (pool: readonly string[]) => pool[Math.floor(Math.random() * pool.length)];

/** fenced blocks and `inline code` are left alone, so pasting code does not get mangled */
const CODE = /```[\s\S]*?```|`[^`\n]*`/g;

function split(content: string) {
    const parts: { code: boolean; text: string }[] = [];
    let cursor = 0;

    for (const match of content.matchAll(CODE)) {
        if (match.index > cursor) parts.push({ code: false, text: content.slice(cursor, match.index) });
        parts.push({ code: true, text: match[0] });
        cursor = match.index + match[0].length;
    }

    if (cursor < content.length) parts.push({ code: false, text: content.slice(cursor) });
    return parts;
}

function cleanSegment(text: string) {
    let out = text;
    for (const { regex, pool } of compiled.rules) {
        regex.lastIndex = 0;
        out = out.replace(regex, () => pick(pool));
    }
    return out;
}

export function clean(content: string) {
    compile();
    if (compiled.rules.length === 0) return content;

    return split(content).map(part => (part.code ? part.text : cleanSegment(part.text))).join("");
}

export default definePlugin({
    id: "GoodPerson",
    name: "GoodPerson",
    description: "Makes you (or others) a good person",
    tags: ["Utility", "Fun"],
    authors: [TestcordDevs.x2b],
    settings,

    onBeforeMessageSend(_channelId, message) {
        message.content = clean(message.content);
    },

    flux: {
        MESSAGE_CREATE({ guildId, message }) {
            if (!settings.plain.incoming) return;

            const cleaned = clean(message.content);
            if (cleaned === message.content) return;

            message.content = cleaned + NOTE;
            FluxDispatcher.dispatch({ type: "MESSAGE_UPDATE", message, guildId });
        },

        MESSAGE_UPDATE({ guildId, message }) {
            if (!settings.plain.incoming) return;
            if (message.content.includes(NOTE)) return;

            const cleaned = clean(message.content);
            if (cleaned === message.content) return;

            message.content = cleaned + NOTE;
            FluxDispatcher.dispatch({ type: "MESSAGE_UPDATE", message, guildId });
        }
    }
});
