/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import { getCurrentChannel, sendMessage } from "@utils/discord";
import definePlugin, { OptionType, PluginNative } from "@utils/types";

const Native = VencordNative.pluginHelpers.Socket as PluginNative<typeof import("./native")>;

const MESSAGE_EVENT = "testcord-socket-message";
const MAX_MESSAGE_LENGTH = 2000;

const settings = definePluginSettings({
    port: {
        description: "Port to listen on",
        type: OptionType.NUMBER,
        default: 3009
    },
    host: {
        description: "Address to listen on. Use 0.0.0.0 to accept connections from other machines.",
        type: OptionType.STRING,
        default: "127.0.0.1"
    },
    password: {
        description: "Password clients must send as their first line. Leave empty to generate one each launch.",
        type: OptionType.STRING,
        default: ""
    },
    allowUnauthedLocalConnections: {
        description: "Let connections from localhost skip the password",
        type: OptionType.BOOLEAN,
        default: false
    }
});

function onSocketMessage(event: Event) {
    const content = (event as CustomEvent<string>).detail;
    const channel = getCurrentChannel();
    if (!channel || !content) return;
    sendMessage(channel.id, { content }).then(undefined, () => showNotification({
        title: "Socket",
        body: "Could not send the message to this channel."
    }));
}

export default definePlugin({
    id: "Socket",
    name: "Socket",
    description: "Send messages to the current channel over a TCP socket",
    tags: ["Utility", "Developers"],
    authors: [TestcordDevs.x2b],
    settings,
    async start() {
        window.addEventListener(MESSAGE_EVENT, onSocketMessage);
        const password = await Native.startServer();
        showNotification({
            title: "Socket is listening",
            body: password
                ? `Session password: ${password}`
                : "No password was set, so anyone who can reach the port can send messages."
        });
    },
    stop() {
        window.removeEventListener(MESSAGE_EVENT, onSocketMessage);
        Native.stopServer();
    }
});
