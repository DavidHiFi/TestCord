/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { openUserProfile } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import { showToast, Toasts, UserStore } from "@webpack/common";

const settings = definePluginSettings({
    ids: {
        description: "Every account ID they have used (comma separated)",
        type: OptionType.STRING,
        default: "",
        placeholder: "123456789012345678, 987654321098765432"
    },
    alias: {
        description: "Alias that gets replaced with a real mention, without the @",
        type: OptionType.STRING,
        default: "",
        placeholder: "friend"
    },
    notify: {
        description: "Tell me when they show up on a new account",
        type: OptionType.BOOLEAN,
        default: true
    }
}).withPrivateSettings<{ lSeenUserID: string }>();

function substituteAlias(content: string) {
    const alias = settings.store.alias ?? settings.plain.alias;
    const { lSeenUserID } = settings.plain;
    if (!alias || !lSeenUserID) return content;
    return content.replaceAll(`@${alias}`, `<@${lSeenUserID}>`);
}

export default definePlugin({
    id: "AntiNameChange",
    name: "AntiNameChange",
    description: "Keeps a real mention for someone who keeps cycling accounts",
    tags: ["Privacy", "Utility"],
    authors: [TestcordDevs.x2b],
    settings,

    onBeforeMessageSend(_channelId, message) {
        message.content = substituteAlias(message.content);
    },

    onBeforeMessageEdit(_channelId, _messageId, message) {
        message.content = substituteAlias(message.content);
    },

    flux: {
        MESSAGE_CREATE({ message }) {
            const authorId = message?.author?.id;
            if (!authorId || authorId === UserStore.getCurrentUser()?.id) return;

            const ids = settings.store.ids ?? settings.plain.ids ?? "";
            if (!ids) return;

            const watched = ids.split(",").some(id => id.trim() === authorId);
            if (!watched || settings.plain.lSeenUserID === authorId) return;

            const previous = settings.plain.lSeenUserID;
            settings.store.lSeenUserID = authorId;

            if (settings.store.notify) {
                showToast(
                    previous
                        ? `Tracked account switched to ${message.author.username}`
                        : `Now tracking ${message.author.username}`,
                    previous ? Toasts.Type.SUCCESS : Toasts.Type.MESSAGE
                );
            }
        }
    },

    commands: [
        {
            name: "friendprofile",
            description: "Open the profile of your friend who keeps changing accounts",
            execute() {
                const { lSeenUserID } = settings.plain;
                if (!lSeenUserID) {
                    showToast("No tracked account has been seen yet", Toasts.Type.FAILURE);
                    return;
                }
                openUserProfile(lSeenUserID);
            }
        }
    ]
});
