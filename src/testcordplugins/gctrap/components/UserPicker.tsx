/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Avatar, TextInput, useMemo, useState } from "@webpack/common";

import { FriendOption, Role } from "../types";
import { cl, STATUS_COLORS } from "../utils";

const FILTERS = ["all", "online", "idle", "dnd", "voice"] as const;
type Filter = (typeof FILTERS)[number];
const FILTER_LABELS: Record<Filter, string> = {
    all: "All",
    online: "Online",
    idle: "Idle",
    dnd: "DND",
    voice: "In Voice"
};

/** Clicking a badge cycles a person through target, member, then off the lists. */
const CYCLE: Record<string, Role | undefined> = {
    target: "member",
    member: undefined
};
const BADGES: Record<Role, string> = { target: "target", member: "member" };

interface UserPickerProps {
    friends: readonly FriendOption[];
    roles: ReadonlyMap<string, Role>;
    onCycle(userId: string): void;
    onCycleMany(userIds: readonly string[], role: Role | undefined): void;
    onClearAll(): void;
}

export default function UserPicker({ friends, roles, onCycle, onCycleMany, onClearAll }: UserPickerProps) {
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<Filter>("all");

    const visible = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return friends.filter(friend => {
            if (filter === "voice" && !friend.inVoice) return false;
            if (filter !== "all" && filter !== "voice" && friend.status !== filter) return false;
            if (!needle) return true;
            return friend.name.toLowerCase().includes(needle)
                || friend.username.toLowerCase().includes(needle)
                || friend.id.includes(needle);
        });
    }, [friends, query, filter]);

    const visibleIds = visible.map(friend => friend.id);
    const targets = [...roles.values()].filter(role => role === "target").length;
    const members = [...roles.values()].filter(role => role === "member").length;
    const allTargets = visibleIds.length > 0 && visibleIds.every(id => roles.get(id) === "target");
    const allMembers = visibleIds.length > 0 && visibleIds.every(id => roles.get(id) === "member");

    return (
        <div className={cl("picker")}>
            <TextInput
                placeholder="Search by name or ID"
                value={query}
                onChange={setQuery}
            />
            <div className={cl("filters")}>
                {FILTERS.map(name => (
                    <Button
                        key={name}
                        size="xs"
                        variant={filter === name ? "primary" : "secondary"}
                        onClick={() => setFilter(name)}
                    >
                        {FILTER_LABELS[name]}
                    </Button>
                ))}
                <span className={cl("count")}>{targets} target{members ? `, ${members} member` : ""}</span>
            </div>
            <div className={cl("list")}>
                {visible.map(friend => {
                    const role = roles.get(friend.id);
                    return (
                        <div
                            key={friend.id}
                            role="button"
                            tabIndex={0}
                            className={cl("row", { picked: !!role })}
                            onClick={() => onCycle(friend.id)}
                            onKeyDown={event => event.key === "Enter" && onCycle(friend.id)}
                        >
                            <span className={cl("dot")} style={{ background: STATUS_COLORS[friend.status] }} />
                            <Avatar size="SIZE_24" src={friend.avatar} />
                            <span className={cl("row-main")}>
                                <span className={cl("row-name")}>{friend.name}</span>
                                <span className={cl("row-sub")}>@{friend.username}</span>
                            </span>
                            {friend.inVoice && <span className={cl("badge")}>voice</span>}
                            <span className={cl("role", role ? { [role]: true } : undefined)}>
                                {role ? BADGES[role] : "none"}
                            </span>
                        </div>
                    );
                })}
                {!visible.length && <div className={cl("empty")}>Nobody matches that.</div>}
            </div>
            <div className={cl("picker-foot")}>
                <Button size="xs" variant="secondary" onClick={() => onCycleMany(visibleIds, allTargets ? undefined : "target")}>
                    {allTargets ? "Untarget visible" : "Target visible"}
                </Button>
                <Button size="xs" variant="secondary" onClick={() => onCycleMany(visibleIds, allMembers ? undefined : "member")}>
                    {allMembers ? "Unlist visible" : "Add visible as members"}
                </Button>
                <Button size="xs" variant="secondary" disabled={!roles.size} onClick={onClearAll}>
                    Clear
                </Button>
            </div>
        </div>
    );
}
