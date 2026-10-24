/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { RestAPI, showToast, Toasts, UserStore } from "@webpack/common";

const settings = definePluginSettings({
    channelIDs: {
        description: "Only watch these channels (comma separated, empty for all)",
        type: OptionType.STRING
    },
    userIDs: {
        description: "Never react to these users (comma separated)",
        type: OptionType.STRING
    },
    emoji: {
        description: "Reaction to use. Custom emoji work too, in the name:id form.",
        type: OptionType.STRING,
        default: "\u{1F480}"
    },
    threshold: {
        description: "How suspicious a message has to look before reacting",
        type: OptionType.SLIDER,
        min: 1,
        max: 6,
        default: 4,
        markers: [1, 2, 3, 4, 5, 6],
        stickToMarkers: true
    },
    maxChars: {
        description: "Ignore anything longer than this",
        type: OptionType.NUMBER,
        default: 500
    }
});

const KEYBOARD_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890"];

const LOW_EFFORT = new Set([
    "u", "ur", "r", "k", "kk", "kkk", "bc", "idk", "wbu", "imo", "ngl", "fr", "np",
    "irl", "yw", "tbf", "afaik", "smh", "ikr", "lmk", "hmu", "wyd", "istg", "ight",
    "ima", "gonna", "wanna", "gotta", "kinda", "sorta", "bruh", "bet", "yea", "nah",
    "idc", "lowkey", "deadass", "frfr", "ayo", "ayo?"
]);

function isKeyboardSmash(text: string) {
    const squashed = text.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (squashed.length < 4) return false;
    if (/(.)\1{3,}/.test(squashed)) return true;

    return KEYBOARD_ROWS.some(row => {
        let run = 1;
        for (let i = 1; i < squashed.length; i++) {
            const previous = row.indexOf(squashed[i - 1]);
            const current = row.indexOf(squashed[i]);
            const adjacent = previous !== -1 && current !== -1 && Math.abs(current - previous) === 1;
            run = adjacent ? run + 1 : 1;
            if (run >= 5) return true;
        }
        return false;
    });
}

function letterRatio(text: string, pattern: RegExp) {
    const letters = text.replace(/[^a-z]/gi, "");
    if (letters.length < 4) return 0;
    return (letters.match(pattern)?.length ?? 0) / letters.length;
}

export function huskiness(content: string) {
    const text = content.trim();
    if (text.length < 2) return 0;

    let score = 0;
    if (isKeyboardSmash(text)) score += 3;
    if (letterRatio(text, /[A-Z]/g) > 0.8 && text.length > 4) score += 1;

    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length && words.every(word => LOW_EFFORT.has(word.replace(/[.,!?]/g, "")))) score += 3;
    if (words.length > 1 && new Set(words).size === 1) score += 2;
    if (words.length <= 2 && text.length < 15 && !/[.!?]/.test(text)) score += 1;

    const letters = text.toLowerCase().replace(/[^a-z]/g, "");
    if (letters.length >= 4 && letterRatio(text, /[aeiouy]/g) < 0.2) score += 2;

    return score;
}

function reactionPath(emoji: string) {
    if (!emoji) return "";
    return `/channels/{channel}/messages/{message}/reactions/${emoji.includes(":") ? emoji : encodeURIComponent(emoji)}/@me`;
}

export default definePlugin({
    id: "Huskbot",
    name: "Huskbot",
    description: "Reacts to low effort messages. This selfbot trick can get you banned.",
    tags: ["Utility", "Fun"],
    authors: [TestcordDevs.x2b],
    settings,

    flux: {
        MESSAGE_CREATE({ message }) {
            if (message?.bot || !message?.content || !message?.author) return;
            if (message.author.id === UserStore.getCurrentUser()?.id) return;

            const { emoji, threshold, maxChars, channelIDs, userIDs } = settings.store;
            if (!emoji) return;
            if (message.content.length > maxChars) return;

            if (channelIDs && !channelIDs.split(",").some(id => id.trim() === message.channel_id)) return;
            if (userIDs && userIDs.split(",").some(id => id.trim() === message.author.id)) return;
            if (huskiness(message.content) < threshold) return;

            const path = reactionPath(emoji)
                .replace("{channel}", message.channel_id)
                .replace("{message}", message.id);
            if (!path) return;

            RestAPI.put({
                url: path
            }).catch(() => showToast("Could not add the husk reaction", Toasts.Type.FAILURE));
        }
    }
});
