/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { Heading } from "@components/Heading";
import { pluralize } from "@utils/misc";
import { ChannelStore, SearchableSelect, showToast, TextInput, Toasts, useState } from "@webpack/common";

import {
    addMembers,
    chunk,
    createGroup,
    getErrorMessage,
    getFriends,
    getGroupName,
    joinByInvite,
    listGroups,
    openChannel,
    recipientIds,
    selfId
} from "../api";
import { settings } from "../settings";
import { GctrapStore } from "../store";
import { cycleRole, GROUP_MODES, GroupMode, isGroupMode, Role, rolesToLists, setManyRoles } from "../types";
import { cl } from "../utils";
import UserPicker from "./UserPicker";

const BUILT_IN_PRESETS = ["Everyone", "Online", "Idle", "Do Not Disturb", "In Voice"] as const;
const STATUS_BY_PRESET: Record<string, "online" | "idle" | "dnd"> = {
    Online: "online",
    Idle: "idle",
    "Do Not Disturb": "dnd"
};
const GROUP_MEMBER_LIMIT = 10;

function parseInviteCode(input: string): string {
    const trimmed = input.trim();
    const match = trimmed.match(/(?:discord\.gg|discord(?:app)?\.com\/invite|discord\.com\/invite)\/([\w-]{1,30})/i);
    return match?.[1] ?? trimmed.replace(/^\/+|\/+$/g, "");
}

function selectedIdsFor(preset: string, friends: ReturnType<typeof getFriends>, saved: readonly { name: string; ids: string[]; }[]): string[] {
    const stored = saved.find(item => item.name === preset);
    if (stored) return stored.ids;
    if (preset === "Everyone") return friends.map(friend => friend.id);
    if (preset === "In Voice") return friends.filter(friend => friend.inVoice).map(friend => friend.id);
    const status = STATUS_BY_PRESET[preset];
    if (status) return friends.filter(friend => friend.status === status).map(friend => friend.id);
    return [];
}

const MEMBER_SIZE: ["memberSize"] = ["memberSize"];

interface NewTabProps {
    onTrack(channelId: string, members: string[], name: string): void;
}

export default function NewTab({ onTrack }: NewTabProps) {
    const presets = GctrapStore(state => state.presets);
    const tracked = GctrapStore(state => state.groups);
    const { memberSize } = settings.use(MEMBER_SIZE);
    const [friends, setFriends] = useState(getFriends);
    const [roles, setRoles] = useState<Map<string, Role>>(() => new Map());
    const [preset, setPreset] = useState<string>("Everyone");
    const [mode, setMode] = useState<GroupMode>(isGroupMode(settings.store.defaultMode) ? settings.store.defaultMode : "strict");
    const [name, setName] = useState("");
    const [presetName, setPresetName] = useState("");
    const [invite, setInvite] = useState("");
    const [trackId, setTrackId] = useState("");
    const [busy, setBusy] = useState("");
    const [error, setError] = useState("");

    const presetNames = [...BUILT_IN_PRESETS, ...presets.map(item => item.name)];
    const untracked = listGroups().filter(group => !tracked.some(item => item.id === group.id));
    const selected = [...roles.keys()];
    const targetCount = [...roles.values()].filter(role => role === "target").length;
    const memberCount = [...roles.values()].filter(role => role === "member").length;

    const setSelection = (ids: readonly string[]) => setRoles(new Map(ids.map(id => [id, "target" as Role])));
    const bulkToggle = (ids: readonly string[], add: boolean) =>
        setRoles(current => setManyRoles(current, ids, add ? "target" : undefined));

    function applyPreset(next: string) {
        setPreset(next);
        setSelection(selectedIdsFor(next, friends, presets));
    }

    async function run(label: string, task: () => Promise<void>) {
        setBusy(label);
        setError("");
        try {
            await task();
        } catch (err) {
            setError(getErrorMessage(err));
        } finally {
            setBusy("");
        }
    }

    async function create() {
        if (!selected.length) {
            setError("Pick at least one friend to add.");
            return;
        }
        if (!targetCount) {
            setError("Mark at least one person as a target, otherwise gctrap has nobody to hold in place.");
            return;
        }
        await run("Creating the group", async () => {
            const { targets, members } = rolesToLists(roles);
            const [first, ...rest] = chunk(selected, perWave);
            const channelId = await createGroup(first, name);
            if (rest.length) await addMembers(channelId, rest.flat(), perWave, settings.store.addDelay);

            const label = name.trim();
            GctrapStore.getState().upsertGroup({
                id: channelId,
                label: label || undefined,
                mode,
                targets,
                members,
                readdLimit: settings.store.readdLimit,
                readdDelay: settings.store.readdDelay
            });
            GctrapStore.getState().addLog(
                label || "New group",
                "action",
                `Created with ${pluralize(targets.length, "target")} and ${pluralize(members.length, "member")}`
            );
            showToast("Group created and added to the dashboard", Toasts.Type.SUCCESS);
            openChannel(channelId);
        });
    }

    async function join() {
        const code = parseInviteCode(invite);
        if (!code) {
            setError("Paste an invite code or a full invite link.");
            return;
        }
        await run("Joining the group", async () => {
            const channelId = await joinByInvite(code);
            if (!channelId) {
                setError("Invite accepted but the group did not show up yet. Open it from your DM list.");
                return;
            }
            const channel = ChannelStore.getChannel(channelId);
            const members = recipientIds(channel).filter(id => id !== selfId());
            const label = getGroupName(channel);
            if (!tracked.some(item => item.id === channelId)) onTrack(channelId, members, label);
            showToast("Joined the group", Toasts.Type.SUCCESS);
            openChannel(channelId);
        });
    }

    function trackExisting() {
        const channel = ChannelStore.getChannel(trackId);
        if (!channel) return;
        onTrack(channel.id, recipientIds(channel).filter(id => id !== selfId()), getGroupName(channel));
        setTrackId("");
    }

    const perWave = Math.max(1, Math.min(memberSize - 1, GROUP_MEMBER_LIMIT - 1));
    const waves = Math.max(1, Math.ceil(selected.length / perWave));

    return (
        <div className={cl("new")}>
            <div className={cl("columns")}>
                <div className={cl("column")}>
                    <Heading tag="h5">Group name</Heading>
                    <TextInput
                        placeholder="Optional, shows up in the dashboard"
                        value={name}
                        maxLength={100}
                        onChange={setName}
                    />

                    <Heading tag="h5">Member preset</Heading>
                    <div className={cl("preset-row")}>
                        {presetNames.map(label => (
                            <Button
                                key={label}
                                size="xs"
                                variant={preset === label ? "primary" : "secondary"}
                                onClick={() => applyPreset(label)}
                            >
                                {label}
                            </Button>
                        ))}
                        <TextInput
                            placeholder="Name this selection"
                            value={presetName}
                            onChange={setPresetName}
                        />
                        <Button
                            size="small"
                            variant="secondary"
                            disabled={!presetName.trim() || !selected.length}
                            onClick={() => {
                                GctrapStore.getState().addPreset({ name: presetName.trim(), ids: [...selected] });
                                setPreset(presetName.trim());
                                setPresetName("");
                            }}
                        >
                            Save preset
                        </Button>
                    </div>
                    {!!presets.length && (
                        <div className={cl("preset-row")}>
                            {presets.map(item => (
                                <span key={item.name} className={cl("chip", { active: preset === item.name })}>
                                    <span className={cl("chip-name")} onClick={() => applyPreset(item.name)}>
                                        {item.name} ({item.ids.length})
                                    </span>
                                    <Button
                                        size="min"
                                        variant="secondary"
                                        aria-label={`Delete ${item.name}`}
                                        onClick={() => GctrapStore.getState().removePreset(item.name)}
                                    >
                                        ×
                                    </Button>
                                </span>
                            ))}
                        </div>
                    )}

                    <Heading tag="h5">Starting mode</Heading>
                    <div className={cl("preset-row")}>
                        {(Object.keys(GROUP_MODES) as GroupMode[]).map(value => (
                            <Button
                                key={value}
                                size="xs"
                                variant={mode === value ? "primary" : "secondary"}
                                onClick={() => setMode(value)}
                            >
                                {GROUP_MODES[value]}
                            </Button>
                        ))}
                    </div>

                    <div className={cl("hint")}>
                        {selected.length
                            ? `${pluralize(targetCount, "target")} and ${pluralize(memberCount, "member")} queued, that is ${pluralize(waves, "wave")} of at most ${pluralize(perWave, "person")} at a time.`
                            : "Nobody picked yet. Pick friends on the right or load a preset."}
                    </div>
                    <div className={cl("hint")}>
                        Targets are put back in when they leave, and anyone they add gets kicked. Members are left alone, and
                        anyone they add is taken as a member.
                    </div>
                    {error && <div className={cl("error")}>{error}</div>}
                    <Button
                        variant={busy ? "secondary" : "primary"}
                        disabled={!!busy || !selected.length}
                        onClick={create}
                    >
                        {busy || `Create group with ${pluralize(selected.length, "member")}`}
                    </Button>
                </div>

                <div className={cl("column")}>
                    <Heading tag="h5">
                        <span>Pick people ({friends.length} friends)</span>
                        <Button size="xs" variant="secondary" onClick={() => setFriends(getFriends())}>Refresh</Button>
                    </Heading>
                    <UserPicker
                        friends={friends}
                        roles={roles}
                        onCycle={userId => setRoles(current => cycleRole(current, userId))}
                        onCycleMany={(ids, role) => setRoles(current => setManyRoles(current, ids, role))}
                        onClearAll={() => setRoles(new Map())}
                    />
                </div>
            </div>

            <div className={cl("columns")}>
                <div className={cl("column")}>
                    <Heading tag="h5">Join by invite</Heading>
                    <TextInput
                        placeholder="discord.gg/invite or just the code"
                        value={invite}
                        onChange={setInvite}
                    />
                    <Button variant="secondary" disabled={!!busy} onClick={join}>
                        {busy || "Join and track"}
                    </Button>
                </div>

                <div className={cl("column")}>
                    <Heading tag="h5">Track a group you are already in</Heading>
                    <SearchableSelect
                        placeholder={untracked.length ? "Choose a group" : "No untracked groups"}
                        options={untracked.map(group => ({ value: group.id, label: getGroupName(group) }))}
                        value={trackId || undefined}
                        onChange={(value: string | undefined) => setTrackId(value ?? "")}
                        clearable={false}
                        maxVisibleItems={6}
                    />
                    <Button variant="secondary" disabled={!trackId} onClick={trackExisting}>
                        Add to dashboard
                    </Button>
                </div>
            </div>
        </div>
    );
}
