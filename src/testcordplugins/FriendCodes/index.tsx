/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs,TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";

import FriendCodesPanel from "./components/FriendCodesPanel";

export default definePlugin({
    id: "FriendCodes",
    name: "FriendCodes",
    description: "Generate FriendCodes to easily add friends",
    tags: ["Friends", "Utility"],
    authors: [Devs.HypedDomi, TestcordDevs.x2b, TestcordDevs.nnenaza],
    patches: [],

    get FriendCodesPanel() {
        return <FriendCodesPanel />;
    }
});
