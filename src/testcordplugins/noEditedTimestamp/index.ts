/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    id: "NoEditedTimestamp",
    name: "NoEditedTimestamp",
    description: "Removes the '(edited)' label from all messages globally, not just your own.",
    authors: [TestcordDevs.Sharp],
    tags: ["Chat", "Utility"],

    patches: [
        {
            find: "#{intl::MESSAGE_EDITED}",
            replacement: {
                match: /(?<=function \i\(\i\)\{)(?=let\{message:)/,
                replace: "return null;",
            },
        },
    ],
});
