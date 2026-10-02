/* eslint-disable simple-header/header -- This standalone user plugin is MIT licensed. */
/*
 * StaffTag User Plugin
 * Copyright (c) 2026 DavidHiFi
 * SPDX-License-Identifier: MIT
 */

import { definePluginSettings } from "@api/Settings";
import { managedStyleRootNode } from "@api/Styles";
import { TestcordDevs } from "@utils/constants";
import { createAndAppendStyle } from "@utils/css";
import definePlugin, { OptionType } from "@utils/types";
import { GuildMemberStore, GuildRoleStore, GuildStore, PermissionsBits, SelectedGuildStore, Tooltip, UserStore, useStateFromStores } from "@webpack/common";

type StaffKind = "owner" | "admin" | "management";

const settings = definePluginSettings({
    useCrown: { type: OptionType.BOOLEAN, description: "Show a crown instead of a text tag.", default: true },
    useRoleColor: { type: OptionType.BOOLEAN, description: "Color badges with the member's role color.", default: true },
    ignoreBots: { type: OptionType.BOOLEAN, description: "Hide badges for bots.", default: false },
    ignoreSelf: { type: OptionType.BOOLEAN, description: "Hide your own badge.", default: false },
    owners: { type: OptionType.BOOLEAN, description: "Mark server owners.", default: true },
    admins: { type: OptionType.BOOLEAN, description: "Mark members with Administrator permission.", default: true },
    management: { type: OptionType.BOOLEAN, description: "Mark members with moderation or management permissions.", default: true },
    voiceList: { type: OptionType.BOOLEAN, description: "Show badges beside users in voice channels.", default: true },
    memberList: { type: OptionType.BOOLEAN, description: "Show badges in the member list.", default: true },
    messages: { type: OptionType.BOOLEAN, description: "Show badges beside message authors.", default: true },
    profiles: { type: OptionType.BOOLEAN, description: "Show badges in user profiles.", default: true },
    ownerLabel: { type: OptionType.STRING, description: "Label for server owners.", default: "Owner" },
    adminLabel: { type: OptionType.STRING, description: "Label for administrators.", default: "Admin" },
    managementLabel: { type: OptionType.STRING, description: "Label for moderators and managers.", default: "Management" }
});

const reactiveSettings = ["useCrown", "useRoleColor", "ignoreBots", "ignoreSelf", "owners", "admins", "management", "voiceList", "memberList", "messages", "profiles", "ownerLabel", "adminLabel", "managementLabel"] as const;

// Plugin managedStyle expects the name of an imported "?managed" stylesheet, not CSS text,
// so the rules are added in start() to keep this plugin a single file.
const css = `
.vc-stafftag { display: inline-flex; align-items: center; flex: none; vertical-align: middle; margin-left: 4px; line-height: 1; }
.vc-stafftag svg { display: block; }
.vc-stafftag-label { display: inline-block; padding: 2px 4px; border-radius: 3px; border: 1px solid currentColor; font-size: 10px; font-weight: 700; }
.vc-stafftag-voice { margin-right: 3px; }
`;
let style: HTMLStyleElement | undefined;

function getStaffKind(guildId: string, userId: string): StaffKind | null {
    const guild = GuildStore.getGuild(guildId);
    const user = UserStore.getUser(userId);
    if (!guild || !user || settings.store.ignoreBots && user.bot || settings.store.ignoreSelf && userId === UserStore.getCurrentUser()?.id) return null;

    if (guild.ownerId === userId) return settings.store.owners ? "owner" : null;

    const member = GuildMemberStore.getMember(guildId, userId);
    if (!member) return null;

    const roles = GuildRoleStore.getRolesSnapshot(guildId);
    let permissions = roles[guildId]?.permissions ?? 0n;
    for (const roleId of member.roles) permissions |= roles[roleId]?.permissions ?? 0n;

    if (permissions & PermissionsBits.ADMINISTRATOR) return settings.store.admins ? "admin" : null;
    const managementBits = PermissionsBits.MANAGE_GUILD | PermissionsBits.MANAGE_CHANNELS |
        PermissionsBits.MANAGE_ROLES | PermissionsBits.KICK_MEMBERS | PermissionsBits.BAN_MEMBERS |
        PermissionsBits.MANAGE_MESSAGES | PermissionsBits.MANAGE_THREADS | PermissionsBits.MANAGE_EVENTS |
        PermissionsBits.MUTE_MEMBERS | PermissionsBits.DEAFEN_MEMBERS | PermissionsBits.MOVE_MEMBERS;
    if ((permissions & managementBits) !== 0n && settings.store.management) return "management";
    return null;
}

function StaffBadge({ guildId, userId, place }: { guildId: string; userId: string; place: string; }) {
    settings.use([...reactiveSettings]);
    const kind = useStateFromStores([GuildStore, GuildMemberStore, GuildRoleStore, UserStore], () => getStaffKind(guildId, userId));
    const color = useStateFromStores([GuildMemberStore], () => GuildMemberStore.getMember(guildId, userId)?.colorString);
    if (!kind || !settings.store[place === "voice" ? "voiceList" : place === "member" ? "memberList" : place === "message" ? "messages" : "profiles"]) return null;

    const label = {
        owner: settings.store.ownerLabel,
        admin: settings.store.adminLabel,
        management: settings.store.managementLabel
    }[kind] || kind;
    const fallbackColor = kind === "owner" ? "#faa61a" : kind === "admin" ? "#aaa9ad" : "#b88954";

    return <Tooltip text={label}>
        {tooltipProps => <span
            {...tooltipProps}
            className={`vc-stafftag vc-stafftag-${place}`}
            role="img"
            aria-label={label}
            style={{ color: settings.store.useRoleColor && color || fallbackColor }}
        >
            {settings.store.useCrown
                ? <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M2 7.5a1.5 1.5 0 1 1 2.6 1.02L8.3 12l2.4-5.5a1.5 1.5 0 1 1 2.6 0l2.4 5.5 3.7-3.48A1.5 1.5 0 1 1 22 7.5L20.5 18h-17L2 7.5ZM4 20h16v2H4v-2Z" />
                </svg>
                : <span className="vc-stafftag-label">{label}</span>}
        </span>}
    </Tooltip>;
}

export default definePlugin({
    name: "StaffTag",
    description: "Show owner, administrator and moderator badges in voice channels, member lists, messages and profiles.",
    authors: [TestcordDevs.DevilBro, TestcordDevs.DavidHiFi],
    tags: ["Appearance", "Roles", "Voice"],
    dependencies: ["MemberListDecoratorsAPI", "MessageDecorationsAPI", "NicknameIconsAPI"],
    settings,
    start() {
        style = createAndAppendStyle("vc-stafftag-style", managedStyleRootNode);
        style.textContent = css;
    },
    stop() {
        style?.remove();
        style = undefined;
    },
    renderMemberListDecorator({ type, user, channel }) {
        if (type !== "guild" || !user) return null;
        const guildId = channel?.guild_id ?? SelectedGuildStore.getGuildId();
        return guildId ? <StaffBadge guildId={guildId} userId={user.id} place="member" /> : null;
    },
    renderMessageDecoration({ channel, message }) {
        if (!channel?.guild_id || !message?.author) return null;
        return <StaffBadge guildId={channel.guild_id} userId={message.author.id} place="message" />;
    },
    renderNicknameIcon({ userId }) {
        const guildId = SelectedGuildStore.getGuildId();
        return guildId ? <StaffBadge guildId={guildId} userId={userId} place="profile" /> : null;
    },
    patches: [{
        find: "#{intl::GUEST_NAME_SUFFIX})]",
        replacement: {
            match: /#{intl::GUEST_NAME_SUFFIX}\)\]\}\):""(?=.*?userId:(\i\.\i))/,
            replace: "$&,$self.renderVoiceTag($1)"
        }
    }],
    renderVoiceTag(userId: string) {
        const guildId = SelectedGuildStore.getGuildId();
        return guildId && userId ? <StaffBadge guildId={guildId} userId={userId} place="voice" /> : null;
    }
});
