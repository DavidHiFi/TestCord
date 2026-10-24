/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import { ErrorCard } from "@components/ErrorCard";
import { Paragraph } from "@components/Paragraph";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import ace from "file://ace/ace.js?minify";
import highlighter from "file://ace/highlighter.js?minify";
import theme from "file://ace/theme.js?minify";

import { RuleRow } from "./components/RuleRow";
import { applyRules, makeEmptyRule, type Rule } from "./rules";

const settings = definePluginSettings({
    addRule: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => (
            <Button
                variant="secondary"
                onClick={() => { settings.store.rules = [...(settings.plain.rules ?? []), makeEmptyRule()]; }}
            >
                Add rule
            </Button>
        )
    },
    editor: {
        type: OptionType.COMPONENT,
        description: "",
        component: () => {
            const { rules } = settings.use(["rules"]);
            const list = rules ?? [];

            return (
                <div className="vc-jstr-rules">
                    {list.length === 0
                        ? <Paragraph size="xs">No rules yet.</Paragraph>
                        : list.map((rule, index) => (
                            <RuleRow
                                key={index}
                                index={index}
                                onDelete={() => { settings.store.rules = list.filter((_, i) => i !== index); }}
                            />
                        ))}
                    <Paragraph size="xs">
                        Find accepts plain text or /regex/flags. A rule only runs on messages that also
                        contain the "only if includes" text, when that field is set.
                    </Paragraph>
                </div>
            );
        }
    }
}).withPrivateSettings<{ rules: Rule[] }>();

export { settings };

export default definePlugin({
    id: "JSTextReplace",
    name: "JSTextReplace",
    description: "Rewrite your outgoing messages with JavaScript",
    tags: ["Chat", "Utility"],
    authors: [TestcordDevs.x2b],
    settings,

    settingsAboutComponent: () => (
        <ErrorCard className="vc-jstr-warning">
            <Paragraph>
                Every replacement is arbitrary JavaScript running with your whole client session. Only add
                rules you wrote yourself, and never paste one you do not understand.
            </Paragraph>
        </ErrorCard>
    ),

    start() {
        (0, eval)(ace);
        (0, eval)(theme);
        (0, eval)(highlighter);
    },

    async onBeforeMessageSend(channelId, message) {
        message.content = await applyRules(channelId, message.content);
    }
});
