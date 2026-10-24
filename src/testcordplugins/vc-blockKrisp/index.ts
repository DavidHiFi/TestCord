/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs,TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    id: "BlockKrisp",
    name: "BlockKrisp",
    description: "Prevent Krisp from loading",
    tags: ["Voice", "Utility"],
    authors: [Devs.D3SOX, TestcordDevs.x2b],
    patches: [
        // Block loading Krisp module on Desktop
        // Uses the exact function call as anchor
        {
            find: "ensureModule(\"discord_krisp\")",
            replacement: {
                match: /[\w$.]+\.ensureModule\("discord_krisp"\)/,
                replace: "Promise.reject(new Error('Krisp blocked'))"
            }
        },
        // Block loading Krisp module on Web, by skipping the noise-cancellation guard around the node creation
        {
            find: "krisp_browser_models",
            replacement: {
                match: /if\(this\._noiseCancellation\)/,
                replace: "if(false)"
            }
        },
        // Set Krisp to not supported
        {
            find: "isNoiseCancellationSupported(){",
            replacement: {
                match: /isNoiseCancellationSupported\(\)\{/,
                replace: "$&return false;"
            }
        }
    ],
});
