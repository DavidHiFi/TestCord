/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { sleep } from "@utils/misc";
import { Channel } from "@vencord/discord-types";
import { ChannelType } from "@vencord/discord-types/enums";
import {
    ChannelStore,
    Constants,
    IconUtils,
    NavigationRouter,
    PresenceStore,
    RelationshipStore,
    RestAPI,
    UserStore,
    VoiceStateStore
} from "@webpack/common";

import { FriendOption } from "./types";

const logger = new Logger("gctrap");

// Not every build ships all of these Endpoints keys, so fall back to the
// literal path the way channelGallery does for messages.
const Ep = Constants.Endpoints;

function endpoint(key: string, ...args: string[]): string | undefined {
    const value: unknown = Ep?.[key];
    if (typeof value === "function") return (value as (...args: string[]) => string)(...args);
    if (typeof value === "string") return value;
    return undefined;
}

const groupDmCreateUrl = () => endpoint("GROUP_DM_CREATE") ?? "/users/@me/channels";
const channelUrl = (channelId: string) => endpoint("CHANNEL", channelId) ?? `/channels/${channelId}`;
const recipientUrl = (channelId: string, userId: string) =>
    endpoint("CHANNEL_RECIPIENTS", channelId) ?? `/channels/${channelId}/recipients/${userId}`;
const inviteUrl = (code: string) => endpoint("INVITE", code) ?? `/invite/${code}`;

export function isGroup(channel?: Channel | null): boolean {
    return !!channel && channel.type === ChannelType.GROUP_DM;
}

/** Groups the account is currently in, newest activity first */
export function listGroups(): Channel[] {
    return ChannelStore.getSortedPrivateChannels().filter(isGroup);
}

export function recipientIds(channel?: Channel | null): string[] {
    return channel?.recipients?.filter(Boolean) ?? [];
}

export function getGroupName(channel?: Channel | null): string {
    if (!channel) return "Unknown group";
    if (channel.name) return channel.name;
    const names = recipientIds(channel)
        .map(id => UserStore.getUser(id)?.globalName || UserStore.getUser(id)?.username)
        .filter(Boolean);
    return names.length ? names.join(", ") : channel.id;
}

type ChannelWithInvites = Channel & { invites?: { code: string; }[]; };

export function getChannelInviteCode(channel?: Channel | null): string | undefined {
    return (channel as ChannelWithInvites | null | undefined)?.invites?.[0]?.code;
}

export function selfId(): string {
    return UserStore.getCurrentUser()?.id ?? "";
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
    const safeSize = Math.max(1, size);
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += safeSize) chunks.push(items.slice(i, i + safeSize));
    return chunks;
}

export function privateGroupIds(): Set<string> {
    return new Set(ChannelStore.getSortedPrivateChannels().map(channel => channel.id));
}

export function getErrorMessage(err: any): string {
    const body = err?.body;
    switch (body?.code) {
        case 30001:
            return "This group already has the maximum number of members.";
        case 30002:
            return "You have too many groups open. Close a few and try again.";
        case 40003:
            return "You are not friends with everyone on that list.";
        case 50007:
            return "That user cannot be added, they may have blocked you or closed DMs.";
        case 50033:
            return "That user cannot be added. Blocked, removed, and selfbot accounts are rejected.";
        case 50035:
            return "One of the IDs you entered is not valid.";
        default:
            return body?.message ?? err?.message ?? "The request failed.";
    }
}

export async function renameGroup(channelId: string, name: string): Promise<void> {
    await RestAPI.patch({ url: channelUrl(channelId), body: { name: name.trim().slice(0, 100) } });
}

export async function createGroup(recipientList: readonly string[], name?: string): Promise<string> {
    const res = await RestAPI.post({ url: groupDmCreateUrl(), body: { recipient_ids: recipientList } });
    const channelId = res?.body?.id;
    if (!channelId) throw new Error("Discord did not return the new group.");
    if (name?.trim()) await renameGroup(channelId, name);
    return channelId;
}

/**
 * Discord only accepts one new recipient per request, so `size` is how many of
 * those requests are fired per wave before waiting `delay` milliseconds.
 */
export async function addMembers(
    channelId: string,
    userIds: readonly string[],
    size: number,
    delay: number
): Promise<{ added: number; failed: string[]; }> {
    const existing = recipientIds(ChannelStore.getChannel(channelId));
    const missing = userIds.filter(id => !existing.includes(id));
    const failed = new Set<string>();

    for (const batch of chunk(missing, size)) {
        await Promise.all(batch.map(async userId => {
            try {
                await RestAPI.put({ url: recipientUrl(channelId, userId), body: {} });
            } catch (err) {
                failed.add(userId);
                logger.warn(`Could not add ${userId}: ${getErrorMessage(err)}`);
            }
        }));
        if (delay > 0) await sleep(delay);
    }

    return { added: missing.length - failed.size, failed: [...failed] };
}

export async function removeMembers(
    channelId: string,
    userIds: readonly string[],
    size: number,
    delay: number
): Promise<{ removed: number; failed: string[]; }> {
    const failed = new Set<string>();

    for (const batch of chunk(userIds, size)) {
        await Promise.all(batch.map(async userId => {
            try {
                await RestAPI.del({ url: recipientUrl(channelId, userId) });
            } catch (err) {
                failed.add(userId);
                logger.warn(`Could not remove ${userId}: ${getErrorMessage(err)}`);
            }
        }));
        if (delay > 0) await sleep(delay);
    }

    return { removed: userIds.length - failed.size, failed: [...failed] };
}

/** Accept an invite and work out which group it dropped us into */
export async function joinByInvite(code: string): Promise<string | undefined> {
    const before = privateGroupIds();
    await RestAPI.post({ url: inviteUrl(code), body: {} });
    await sleep(750);
    return findNewGroup(before) ?? getGroupByInviteCode(code);
}

function findNewGroup(before: Set<string>): string | undefined {
    return ChannelStore.getSortedPrivateChannels().find(channel => isGroup(channel) && !before.has(channel.id))?.id;
}

function getGroupByInviteCode(code: string): string | undefined {
    return ChannelStore.getSortedPrivateChannels().find(channel => isGroup(channel) && getChannelInviteCode(channel) === code)?.id;
}

export function openChannel(channelId: string): void {
    NavigationRouter.transitionTo(`/channels/@me/${channelId}`);
}

export function getFriends(): FriendOption[] {
    const self = selfId();
    return RelationshipStore.getFriendIDs()
        .filter(id => id !== self)
        .map((id): FriendOption | undefined => {
            const user = UserStore.getUser(id);
            if (!user) return undefined;
            const status = PresenceStore.getStatus(id, null, "offline");
            return {
                id,
                user,
                name: user.globalName || user.username,
                username: user.username,
                avatar: IconUtils.getUserAvatarURL(user, true, 48) ?? "",
                status: status === "online" || status === "idle" || status === "dnd" ? status : "offline",
                inVoice: !!VoiceStateStore.getVoiceStateForUser(id)?.channelId
            } satisfies FriendOption;
        })
        .filter((option): option is FriendOption => !!option)
        .sort((a, b) => a.name.localeCompare(b.name));
}

/** Name, avatar and status for any user ID, friend or not */
export function describeUser(id: string): FriendOption {
    const user = UserStore.getUser(id);
    const status = PresenceStore.getStatus(id, null, "offline");
    return {
        id,
        user,
        name: user?.globalName || user?.username || id,
        username: user?.username ?? "unknown",
        avatar: user ? IconUtils.getUserAvatarURL(user, true, 48) ?? "" : "",
        status: status === "online" || status === "idle" || status === "dnd" ? status : "offline",
        inVoice: !!VoiceStateStore.getVoiceStateForUser(id)?.channelId
    };
}
