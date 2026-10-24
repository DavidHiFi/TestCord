/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { playAudio } from "@api/AudioPlayer";
import { type NavContextMenuPatchCallback } from "@api/ContextMenu";
import { Notifications } from "@api/index";
import { definePluginSettings } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import { Devs } from "@utils/constants";
import { getCurrentChannel } from "@utils/discord";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import type { Channel, Message } from "@vencord/discord-types";
import { ChannelActionCreators, ChannelStore, GuildMemberStore, Menu, MessageStore, NavigationRouter, PresenceStore, UserGuildSettingsStore, UserStore, WindowStore } from "@webpack/common";
import { JSX } from "react";

interface IMessageCreate {
    channelId: string;
    guildId: string;
    message: Message;
}

interface MessageWithMentions extends Omit<Message, "mentionEveryone" | "mentionRoles" | "mentions"> {
    mention_everyone: boolean;
    mention_roles: string[];
    mentions: Array<string | { id: string; }>;
}

const SILENT_PING_FLAG = 1 << 12;

const StatusSetting = getUserSettingLazy<string>("status", "status")!;

function getSelectedStatus(userId: string) {
    try {
        return StatusSetting.getSetting() || PresenceStore.getStatus(userId);
    } catch {
        return PresenceStore.getStatus(userId);
    }
}

function DisabledIcon(): JSX.Element {
    return (
        <svg
            width="18"
            height="18"
        >
            <circle cx="9" cy="9" r="8" fill="var(--status-danger)" />
            <circle cx="9" cy="9" r="3.75" fill="white" />
        </svg>
    );
}

function EnabledIcon(): JSX.Element {
    return (
        <svg
            width="18"
            height="18"
        >
            <circle cx="9" cy="9" r="8" fill="currentColor" />
            <circle cx="9" cy="9" r="3.75" fill="black" />
        </svg>
    );
}

function processIds(value: string): string {
    return value.replace(/\s/g, "").split(",").filter(id => id.trim() !== "").join(", ");
}

function isMentioned(message: MessageWithMentions, channel: Channel | undefined, currentUserId: string) {
    const storedMessage = MessageStore.getMessage(message.channel_id, message.id);
    if (storedMessage?.mentioned === true) return true;
    const directMention = message.mentions?.some((mention: string | { id: string; }) => (typeof mention === "string" ? mention : mention?.id) === currentUserId);
    if (directMention) return true;

    const guildId = channel?.guild_id;
    if (guildId == null) return false;

    const memberRoles = GuildMemberStore.getMember(guildId, currentUserId)?.roles ?? [];
    if (!UserGuildSettingsStore.isSuppressRolesEnabled(guildId) && message.mention_roles?.some(roleId => memberRoles.includes(roleId))) return true;

    return message.mention_everyone === true && !UserGuildSettingsStore.isSuppressEveryoneEnabled(guildId);
}

async function showNotification(message: Message, guildId: string | undefined): Promise<void> {
    try {
        const channel = ChannelStore.getChannel(message.channel_id);
        const channelRegex = /<#(\d{17,20})>/g;
        const userRegex = /<@!?(\d{17,20})>/g;

        const body = (message.content || "")
            .replace(channelRegex, (_match, channelId: string) => `#${ChannelStore.getChannel(channelId)?.name ?? channelId}`)
            .replace(userRegex, (_match, userId: string) => {
                const user = UserStore.getUser(userId);
                return `@${user?.globalName || user?.username || userId}`;
            })
            || (message.attachments?.length ? "Sent an attachment" : "Sent a message");

        await Notifications.showNotification({
            title: `${(message.author as any).globalName} ${guildId ? `(#${channel?.name}, ${ChannelStore.getChannel(channel?.parent_id)?.name})` : ""}`,
            body,
            icon: UserStore.getUser(message.author.id).getAvatarURL(undefined, undefined, false),
            onClick: function (): void {
                NavigationRouter.transitionTo(`/channels/${guildId ?? "@me"}/${message.channel_id}/${message.id}`);
            }
        });

        if (settings.store.notificationSound) {
            playAudio("message1");
        }
    } catch (error) {
        new Logger("BypassStatus").error("Failed to notify user: ", error);
    }
}

function ContextCallback(name: "guild" | "user" | "channel"): NavContextMenuPatchCallback {
    return (children, props) => {
        const type = props[name];
        if (!type) return;
        const enabled = settings.store[`${name}s`].split(", ").includes(type.id);
        if (name === "user" && type.id === UserStore.getCurrentUser().id) return;
        children.splice(-1, 0, (
            <Menu.MenuGroup>
                <Menu.MenuItem
                    id={`status-${name}-bypass`}
                    label={`${enabled ? "Remove" : "Add"} Status Bypass`}
                    icon={enabled ? EnabledIcon : DisabledIcon}
                    leadingAccessory={{ type: "icon", icon: enabled ? EnabledIcon : DisabledIcon }}
                    action={() => {
                        let bypasses: string[] = settings.store[`${name}s`].split(", ");
                        if (enabled) bypasses = bypasses.filter(id => id !== type.id);
                        else bypasses.push(type.id);
                        settings.store[`${name}s`] = bypasses.filter(id => id.trim() !== "").join(", ");
                    }}
                />
            </Menu.MenuGroup>
        ));
    };
}

const settings = definePluginSettings({
    guilds: {
        type: OptionType.STRING,
        description: "Guilds to let bypass (notified when pinged anywhere in guild)",
        default: "",
        placeholder: "Separate with commas",
        onChange: value => settings.store.guilds = processIds(value)
    },
    channels: {
        type: OptionType.STRING,
        description: "Channels to let bypass (notified when pinged in that channel)",
        default: "",
        placeholder: "Separate with commas",
        onChange: value => settings.store.channels = processIds(value)
    },
    users: {
        type: OptionType.STRING,
        description: "Users to let bypass (notified for all messages sent in DMs)",
        default: "",
        placeholder: "Separate with commas",
        onChange: value => settings.store.users = processIds(value)
    },
    allowOutsideOfDms: {
        type: OptionType.BOOLEAN,
        description: "Allow selected users to bypass status outside of DMs too (acts like a channel/guild bypass, but it's for all messages sent by the selected users)"
    },
    notificationSound: {
        type: OptionType.BOOLEAN,
        description: "Whether the notification sound should be played",
        default: true,
    },
    respectSilentPings: {
        type: OptionType.BOOLEAN,
        description: "Respect silent pings (@silent / suppress notifications)",
        default: true
    },
    statusToUse: {
        type: OptionType.SELECT,
        description: "Status to use for whitelist",
        options: [
            {
                label: "Online",
                value: "online",
            },
            {
                label: "Idle",
                value: "idle",
            },
            {
                label: "Do Not Disturb",
                value: "dnd",
                default: true
            },
            {
                label: "Invisible",
                value: "invisible",
            }
        ]
    }
});

export default definePlugin({
    id: "BypassStatus",
    name: "BypassStatus",
    description: "Still get notifications from specific sources when in do not disturb mode. Right-click on users/channels/guilds to set them to bypass do not disturb mode.",
    tags: ["Activity", "Customisation", "Notifications", "Servers"],
    authors: [Devs.Inbestigator],
    dependencies: ["AudioPlayerAPI", "UserSettingsAPI"],
    flux: {
        async MESSAGE_CREATE({ message, guildId, channelId }: IMessageCreate): Promise<void> {
            try {
                const currentUser = UserStore.getCurrentUser();
                const userStatus = getSelectedStatus(currentUser.id);
                const currentChannelId = getCurrentChannel()?.id ?? "0";
                if (message.state === "SENDING" || !message.author || message.author.id === currentUser.id || (channelId === currentChannelId && WindowStore.isFocused()) || userStatus !== settings.store.statusToUse) {
                    return;
                }
                if (settings.store.respectSilentPings && (message.flags & SILENT_PING_FLAG)) { return; }
                const channel = ChannelStore.getChannel(channelId);
                const mentioned = isMentioned(message as unknown as MessageWithMentions, channel, currentUser.id);
                if ((settings.store.guilds.split(", ").includes(guildId) || settings.store.channels.split(", ").includes(channelId)) && mentioned) {
                    await showNotification(message, guildId);
                } else if (settings.store.users.split(", ").includes(message.author.id)) {
                    const userChannelId = await ChannelActionCreators.getOrEnsurePrivateChannel(message.author.id);
                    if (channelId === userChannelId || (mentioned && settings.store.allowOutsideOfDms === true)) {
                        await showNotification(message, guildId);
                    }
                }
            } catch (error) {
                new Logger("BypassStatus").error("Failed to handle message: ", error);
            }
        }
    },
    settings,
    contextMenus: {
        "guild-context": ContextCallback("guild"),
        "channel-context": ContextCallback("channel"),
        "user-context": ContextCallback("user"),
    }
});
