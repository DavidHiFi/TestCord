/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findGroupChildrenByChildId, type NavContextMenuPatchCallback } from "@api/ContextMenu";
import { disableStyle, enableStyle } from "@api/Styles";
import ErrorBoundary from "@components/ErrorBoundary";
import { TestcordDevs } from "@utils/constants";
import { classes } from "@utils/misc";
import definePlugin from "@utils/types";
import type { Channel, Message } from "@vencord/discord-types";
import { ChannelStore, GuildChannelStore, GuildMemberStore, Menu, SelectedChannelStore, UserStore } from "@webpack/common";
import type { JSX } from "react";

import { ChromeTabsStrip } from "./components/ChromeTabsStrip";
import { removeChromeTabSwitcher } from "./components/ChromeTabSwitcher";
import style from "./style.css?managed";
import { getSyntheticPageIdForPath, handleNavigation, isSelfNavigation, openTarget, settings } from "./util";
import * as ChromeTabsStore from "./util/store";

function parseChannelUrl(url: string): { guildId: string; channelId?: string; messageId?: string; } | null {
    try {
        const path = url.startsWith("http") ? new URL(url).pathname : url;
        const match = path.match(/^\/channels\/([@\w]+)(?:\/([a-zA-Z0-9_-]+))?(?:\/(\d+))?/);
        if (!match) return null;
        return {
            guildId: match[1],
            channelId: match[2],
            messageId: match[3]
        };
    } catch {
        return null;
    }
}

function resolveGuildChannelId(guildId: string): string | undefined {
    const selected = SelectedChannelStore.getChannelId(guildId);
    if (selected) return selected;

    const def = GuildChannelStore.getDefaultChannel(guildId)?.id;
    if (def) return def;

    const selectable = GuildChannelStore.getSelectableChannels?.(guildId);
    if (selectable && selectable.length > 0) {
        return selectable[0]?.channel?.id;
    }

    const guildChannels = GuildChannelStore.getChannels(guildId);
    if (guildChannels?.SELECTABLE?.[0]?.channel?.id) {
        return guildChannels.SELECTABLE[0].channel.id;
    }
    if (guildChannels?.VOCAL?.[0]?.channel?.id) {
        return guildChannels.VOCAL[0].channel.id;
    }

    return undefined;
}

function findTargetFromFiber(target: HTMLElement): { guildId?: string; channelId?: string; } | null {
    let curr: HTMLElement | null = target;
    let depth = 0;
    while (curr && depth < 8) {
        const fiberKey = Object.keys(curr).find(k => k.startsWith("__reactFiber$"));
        if (fiberKey) {
            let fiber = (curr as unknown as Record<string, unknown>)[fiberKey] as {
                memoizedProps?: Record<string, unknown>;
                return?: any;
            } | null;
            let fDepth = 0;
            while (fiber && fDepth < 10) {
                const memo = fiber.memoizedProps;
                if (memo) {
                    if (memo.message || memo.messageId) {
                        return null;
                    }
                    const channel = memo.channel as Channel | undefined;
                    const channelId = (memo.channelId as string | undefined) || channel?.id;
                    if (channelId) {
                        const guildId = (memo.guildId as string | undefined) || channel?.guild_id || (memo.guild as { id?: string; } | undefined)?.id;
                        return { guildId, channelId };
                    }
                    const guildId = (memo.guildId as string | undefined) || (memo.guild as { id?: string; } | undefined)?.id;
                    if (guildId) {
                        const cid = resolveGuildChannelId(guildId);
                        return { guildId, channelId: cid };
                    }
                }
                fiber = fiber.return;
                fDepth++;
            }
        }
        curr = curr.parentElement;
        depth++;
    }
    return null;
}

function openTargetInNewTab(guildId: string, channelId?: string, messageId?: string) {
    let cid = channelId;
    let gid = guildId;
    if (gid === "@me" || gid === "home") {
        gid = "@me";
        if (!cid) cid = "__friends__";
    } else if (!cid) {
        cid = resolveGuildChannelId(gid);
    }
    if (!cid) return;

    openTarget({ guildId: gid, channelId: cid }, true, messageId);
}

function handleGlobalClick(e: MouseEvent) {
    if (!settings.store.ctrlClickNewTab) return;
    if (!e.ctrlKey && !e.metaKey) return;
    if (e.button !== 0) return;

    const target = e.target as HTMLElement | null;
    if (!target) return;

    if (target.closest(".tc-chrometabs-container, .tc-chrometabs-switcher-overlay")) return;

    const channelAttrElem = target.closest("[data-channel-id]") as HTMLElement | null;
    if (channelAttrElem) {
        const cid = channelAttrElem.getAttribute("data-channel-id");
        if (cid) {
            const ch = ChannelStore.getChannel(cid);
            const gid = ch?.guild_id || channelAttrElem.getAttribute("data-guild-id") || "@me";
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            openTargetInNewTab(gid, cid);
            return;
        }
    }

    const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
    if (anchor) {
        const href = anchor.getAttribute("href");
        if (href) {
            const parsed = parseChannelUrl(href);
            if (parsed) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                openTargetInNewTab(parsed.guildId, parsed.channelId, parsed.messageId);
                return;
            }
            const synthetic = getSyntheticPageIdForPath(href);
            if (synthetic) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                openTargetInNewTab("@me", synthetic);
                return;
            }
        }
    }

    const channelItem = target.closest('[data-list-item-id^="channels___"], [id^="channels___"]') as HTMLElement | null;
    if (channelItem) {
        const attr = channelItem.getAttribute("data-list-item-id") || channelItem.getAttribute("id") || "";
        const match = attr.match(/^channels___(\d+)/);
        if (match?.[1]) {
            const cid = match[1];
            const ch = ChannelStore.getChannel(cid);
            const gid = ch?.guild_id || "@me";
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            openTargetInNewTab(gid, cid);
            return;
        }
    }

    const privateItem = target.closest('[data-list-item-id*="private-channels"]') as HTMLElement | null;
    if (privateItem) {
        const dataId = privateItem.getAttribute("data-list-item-id") || "";
        const match = dataId.match(/private-channels___(\d+)/);
        if (match?.[1]) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            openTargetInNewTab("@me", match[1]);
            return;
        }
        if (dataId.includes("friends")) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            openTargetInNewTab("@me", "__friends__");
            return;
        }
        if (dataId.includes("shop")) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            openTargetInNewTab("@me", "__shop__");
            return;
        }
        if (dataId.includes("nitro")) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            openTargetInNewTab("@me", "__nitro__");
            return;
        }
    }

    const guildItem = target.closest('[data-list-item-id^="guildsnav___"]') as HTMLElement | null;
    if (guildItem) {
        const raw = guildItem.getAttribute("data-list-item-id")?.replace("guildsnav___", "");
        if (raw) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            openTargetInNewTab(raw);
            return;
        }
    }

    if (!target.closest('[class*="messageListItem"], [id^="chat-messages-"], [class*="messageContent"], [role="article"], [class*="markup_"]')) {
        const fromFiber = findTargetFromFiber(target);
        if (fromFiber?.channelId) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            openTargetInNewTab(fromFiber.guildId || "@me", fromFiber.channelId);
        }
    }
}

const openInNewTab: NavContextMenuPatchCallback = (children, props: { channel: Channel; messageId?: string; }) => {
    const { channel, messageId } = props;
    if (!channel) return;

    const item = (
        <Menu.MenuItem
            id="tc-chrometabs-open-in-new-tab"
            label="Open in New Tab"
            action={() => openTarget(
                { guildId: channel.guild_id || "@me", channelId: channel.id },
                true,
                messageId
            )}
        />
    );

    const group = findGroupChildrenByChildId("channel-copy-link", children);
    if (group) group.push(item);
    else children.splice(-1, 0, <Menu.MenuGroup>{item}</Menu.MenuGroup>);
};

export default definePlugin({
    name: "ChromeTabs",
    description: "Browser-style channel tabs styled after Google Chrome",
    tags: ["Appearance", "Customisation", "Organisation", "Servers", "Utility"],
    authors: [TestcordDevs.SirPhantom89],
    dependencies: ["ContextMenuAPI"],

    settings,
    start() {
        enableStyle(style);
        window.addEventListener("click", handleGlobalClick, true);
    },
    stop() {
        window.removeEventListener("click", handleGlobalClick, true);
        removeChromeTabSwitcher();
        disableStyle(style);
    },

    contextMenus: {
        "channel-context": openInNewTab,
        "channel-mention-context": openInNewTab,
        "user-context": openInNewTab,
        "gdm-context": openInNewTab
    },

    patches: [
        {
            find: '"AppView"',
            replacement: {
                match: /"div",{(?=.{0,80}(\i\?\.params))/,
                replace: "$self.render,{currentTarget:$1,"
            }
        },

        {
            find: '"data-window-chrome"',
            replacement: {
                match: /onDoubleClick:(\i),children:(\i)\}\),\(0,(\i)\.jsx\)\("div",\{className:(\i\.\i),children:(\i)\}/,
                replace: 'onDoubleClick:$1,children:$self.renderTitleBarLeading($2)}),(0,$3.jsx)("div",{className:$4,children:$self.isTitleBar()?null:$5}'
            }
        },
        {
            find: ".deleteRecentMention(",
            replacement: {
                match: /(?<=className:\i.\i,onJump:)(\i)=>(\i\(\i,\i\.id\))(?=.{0,40}message:(\i))/,
                replace: "$1 => { if ($1?.ctrlKey) $self.openMessage($3); else $2 }"
            }
        },
        {
            find: "__invalid_searchResultFocusRing",
            replacement: {
                match: /(\i)\.stopPropagation.{0,50}(?=null!=(\i))/,
                replace: "$&if ($1.ctrlKey) return $self.openMessage($2);"
            }
        }
    ],

    flux: {
        CHANNEL_SELECT({ channelId, guildId }: { channelId: string | null; guildId: string | null; }) {
            if (isSelfNavigation()) {
                ChromeTabsStore.endSelfNavigation();
                return;
            }

            if (channelId) {
                handleNavigation({ guildId: guildId || "@me", channelId });
                return;
            }

            const syntheticId = getSyntheticPageIdForPath(window.location.pathname);
            if (syntheticId) handleNavigation({ guildId: "@me", channelId: syntheticId });
        },

        MESSAGE_CREATE({ message, optimistic, type }: { message: Message; optimistic?: boolean; type?: string; }) {
            if (!settings.store.openTabOnMention) return;
            if (optimistic || (type === "MESSAGE_CREATE" && message.state === "SENDING")) return;

            const currentUserId = UserStore.getCurrentUser()?.id;
            if (!currentUserId || message.author?.id === currentUserId) return;

            const isMentioned = message.mentions?.some(m => (typeof m === "string" ? m === currentUserId : (m as unknown as { id: string; })?.id === currentUserId));
            const channel = ChannelStore.getChannel(message.channel_id);
            const guildId = channel?.guild_id || "@me";

            let isRoleMentioned = false;
            if (!isMentioned && channel?.guild_id) {
                const mentionRoles = (message as unknown as { mention_roles?: string[]; }).mention_roles || message.mentionRoles;
                if (mentionRoles?.length) {
                    const member = GuildMemberStore.getMember(channel.guild_id, currentUserId);
                    if (member?.roles?.length) {
                        isRoleMentioned = mentionRoles.some(roleId => member.roles.includes(roleId));
                    }
                }
            }

            if (!isMentioned && !isRoleMentioned) return;

            const active = ChromeTabsStore.getActiveTab();
            if (active && active.channelId === message.channel_id) return;

            const existing = ChromeTabsStore.getTabs().find(t => t.channelId === message.channel_id);
            if (existing) {
                ChromeTabsStore.retargetTab(existing.id, { guildId, channelId: message.channel_id }, message.id);
                if (settings.store.focusTabOnMention) {
                    ChromeTabsStore.activateTab(existing.id);
                }
                return;
            }

            if (active) {
                ChromeTabsStore.createTabAfter(
                    active.id,
                    { guildId, channelId: message.channel_id },
                    settings.store.focusTabOnMention,
                    message.id
                );
            } else {
                ChromeTabsStore.createTab(
                    { guildId, channelId: message.channel_id },
                    settings.store.focusTabOnMention,
                    message.id
                );
            }
        }
    },

    render(props: {
        currentTarget: { guildId: string; channelId: string; };
        children: JSX.Element;
        className?: string;
        [key: string]: unknown;
    }) {
        const { currentTarget, children, className, ...rest } = props;
        const { tabBarPosition, collapsible } = settings.store;
        if (tabBarPosition === "titlebar") {
            return <div className={className} {...rest}>{children}</div>;
        }

        const strip = (
            <ErrorBoundary noop>
                <ChromeTabsStrip
                    guildId={currentTarget?.guildId || "@me"}
                    channelId={currentTarget?.channelId}
                    position={tabBarPosition as "left" | "top" | "bottom" | "right" | "titlebar"}
                    collapsible={collapsible}
                />
            </ErrorBoundary>
        );

        if (tabBarPosition === "bottom") {
            return (
                <div className={classes("tc-chrometabs-app-col", "tc-chrometabs-layout-bottom", className)} {...rest}>
                    <div className="tc-chrometabs-app-main">{children}</div>
                    {strip}
                </div>
            );
        }

        if (tabBarPosition === "left") {
            return (
                <div className={classes("tc-chrometabs-app-row", "tc-chrometabs-layout-left", className)} {...rest}>
                    {strip}
                    <div className="tc-chrometabs-app-main">{children}</div>
                </div>
            );
        }

        if (tabBarPosition === "right") {
            return (
                <div className={classes("tc-chrometabs-app-row", "tc-chrometabs-layout-right", className)} {...rest}>
                    <div className="tc-chrometabs-app-main">{children}</div>
                    {strip}
                </div>
            );
        }

        return (
            <div className={classes("tc-chrometabs-app-col", "tc-chrometabs-layout-top", className)} {...rest}>
                {strip}
                <div className="tc-chrometabs-app-main">{children}</div>
            </div>
        );
    },

    isTitleBar() {
        return settings.store.tabBarPosition === "titlebar";
    },

    renderTitleBarLeading(leading: JSX.Element) {
        if (!this.isTitleBar()) return leading;
        return (
            <>
                {leading}
                <ErrorBoundary noop>
                    <ChromeTabsStrip
                        guildId="@me"
                        channelId="__friends__"
                        titleBar
                        position="titlebar"
                        collapsible={settings.store.collapsible}
                    />
                </ErrorBoundary>
            </>
        );
    },

    openMessage(message: Message) {
        const channel = ChannelStore.getChannel(message.channel_id);

        openTarget(
            { guildId: channel?.guild_id || "@me", channelId: message.channel_id },
            false,
            message.id
        );
    },

    util: ChromeTabsStore
});
