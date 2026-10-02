/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { pluralize } from "@utils/misc";
import { SearchableSelect, showToast, TextInput, Toasts, useState } from "@webpack/common";

import { syncGroup } from "../actions";
import { getErrorMessage, getGroupName, listGroups } from "../api";
import { settings } from "../settings";
import { GctrapStore } from "../store";
import { cl } from "../utils";
import GroupCard from "./GroupCard";
import LogTab from "./LogTab";

export function UntrackedPicker({ onTrack }: { onTrack(channelId: string): void; }) {
    const tracked = GctrapStore(state => state.groups);
    const [trackId, setTrackId] = useState("");

    const untracked = listGroups().filter(group => !tracked.some(item => item.id === group.id));
    if (!untracked.length) return null;

    return (
        <div className={cl("track-row")}>
            <SearchableSelect
                placeholder="Track a group you are already in"
                options={untracked.map(group => ({ value: group.id, label: getGroupName(group) }))}
                value={trackId || undefined}
                onChange={(value: string | undefined) => setTrackId(value ?? "")}
                clearable={false}
                maxVisibleItems={6}
            />
            <Button size="xs" variant="secondary" disabled={!trackId} onClick={() => onTrack(trackId)}>
                Add to dashboard
            </Button>
        </div>
    );
}

const SHOW_STATS: ["showStats"] = ["showStats"];

interface DashboardTabProps {
    onCreate(): void;
    onTrack(channelId: string): void;
}

export default function DashboardTab({ onCreate, onTrack }: DashboardTabProps) {
    const groups = GctrapStore(state => state.groups);
    const log = GctrapStore(state => state.log);
    const { showStats } = settings.use(SHOW_STATS);
    const [query, setQuery] = useState("");
    const [busy, setBusy] = useState(false);

    const memberCount = new Set(groups.flatMap(group => group.members)).size;
    const visible = groups.filter(group => {
        const needle = query.trim().toLowerCase();
        if (!needle) return true;
        return (group.label ?? "").toLowerCase().includes(needle) || group.id.includes(needle) || group.members.some(id => id.includes(needle));
    });

    async function syncAll() {
        setBusy(true);
        for (const group of groups) {
            try {
                await syncGroup(group);
            } catch (err) {
                showToast(`Could not sync ${group.label ?? group.id}: ${getErrorMessage(err)}`, Toasts.Type.FAILURE);
            }
        }
        setBusy(false);
        showToast(`Synced ${pluralize(groups.length, "group")}`, Toasts.Type.SUCCESS);
    }

    return (
        <div className={cl("dash")}>
            {showStats && (
                <div className={cl("stats")}>
                    <span className={cl("stat")}>{pluralize(groups.length, "group")} tracked</span>
                    <span className={cl("stat")}>{pluralize(memberCount, "member")} on the lists</span>
                    <span className={cl("stat")}>{pluralize(log.length, "event")} logged</span>
                </div>
            )}

            <div className={cl("dash-tools")}>
                <TextInput placeholder="Search by name, ID or member" value={query} onChange={setQuery} />
                <Button variant="primary" onClick={onCreate}>New group</Button>
                <Button variant="secondary" disabled={busy || !groups.length} onClick={syncAll}>
                    {busy ? "Syncing" : "Sync all"}
                </Button>
            </div>

            {visible.map(group => <GroupCard key={group.id} group={group} />)}
            {!visible.length && (
                <div className={cl("empty")}>
                    {groups.length ? "No tracked group matches that." : "Nothing tracked yet, make a group or add one you are already in."}
                </div>
            )}

            <UntrackedPicker onTrack={onTrack} />
            <LogTab />
        </div>
    );
}
