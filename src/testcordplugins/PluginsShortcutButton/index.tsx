/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { UserAreaButton, UserAreaRenderProps } from "@api/UserArea";
import { PluginsIcon } from "@components/Icons";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import { SettingsRouter } from "@webpack/common";

function PluginsShortcutButton({
    iconForeground,
    hideTooltips,
    nameplate
}: UserAreaRenderProps) {
    return (
        <UserAreaButton
            className="button__201d5 wrapper__201d5"
            tooltipText={hideTooltips ? void 0 : "Plugins"}
            aria-label="Plugins"
            plated={nameplate != null}
            onClick={() => SettingsRouter.openUserSettings("testcord_plugins_panel")}
            icon={<PluginsIcon className={iconForeground} />}
        />
    );
}

export default definePlugin({
    name: "Plugins Shortcut Button",
    description: "Adds a shortcut button to the user area that opens the TestCord Plugins settings.",
    authors: [TestcordDevs.szcx404],

    dependencies: ["UserAreaAPI"],

    userAreaButton: {
        icon: PluginsIcon,
        render: PluginsShortcutButton
    }
});
