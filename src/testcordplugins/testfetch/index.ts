/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { isPluginEnabled } from "@api/PluginManager";
import { gitHashShort } from "@shared/vencordUserAgent";
import { CONTRIB_ROLE_IDS, DONOR_ROLE_IDS, EQUICORD_GUILD_ID, TESTCORD_GUILD_ID, TestcordDevs, VC_GUILD_ID } from "@utils/constants";
import { sendMessage } from "@utils/discord";
import { isAnyPluginDev, tryOrElse } from "@utils/misc";
import { makeCodeblock } from "@utils/text";
import definePlugin, { PluginNative } from "@utils/types";
import { GuildMemberStore, LocaleStore, ThemeStore, UserStore } from "@webpack/common";

import gitBranch from "~git-branch";
import { PluginMeta } from "~plugins";

import { getUserSettingLazy } from "../../api/UserSettings";

const Native = VencordNative.pluginHelpers.testfetch as PluginNative<typeof import("./native")>;

const ROLE_GUILDS = [TESTCORD_GUILD_ID, EQUICORD_GUILD_ID, VC_GUILD_ID];
const STALE_AFTER = 12096e5;

const BOLD_ORANGE = "\x1b[1;33;38;5;208m";
const DIM_ORANGE = "\x1b[33;38;5;208m";
const RESET = "\x1b[0m";
const ANSI = /\x1b\[[0-9;]*m/g;

const LOGO_COLORS: Record<string, string> = {
    ".": "\x1b[33;38;5;208m",
    "#": "\x1b[30;38;5;16m",
    "@": "\x1b[31;38;5;88m"
};

const LOGO_ART = [
    "          ..........",
    "      ..................",
    "    ......................",
    "  ..........................",
    " ....############............",
    " ....############............",
    "........######................",
    "........######..@@@@@@@@@@@...",
    "........######@@@@@@..........",
    " .......######@@@@...........",
    " .......######@@@@...........",
    "  ......######@@@@@@........",
    "    ....######..@@@@@@@@..",
    "      ..................",
    "          .........."
];

const LOGO = LOGO_ART.map(row => {
    let line = "";
    let color = "";
    for (const cell of row) {
        const next = LOGO_COLORS[cell] ?? "";
        if (next !== color) {
            line += next;
            color = next;
        }
        line += next ? "█" : " ";
    }
    return line + RESET;
});

const COLOR_BAR = [40, 41, 42, 43, 44, 45, 46, 47].map(c => `\x1b[2;${c}m███`).join("") + RESET;

const ShowCurrentGame = getUserSettingLazy<boolean>("status", "showCurrentGame");

function capitalize(text: string) {
    return text?.length ? text[0].toUpperCase() + text.slice(1) : (text ?? "");
}

function bytes(value: number) {
    const units = ["B", "KiB", "MiB", "GiB", "TiB"];
    let n = value;
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
        n /= 1024;
        i++;
    }
    return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function clientVersion() {
    if (IS_DISCORD_DESKTOP) return `Desktop v${tryOrElse(() => DiscordNative.app.getVersion(), "unknown")}`;
    if (IS_VESKTOP) return `Vesktop v${tryOrElse(() => VesktopNative.app.getVersion(), "unknown")}`;
    if (IS_EQUIBOP) return `Equibop v${tryOrElse(() => VesktopNative.app.getVersion(), "unknown")}`;
    return IS_USERSCRIPT ? "UserScript" : "Web";
}

function operatingSystem() {
    const os = navigator.userAgent.match(/(?:Windows|Mac OS X|Linux|Android|iPhone OS)[^;)]*/)?.[0];
    const arch = (navigator as Navigator & { userAgentData?: { platform?: string; }; }).userAgentData?.platform;
    return [os ?? navigator.platform, arch].filter(Boolean).join(" / ");
}

function hasAnyRole(roleIds: readonly string[]) {
    const me = UserStore.getCurrentUser();
    if (!me) return false;
    return ROLE_GUILDS.some(guildId => GuildMemberStore.getMember(guildId, me.id)?.roles?.some(role => roleIds.includes(role)));
}

function guildRoles() {
    const me = UserStore.getCurrentUser();
    const isContrib = !!me && (
        isAnyPluginDev(me.id) ||
        hasAnyRole(CONTRIB_ROLE_IDS) ||
        (Boolean(me.username) && (
            Object.values(TestcordDevs).some(d => (d.id && d.id.toString() === me.id) || d.name?.toLowerCase() === me.username.toLowerCase() || ("github" in d && typeof d.github === "string" && d.github.toLowerCase() === me.username.toLowerCase())) ||
            Object.keys(TestcordDevs).some(k => k.toLowerCase() === me.username.toLowerCase())
        ))
    );

    return {
        donor: hasAnyRole(DONOR_ROLE_IDS),
        contributor: isContrib
    };
}

function pluginCounts() {
    const counts = { official: [0, 0], user: [0, 0] } satisfies Record<string, number[]>;

    for (const plugin of Object.values(Vencord.Plugins.plugins)) {
        if (plugin.name?.endsWith("API") || plugin.required) continue;
        const bucket = PluginMeta[plugin.name]?.userPlugin ? counts.user : counts.official;
        bucket[1]++;
        if (plugin.started) bucket[0]++;
    }

    const official = `${counts.official[0]} / ${counts.official[1]}`;
    return counts.user[1] ? `${official} official, ${counts.user[0]} / ${counts.user[1]} user` : `${official} official`;
}

function knownIssues() {
    return [
        isPluginEnabled("NoRPC") && "NoRPC",
        tryOrElse(() => !ShowCurrentGame?.getSetting(), false) && "activities disabled",
        BUILD_TIMESTAMP < Date.now() - STALE_AFTER && "outdated"
    ].filter(Boolean).join(", ");
}

async function collect() {
    const me = UserStore.getCurrentUser();
    const sys = await tryOrElse(() => Native?.getSystemInfo?.(), null);
    const { donor, contributor } = guildRoles();

    const env = window.GLOBAL_ENV ?? {};

    return {
        user: me?.username ?? "unknown",
        version: `${VERSION} ~ ${gitHashShort} - ${Intl.DateTimeFormat(navigator.language, { dateStyle: "medium" }).format(BUILD_TIMESTAMP)}${IS_STANDALONE ? "" : ` ~ ${gitBranch}`}`,
        client: `${capitalize(env.RELEASE_CHANNEL ?? "unknown")} ~ ${clientVersion()}`,
        build: `${env.BUILD_NUMBER ?? "unknown"} ~ ${env.VERSION_HASH?.slice(0, 7) ?? "unknown"}`,
        issues: knownIssues(),
        os: operatingSystem(),
        cpu: sys ? `${sys.cores} cores (${sys.arch})` : "",
        memory: sys ? `${bytes(sys.heapUsed)} / ${bytes(sys.heapTotal)} heap, ${bytes(sys.systemTotal)} ram` : "",
        screen: `${window.innerWidth}x${window.innerHeight} @ ${window.devicePixelRatio}x`,
        theme: capitalize(ThemeStore.theme),
        locale: LocaleStore.locale,
        plugins: pluginCounts(),
        uptime: `${Math.max(0, ~~((Date.now() - (env.HTML_TIMESTAMP ?? Date.now())) / 1000))}s`,
        donor: donor ? "yes" : "no",
        contributor: contributor ? "yes" : "no"
    };
}

type Report = Awaited<ReturnType<typeof collect>>;

function render(data: Report) {
    const rows = ([
        ["", `${BOLD_ORANGE}${data.user}${RESET}@${DIM_ORANGE}testcord${RESET}`],
        ["version", data.version],
        ["client", data.client],
        ["build", data.build],
        ["issues", data.issues],
        ["os", data.os],
        ["cpu", data.cpu],
        ["memory", data.memory],
        ["screen", data.screen],
        ["theme", data.theme],
        ["locale", data.locale],
        ["plugins", data.plugins],
        ["uptime", data.uptime],
        ["donor", data.donor],
        ["contributor", data.contributor]
    ] as [string, string][]).filter(([, value]) => value.length);

    const indent = Math.max(...LOGO.map(line => line.replace(ANSI, "").length)) + 3;
    const height = Math.max(LOGO.length, rows.length);
    const lines: string[] = [];

    for (let i = 0; i < height; i++) {
        const art = i < LOGO.length
            ? `${LOGO[i]}${" ".repeat(indent - LOGO[i].replace(ANSI, "").length)}`
            : " ".repeat(indent);

        const row = rows[i];
        const text = !row ? "" : row[0] ? `${DIM_ORANGE}${capitalize(row[0])}: ${RESET}${row[1]}` : row[1];

        lines.push(`${art}${text}`);
    }

    return makeCodeblock([...lines, " ".repeat(indent) + COLOR_BAR].join("\n"), "ansi");
}

async function buildReport(asJson: boolean) {
    const data = await collect();
    return asJson ? makeCodeblock(JSON.stringify(data, null, 2), "json") : render(data);
}

export default definePlugin({
    name: "testfetch",
    description: "System info card for Testcord, for bug reports",
    tags: ["Utility", "Developers", "Fun"],
    authors: [TestcordDevs.x2b, TestcordDevs.sirphantom89],
    commands: [
        {
            name: "testfetch",
            description: "Show your Testcord system info",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "send",
                    description: "Post the card in chat instead of only showing it to you",
                    type: ApplicationCommandOptionType.BOOLEAN,
                    required: false
                },
                {
                    name: "json",
                    description: "Output raw JSON instead of the card",
                    type: ApplicationCommandOptionType.BOOLEAN,
                    required: false
                }
            ],
            async execute(args, ctx) {
                const content = await buildReport(findOption(args, "json", false));
                if (findOption(args, "send", false)) await sendMessage(ctx.channel.id, { content });
                else await sendBotMessage(ctx.channel.id, { content });
            }
        }
    ]
});
