/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { sendBotMessage } from "@api/Commands";
import { ChannelToolbarButton } from "@api/HeaderBar";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { Forms, React, useEffect, useState } from "@webpack/common";

import { openDashboard } from "./dashboard";
import { handleMessage, log, logger, type OwoEmbed, type OwoMessage, refreshScheduler, setDashboardOpener, snapshot, startEngine, stopEngine } from "./engine";
import { settings } from "./settings";

function OwoIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor" aria-hidden="true" {...props}>
            <path d="M12 2a7 7 0 0 0-7 7c0 2.38 1.19 4.47 3 5.74V17a3 3 0 0 0 3 3h2a3 3 0 0 0 3-3v-2.26c1.81-1.27 3-3.36 3-5.74a7 7 0 0 0-7-7Zm-3.5 7a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0Zm7 0a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0ZM11 14h2a1 1 0 0 1 0 2h-2a1 1 0 0 1 0-2Z" />
            <path d="M9 21a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2H9Z" />
        </svg>
    );
}

function OwoToolbarButton() {
    const [paused, setPaused] = useState(() => snapshot().paused);
    useEffect(() => {
        const id = setInterval(() => setPaused(snapshot().paused), 2000);
        return () => clearInterval(id);
    }, []);
    return (
        <ChannelToolbarButton
            icon={OwoIcon}
            tooltip={paused ? "OwoSelf Dashboard (paused)" : "OwoSelf Dashboard"}
            selected={paused}
            onClick={() => openDashboard()}
        />
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function toOwoMessage(raw: unknown): OwoMessage | null {
    if (!isRecord(raw)) return null;
    const { author } = raw;
    if (!isRecord(author) || typeof author.id !== "string") return null;
    if (typeof raw.channel_id !== "string" || typeof raw.id !== "string") return null;

    const embeds: OwoEmbed[] = [];
    if (Array.isArray(raw.embeds)) {
        for (const e of raw.embeds) {
            if (!isRecord(e)) continue;
            const fields: { name: string; value: string; }[] = [];
            if (Array.isArray(e.fields)) {
                for (const f of e.fields) {
                    if (isRecord(f) && typeof f.name === "string" && typeof f.value === "string") {
                        fields.push({ name: f.name, value: f.value });
                    }
                }
            }
            embeds.push({
                title: typeof e.title === "string" ? e.title : undefined,
                description: typeof e.description === "string" ? e.description : undefined,
                footer: isRecord(e.footer) && typeof e.footer.text === "string" ? { text: e.footer.text } : undefined,
                author: isRecord(e.author) && typeof e.author.name === "string" ? { name: e.author.name } : undefined,
                fields
            });
        }
    }

    const mentions: { id: string; }[] = [];
    if (Array.isArray(raw.mentions)) {
        for (const m of raw.mentions) {
            if (isRecord(m) && typeof m.id === "string") mentions.push({ id: m.id });
        }
    }

    const attachments: { url: string; }[] = [];
    if (Array.isArray(raw.attachments)) {
        for (const a of raw.attachments) {
            if (isRecord(a) && typeof a.url === "string") attachments.push({ url: a.url });
        }
    }

    const buttonUrls: string[] = [];
    const walkComponents = (node: unknown, depth: number): void => {
        if (buttonUrls.length >= 10 || depth > 4) return;
        if (Array.isArray(node)) {
            for (const child of node) walkComponents(child, depth + 1);
            return;
        }
        if (!isRecord(node)) return;
        if (typeof node.url === "string" && node.url.startsWith("https://")) buttonUrls.push(node.url);
        if (node.components !== undefined) walkComponents(node.components, depth + 1);
    };
    if (raw.components !== undefined) walkComponents(raw.components, 0);

    return {
        id: raw.id,
        channel_id: raw.channel_id,
        guild_id: typeof raw.guild_id === "string" ? raw.guild_id : undefined,
        content: typeof raw.content === "string" ? raw.content : "",
        author: {
            id: author.id,
            username: typeof author.username === "string" ? author.username : undefined,
            bot: typeof author.bot === "boolean" ? author.bot : undefined
        },
        mentions,
        embeds,
        attachments,
        buttonUrls
    };
}

function OwoAbout() {
    return (
        <Forms.FormText>
            OwO automation ported from NeuraSelf. Open the dashboard from the channel header button, the Testcord toolbox, or the owoself chat command. Type owoself start, stop, status or dashboard in chat. Extra tokens live under Dashboard, Accounts.
        </Forms.FormText>
    );
}

export default definePlugin({
    id: "OwoSelf",
    name: "OwoSelf",
    description: "owo selfbot inspired by neuraself, due to limitations on the dc client its better to use NeuraSelf but this one is just as good if u only needa auto hunt and battle while doing sum other shi",
    authors: [TestcordDevs.x2b],
    dependencies: ["HeaderBarAPI"],

    settings,
    settingsAboutComponent: OwoAbout,

    headerBarButton: {
        location: "channeltoolbar",
        icon: OwoIcon,
        render: OwoToolbarButton,
        priority: 250
    },

    toolboxActions: {
        "Open OwoSelf Dashboard"() {
            openDashboard();
        }
    },

    commands: [
        {
            name: "owoself",
            description: "Open the OwoSelf dashboard or show status",
            options: [
                {
                    name: "action",
                    description: "What to do",
                    type: 3,
                    required: false,
                    choices: [
                        { name: "dashboard", label: "dashboard", value: "dashboard" },
                        { name: "status", label: "status", value: "status" }
                    ]
                }
            ],
            execute(args, ctx) {
                let action = "dashboard";
                for (const a of args) {
                    if (isRecord(a) && a.name === "action" && typeof a.value === "string") action = a.value;
                }
                if (action === "status") {
                    const snap = snapshot();
                    const state = !snap.running ? "off" : snap.paused ? "paused" : snap.onBreak ? "on a human break" : "running";
                    sendBotMessage(ctx.channel.id, {
                        content: `OwoSelf is ${state}. Hunts ${snap.hunts}, battles ${snap.battles}, cowoncy ${snap.cash > 0 ? snap.cash.toLocaleString() : "unknown"}.`
                    });
                } else {
                    openDashboard();
                }
            }
        }
    ],

    flux: {
        MESSAGE_CREATE({ message, optimistic }: { message: unknown; optimistic?: boolean; }) {
            if (optimistic) return;
            const parsed = toOwoMessage(message);
            if (parsed) handleMessage(parsed);
        },
        MESSAGE_UPDATE({ message }: { message: unknown; }) {
            const parsed = toOwoMessage(message);
            if (parsed) handleMessage(parsed);
        }
    },

    start() {
        log("SYS", "OwoSelf plugin enabled.");
        setDashboardOpener(openDashboard);
        startEngine()
            .then(() => refreshScheduler())
            .catch(e => logger.error("Failed to start engine", e));
    },

    stop() {
        setDashboardOpener(null);
        stopEngine();
    }
});
