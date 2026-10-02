/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Badge } from "@components/Badge";
import { Button } from "@components/Button";
import { copyWithToast } from "@utils/discord";
import { pluralize } from "@utils/misc";
import { ChannelStore, showToast, TextInput, Toasts, useMemo, useState, useStateFromStores } from "@webpack/common";

import { isGivenUp, log, notify, resetReaddCounts, syncGroup } from "../actions";
import { addMembers, describeUser, getErrorMessage, getFriends, getGroupName, openChannel, recipientIds, removeMembers, selfId } from "../api";
import { settings } from "../settings";
import { GctrapStore } from "../store";
import { cycleRole, GROUP_MODES, GroupConfig, GroupMode, Role, rolesToLists, setManyRoles } from "../types";
import { cl, GroupAvatar, STATUS_COLORS } from "../utils";
import UserPicker from "./UserPicker";

function Field({ label, value, onCommit, min = 0, max = 99999 }: {
    label: string;
    value: number;
    onCommit(value: number): void;
    min?: number;
    max?: number;
}) {
    const [text, setText] = useState(String(value));

    return (
        <label className={cl("field")}>
            <span className={cl("field-label")}>{label}</span>
            <TextInput
                type="number"
                value={text}
                min={min}
                max={max}
                onChange={setText}
                onBlur={() => {
                    const next = Number.parseInt(text, 10);
                    if (Number.isNaN(next)) {
                        setText(String(value));
                        return;
                    }
                    const clamped = Math.min(max, Math.max(min, next));
                    setText(String(clamped));
                    if (clamped !== value) onCommit(clamped);
                }}
            />
        </label>
    );
}

function MemberChip({ userId, role, onRemove }: { userId: string; role: Role; onRemove(): void; }) {
    const member = describeUser(userId);
    return (
        <span className={cl("chip", { [role]: true })}>
            <span className={cl("dot")} style={{ background: STATUS_COLORS[member.status] }} />
            <span className={cl("chip-name")}>{member.name}</span>
            <span className={cl("chip-role")}>{role}</span>
            <button className={cl("chip-x")} onClick={onRemove} aria-label={`Remove ${member.name} from the ${role} list`}>×</button>
        </span>
    );
}

interface GroupCardProps {
    group: GroupConfig;
}

export default function GroupCard({ group }: GroupCardProps) {
    const present = useStateFromStores([ChannelStore], () => recipientIds(ChannelStore.getChannel(group.id)));
    const [label, setLabel] = useState(group.label ?? "");
    const [roles, setRoles] = useState<Map<string, Role>>(() => new Map([
        ...group.targets.map((id): [string, Role] => [id, "target"]),
        ...group.members.map((id): [string, Role] => [id, "member"])
    ]));
    const [adding, setAdding] = useState(false);
    const [busy, setBusy] = useState("");

    const channel = ChannelStore.getChannel(group.id);
    const name = group.label || getGroupName(channel);
    const known = useMemo(() => new Set([...group.targets, ...group.members, selfId()]), [group.targets, group.members]);

    const missing = group.targets.filter(id => !present.includes(id));
    const strangers = present.filter(id => !known.has(id));
    const stopped = group.targets.filter(id => isGivenUp(group.id, id));
    const absent = group.members.filter(id => !present.includes(id));
    const friends = adding ? getFriends() : [];

    const update = (patch: Partial<GroupConfig>) => GctrapStore.getState().upsertGroup({ ...group, ...patch });

    async function run(task: () => Promise<void>) {
        setBusy("Working");
        try {
            await task();
        } catch (err) {
            showToast(getErrorMessage(err), Toasts.Type.FAILURE);
            log(group, getErrorMessage(err), "error");
        } finally {
            setBusy("");
        }
    }

    return (
        <div className={cl("card")}>
            <div className={cl("card-head")}>
                <GroupAvatar channel={channel} />
                <div className={cl("card-titles")}>
                    <TextInput
                        placeholder={getGroupName(channel)}
                        value={label}
                        onChange={setLabel}
                        onBlur={() => label.trim() !== (group.label ?? "") && update({ label: label.trim() || undefined })}
                    />
                    <span className={cl("card-sub")}>
                        {name} {"·"} {pluralize(group.targets.length, "target")} {"·"} {pluralize(group.members.length, "member")} {"·"} {pluralize(present.length, "person")} in the group
                    </span>
                </div>
                <div className={cl("card-actions")}>
                    <Button size="xs" variant="secondary" onClick={() => openChannel(group.id)}>Open</Button>
                    <Button size="xs" variant="secondary" onClick={() => copyWithToast(group.id, "Copied the group ID")}>Copy ID</Button>
                    <Button
                        size="xs"
                        variant="dangerSecondary"
                        onClick={() => {
                            GctrapStore.getState().removeGroup(group.id);
                            notify("Stopped tracking", `${name} is off the dashboard now.`);
                        }}
                    >
                        Forget
                    </Button>
                </div>
            </div>

            <div className={cl("row")}>
                {(Object.keys(GROUP_MODES) as GroupMode[]).map(mode => (
                    <Button key={mode} size="xs" variant={group.mode === mode ? "primary" : "secondary"} onClick={() => update({ mode })}>
                        {GROUP_MODES[mode]}
                    </Button>
                ))}
                <Field label="Re-add limit" value={group.readdLimit} max={100} onCommit={readdLimit => update({ readdLimit })} />
                <Field label="Re-add delay" value={group.readdDelay} max={5000} onCommit={readdDelay => update({ readdDelay })} />
            </div>

            <div className={cl("row")}>
                <Badge text={pluralize(missing.length, "target out")} variant={missing.length ? "warning" : "default"} />
                <span className={cl("hint")}>walked out and will be put back</span>
                <Badge text={pluralize(strangers.length, "stranger")} variant={strangers.length ? "danger" : "default"} />
                <span className={cl("hint")}>not on either list</span>
                {!!absent.length && <Badge text={pluralize(absent.length, "member out")} variant="default" />}
                {stopped.length > 0 && <Badge text={`${stopped.length} given up on`} variant="warning" />}
            </div>

            <div className={cl("row")}>
                <Button
                    size="xs"
                    variant="primary"
                    disabled={!!busy}
                    onClick={() => run(async () => showToast(await syncGroup(group), Toasts.Type.SUCCESS))}
                >
                    {busy || "Sync now"}
                </Button>
                <Button
                    size="xs"
                    variant="secondary"
                    disabled={!strangers.length || group.mode === "addonly" || group.mode === "off"}
                    onClick={() => run(async () => {
                        const { removed } = await removeMembers(group.id, strangers, settings.store.memberSize, settings.store.addDelay);
                        log(group, `Kicked ${pluralize(removed, "stranger")}`, "action");
                    })}
                >
                    Kick strangers
                </Button>
                <Button
                    size="xs"
                    variant="secondary"
                    disabled={!missing.length || group.mode === "kickonly" || group.mode === "off"}
                    onClick={() => run(async () => {
                        const { added } = await addMembers(group.id, missing, settings.store.memberSize, settings.store.addDelay);
                        log(group, `Put ${pluralize(added, "target")} back in`, "action");
                    })}
                >
                    Put targets back
                </Button>
                <Button size="xs" variant="secondary" onClick={() => resetReaddCounts(group)}>
                    Reset counters
                </Button>
                <Button size="xs" variant="secondary" onClick={() => setAdding(!adding)}>
                    {adding ? "Done" : "Edit lists"}
                </Button>
            </div>

            {adding ? (
                <div className={cl("list-editor")}>
                    <div className={cl("hint")}>
                        Targets get put back in when they leave, and anyone they add gets kicked. Members are left alone, and
                        anyone they add is taken as a member.
                    </div>
                    <UserPicker
                        friends={friends}
                        roles={roles}
                        onCycle={userId => setRoles(current => cycleRole(current, userId))}
                        onCycleMany={(ids, role) => setRoles(current => setManyRoles(current, ids, role))}
                        onClearAll={() => setRoles(new Map())}
                    />
                    <Button
                        size="xs"
                        variant="primary"
                        onClick={() => {
                            const { targets, members } = rolesToLists(roles);
                            update({ targets, members });
                            setAdding(false);
                            showToast(`Saved ${pluralize(targets.length, "target")} and ${pluralize(members.length, "member")}`, Toasts.Type.SUCCESS);
                        }}
                    >
                        Save lists
                    </Button>
                </div>
            ) : (
                <div className={cl("chips-wrap")}>
                    <div className={cl("chips")}>
                        <span className={cl("chips-label")}>Targets</span>
                        {group.targets.map(id => (
                            <MemberChip
                                key={id}
                                userId={id}
                                role="target"
                                onRemove={() => update({ targets: group.targets.filter(member => member !== id) })}
                            />
                        ))}
                        {!group.targets.length && <span className={cl("hint")}>No targets yet, so anyone who joins gets kicked.</span>}
                    </div>
                    <div className={cl("chips")}>
                        <span className={cl("chips-label")}>Members</span>
                        {group.members.map(id => (
                            <MemberChip
                                key={id}
                                userId={id}
                                role="member"
                                onRemove={() => update({ members: group.members.filter(member => member !== id) })}
                            />
                        ))}
                        {!group.members.length && <span className={cl("hint")}>No members yet, so only you can add people safely.</span>}
                    </div>
                </div>
            )}
        </div>
    );
}
