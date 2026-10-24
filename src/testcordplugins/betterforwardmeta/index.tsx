/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, DateUtils, GuildStore, IconUtils, NavigationRouter, Popout, SelectedGuildStore, SnowflakeUtils, Text, useRef, UserStore, useStateFromStores } from "@webpack/common";

import { Chevron, cl, ServerProfile } from "./utils";

const TEXT_CHANNELS = [0, 2, 5, 13, 15, 16];
const THREAD_CHANNELS = [10, 11, 12];

const settings = definePluginSettings({
    showGuild: {
        description: "Show the server the message came from",
        type: OptionType.BOOLEAN,
        default: true
    },
    showChannel: {
        description: "Show the channel the message came from",
        type: OptionType.BOOLEAN,
        default: true
    },
    showTime: {
        description: "Always show when the message was sent, even if Discord hides it",
        type: OptionType.BOOLEAN,
        default: true
    }
});

function describeChannel(channel: { type: number; name?: string; recipients?: string[] }) {
    if (TEXT_CHANNELS.includes(channel.type)) return `#${channel.name}`;
    if (THREAD_CHANNELS.includes(channel.type)) return channel.name ?? "thread";

    if (channel.type === 1) {
        const recipient = channel.recipients?.[0] ? UserStore.getUser(channel.recipients[0]) : null;
        return `@${recipient?.globalName || recipient?.username || "unknown"}`;
    }

    if (channel.type === 3) {
        if (channel.name) return channel.name;
        const names = (channel.recipients ?? [])
            .map(id => UserStore.getUser(id))
            .filter(Boolean)
            .map(user => user!.globalName || user!.username);
        return names.join(", ") || "group";
    }

    return channel.name ?? "unknown";
}

const GuildLink = ErrorBoundary.wrap(function GuildLink({ guildId }: { guildId: string }) {
    const guild = useStateFromStores([GuildStore], () => GuildStore.getGuild(guildId));
    const ref = useRef<HTMLDivElement>(null);
    if (!guild) return null;

    return (
        <Popout
            position="top"
            renderPopout={() => <ServerProfile guildId={guildId} />}
            targetElementRef={ref}
        >
            {popoutProps => (
                <div ref={ref} className={cl("element")} {...popoutProps}>
                    {guild.icon && (
                        <img
                            src={IconUtils.getGuildIconURL({ id: guild.id, icon: guild.icon, canAnimate: true, size: 32 })}
                            alt=""
                            className={cl("icon")}
                        />
                    )}
                    <Text variant="text-sm/medium" className={cl("text")} style={{ marginLeft: guild.icon ? 20 : 0 }}>
                        {guild.name}
                    </Text>
                    <Chevron />
                </div>
            )}
        </Popout>
    );
}, { noop: true });

export default definePlugin({
    id: "BetterForwardMeta",
    name: "BetterForwardMeta",
    description: "Add the origin server, channel and time to forwarded messages",
    tags: ["Chat", "Utility"],
    authors: [TestcordDevs.x2b],
    settings,

    ForwardFooter(message: any) {
        const { guild_id, channel_id, message_id } = message.message.messageReference;
        const channel = useStateFromStores([ChannelStore], () => ChannelStore.getChannel(channel_id));
        const { showGuild, showChannel, showTime } = settings.plain;
        const currentGuild = SelectedGuildStore.getGuildId();

        return (
            <div className={cl("footer")}>
                {showGuild && guild_id && guild_id !== currentGuild && <GuildLink guildId={guild_id} />}

                {showChannel && channel && (
                    <div
                        className={cl("element")}
                        onClick={() => NavigationRouter.transitionTo(`/channels/${guild_id ?? "@me"}/${channel_id}/${message_id}`)}
                    >
                        <Text variant="text-sm/medium" className={cl("text")}>
                            {describeChannel(channel)}
                        </Text>
                        <Chevron />
                    </div>
                )}

                {showTime && (
                    <div className={cl("element", { static: true })}>
                        <Text variant="text-sm/medium" className={cl("text")}>
                            {DateUtils.calendarFormat(new Date(SnowflakeUtils.extractTimestamp(message_id)))}
                        </Text>
                    </div>
                )}
            </div>
        );
    },

    patches: [
        {
            find: "originLabel:e.name,originIconUrl",
            replacement: {
                match: /let\{message:\i,snapshot:\i,index:\i\}=(\i)/,
                replace: "return $self.ForwardFooter($1);$&"
            }
        }
    ]
});
