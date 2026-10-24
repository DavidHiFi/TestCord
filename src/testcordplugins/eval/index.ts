/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, ApplicationCommandType, findOption, sendBotMessage } from "@api/Commands";
import { TestcordDevs } from "@utils/constants";
import { sendMessage } from "@utils/discord";
import definePlugin, { PluginNative } from "@utils/types";

import { createConsole, prepare, report } from "./shared";

const Native = VencordNative.pluginHelpers.Eval as PluginNative<typeof import("./native")>;

async function run(code: string) {
    const { lines, fake } = createConsole();
    const script = prepare(code);

    let result: unknown;
    try {
        result = await (0, eval)(script);
    } catch (error) {
        result = error;
    }

    return report(script, result, lines);
}

export default definePlugin({
    id: "Eval",
    name: "Eval",
    description: "Adds a slash command to run JavaScript on your own client",
    tags: ["Developers", "Console"],
    authors: [TestcordDevs.x2b],
    commands: [
        {
            name: "eval",
            description: "Run JavaScript in your client. You are running this at your own risk.",
            type: ApplicationCommandType.CHAT_INPUT,
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "code",
                    description: "The code to run",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                },
                {
                    name: "send",
                    description: "Post the result in chat instead of only showing it to you",
                    type: ApplicationCommandOptionType.BOOLEAN,
                    required: false
                }
            ],
            async execute(args, ctx) {
                const content = await run(findOption(args, "code", ""));
                if (findOption(args, "send", false)) await sendMessage(ctx.channel.id, { content });
                else await sendBotMessage(ctx.channel.id, { content });
            }
        },
        {
            name: "native-eval",
            description: "Run JavaScript in the Node context of the desktop client. You are running this at your own risk.",
            type: ApplicationCommandType.CHAT_INPUT,
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "code",
                    description: "The code to run",
                    type: ApplicationCommandOptionType.STRING,
                    required: true
                },
                {
                    name: "send",
                    description: "Post the result in chat instead of only showing it to you",
                    type: ApplicationCommandOptionType.BOOLEAN,
                    required: false
                }
            ],
            async execute(args, ctx) {
                let content: string;
                try {
                    content = await Native.evalCode(findOption(args, "code", ""));
                } catch (error) {
                    content = report(findOption(args, "code", ""), error, []);
                }

                if (findOption(args, "send", false)) await sendMessage(ctx.channel.id, { content });
                else await sendBotMessage(ctx.channel.id, { content });
            }
        }
    ]
});
