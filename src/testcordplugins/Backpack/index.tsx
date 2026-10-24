/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addChatBarButton, BackpackedButtons, backpackListeners,ChatBarButton, ChatBarButtonFactory, ChatBarButtonMap, notifyBackpackChange } from "@api/ChatButtons";
import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { ContextMenuApi, Menu, React, useEffect, useRef,useState } from "@webpack/common";

import backpackStyle from "./style.css?managed";

const BACKPACK_ID = "Backpack";

const settings = definePluginSettings({
    autoPackNewButtons: {
        type: OptionType.BOOLEAN,
        description: "Automatically pack newly added chat bar buttons into the backpack",
        default: true
    },
    showPackedCount: {
        type: OptionType.BOOLEAN,
        description: "Show a badge with the number of packed buttons",
        default: true
    },
    packedButtons: {
        type: OptionType.CUSTOM,
        description: "Packed button IDs",
        hidden: true,
        default: [] as string[]
    }
});

function BackpackIcon({ width = 22, height = 22 }: { width?: string | number; height?: string | number; }) {
    return (
        <svg width={width} height={height} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M7 8V6a5 5 0 0 1 10 0v2h.5A2.5 2.5 0 0 1 20 10.5v8A2.5 2.5 0 0 1 17.5 21h-11A2.5 2.5 0 0 1 4 18.5v-8A2.5 2.5 0 0 1 6.5 8H7Zm2 0h6V6a3 3 0 1 0-6 0v2Zm-1 5a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2H8Z" />
        </svg>
    );
}

function packButton(id: string) {
    if (BackpackedButtons.has(id)) return;

    const { packedButtons } = settings.store;
    if (!packedButtons.includes(id)) {
        settings.store.packedButtons = [...packedButtons, id];
    }
    BackpackedButtons.add(id);
    notifyBackpackChange();
}

function unpackButton(id: string) {
    if (!BackpackedButtons.has(id)) return;

    const { packedButtons } = settings.store;
    settings.store.packedButtons = packedButtons.filter(b => b !== id);
    BackpackedButtons.delete(id);
    notifyBackpackChange();
}

function renderBackpackMenuItems() {
    const { packedButtons } = settings.store;

    return [
        <Menu.MenuGroup key="backpack-group" label="BACKPACK">
            {packedButtons.map(id => {
                const data = ChatBarButtonMap.get(id);
                if (!data) return null;

                return (
                    <Menu.MenuItem
                        key={id}
                        id={`backpack-menu-${id}`}
                        label={id}
                        icon={data.icon}
                        action={(e?: React.MouseEvent) => {
                            e?.stopPropagation();
                            unpackButton(id);
                        }}
                    />
                );
            })}
            {packedButtons.length === 0 && (
                <Menu.MenuItem disabled key="backpack-empty" label="No packed buttons" id="backpack-empty" />
            )}
            <Menu.MenuSeparator />
            <Menu.MenuItem
                id="backpack-manage"
                label="Manage Packed Buttons"
                action={(e?: React.MouseEvent) => {
                    e?.stopPropagation();
                    settings.store.autoPackNewButtons = !settings.store.autoPackNewButtons;
                }}
            />
        </Menu.MenuGroup>
    ];
}

function BackpackContextMenu() {
    settings.use(["packedButtons"]);

    return (
        <Menu.Menu
            navId="backpack-context"
            onClose={() => {}}
            aria-label="Backpack Options"
        >
            {renderBackpackMenuItems()}
        </Menu.Menu>
    );
}

function openBackpackContextMenu(e: React.MouseEvent) {
    e.stopPropagation();
    ContextMenuApi.openContextMenu(e, () => <BackpackContextMenu />);
}

const BackpackButton: ChatBarButtonFactory = ({ isMainChat }) => {
    const { packedButtons, showPackedCount } = settings.store;
    const [popoutOpen, setPopoutOpen] = useState(false);
    const anchorRef = useRef<HTMLDivElement>(null);
    const [, forceUpdate] = useState(0);

    useEffect(() => {
        const listener = () => forceUpdate(n => n + 1);
        notifyBackpackChange();
        backpackListeners.add(listener);
        return () => { backpackListeners.delete(listener); };
    }, []);

    if (!isMainChat) return null;

    return (
        <ChatBarButton
            tooltip={packedButtons.length > 0 ? `Backpack (${packedButtons.length} packed)` : "Backpack"}
            onClick={() => setPopoutOpen(!popoutOpen)}
            onContextMenu={openBackpackContextMenu}
            onAuxClick={e => { e.stopPropagation(); setPopoutOpen(!popoutOpen); }}
        >
            <span className="tc-backpack-marker">
                <BackpackIcon />
                {showPackedCount && packedButtons.length > 0 && (
                    <span className="tc-backpack-badge">{packedButtons.length}</span>
                )}
            </span>
        </ChatBarButton>
    );
};

// Auto-pack new buttons
let autoPackInitialized = false;
function initAutoPack() {
    if (autoPackInitialized) return;
    autoPackInitialized = true;

    const listener = () => {
        if (!settings.store.autoPackNewButtons) return;

        for (const [id] of ChatBarButtonMap) {
            if (id === BACKPACK_ID) continue;
            if (!BackpackedButtons.has(id) && !settings.store.packedButtons.includes(id)) {
                packButton(id);
            }
        }
    };

    // Check on startup
    listener();

    // Listen for new buttons by monkey-patching addChatBarButton
    const originalAdd = addChatBarButton;
    (globalThis as any).__backpack_originalAdd = originalAdd;
    const patchedAdd = (id: string, render: ChatBarButtonFactory, icon: any) => {
        originalAdd(id, render, icon);
        if (settings.store.autoPackNewButtons && id !== BACKPACK_ID) {
            setTimeout(() => packButton(id), 0);
        }
    };
    (globalThis as any).addChatBarButton = patchedAdd;
}

// Cleanup
function cleanup() {
    // Unpack all on unload
    for (const id of BackpackedButtons) {
        unpackButton(id);
    }
}

export default definePlugin({
    id: "Backpack",
    name: "Backpack",
    description: "Collapse your other chat-bar plugin buttons behind a single button to declutter the message bar. Click to expand a menu with packed buttons. Right-click for options.",
    authors: [TestcordDevs.sirphantom89],
    dependencies: ["ChatInputButtonAPI"],

    chatBarButton: {
        icon: BackpackIcon,
        render: BackpackButton
    },

    managedStyle: backpackStyle,

    start() {
        initAutoPack();
    },

    stop() {
        cleanup();
    }
});
