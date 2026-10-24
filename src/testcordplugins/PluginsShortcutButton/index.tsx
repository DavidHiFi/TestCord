/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { UserAreaButton, UserAreaRenderProps } from "@api/UserArea";
import { PluginsIcon } from "@components/Icons";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";

const OpenSettingsModule = findByPropsLazy("openUserSettings");

function PluginsShortcutButton({
    iconForeground,
    hideTooltips,
    nameplate
}: UserAreaRenderProps) {
    return (
        <UserAreaButton
            tooltipText={hideTooltips ? void 0 : "Plugins"}
            aria-label="Plugins"
            plated={nameplate != null}
            onClick={() => OpenSettingsModule.openUserSettings("testcord_plugins_panel")}
            icon={<PluginsIcon className={iconForeground} />}
        />
    );
}

export default definePlugin({
    id: "Plugins Shortcut Button",
    name: "Plugins Shortcut Button",
    description: "Adds a shortcut button to the user area that opens the full TestCord Plugins settings page.",
    authors: [TestcordDevs.szcx404],

    dependencies: ["UserAreaAPI"],

    userAreaButton: {
        icon: PluginsIcon,
        render: PluginsShortcutButton
    }
});
