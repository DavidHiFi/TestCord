/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findOption, RequiredMessageOption } from "@api/Commands";
import { HeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { IconProps, OptionType } from "@utils/types";

const settings = definePluginSettings({
    nyaaMode: {
        type: OptionType.BOOLEAN,
        description: "Nyaa mode. The topbar button toggles this.",
        default: true
    },
    edits: {
        type: OptionType.BOOLEAN,
        description: "Also nyaaify edited messages.",
        default: true
    },
    faces: {
        type: OptionType.BOOLEAN,
        description: "Sprinkle cute faces like (>~<) through your messages.",
        default: true
    },
    tildes: {
        type: OptionType.BOOLEAN,
        description: "End messages with a cute wave like nyes~.",
        default: true
    },
    stutter: {
        type: OptionType.BOOLEAN,
        description: "Sometimes stutter the first word for extra nerves.",
        default: false
    }
});

const TOGGLE_KEYS: Array<"nyaaMode"> = ["nyaaMode"];

const WORDS: Record<string, string> = {
    hello: "hewwo",
    hi: "hii",
    hey: "heyy",
    yes: "nyes",
    yeah: "nyeah",
    yep: "nyep",
    yup: "nyup",
    no: "nyoo",
    nope: "nyope",
    nah: "nyah",
    you: "nyu",
    your: "nyur",
    yours: "nyurs",
    "you're": "nyure",
    youre: "nyure",
    love: "wuv",
    loves: "wuvs",
    loved: "wuvved",
    like: "wike",
    likes: "wikes",
    liked: "wiked",
    cute: "kawaii",
    cat: "neko",
    cats: "nekos",
    dog: "doggo",
    dogs: "doggos",
    friend: "fwiend",
    friends: "fwiends",
    small: "smol",
    watch: "nyatch",
    watching: "nyatchin",
    watched: "nyatched",
    watches: "nyatches",
    eat: "nom",
    food: "nummies",
    play: "pway",
    playing: "pwayin",
    please: "pwease",
    sorry: "sowwy",
    thanks: "thankies",
    thank: "fank",
    what: "wat",
    this: "dis",
    that: "dat",
    the: "da",
    they: "dey",
    them: "dem",
    their: "deir",
    with: "wif",
    without: "wifout",
    for: "fur",
    have: "hab",
    my: "mya",
    me: "mew",
    good: "gud",
    morning: "mornin",
    night: "nyight",
    stop: "stawp",
    stupid: "baka",
    idiot: "baka",
    really: "weally",
    little: "wittle",
    ok: "oki",
    okay: "oki",
    bye: "baii",
    lol: "hehe"
};

const FACES = [
    "(>~<)",
    "(>ω<)",
    "(≧◡≦)",
    "(˶ᵔᵕᵔ˶)",
    "૮₍ ˶•⤙•˶ ₎ა",
    "(=^･ω･^=)",
    "(,,ฅωฅ,,)",
    "( •̀ ω •́ )",
    "(⁄ ⁄>⁄ ▽ ⁄<⁄ ⁄)",
    "(,,>﹏<,,)",
    "UwU",
    "OwO",
    "nya~",
    "(ᵔᴥᵔ)"
];

const HONORIFICS = ["chan", "kun", "sama", "senpai", "san", "tan", "chin"];

const CUTE_NAMES = ["Yuki", "Mochi", "Hana", "Sakura", "Kiki", "Mimi", "Momo", "Chibi", "Suki", "Rin", "Yuna", "Koko", "Pocky", "Neko", "Aiko", "Hoshi"];

const NAME_COMMAND = /^!name\b/i;
const NAME_SHORTHAND = /^!(\S+)$/;

const PROTECT = /(```[\s\S]*?```|`[^`\n]*`|https?:\/\/\S+|<[@#][^<>\s]*>|<a?:\w+:\d+>|<t:\d+[^<>]*>|:\w+:)/g;
const PROTECTED = /^(?:```[\s\S]*```|`[^`]*`|https?:\/\/\S+|<[@#][^<>\s]*>|<a?:\w+:\d+>|<t:\d+[^<>]*>|:\w+:)$/;
const WORD = /^[A-Za-z]+(?:'[A-Za-z]+)?$/;
const WORD_SPLIT = /(![A-Za-z0-9_]+~?|\b[A-Za-z]+(?:'[A-Za-z]+)?\b)/g;

function preserveCase(original: string, replacement: string): string {
    if (original.length > 1 && original === original.toUpperCase()) return replacement.toUpperCase();
    const first = original[0];
    if (first && first !== first.toLowerCase() && first === first.toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1);
    return replacement;
}

function phonetic(word: string): string {
    return word
        .replace(/th/g, "d")
        .replace(/[rl]/g, "w")
        .replace(/ove/g, "uv")
        .replace(/n([aeiou])/g, "ny$1")
        .replace(/ing$/, "in");
}

function nyaaifyWord(token: string): string {
    if (!WORD.test(token)) return token;
    const lower = token.toLowerCase();
    const mapped = WORDS[lower];
    if (mapped) return preserveCase(token, mapped);
    return preserveCase(token, phonetic(lower));
}

function nyaaifyCore(text: string, stutter: boolean): string {
    let stutterRolled = !stutter;
    return text.split(PROTECT).map(part => {
        if (part === "" || PROTECTED.test(part)) return part;
        return part.split(WORD_SPLIT).map((token, idx, arr) => {
            if (token.startsWith("!")) {
                let prev = "";
                for (let j = idx - 1; j >= 0; j--) {
                    if (arr[j] !== "") {
                        prev = arr[j];
                        break;
                    }
                }
                if (!/(^|\s)$/.test(prev)) return token;
                stutterRolled = true;
                const base = token.slice(1).replace(/~$/, "");
                return `${base}-${HONORIFICS[Math.floor(Math.random() * HONORIFICS.length)]}~`;
            }
            if (!WORD.test(token)) return token;
            const out = nyaaifyWord(token);
            if (!stutterRolled) {
                stutterRolled = true;
                if (out.length >= 4 && /^[A-Za-z]/.test(out) && Math.random() < 0.15) return `${out[0]}-${out}`;
            }
            return out;
        }).join("");
    }).join("");
}

function pickFace(): string {
    return FACES[Math.floor(Math.random() * FACES.length)];
}

function makeName(content: string): string | null {
    let base: string | undefined;
    const command = content.match(NAME_COMMAND);
    if (command) {
        base = content.slice(command[0].length).trim().split(/\s+/)[0];
    } else {
        const shorthand = content.match(NAME_SHORTHAND);
        if (!shorthand) return null;
        base = shorthand[1];
    }
    const name = base || CUTE_NAMES[Math.floor(Math.random() * CUTE_NAMES.length)];
    const honorific = HONORIFICS[Math.floor(Math.random() * HONORIFICS.length)];
    const face = settings.store.faces ? ` ${pickFace()}` : "";
    return `${name}-${honorific}~${face}`;
}

function finishNyaa(text: string, faces: boolean, tildes: boolean): string {
    let out = text;
    if (tildes && /[^\s~]$/.test(out)) {
        const punct = out.match(/([!?.…]+)$/);
        if (punct && punct.index !== undefined) out = `${out.slice(0, punct.index)}~${punct[1]}`;
        else out += "~";
    }
    if (faces) {
        const endFace = pickFace();
        const sentence = out.match(/[!?.…]["')\]]? +/);
        if (sentence && sentence.index !== undefined && Math.random() < 0.4) {
            const at = sentence.index + sentence[0].trimEnd().length;
            out = `${out.slice(0, at)} ${pickFace()}${out.slice(at)}`;
        }
        if (out.length + endFace.length + 1 <= 2000) out += ` ${endFace}`;
    }
    return out;
}

export function nyaaify(input: string, opts: { faces: boolean; tildes: boolean; stutter: boolean; }): string {
    if (!input.trim()) return input;
    const core = nyaaifyCore(input, opts.stutter);
    const finished = finishNyaa(core, opts.faces, opts.tildes);
    if (finished.length > 2000) {
        const withoutFaces = finishNyaa(core, false, opts.tildes);
        if (withoutFaces.length <= 2000) return withoutFaces;
        return core.slice(0, 2000);
    }
    return finished;
}

function transformOutgoing(content: string): string {
    if (content.startsWith("\\") && content.length > 1) return content.slice(1);
    if (content.startsWith("/")) return content;
    return nyaaify(content, { faces: settings.store.faces, tildes: settings.store.tildes, stutter: settings.store.stutter });
}

function NyaaaIcon({ height = 20, width = 20, className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={width} height={height} className={className} aria-hidden="true">
            <g fill="currentColor">
                <ellipse cx="12" cy="15.5" rx="4" ry="3.2" />
                <circle cx="5.8" cy="10.5" r="1.8" />
                <circle cx="9.5" cy="7.6" r="1.8" />
                <circle cx="14.5" cy="7.6" r="1.8" />
                <circle cx="18.2" cy="10.5" r="1.8" />
            </g>
        </svg>
    );
}

const NyaaaToggleButton = ErrorBoundary.wrap(function NyaaaToggleButton() {
    const { nyaaMode } = settings.use(TOGGLE_KEYS);

    return (
        <HeaderBarButton
            icon={NyaaaIcon}
            tooltip={nyaaMode ? "Nyaaa mode: On" : "Nyaaa mode: Off"}
            aria-label="Toggle Nyaaa mode"
            selected={nyaaMode}
            onClick={() => {
                settings.store.nyaaMode = !nyaaMode;
            }}
        />
    );
}, { noop: true });

export default definePlugin({
    id: "Nyaaa",
    name: "Nyaaa",
    description: "Tuwrns nyur messages into kawaii uwu nya speak, wif faces wike (>~<) spwinkwed in. Send !atwas anywewe fur a Japanyese nyame wike atwas-chan~",
    authors: [TestcordDevs.x2b],
    tags: ["Fun", "Chat", "Commands"],
    settings,
    commands: [
        {
            name: "nyaaa",
            description: "Nyaaify some text into cute uwu nya speak.",
            options: [RequiredMessageOption],
            execute: opts => ({
                content: nyaaify(findOption(opts, "message", ""), { faces: settings.store.faces, tildes: settings.store.tildes, stutter: settings.store.stutter })
            })
        }
    ],

    headerBarButton: {
        icon: NyaaaIcon,
        render: () => <NyaaaToggleButton />,
        priority: 1337
    },

    onBeforeMessageSend(_, msg) {
        if (typeof msg.content !== "string" || !msg.content.trim()) return;
        const named = makeName(msg.content);
        if (named) {
            msg.content = named;
            return;
        }
        if (!settings.store.nyaaMode) return;
        msg.content = transformOutgoing(msg.content);
    },

    onBeforeMessageEdit(_cid, _mid, msg) {
        if (typeof msg.content !== "string" || !msg.content.trim()) return;
        const named = makeName(msg.content);
        if (named) {
            msg.content = named;
            return;
        }
        if (!settings.store.nyaaMode || !settings.store.edits) return;
        msg.content = transformOutgoing(msg.content);
    }
});
