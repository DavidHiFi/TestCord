/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { Channel } from "@vencord/discord-types";
import { Avatar, IconUtils, UserStore } from "@webpack/common";

import { recipientIds } from "./api";

export const cl = classNameFactory("vc-gctrap-");

export function groupAvatarUrl(channel?: Channel | null): string {
    if (!channel) return "";
    const icon = IconUtils.getChannelIconURL({ id: channel.id, icon: channel.icon, size: 32 });
    if (icon) return icon;

    const other = recipientIds(channel).find(id => id !== UserStore.getCurrentUser()?.id);
    const user = other ? UserStore.getUser(other) : undefined;
    return user ? IconUtils.getUserAvatarURL(user, false, 48) ?? "" : "";
}

export function GroupAvatar({ channel, size = "SIZE_24" }: { channel?: Channel | null; size?: "SIZE_16" | "SIZE_24" | "SIZE_32"; }) {
    return <Avatar size={size} src={groupAvatarUrl(channel)} />;
}

export const STATUS_COLORS = {
    online: "var(--status-positive)",
    idle: "var(--status-warning)",
    dnd: "var(--status-danger)",
    offline: "var(--primary-400)"
} as const;
