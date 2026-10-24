/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { SettingsStore } from "@api/Settings";
import definePlugin, { PluginNative } from "@utils/types";

import { settings } from "./settings";

const Native = VencordNative.pluginHelpers.CursorMacOS as PluginNative<typeof import("./native")>;

async function apply() {
    const { style, size } = settings.store;
    console.log(`[CursorMacOS] Applying: ${style}/${size}`);
    const result = await Native.applyCursors(style, size);
    if (!result.ok) {
        console.warn("[CursorMacOS] Could not apply cursors:", result.error);
    }
}

const changeListener = () => {
    apply();
};

export default definePlugin({
    id: "CursorMacOS",
    name: "CursorMacOS",
    enabledByDefault: false,
    description: "Replaces Windows SYSTEM cursors with authentic macOS cursors (.cur/.ani). Restores default cursors when disabled.",
    tags: ["Appearance", "Nightcord"],
    authors: [{ name: "Nightcord", id: 0n }],

    settings,

    async start() {
        await apply();
        SettingsStore.addPrefixChangeListener("plugins.CursorMacOS", changeListener);
    },

    async stop() {
        SettingsStore.removePrefixChangeListener("plugins.CursorMacOS", changeListener);
        console.log("[CursorMacOS] Restoring default Windows cursors...");
        const result = await Native.restoreCursors();
        if (!result.ok) {
            console.error("[CursorMacOS] Failed to restore:", result.error);
        }
    },
});
