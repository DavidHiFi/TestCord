/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    memberSize: {
        type: OptionType.NUMBER,
        description: "How many member requests to run at once when adding or kicking",
        default: 5,
        componentProps: { type: "number", min: 1, max: 50 }
    },
    addDelay: {
        type: OptionType.NUMBER,
        description: "Milliseconds to wait between member batches",
        default: 250,
        componentProps: { type: "number", min: 0, max: 5000 }
    },
    readdDelay: {
        type: OptionType.NUMBER,
        description: "Milliseconds to wait before putting a missing member back in",
        default: 200,
        componentProps: { type: "number", min: 0, max: 5000 }
    },
    readdLimit: {
        type: OptionType.NUMBER,
        description: "How often one member may be re-added per group before gctrap gives up, zero means never",
        default: 5,
        componentProps: { type: "number", min: 0, max: 100 }
    },
    defaultMode: {
        type: OptionType.SELECT,
        description: "Starting mode for groups added to the dashboard",
        options: [
            { label: "Kick and re-add", value: "strict", default: true },
            { label: "Kick only", value: "kickonly" },
            { label: "Re-add only", value: "addonly" },
            { label: "Paused", value: "off" }
        ]
    },
    autoTrack: {
        type: OptionType.BOOLEAN,
        description: "Track groups this account creates or joins through an invite",
        default: true
    },
    showStats: {
        type: OptionType.BOOLEAN,
        description: "Show the group, member and event counters in the dashboard",
        default: true
    },
    notify: {
        type: OptionType.BOOLEAN,
        description: "Show a desktop notification when a group fills up or a member is auto kicked",
        default: true
    },
    buttonLocation: {
        type: OptionType.SELECT,
        description: "Where the gctrap button shows up",
        options: [
            { label: "Chat input bar", value: "chatbar", default: true },
            { label: "Chat header bar", value: "headerbar" },
            { label: "Both", value: "both" }
        ]
    }
});
