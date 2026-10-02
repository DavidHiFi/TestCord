/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { User } from "@vencord/discord-types";

export const GROUP_MODES = {
    strict: "Kick & Re-add",
    kickonly: "Kick only",
    addonly: "Re-add only",
    off: "Paused"
} as const;
export type GroupMode = keyof typeof GROUP_MODES;

export function isGroupMode(value: string): value is GroupMode {
    return value in GROUP_MODES;
}

/**
 * targets are the people the trap is pointed at. They get put back in when they
 * walk out, and anyone they drag into the group is treated as a stranger.
 * members are the people running the trap with you. They are never touched, so
 * they can add, remove and leave as they like.
 */
export type Role = "target" | "member";

export interface GroupConfig {
    id: string;
    label?: string;
    mode: GroupMode;
    targets: string[];
    members: string[];
    readdLimit: number;
    readdDelay: number;
    /** How often each target has been put back in since the last reset */
    readds?: Record<string, number>;
}

export function roleOf(group: Pick<GroupConfig, "targets" | "members">, userId: string): Role | undefined {
    if (group.targets.includes(userId)) return "target";
    if (group.members.includes(userId)) return "member";
    return undefined;
}

export function isTarget(group: Pick<GroupConfig, "targets">, userId: string): boolean {
    return group.targets.includes(userId);
}

/** Clicking a person moves them target, then member, then off both lists. */
export function cycleRole(roles: ReadonlyMap<string, Role>, userId: string): Map<string, Role> {
    const next = new Map(roles);
    const current = next.get(userId);
    if (current === "target") next.set(userId, "member");
    else if (current === "member") next.delete(userId);
    else next.set(userId, "target");
    return next;
}

export function setManyRoles(roles: ReadonlyMap<string, Role>, userIds: readonly string[], role: Role | undefined): Map<string, Role> {
    const next = new Map(roles);
    for (const id of userIds) {
        if (role) next.set(id, role);
        else next.delete(id);
    }
    return next;
}

export function rolesToLists(roles: ReadonlyMap<string, Role>): Pick<GroupConfig, "targets" | "members"> {
    const targets: string[] = [];
    const members: string[] = [];
    for (const [id, role] of roles) (role === "target" ? targets : members).push(id);
    return { targets, members };
}

export interface Preset {
    name: string;
    ids: string[];
}

export type LogKind = "info" | "action" | "warn" | "error";

export interface LogEntry {
    id: number;
    ts: number;
    group: string;
    kind: LogKind;
    text: string;
}

export interface FriendOption {
    user?: User;
    id: string;
    name: string;
    username: string;
    avatar: string;
    status: "online" | "idle" | "dnd" | "offline";
    inVoice: boolean;
}

export interface GroupDefaults {
    mode: GroupMode;
    readdLimit: number;
    readdDelay: number;
}

/**
 * Groups used to keep a single allowlist under `members`, which held the people
 * that got readded. That list is the target list now, and the member list starts
 * empty, so an existing group keeps behaving exactly as it did before.
 */
export function migrateGroup(raw: unknown, defaults: GroupDefaults): GroupConfig | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const value = raw as Partial<GroupConfig> & { members?: string[]; targets?: string[]; };
    if (typeof value.id !== "string") return undefined;

    const legacy = !Array.isArray(value.targets);
    const targets = (value.targets ?? value.members ?? []).filter(id => typeof id === "string");
    const members = legacy ? [] : (value.members ?? []).filter(id => typeof id === "string");
    const mode = typeof value.mode === "string" && isGroupMode(value.mode) ? value.mode : defaults.mode;

    return {
        id: value.id,
        label: value.label,
        mode,
        targets,
        members,
        readdLimit: typeof value.readdLimit === "number" ? value.readdLimit : defaults.readdLimit,
        readdDelay: typeof value.readdDelay === "number" ? value.readdDelay : defaults.readdDelay,
        readds: value.readds ?? {}
    };
}
