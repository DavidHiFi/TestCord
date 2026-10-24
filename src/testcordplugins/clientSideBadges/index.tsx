/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addProfileBadge, BadgePosition, type ProfileBadge,removeProfileBadge } from "@api/Badges";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { SearchableSelect, UserStore } from "@webpack/common";

const BADGES = [
    ["discordStaff", "Discord Staff", "5e74e9b61934fc1f67c65515d1f7e60d.png", "https://discord.com/company"],
    ["partneredServerOwner", "Partnered Server Owner", "3f9748e53446a137a052f3454e2de41e.png", "https://discord.com/partners"],
    ["earlySupporter", "Early Supporter", "7060786766c9c840eb3019e725d2b358.png", "https://discord.com/settings/premium"],
    ["activeDeveloper", "Active Developer", "6bdc42827a38498929a4920da12695d9.png", "https://support-dev.discord.com/hc/en-us/articles/10113997751447"],
    ["earlyVerifiedBotDeveloper", "Early Verified Bot Developer", "6df5892e0f35b051f8b61eace34f4967.png", "https://discord.com/settings/premium"],
    ["moderatorProgramsAlumni", "Moderator Programs Alumni", "fee1624003e2fee35cb398e125dc479b.png", "https://discord.com/settings/premium"],
    ["bugHunter", "Bug Hunter", "2717692c7dca7289b35297368a940dd0.png", "https://discord.com/settings/premium"],
    ["goldenBugHunter", "Golden Bug Hunter", "848f79194d4be5ff5f81505cbd0ce1e6.png", "https://discord.com/settings/premium"],
    ["hypesquadEvents", "HypeSquad Events", "bf01d1073931f921909045f3a39fd264.png", "https://support.discord.com/hc/en-us/articles/360035962891-Profile-Badges-101"],
    ["houseOfBravery", "HypeSquad Bravery", "8a88d63823d8a71cd5e390baa45efa02.png", "https://discord.com/settings/hypesquad-online"],
    ["houseOfBrilliance", "HypeSquad Brilliance", "011940fd013da3f7fb926e4a1cd2e618.png", "https://discord.com/settings/hypesquad-online"],
    ["houseOfBalance", "HypeSquad Balance", "3aa41de486fa12454c3761e8e223442e.png", "https://discord.com/settings/hypesquad-online"],
    ["discordQuests", "Discord Quests", "7d9ae358c8c5e118768335dbe68b4fb8.png", "https://discord.com/discovery/quests"],
    ["nitro", "Discord Nitro", "2ba85e8026a8614b640c2837bcdfe21b.png", "https://discord.com/settings/premium"],
    ["serverBooster", "Server Booster", "ec92202290b48d0879b7413d2dde3bab.png", "https://discord.com/settings/premium"],
    ["supportsCommands", "Supports Commands", "6f9e37f9029ff57aef81db857890005e.png", "https://discord.com/blog/welcome-to-the-new-era-of-discord-apps"],
    ["premiumApp", "Premium App", "d2010c413a8da2208b7e4f35bd8cd4ac.png", ""],
    ["usesAutomod", "Uses AutoMod", "f2459b691ac7453ed6039bbcfaccbfcd.png", ""],
    ["legacyUsername", "Legacy Username", "6de6d34650760ba5551a79732e98ed60.png", ""],
    ["aClownForATime", "A clown, for a limited time", "971cfe4aa5c0582000ea.svg", "https://youtu.be/cc2-4ci4G84"]
] as const;

type BadgeId = (typeof BADGES)[number][0];

const BADGE_IDS = BADGES.map(([id]) => id) as BadgeId[];

function BadgePicker() {
    const flags = settings.use(BADGE_IDS);
    const selected = BADGE_IDS.filter((_, index) => flags[index]);

    return (
        <SearchableSelect
            multi
            clearable
            closeOnSelect={false}
            placeholder="Pick the badges to show"
            options={BADGES.map(([id, label]) => ({ value: id as string, label: label as string }))}
            value={selected}
            onChange={next => {
                for (const [index, id] of BADGE_IDS.entries()) {
                    settings.store[id] = next.includes(id);
                }
            }}
        />
    );
}

/**
 * One hidden boolean per badge, kept at its original key so existing configurations survive.
 * The picker below is the only UI for them.
 */
const settings = definePluginSettings({
    discordStaff: { type: OptionType.BOOLEAN, default: false, hidden: true, description: "" },
    partneredServerOwner: { type: OptionType.BOOLEAN, default: false, hidden: true, description: "" },
    earlySupporter: { type: OptionType.BOOLEAN, default: false, hidden: true, description: "" },
    activeDeveloper: { type: OptionType.BOOLEAN, default: false, hidden: true, description: "" },
    earlyVerifiedBotDeveloper: { type: OptionType.BOOLEAN, default: false, hidden: true, description: "" },
    moderatorProgramsAlumni: { type: OptionType.BOOLEAN, default: false, hidden: true, description: "" },
    bugHunter: { type: OptionType.BOOLEAN, default: false, hidden: true, description: "" },
    goldenBugHunter: { type: OptionType.BOOLEAN, default: false, hidden: true, description: "" },
    hypesquadEvents: { type: OptionType.BOOLEAN, default: false, hidden: true, description: "" },
    houseOfBravery: { type: OptionType.BOOLEAN, default: false, hidden: true, description: "" },
    houseOfBrilliance: { type: OptionType.BOOLEAN, default: false, hidden: true, description: "" },
    houseOfBalance: { type: OptionType.BOOLEAN, default: false, hidden: true, description: "" },
    discordQuests: { type: OptionType.BOOLEAN, default: false, hidden: true, description: "" },
    nitro: { type: OptionType.BOOLEAN, default: false, hidden: true, description: "" },
    serverBooster: { type: OptionType.BOOLEAN, default: false, hidden: true, description: "" },
    supportsCommands: { type: OptionType.BOOLEAN, default: false, hidden: true, description: "" },
    premiumApp: { type: OptionType.BOOLEAN, default: false, hidden: true, description: "" },
    usesAutomod: { type: OptionType.BOOLEAN, default: false, hidden: true, description: "" },
    legacyUsername: { type: OptionType.BOOLEAN, default: false, hidden: true, description: "" },
    aClownForATime: { type: OptionType.BOOLEAN, default: false, hidden: true, description: "" },

    position: {
        description: "Where to place them relative to your real badges",
        type: OptionType.SELECT,
        options: [
            { label: "After", value: "end", default: true },
            { label: "Before", value: "start" }
        ]
    },
    picker: {
        type: OptionType.COMPONENT,
        description: "Badges to show on your own profile. Nobody else can see these.",
        component: BadgePicker
    }
});

const registered: ProfileBadge[] = [];

export default definePlugin({
    id: "ClientSideBadges",
    name: "ClientSideBadges",
    description: "Show extra badges on your own profile. Other users never see them.",
    tags: ["Customisation", "Appearance"],
    authors: [TestcordDevs.x2b],
    settings,

    start() {
        const position = settings.plain.position === "start" ? BadgePosition.START : BadgePosition.END;

        for (const [id, description, icon, link] of BADGES) {
            const badge: ProfileBadge = {
                id,
                description,
                iconSrc: `https://cdn.discordapp.com/badge-icons/${icon}`,
                position,
                link: link || undefined,
                // read live so toggling a badge applies without reloading the client
                shouldShow: ({ userId }) => userId === UserStore.getCurrentUser()?.id && settings.plain[id]
            };

            addProfileBadge(badge);
            registered.push(badge);
        }
    },

    stop() {
        for (const badge of registered) removeProfileBadge(badge);
        registered.length = 0;
    }
});
