/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import BetterForwards from "@equicordplugins/betterForwards";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "SelfForward",
    description: "Adds the current channel to the forward list popup",
    tags: ["Utility"],
    authors: [{ name: "VillainsRule", id: 0n }],
    patches: [
        {
            find: ".getChannelHistory(),",
            predicate: () => !isPluginEnabled("BetterForwards") || !BetterForwards.settings.store.selfForward,
            replacement: [{
                match: /\[\i\.id\]/,
                replace: "[]"
            }]
        }
    ]
});
