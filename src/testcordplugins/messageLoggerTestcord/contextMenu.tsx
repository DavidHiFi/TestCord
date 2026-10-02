/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addContextMenuPatch, type NavContextMenuPatchCallback,removeContextMenuPatch } from "@api/ContextMenu";
import { isPluginEnabled } from "@api/PluginManager";
import { Alerts, FluxDispatcher, Menu, MessageActions, React, SortedGuildStore, Toasts, UserStore } from "@webpack/common";

import { silentDeleteMessage } from "./antilog";
import { clearEditHistoryCache, deleteLog, invalidateLoggedCaches, localRemoveLoggedMessage, removeChannelLogs } from "./engine";
import { addToOppositeAndList, isInList, type ListType,removeFromList } from "./lists";
import { openLogs } from "./LogsModal";
import { osintScanLoggedMessages } from "./osintBridge";
import { settings } from "./settings";

interface MenuProps {
    navId?: string;
    message?: any;
    channel?: any;
    user?: any;
    guild?: any;
    folderId?: number;
}

const idFunctions: Record<string, (props: MenuProps) => string | string[] | null | undefined> = {
    Folder: props =>
        props?.folderId != null
            ? SortedGuildStore.getGuildFolders?.().find(f => f?.folderId === props.folderId)?.guildIds ?? null
            : null,
    Server: props => props?.guild?.id,
    User: props => props?.message?.author?.id || props?.user?.id,
    Channel: props => props?.message?.channel_id || props?.channel?.id
};

function renderOpenLogs(idType: string, props: MenuProps) {
    const id = idFunctions[idType]?.(props);
    if (!id || Array.isArray(id)) return null;

    return (
        <Menu.MenuItem
            key={`open-logs-${idType}`}
            id={`testcord-ml-open-logs-${idType.toLowerCase()}`}
            label={`Open Logs For ${idType}`}
            action={() => openLogs(`${idType === "Server" ? "guild" : idType.toLowerCase()}:${id}`)}
        />
    );
}

function renderListOption(listType: ListType, idType: string, props: MenuProps) {
    const rawId = idFunctions[idType]?.(props);
    if (!rawId || (Array.isArray(rawId) && rawId.length === 0)) return null;

    const ids = Array.isArray(rawId) ? rawId : [rawId];
    const isBlocked = ids.every(id => isInList(listType, id));
    const opposite: ListType = listType === "blacklistedIds" ? "whitelistedIds" : "blacklistedIds";
    const isOppositeBlocked = ids.some(id => isInList(opposite, id));
    const listLabel = listType === "blacklistedIds" ? "Blacklist" : "Whitelist";

    return (
        <Menu.MenuItem
            key={`${listType}-${idType}`}
            id={`testcord-ml-${listType}-${idType.toLowerCase()}`}
            label={
                isOppositeBlocked
                    ? `Move ${idType} to ${listLabel}`
                    : isBlocked ? `Remove ${idType} From ${listLabel}` : `${listLabel} ${idType}`
            }
            action={() => {
                if (isBlocked) ids.forEach(id => removeFromList(listType, id));
                else ids.forEach(id => addToOppositeAndList(listType, id));
                Toasts.show({
                    message: `${isBlocked ? "Removed from" : "Added to"} ${listLabel.toLowerCase()}.`,
                    type: Toasts.Type.SUCCESS,
                    id: `testcord-ml-list-${Date.now()}`
                });
            }}
        />
    );
}

function buildLoggedMessageItems(navId: string, props: MenuProps) {
    const { message } = props;
    if (navId !== "message" || !message) return null;
    if (!message.deleted && !(message.editHistory?.length > 0)) return null;

    // Show removal options for any logged deleted/edited message.
    // getCachedLoggedMessage is best-effort: after restart, older logs may be primed,
    // but we still allow removal via DB even if not in memory cache.

    return [
        <Menu.MenuSeparator key="sep-remove" />,
        message.deleted && (
            <Menu.MenuItem
                key="remove-message-temporary"
                id="testcord-ml-remove-message"
                label="Delete Message (Temporary)"
                color="danger"
                action={async () => {
                    invalidateLoggedCaches(message.id);
                    await localRemoveLoggedMessage(message.id, false, message.channel_id);
                    Toasts.show({
                        message: "Hidden from chat. It stays in your logs.",
                        type: Toasts.Type.SUCCESS,
                        id: Toasts.genId()
                    });
                }}
            />
        ),
        message.deleted && (
            <Menu.MenuItem
                key="remove-message-permanent"
                id="testcord-ml-remove-message-permanent"
                label="Delete Message (Forever)"
                color="danger"
                action={async () => {
                    invalidateLoggedCaches(message.id);
                    await localRemoveLoggedMessage(message.id, true, message.channel_id);
                    Toasts.show({
                        message: "Message deleted from your logs forever.",
                        type: Toasts.Type.SUCCESS,
                        id: Toasts.genId()
                    });
                }}
            />
        ),
        !message.deleted && (
            <Menu.MenuItem
                key="remove-history-temporary"
                id="testcord-ml-remove-history-temporary"
                label="Delete Message History (Temporary)"
                color="danger"
                action={async () => {
                    clearEditHistoryCache(message.id);
                    (message as any).editHistory = [];
                    FluxDispatcher.dispatch({
                        type: "MESSAGE_UPDATE",
                        message: { id: message.id, channel_id: message.channel_id, editHistory: [] }
                    });
                    Toasts.show({
                        message: "Hidden from chat. History stays in your logs.",
                        type: Toasts.Type.SUCCESS,
                        id: Toasts.genId()
                    });
                }}
            />
        ),
        !message.deleted && (
            <Menu.MenuItem
                key="remove-history-permanent"
                id="testcord-ml-remove-history-permanent"
                label="Delete Message History (Forever)"
                color="danger"
                action={async () => {
                    clearEditHistoryCache(message.id);
                    (message as any).editHistory = [];
                    await deleteLog(message.id);
                    FluxDispatcher.dispatch({
                        type: "MESSAGE_UPDATE",
                        message: { id: message.id, channel_id: message.channel_id, editHistory: [] }
                    });
                    Toasts.show({
                        message: "Edit history deleted from your logs forever.",
                        type: Toasts.Type.SUCCESS,
                        id: Toasts.genId()
                    });
                }}
            />
        )
    ].filter(Boolean);
}

function buildHideFromLoggersItem(navId: string, props: MenuProps) {
    const { message } = props;
    if (!settings.store.hideFromOtherLoggers) return null;
    if (navId !== "message" || !message || message.deleted) return null;
    if (message.author?.id !== UserStore.getCurrentUser()?.id) return null;

    return (
        <Menu.MenuItem
            key="hide-from-message-loggers"
            id="testcord-ml-hide-from-loggers"
            label="Delete Message (Hide From Message Loggers)"
            color="danger"
            action={async () => {
                try {
                    await MessageActions.deleteMessage(message.channel_id, message.id);
                    // Nonce replacement: loggers that dedupe by nonce overwrite the
                    // captured deleted content with the placeholder text.
                    await MessageActions._sendMessage(
                        message.channel_id,
                        {
                            content: settings.store.hideFromLoggersPlaceholder || "message deleted",
                            tts: false,
                            invalidEmojis: [],
                            validNonShortcutEmojis: []
                        },
                        { nonce: message.id }
                    );
                    invalidateLoggedCaches(message.id);
                    await localRemoveLoggedMessage(message.id, true, message.channel_id);
                    Toasts.show({
                        message: "Message deleted and hidden from other loggers.",
                        type: Toasts.Type.SUCCESS,
                        id: Toasts.genId()
                    });
                } catch {
                    Toasts.show({
                        message: "Failed to hide the message from other loggers.",
                        type: Toasts.Type.FAILURE,
                        id: Toasts.genId()
                    });
                }
            }}
        />
    );
}

function buildChannelClearItems(navId: string, props: MenuProps) {
    if (navId !== "channel-context" && navId !== "gdm-context") return null;
    const channelId = idFunctions.Channel(props);
    if (typeof channelId !== "string" || !channelId) return null;

    const run = async (permanent: boolean) => {
        try {
            const count = await removeChannelLogs(channelId, permanent);
            Toasts.show({
                message: count === 0
                    ? "No logs in this channel."
                    : permanent
                        ? `Deleted ${count} logs from this channel forever.`
                        : `Hidden ${count} logs from this channel. They return after a restart.`,
                type: count === 0 ? Toasts.Type.MESSAGE : Toasts.Type.SUCCESS,
                id: Toasts.genId()
            });
        } catch (error) {
            console.error("Failed to remove channel logs", error);
            Toasts.show({
                message: "Failed to remove logs from this channel.",
                type: Toasts.Type.FAILURE,
                id: Toasts.genId()
            });
        }
    };

    return [
        <Menu.MenuItem
            key="testcord-ml-clear-channel-temp"
            id="testcord-ml-clear-channel-temp"
            label="Rm All Channel Logs (Tmp)"
            color="danger"
            action={() => void run(false)}
        />,
        <Menu.MenuItem
            key="testcord-ml-clear-channel-permanent"
            id="testcord-ml-clear-channel-permanent"
            label="Rm All Channel Logs (Perm)"
            color="danger"
            action={() => Alerts.show({
                title: "Remove all channel logs",
                body: "This deletes every saved deleted message and edit history for this channel and cannot be undone.",
                confirmText: "Delete everything",
                confirmVariant: "critical-primary",
                cancelText: "Cancel",
                onConfirm: () => run(true)
            })}
        />
    ];
}

// The navId is the key a patch is registered under, never a field of the props Discord
// hands the callback. Reading props.navId yields undefined, which is what silently kept
// every navId-gated item from rendering.
function createContextMenuPatch(navId: string): NavContextMenuPatchCallback {
    return (children, props: MenuProps) => {
        if (!props || children.some(child => child?.props?.id === "testcord-ml-menu")) return;

        const isMessageMenu = navId === "message";
        const { message } = props;

        const showSilentDelete = isMessageMenu
            && settings.store.enableSilentDelete
            && message
            && !message.deleted
            && message.author?.id === UserStore.getCurrentUser()?.id
            && !isPluginEnabled("AntilogPremium");

        // Heavily used actions live at the top level for quick access
        const loggedItems = buildLoggedMessageItems(navId, props);
        const hideFromLoggersItem = buildHideFromLoggersItem(navId, props);

        children.push(
            loggedItems ? <React.Fragment key="testcord-ml-top">{loggedItems}</React.Fragment> : null,
            hideFromLoggersItem,
            <Menu.MenuSeparator key="testcord-ml-sep" />,
            <Menu.MenuItem
                key="testcord-ml-menu"
                id="testcord-ml-menu"
                label="Message Logger"
            >
                <Menu.MenuItem
                    id="testcord-ml-open-logs"
                    label="Open Logs"
                    action={() => openLogs()}
                />
                {Object.keys(idFunctions).map(IdType => renderOpenLogs(IdType, props))}
                {isMessageMenu && message && (
                    <Menu.MenuItem
                        id="testcord-ml-open-logs-author"
                        label="Open Logs For Author"
                        action={() => openLogs(`from:${message.author.id}`)}
                    />
                )}

                {buildChannelClearItems(navId, props)}

                <Menu.MenuSeparator />
                {Object.keys(idFunctions).map(IdType => renderListOption("blacklistedIds", IdType, props))}
                {Object.keys(idFunctions).map(IdType => renderListOption("whitelistedIds", IdType, props))}

                {isMessageMenu && message && (
                    <>
                        <Menu.MenuSeparator />
                        <Menu.MenuItem
                            id="testcord-ml-osint-logged"
                            label="OSINT Analyze Logged Messages"
                            action={() => void osintScanLoggedMessages(message.author.id)}
                        />
                        <Menu.MenuItem
                            id="testcord-ml-osint-full"
                            label="Full OSINT Scan Of Author"
                            action={() => {
                                void import("../testcordosinttoolkit/index").then(({ openOsintScanFor }) =>
                                    openOsintScanFor(message.author.id, message.channel_id)
                                );
                            }}
                        />
                    </>
                )}

                {showSilentDelete && (
                    <>
                        <Menu.MenuSeparator />
                        <Menu.MenuItem
                            id="testcord-ml-silent-delete"
                            label={<span style={{ color: "var(--status-danger)" }}>Silent Delete</span>}
                            color="danger"
                            action={() => {
                                void silentDeleteMessage(message.channel_id, message.id).then(ok =>
                                    Toasts.show({
                                        message: ok ? "Message silently deleted." : "Silent delete failed.",
                                        type: ok ? Toasts.Type.SUCCESS : Toasts.Type.FAILURE,
                                        id: Toasts.genId()
                                    })
                                );
                            }}
                        />
                    </>
                )}
            </Menu.MenuItem>
        );
    };
}

const PATCHED_MENUS = ["message", "channel-context", "user-context", "guild-context", "gdm-context"] as const;

const menuPatches = new Map<string, NavContextMenuPatchCallback>();

export function setupLoggerContextMenus() {
    for (const menu of PATCHED_MENUS) {
        const patch = createContextMenuPatch(menu);
        menuPatches.set(menu, patch);
        addContextMenuPatch(menu, patch);
    }
}

export function removeLoggerContextMenus() {
    for (const menu of PATCHED_MENUS) {
        const patch = menuPatches.get(menu);
        if (patch) removeContextMenuPatch(menu, patch);
    }
    menuPatches.clear();
}
