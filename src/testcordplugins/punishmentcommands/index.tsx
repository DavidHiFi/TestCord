/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { sendMessage } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import { Menu, SelectedChannelStore, SelectedGuildStore, showToast, Toasts } from "@webpack/common";

import { openPunishModal } from "./Modals";

const settings = definePluginSettings({
    command: {
        description: "Command prefix the bot listens for",
        type: OptionType.STRING,
        default: "+Cg"
    },
    guildIds: {
        description: "Only offer these in these servers (comma separated, empty for everywhere)",
        type: OptionType.STRING,
        default: ""
    },
    channelId: {
        description: "Send the command here instead of whatever channel you are in",
        type: OptionType.STRING,
        default: ""
    },
    durations: {
        description: "Mute lengths to offer in the menu (comma separated)",
        type: OptionType.STRING,
        default: "10m,1h,6h,12h,1d,7d"
    },
    confirm: {
        description: "Tell me when a command was sent",
        type: OptionType.BOOLEAN,
        default: true
    }
});

function listed(value: string) {
    return value.split(",").map(entry => entry.trim()).filter(Boolean);
}

export default definePlugin({
    id: "PunishmentCommands",
    name: "PunishmentCommands",
    description: "Run punishment bot commands from the user context menu",
    tags: ["Servers", "Commands"],
    authors: [TestcordDevs.x2b],
    settings,

    contextMenus: {
        "user-context"(children, { user }: { user?: { id: string; username: string } }) {
            if (!user) return;

            const { guildIds, command, channelId, confirm } = settings.plain;
            const currentGuild = SelectedGuildStore.getGuildId();
            if (guildIds && (!currentGuild || !listed(guildIds).includes(currentGuild))) return;

            const punish = (duration?: string) => openPunishModal({
                username: user.username,
                presetDuration: duration,
                onSubmit: async (chosen, reason) => {
                    const channel = channelId || SelectedChannelStore.getChannelId();
                    if (!channel) throw new Error("No channel to send the command to");

                    await sendMessage(channel, {
                        content: [command, user.id, chosen, reason].filter(Boolean).join(" ")
                    });

                    if (confirm) showToast(`Punished ${user.username}`, Toasts.Type.SUCCESS);
                }
            });

            children.splice(-3, 0,
                <Menu.MenuGroup id="vc-punish" label="Punish">
                    {listed(settings.plain.durations).map(duration => (
                        <Menu.MenuItem
                            key={duration}
                            id={`vc-punish-${duration}`}
                            label={`Mute for ${duration}`}
                            color="var(--danger, #f23f43)"
                            action={() => punish(duration)}
                        />
                    ))}
                    <Menu.MenuSeparator />
                    <Menu.MenuItem
                        id="vc-punish-custom"
                        label="Mute (custom duration)"
                        color="var(--danger, #f23f43)"
                        action={() => punish()}
                    />
                </Menu.MenuGroup>
            );
        }
    }
});
