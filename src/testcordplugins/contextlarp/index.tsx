/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { sendBotMessage } from "@api/Commands";
import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { TestcordDevs } from "@utils/constants";
import definePlugin from "@utils/types";
import type { Channel, User } from "@vencord/discord-types";
import { Menu } from "@webpack/common";

const KnifeIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 1.5 14 4c.8.6 1.4 1.5 1.6 2.6l-3.6 2-3.6-2C8.6 5.5 9.2 4.6 10 4Z" />
        <path d="M5 6.5h14v1.6H5Z" />
        <path d="M11 9.6h2c.6 0 1 .4 1 1v2h1v2.9c0 .8-.7 1.5-1.5 1.5h-3c-.8 0-1.5-.7-1.5-1.5v-2.9h1v-2c0-.6.4-1 1-1Z" />
    </svg>
);

const AngryFaceIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z" />
        <circle cx="8" cy="10" r="1.5" />
        <circle cx="16" cy="10" r="1.5" />
        <path d="M5.5 6.5 8.8 8.6a.4.4 0 0 1-.5.7L5 7.2a.4.4 0 0 1 .5-.7Z" />
        <path d="M18.5 6.5 15.2 8.6a.4.4 0 0 0 .5.7l3.3-2.1a.4.4 0 0 0-.5-.7Z" />
        <path d="M12 14.5c2 0 3.6 1 3.7 1.1.4.4.3 1-.2 1.1-.6.2-1.8.8-3.5.8s-2.9-.6-3.5-.8c-.5-.1-.6-.7-.2-1.1Z" />
    </svg>
);

const CrossIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M9.5 1.6h5a1 1 0 0 1 1 1v4.9H20.4a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-4.9V21.4a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-7.9H3.6a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1h4.9v-4.9a1 1 0 0 1 1-1Z" />
    </svg>
);

const BabyBottleIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M10 1.6a2 2 0 0 1 4 0v.9h3.3a1.5 1.5 0 0 1 1.5 1.5V5h2.7a1.5 1.5 0 0 1 1.5 1.5v1.6H1V6.5A1.5 1.5 0 0 1 2.5 5h2.7V4a1.5 1.5 0 0 1 1.5-1.5H10Z" />
        <path d="M1 8.7h22V19a3.4 3.4 0 0 1-3.4 3.4H4.4A3.4 3.4 0 0 1 1 19Z" />
    </svg>
);

const RazorIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <rect x="3" y="7" width="18" height="10" rx="1.5" />
        <circle cx="12" cy="12" r="2.5" />
        <path d="M6.5 7V5l2.2 2Z" />
        <path d="M17.5 7V5l-2.2 2Z" />
        <path d="M6.5 17v2l2.2-2Z" />
        <path d="M17.5 17v2l-2.2-2Z" />
    </svg>
);

const HeartIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 21.35 10.55 20.03C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54Z" />
    </svg>
);

const DocumentIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 2 4 4h-4Z" />
        <path d="M8 12h8v1.5H8Zm0 3h6v1.5H8Z" />
    </svg>
);

const DangerIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2 1 21h22ZM12 6.6 4.7 19.2h14.6Zm-1 6.3h2v4.7h-2Zm0-5.6h2v3.7h-2Z" />
    </svg>
);

const actions = [
    { id: "contextlarp-kill", label: "Kill User", icon: KnifeIcon, result: (m: string) => `Killed ${m}` },
    { id: "contextlarp-rape", label: "Rape User", icon: AngryFaceIcon, result: (m: string) => `Raped ${m}` },
    { id: "contextlarp-crucify", label: "Crucify User", icon: CrossIcon, result: (m: string) => `Crucified ${m}` },
    { id: "contextlarp-impregnate", label: "Impregnate User", icon: BabyBottleIcon, result: (m: string) => `Impregnated ${m}` },
    { id: "contextlarp-skin", label: "Skin User Alive", icon: RazorIcon, result: (m: string) => `Skinned ${m} alive` },
    { id: "contextlarp-fuck", label: "Fuck User", icon: HeartIcon, result: (m: string) => `Fucked ${m}` },
    { id: "contextlarp-doxx", label: "Doxx User", icon: DocumentIcon, result: (m: string) => `Doxxed ${m}` },
    { id: "contextlarp-ext", label: "Exterminate User", icon: DangerIcon, result: (m: string) => `Exterminated ${m}` },
] as const;

const makeItems = (channel: Channel, user: User) =>
    actions.map(a => (
        <Menu.MenuItem
            id={a.id}
            key={a.id}
            label={a.label}
            color="danger"
            icon={a.icon}
            leadingAccessory={{ type: "icon", icon: a.icon }}
            action={() => sendBotMessage(channel.id, { content: a.result(`<@${user.id}>`) })}
        />
    ));

const MessageContextMenuPatch: NavContextMenuPatchCallback = (children, { channel, message }) => {
    if (!message?.author) return;

    const items = makeItems(channel, message.author);

    for (const anchor of ["delete", "report"]) {
        const group = findGroupChildrenByChildId(anchor, children);
        if (!group) continue;

        const index = group.findIndex(i => i?.props?.id === anchor);
        if (index === -1) continue;

        group.splice(index, 0, ...items);
        return;
    }

    children.push(...items);
};

const UserContextMenuPatch: NavContextMenuPatchCallback = (children, { channel, user }) => {
    if (!user) return;

    children.push(...makeItems(channel, user));
};

export default definePlugin({
    id: "ContextLarp",
    name: "ContextLarp",
    description: "Adds violent context menu roleplay actions for messages and users that fake a Clyde report on click.",
    authors: [TestcordDevs.x2b],
    contextMenus: {
        "message": MessageContextMenuPatch,
        "user-context": UserContextMenuPatch
    }
});
