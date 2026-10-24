/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { MessageActions } from "@webpack/common";

const logger = new Logger("Yaoi");
const CORS_PROXY = "https://cors.keiran0.workers.dev?url=";

interface BooruPost {
    file_url?: string;
    large_file_url?: string;
    sample_url?: string;
    directory?: string | number;
    image?: string;
}

interface ApiSource {
    name: string;
    endpoint: string;
    parse: (data: unknown) => string | null;
}

function booru(name: string, url: string): ApiSource {
    return {
        name,
        endpoint: CORS_PROXY + encodeURIComponent(url),
        parse: data => {
            if (!Array.isArray(data) || data.length === 0) return null;
            const post = data[Math.floor(Math.random() * data.length)] as BooruPost;
            return post?.file_url ?? post?.large_file_url ?? post?.sample_url ?? null;
        }
    };
}

const API_LIST: ApiSource[] = [
    {
        name: "PurrBot",
        endpoint: CORS_PROXY + encodeURIComponent("https://api.purrbot.site/v2/img/nsfw/yaoi/gif"),
        parse: data => {
            const link = (data as { error?: boolean; link?: string })?.link;
            return typeof link === "string" ? link : null;
        }
    },
    booru("yande.re", "https://yande.re/post.json?tags=yaoi+rating%3Ageneral&limit=20"),
    booru("Safebooru", "https://safebooru.org/index.php?page=dapi&s=post&q=index&json=1&limit=20&tags=yaoi+solo"),
    booru("XBooru", "https://xbooru.com/index.php?page=dapi&s=post&q=index&tags=yaoi+solo&limit=20&json=1"),
    {
        name: "TBIB",
        endpoint: CORS_PROXY + encodeURIComponent("https://tbib.org/index.php?page=dapi&s=post&q=index&tags=yaoi+solo&limit=20&json=1"),
        parse: data => {
            if (!Array.isArray(data) || data.length === 0) return null;
            const post = data[Math.floor(Math.random() * data.length)] as BooruPost;
            return post?.directory && post?.image ? `https://tbib.org/images/${post.directory}/${post.image}` : null;
        }
    }
];

function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

async function fetchYaoi(): Promise<{ url: string; source: string; } | null> {
    for (const api of shuffle(API_LIST)) {
        try {
            const res = await fetch(api.endpoint, {
                headers: { Accept: "application/json" }
            });
            if (!res.ok) {
                logger.warn(`${api.name} returned HTTP ${res.status}`);
                continue;
            }
            const data = await res.json();
            const url = api.parse(data);
            if (url) return { url, source: api.name };
            logger.warn(`${api.name} returned no usable URL`);
        } catch (e) {
            logger.error(`${api.name} failed:`, e);
        }
    }
    return null;
}

export default definePlugin({
    id: "Yaoi",
    name: "Yaoi",
    description: "Sends a random yaoi picture via /yaoi. Uses 5 APIs with random order and automatic fallback. (NSFW)",
    authors: [TestcordDevs.x2b],
    tags: ["Commands"],
    commands: [
        {
            name: "yaoi",
            description: "Send a random yaoi picture in chat",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "mode",
                    description: "send (posts in chat) or preview (only you see it). Defaults to send.",
                    type: ApplicationCommandOptionType.STRING,
                    required: false,
                    choices: [
                        { name: "send", value: "send", label: "send" },
                        { name: "preview", value: "preview", label: "preview" }
                    ]
                }
            ],
            execute: async (args, ctx) => {
                const mode = (findOption(args, "mode", "send") as string).toLowerCase();

                const result = await fetchYaoi();
                if (!result) {
                    sendBotMessage(ctx.channel.id, {
                        content: "❌ Couldn't fetch a yaoi picture — all APIs failed. Try again in a moment."
                    });
                    return;
                }

                if (mode === "preview") {
                    sendBotMessage(ctx.channel.id, {
                        content: `${result.url}\n-# Source: ${result.source}`
                    });
                    return;
                }

                try {
                    await MessageActions.sendMessage(ctx.channel.id, {
                        content: result.url,
                        invalidEmojis: [],
                        validNonShortcutEmojis: []
                    }, undefined, {
                        nonce: (Date.now() * 4194304).toString()
                    });
                } catch (e) {
                    logger.error("Failed to send message:", e);
                    sendBotMessage(ctx.channel.id, {
                        content: `⚠️ Couldn't post to chat, here's the link (from ${result.source}):\n${result.url}`
                    });
                }
            }
        }
    ]
});
