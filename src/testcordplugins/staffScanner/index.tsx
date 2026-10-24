/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { showNotification } from "@api/Notifications";
import { definePluginSettings, Settings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { TestcordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { chooseFile } from "@utils/web";
import { findStoreLazy } from "@webpack";
import { Button, ChannelStore, GuildMemberStore, GuildRoleStore, GuildStore, IconUtils, PermissionsBits, React, Toasts, UserStore, useStateFromStores, VoiceStateStore } from "@webpack/common";
import type { ReactNode } from "react";

const SelectedChannelStore = findStoreLazy("SelectedChannelStore");
const SelectedGuildStore = findStoreLazy("SelectedGuildStore");
const logger = new Logger("StaffScanner");
const STAFF_FLAG = 1;
const currentChannelStaff = new Set<string>();
const emptyIdSet = new Set<string>();
const idSetCache = new Map<string, Set<string>>();
let currentVoiceChannelId: string | null = null;

const SOUND_BASE_URL = "https://raw.githubusercontent.com/ImHisako/Illegalcord/main/src/illegalcordplugins/StaffDetector/sounds";
const DEFAULT_SOUND_URLS = {
    join: `${SOUND_BASE_URL}/among-us-role-reveal-sound-effect.mp3`,
    leave: `${SOUND_BASE_URL}/leave.wav`,
};
const CUSTOM_DEFAULT_URLS = {
    join: `${SOUND_BASE_URL}/trollface-smile.mp3`,
    leave: `${SOUND_BASE_URL}/death-note-light-yagami-is-sus.mp3`,
};

type AudioDataKey = "customJoinSoundData" | "customLeaveSoundData";
type AudioNameKey = "customJoinSoundDataName" | "customLeaveSoundDataName";
const audioNameKeys = {
    customJoinSoundData: "customJoinSoundDataName",
    customLeaveSoundData: "customLeaveSoundDataName",
} satisfies Record<AudioDataKey, AudioNameKey>;

const C = {
    notif: "#ef5350",
    sounds: "#42a5f5",
    server: "#66bb6a",
    user: "#ffa726",
    perms: "#ab47bc",
};

function SettingsSep({ title, color = "#9c67ff" }: { title: string; color?: string; }) {
    return (
        <div style={{ margin: "14px 0 2px", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1, height: 1, background: `${color}55` }} />
            <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "1px", color, whiteSpace: "nowrap" }}>{title}</span>
            <div style={{ flex: 1, height: 1, background: `${color}55` }} />
        </div>
    );
}

const settings = definePluginSettings({
    notifHeader: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => <SettingsSep title="Notifications" color={C.notif} />,
    },
    showToasts: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "In-app toast alert on staff join/leave.",
    },
    showNotifications: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "OS-level desktop notification on staff event.",
    },
    notifyAlreadyInVc: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Alert and play the join sound when staff are already present on voice channel join.",
    },
    autoScanOnJoin: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Automatically scan new members when they join and alert if they have the Discord Staff badge.",
    },
    enableLogs: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "Print StaffScanner events to the DevTools console (Ctrl+Shift+I).",
    },

    soundsHeader: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => <SettingsSep title="Sounds" color={C.sounds} />,
    },
    enableSounds: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Play audio alert on staff join/leave.",
    },
    soundVolume: {
        type: OptionType.SLIDER,
        default: 0.36,
        description: "Master volume for all StaffScanner sounds (0% - 100%).",
        markers: [0, 0.25, 0.5, 0.75, 1],
        stickToMarkers: false,
    },
    useCustomSounds: {
        type: OptionType.BOOLEAN,
        default: false,
        description: "OFF - built-in sounds. ON - use an uploaded file or direct audio URL below (uploaded file takes priority).",
    },

    customJoinSoundData: {
        type: OptionType.STRING,
        default: "",
        description: "",
        hidden: true,
    },
    customJoinSoundDataName: {
        type: OptionType.STRING,
        default: "",
        description: "",
        hidden: true,
    },
    customJoinSound: {
        type: OptionType.STRING,
        default: "",
        description: "JOIN fallback URL (https://...) - used only if no file is uploaded above. Empty = built-in custom MP3.",
    },
    customJoinUpload: {
        type: OptionType.COMPONENT,
        description: "Upload JOIN sound (replaces previous upload).",
        component: () => <AudioUploadButton label="Upload JOIN Sound" dataKey="customJoinSoundData" />,
    },

    customLeaveSoundData: {
        type: OptionType.STRING,
        default: "",
        description: "",
        hidden: true,
    },
    customLeaveSoundDataName: {
        type: OptionType.STRING,
        default: "",
        description: "",
        hidden: true,
    },
    customLeaveSound: {
        type: OptionType.STRING,
        default: "",
        description: "LEAVE fallback URL (https://...) - used only if no file is uploaded above. Empty = built-in custom MP3.",
    },
    customLeaveUpload: {
        type: OptionType.COMPONENT,
        description: "Upload LEAVE sound (replaces previous upload).",
        component: () => <AudioUploadButton label="Upload LEAVE Sound" dataKey="customLeaveSoundData" />,
    },

    serverHeader: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => <SettingsSep title="Server Filter" color={C.server} />,
    },
    serverFilterMode: {
        type: OptionType.SELECT,
        options: [
            { label: "All servers", value: "none", default: true },
            { label: "Include only listed servers", value: "include" },
            { label: "Exclude listed servers", value: "exclude" },
        ],
        description: "Which servers trigger voice channel staff detection.",
    },
    serverIncludeIds: {
        type: OptionType.STRING,
        default: "",
        description: "Allowlist - detect ONLY in these guild IDs. Accepts one or more IDs separated by comma, space, or dash.",
    },
    serverExcludeIds: {
        type: OptionType.STRING,
        default: "",
        description: "Blocklist - never detect in these guild IDs. Accepts one or more IDs separated by comma, space, or dash. Overridden by User Include list.",
    },

    userHeader: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => <SettingsSep title="User Filter" color={C.user} />,
    },
    userIncludeIds: {
        type: OptionType.STRING,
        default: "",
        description: "Track ONLY these user IDs (empty = all with matching perms). Overrides server filter and permission check - flagged even without staff permissions. Useful to track undercover staff alts. Accepts one or more IDs separated by comma, space, or dash.",
    },
    userExcludeIds: {
        type: OptionType.STRING,
        default: "",
        description: "Ignore these user IDs regardless of permissions. Accepts one or more IDs separated by comma, space, or dash.",
    },

    permsHeader: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => <SettingsSep title="Detected Permissions" color={C.perms} />,
    },
    adminPermission: { type: OptionType.BOOLEAN, default: true, description: "Administrator" },
    manageGuildPermission: { type: OptionType.BOOLEAN, default: true, description: "Manage Server" },
    manageChannelsPermission: { type: OptionType.BOOLEAN, default: true, description: "Manage Channels" },
    manageRolesPermission: { type: OptionType.BOOLEAN, default: true, description: "Manage Roles" },
    manageNicknamesPermission: { type: OptionType.BOOLEAN, default: false, description: "Manage Nicknames" },
    manageMessagesPermission: { type: OptionType.BOOLEAN, default: true, description: "Manage Messages" },
    kickMembersPermission: { type: OptionType.BOOLEAN, default: true, description: "Kick Members" },
    banMembersPermission: { type: OptionType.BOOLEAN, default: true, description: "Ban Members" },
    moderateMembersPermission: { type: OptionType.BOOLEAN, default: true, description: "Timeout / Moderate Members" },
    moveMembersPermission: { type: OptionType.BOOLEAN, default: true, description: "Move Members" },
    muteMembersPermission: { type: OptionType.BOOLEAN, default: true, description: "Mute Members" },
    deafenMembersPermission: { type: OptionType.BOOLEAN, default: true, description: "Deafen Members" },
});

const permChecks = [
    ["adminPermission", "ADMINISTRATOR"],
    ["manageGuildPermission", "MANAGE_GUILD"],
    ["manageChannelsPermission", "MANAGE_CHANNELS"],
    ["manageRolesPermission", "MANAGE_ROLES"],
    ["manageNicknamesPermission", "MANAGE_NICKNAMES"],
    ["manageMessagesPermission", "MANAGE_MESSAGES"],
    ["kickMembersPermission", "KICK_MEMBERS"],
    ["banMembersPermission", "BAN_MEMBERS"],
    ["moderateMembersPermission", "MODERATE_MEMBERS"],
    ["moveMembersPermission", "MOVE_MEMBERS"],
    ["muteMembersPermission", "MUTE_MEMBERS"],
    ["deafenMembersPermission", "DEAFEN_MEMBERS"],
] satisfies Array<[keyof typeof settings.def, string]>;

const VOICE_NAME_SETTINGS_KEYS = [
    "userIncludeIds", "userExcludeIds", "serverFilterMode", "serverIncludeIds", "serverExcludeIds",
    ...permChecks.map(([key]) => key),
] satisfies Array<keyof typeof settings.def>;

// The pre-merge plugin stored its sound toggle and volume under different names and a
// 0-100 volume scale. Fold both into the unified sound settings before anything reads them.
(function migrateLegacySoundSettings() {
    const legacy = Settings.plugins.StaffScanner as { playSound?: boolean; volume?: number; enableSounds?: boolean; soundVolume?: number; } | undefined;
    if (!legacy) return;

    if (legacy.enableSounds === undefined && legacy.playSound !== undefined) {
        legacy.enableSounds = legacy.playSound;
        delete legacy.playSound;
    }
    if (legacy.soundVolume === undefined && typeof legacy.volume === "number") {
        legacy.soundVolume = Math.min(1, Math.max(0, legacy.volume / 100));
        delete legacy.volume;
    }
})();

function readFileAsDataUri(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === "string") {
                resolve(reader.result);
                return;
            }

            reject(new Error("Selected file could not be read as audio data."));
        };
        reader.onerror = () => reject(reader.error ?? new Error("Selected file could not be read."));
        reader.readAsDataURL(file);
    });
}

function AudioUploadButton({ label, dataKey }: { label: string; dataKey: AudioDataKey; }) {
    const nameKey = audioNameKeys[dataKey];
    const [filename, setFilename] = React.useState<string>(() => {
        const data = settings.store[dataKey];
        return data ? (settings.store[nameKey] || "Uploaded") : "";
    });

    async function handleClick() {
        const file = await chooseFile("audio/*");
        if (!file) return;

        try {
            settings.store[dataKey] = await readFileAsDataUri(file);
            settings.store[nameKey] = file.name;
            setFilename(file.name);
        } catch (error) {
            Toasts.show({
                message: "Could not load that audio file.",
                id: Toasts.genId(),
                type: Toasts.Type.FAILURE,
            });
            if (settings.store.enableLogs) logger.error("StaffScanner: audio upload failed:", error);
        }
    }

    function handleClear() {
        settings.store[dataKey] = "";
        settings.store[nameKey] = "";
        setFilename("");
    }

    return (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            <Button
                color={Button.Colors.PRIMARY}
                size={Button.Sizes.SMALL}
                onClick={() => void handleClick()}
            >
                {label}
            </Button>
            {filename
                ? <>
                    <span style={{ fontSize: 11, color: "#9e9e9e", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{filename}</span>
                    <Button
                        color={Button.Colors.RED}
                        size={Button.Sizes.SMALL}
                        onClick={handleClear}
                    >
                        Clear
                    </Button>
                </>
                : <span style={{ fontSize: 11, color: "#5a4a6a" }}>No file uploaded</span>}
        </div>
    );
}

interface VoiceNameProps {
    user: { id: string; };
    guildId?: string;
    children: ReactNode;
}

const StaffVoiceName = ErrorBoundary.wrap(({ user, guildId, children }: VoiceNameProps) => {
    const options = settings.use(VOICE_NAME_SETTINGS_KEYS);
    const isStaff = useStateFromStores(
        [GuildStore, GuildRoleStore, GuildMemberStore],
        () => Boolean(guildId && shouldFlag(user.id, guildId, getStaffRoleIds(guildId))),
        [user.id, guildId, ...VOICE_NAME_SETTINGS_KEYS.map(key => options[key])]
    );

    return isStaff ? <span style={{ color: "var(--status-danger)" }}>{children}</span> : <>{children}</>;
}, { noop: true });

function parseIdSet(raw: string): Set<string> {
    if (!raw) return emptyIdSet;

    const cached = idSetCache.get(raw);
    if (cached) return cached;

    const ids = new Set<string>();
    for (const match of raw.matchAll(/\d{5,}/g)) {
        ids.add(match[0]);
    }

    idSetCache.set(raw, ids);
    return ids;
}

function shouldFlag(userId: string, guildId: string, staffRoleIds: Set<string>): boolean {
    const excludedUsers = parseIdSet(settings.store.userExcludeIds);
    if (excludedUsers.size > 0 && excludedUsers.has(userId)) return false;

    const includedUsers = parseIdSet(settings.store.userIncludeIds);
    if (includedUsers.size > 0) return includedUsers.has(userId);

    const mode = settings.store.serverFilterMode;
    if (mode === "include") {
        const includedServers = parseIdSet(settings.store.serverIncludeIds);
        if (includedServers.size > 0 && !includedServers.has(guildId)) return false;
    } else if (mode === "exclude") {
        const excludedServers = parseIdSet(settings.store.serverExcludeIds);
        if (excludedServers.has(guildId)) return false;
    }

    return isUserStaff(userId, guildId, staffRoleIds);
}

function getStaffPermissionMask(): bigint {
    let permissions = 0n;
    for (const [key, permission] of permChecks) {
        if (settings.store[key]) permissions |= PermissionsBits[permission];
    }
    return permissions;
}

function getStaffRoleIds(guildId: string): Set<string> {
    const staffPermissions = getStaffPermissionMask();
    const staffRoleIds = new Set<string>();
    if (staffPermissions === 0n) return staffRoleIds;

    const roles = GuildRoleStore.getSortedRoles(guildId);
    for (const role of roles) {
        if (!role?.id) continue;

        const permissions = BigInt(role.permissions);
        if ((permissions & PermissionsBits.ADMINISTRATOR) !== 0n || (permissions & staffPermissions) !== 0n) {
            staffRoleIds.add(role.id);
        }
    }

    return staffRoleIds;
}

function isUserStaff(userId: string, guildId: string, staffRoleIds: Set<string>): boolean {
    const guild = GuildStore.getGuild(guildId);
    if (!guild) return false;

    if (guild.ownerId === userId) return true;
    if (staffRoleIds.has(guildId)) return true;

    const member = GuildMemberStore.getMember(guildId, userId);
    if (!member?.roles?.length) {
        return false;
    }

    for (const roleId of member.roles)
        if (staffRoleIds.has(roleId)) return true;

    return false;
}

function isStaffBadge(user: unknown): boolean {
    if (!user) return false;
    const candidate = user as { hasFlag?: (flag: number) => boolean; publicFlags?: unknown; public_flags?: unknown; flags?: unknown; };
    try {
        if (typeof candidate.hasFlag === "function" && candidate.hasFlag(STAFF_FLAG)) return true;
    } catch { }

    // Discord has shipped publicFlags/flags as both number and bigint across builds.
    for (const value of [candidate.publicFlags ?? candidate.public_flags, candidate.flags]) {
        if (typeof value === "bigint") return (value & BigInt(STAFF_FLAG)) === BigInt(STAFF_FLAG);
        if (typeof value === "number") return (value & STAFF_FLAG) === STAFF_FLAG;
    }
    return false;
}

function getUsername(userId: string): string {
    return UserStore.getUser(userId)?.username ?? userId;
}

function getAvatarUrl(userId: string): string {
    const user = UserStore.getUser(userId);
    if (!user) return IconUtils.getDefaultAvatarURL(userId);
    return IconUtils.getUserAvatarURL(user, false, 128) ?? IconUtils.getDefaultAvatarURL(userId);
}

function getChannelContext(channelId: string): string {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel) return "";
    const guild = channel.guild_id ? GuildStore.getGuild(channel.guild_id) : null;
    if (channel.name && guild?.name) return `#${channel.name} - ${guild.name}`;
    if (channel.name) return `#${channel.name}`;
    return "";
}

function notify(title: string, body: string, icon?: string): void {
    if (settings.store.showToasts)
        Toasts.show({ message: `${title}  ${body}`, id: Toasts.genId(), type: Toasts.Type.MESSAGE });
    if (settings.store.showNotifications)
        showNotification({ title, body, icon, permanent: false, onClick: () => { } });
}

function playSrc(src: string): void {
    const audio = new Audio(src);
    audio.volume = Math.min(1, Math.max(0, settings.store.soundVolume ?? 0.36));
    audio.play().catch(e => {
        if (settings.store.enableLogs) logger.error("StaffScanner: playSrc error:", e);
    });
}

function playStaffSound(isJoin: boolean): void {
    if (!settings.store.enableSounds) return;
    if (settings.store.useCustomSounds) {
        const dataUri = isJoin ? settings.store.customJoinSoundData : settings.store.customLeaveSoundData;
        if (dataUri) { playSrc(dataUri); return; }
        const url = (isJoin ? settings.store.customJoinSound : settings.store.customLeaveSound)?.trim();
        if (url) { playSrc(url); return; }
        playSrc(isJoin ? CUSTOM_DEFAULT_URLS.join : CUSTOM_DEFAULT_URLS.leave);
        return;
    }
    playSrc(isJoin ? DEFAULT_SOUND_URLS.join : DEFAULT_SOUND_URLS.leave);
}

function sendBotMessageQuiet(channelId: string, content: string): void {
    try {
        sendBotMessage(channelId, { content });
    } catch { }
}

function getGuildIdForScan(ctx?: any): string | null {
    if (ctx?.guild?.id) return ctx.guild.id;
    if (ctx?.channel?.guild_id) return ctx.channel.guild_id;
    if (ctx?.channel?.guildId) return ctx.channel.guildId;
    try {
        const gid = SelectedGuildStore.getGuildId();
        if (gid) return gid;
    } catch { }
    try {
        const chId = SelectedChannelStore.getChannelId();
        if (chId) {
            const ch = ChannelStore?.getChannel?.(chId);
            if (ch?.guild_id) return ch.guild_id;
        }
    } catch { }
    return null;
}

function scanCurrentGuild(channelId: string, guildId: string) {
    const guild = GuildStore.getGuild(guildId);
    const guildName = guild?.name ?? "This server";

    let memberIds: string[] = [];
    try {
        const ids = GuildMemberStore.getMemberIds(guildId) as string[] | undefined;
        if (ids && Array.isArray(ids) && ids.length) memberIds = ids;
    } catch { }

    if (!memberIds.length) {
        try {
            const members = GuildMemberStore.getMembers(guildId) as any[];
            if (Array.isArray(members) && members.length) {
                memberIds = members.map(m => m?.userId ?? m?.user?.id ?? m?.id).filter(Boolean);
            }
        } catch { }
    }

    if (!memberIds.length) {
        sendBotMessage(channelId, { content: `No members cached for **${guildName}**. Try opening the member list first and run again.` });
        Toasts.show({
            message: `No members cached for ${guildName}.`,
            id: Toasts.genId(),
            type: Toasts.Type.FAILURE,
            options: { position: Toasts.Position.BOTTOM }
        });
        return;
    }

    sendBotMessage(channelId, { content: `Scanning **${guildName}** (${memberIds.length} members) for Discord Staff...` });

    const staff: Array<{ id: string; username: string; }> = [];
    for (const id of memberIds) {
        const user = UserStore.getUser(id);
        if (!user) continue;
        if (isStaffBadge(user)) {
            staff.push({ id, username: (user as any).globalName ?? user.username ?? id });
        }
    }

    if (!staff.length) {
        sendBotMessage(channelId, { content: `No Discord Staff found in **${guildName}**. Scanned ${memberIds.length} members.` });
        Toasts.show({
            message: `No Staff found in ${guildName} (${memberIds.length} scanned).`,
            id: Toasts.genId(),
            type: Toasts.Type.SUCCESS,
            options: { position: Toasts.Position.BOTTOM }
        });
        return;
    }

    playStaffSound(true);
    notify(`Staff found in ${guildName}:`, staff.map(s => `${s.username} (${s.id})`).join(", "), getAvatarUrl(staff[0].id));
    const content = staff.length === 1
        ? `🚨 Staff found in **${guildName}**\n<@${staff[0].id}> (${staff[0].username}) has Discord Staff badge.`
        : `🚨 Staff found in **${guildName}**\n${staff.map(s => `<@${s.id}> (${s.username})`).join("\n")}`;
    sendBotMessageQuiet(channelId, content);
}

function scanChannelStaff(channelId: string): void {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel?.guild_id) return;

    const myUserId = UserStore.getCurrentUser()?.id;
    if (!myUserId) return;

    const voiceStates = VoiceStateStore.getVoiceStatesForChannel(channelId);
    if (!voiceStates) return;

    const userIds = Object.keys(voiceStates);
    if (!userIds.length) return;

    currentChannelStaff.clear();
    const staffFound: string[] = [];
    const staffRoleIds = getStaffRoleIds(channel.guild_id);
    for (const uid of userIds) {
        if (uid === myUserId) continue;
        if (shouldFlag(uid, channel.guild_id, staffRoleIds)) {
            currentChannelStaff.add(uid);
            staffFound.push(uid);
        }
    }
    if (!staffFound.length || !settings.store.notifyAlreadyInVc) return;

    const ctx = getChannelContext(channelId);
    playStaffSound(true);
    if (staffFound.length === 1) {
        const name = getUsername(staffFound[0]);
        if (settings.store.enableLogs) logger.info(`StaffScanner: "${name}" already in VC - ${ctx}`);
        notify("⚠️ StaffScanner:", `"${name}" already here - ${ctx}`, getAvatarUrl(staffFound[0]));
    } else {
        const names = staffFound.map(id => `"${getUsername(id)}"`).join(", ");
        if (settings.store.enableLogs) logger.info(`StaffScanner: ${staffFound.length} staff already in VC - ${ctx}`);
        notify("⚠️ StaffScanner:", `${staffFound.length} staff: ${names} - ${ctx}`, getAvatarUrl(staffFound[0]));
    }
}

function handleMemberJoin(guildId: string | undefined, userId: string | undefined, eventUser: unknown) {
    if (!settings.store.autoScanOnJoin) return;
    if (!userId) return;

    let user = eventUser as ReturnType<typeof UserStore.getUser>;
    if (!user) {
        try { user = UserStore.getUser(userId); } catch { }
    }
    if (!user || !isStaffBadge(user)) return;

    const guildName = (guildId ? GuildStore.getGuild(guildId)?.name : undefined) ?? (guildId ? `Server ${guildId}` : "a server");
    const username = user.globalName ?? user.username ?? userId;
    const entryId = user.id ?? userId;

    playStaffSound(true);
    notify(`Staff joined ${guildName}:`, `${username} (${entryId})`, getAvatarUrl(entryId));

    try {
        const currentGuildId = SelectedGuildStore.getGuildId();
        const currentChannelId = SelectedChannelStore.getChannelId();
        if (currentGuildId && currentGuildId === guildId && currentChannelId) {
            sendBotMessageQuiet(currentChannelId, `🚨 Staff joined **${guildName}**\n<@${entryId}> (${username}) has Discord Staff badge and just joined.`);
        }
    } catch { }
}

export default definePlugin({
    id: "StaffScanner",
    name: "StaffScanner",
    description: "Detects staff by mod permissions in voice channels, highlights their names in red and alerts on join/leave. Also scans server members for the Discord Staff badge.",
    authors: [
        TestcordDevs.x2b,
        TestcordDevs.irritably,
    ],
    tags: ["Utility", "Servers"],
    searchTerms: ["staff", "moderator", "admin", "detector", "badge", "scan"],
    settings,

    patches: [{
        find: "#{intl::GUEST_NAME_SUFFIX})]",
        replacement: {
            match: /(?<=children:\[)\i(?:\?\?\i\.\i\.getName\(\i\))?(?=,.{0,150}?#{intl::GUEST_NAME_SUFFIX})/,
            replace: "$self.renderVoiceName(arguments[0],$&)"
        }
    }],

    renderVoiceName(props: Omit<VoiceNameProps, "children">, children: ReactNode) {
        return <StaffVoiceName {...props}>{children}</StaffVoiceName>;
    },

    commands: [
        {
            name: "scans",
            description: "Scan every member in this server for Discord Staff badge.",
            inputType: ApplicationCommandInputType.BUILT_IN,
            execute: (_args, ctx) => {
                const channelId = ctx.channel.id;
                const guildId = getGuildIdForScan(ctx);
                if (!guildId) {
                    sendBotMessage(channelId, { content: "Please run this command inside a server." });
                    return;
                }
                scanCurrentGuild(channelId, guildId);
            }
        }
    ],

    start() {
        const vcId: string | null = SelectedChannelStore.getVoiceChannelId?.() ?? null;
        currentVoiceChannelId = vcId;
        if (vcId) scanChannelStaff(vcId);
    },

    stop() {
        currentChannelStaff.clear();
        currentVoiceChannelId = null;
        idSetCache.clear();
    },

    flux: {
        VOICE_CHANNEL_SELECT({ channelId }: { channelId: string | null; }) {
            if (channelId === currentVoiceChannelId) return;
            currentVoiceChannelId = channelId;
            currentChannelStaff.clear();
            if (!channelId) return;
            scanChannelStaff(channelId);
        },

        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: Array<{ userId: string; channelId?: string; oldChannelId?: string; guildId?: string; }>; }) {
            const channelId = currentVoiceChannelId;
            if (!channelId) return;
            const relevantState = voiceStates.find(state => (state.channelId === channelId && state.oldChannelId !== channelId)
                || (state.oldChannelId === channelId && state.channelId !== channelId));
            if (!relevantState) return;
            const guildId = relevantState.guildId ?? ChannelStore.getChannel(channelId)?.guild_id;
            if (!guildId) return;

            const myUserId = UserStore.getCurrentUser()?.id;
            if (!myUserId) return;

            let context: string | undefined;
            let staffRoleIds: Set<string> | undefined;
            for (const { userId, channelId: nextChannelId, oldChannelId } of voiceStates) {
                if (userId === myUserId) continue;
                const entered = nextChannelId === channelId && oldChannelId !== channelId;
                const left = oldChannelId === channelId && nextChannelId !== channelId;
                if (!entered && !left) continue;

                if (entered) {
                    if (currentChannelStaff.has(userId)) continue;
                    staffRoleIds ??= getStaffRoleIds(guildId);
                    if (!shouldFlag(userId, guildId, staffRoleIds)) continue;
                    currentChannelStaff.add(userId);
                    const name = getUsername(userId);
                    context ??= getChannelContext(channelId);
                    if (settings.store.enableLogs) logger.info(`StaffScanner: "${name}" joined - ${context}`);
                    playStaffSound(true);
                    notify("🚨 StaffScanner:", `"${name}" joined - ${context}`, getAvatarUrl(userId));
                    continue;
                }

                if (currentChannelStaff.has(userId)) {
                    currentChannelStaff.delete(userId);
                    const name = getUsername(userId);
                    context ??= getChannelContext(channelId);
                    const remaining = currentChannelStaff.size;
                    const suffix = remaining > 0 ? ` - ${remaining} staff remaining` : " - No staff remaining";
                    if (settings.store.enableLogs) logger.info(`StaffScanner: "${name}" left - ${context} (${remaining} remaining)`);
                    playStaffSound(false);
                    notify("✅ StaffScanner:", `"${name}" left - ${context}${suffix}`, getAvatarUrl(userId));
                }
            }
        },

        GUILD_MEMBER_ADD(event: any) {
            const guildId: string | undefined = event.guildId ?? event.guild_id ?? event.member?.guildId ?? event.guild?.id;
            const userId: string | undefined = event.user?.id ?? event.userId ?? event.member?.userId;
            setTimeout(() => handleMemberJoin(guildId, userId, event.user), 600);
        }
    }
});
