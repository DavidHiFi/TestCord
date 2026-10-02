/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { useForceUpdater } from "@utils/react";
import { ChannelRTCStore, ContextMenuApi, FluxDispatcher, useCallback, useEffect, useLayoutEffect, useRef, UserStore, useState, useStateFromStores } from "@webpack/common";

import { PlusIcon } from "../util/icons";
import { MIN_TAB_WIDTH, settings } from "../util/settings";
import { activateTabByIndex, closeTab, createTab, createTabAfter, cycleTab, getActiveTab, getActiveTabId, getTabs, initTabs, moveTab, reopenClosedTab, subscribe } from "../util/store";
import type { TabTarget } from "../util/types";
import { ChromeTab } from "./ChromeTab";
import { cancelChromeTabSwitcher, cycleChromeTabSwitcher, handleSwitcherKeyDown, handleSwitcherKeyUp, isChromeTabSwitcherOpen } from "./ChromeTabSwitcher";
import { StripContextMenu } from "./ContextMenus";

const cl = classNameFactory("tc-chrometabs-");

const NEW_TAB_BUTTON_WIDTH = 34;
export const NARROW_TAB_WIDTH = 88;
export const TINY_TAB_WIDTH = 58;
export const COMPACT_TAB_WIDTH = 38;
export const SUPER_COMPACT_TAB_WIDTH = 26;

function matchesKeybind(e: KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return null;

    const key = e.key.toLowerCase();

    if (key === "t" && !e.shiftKey) return "new" as const;
    if (key === "t" && e.shiftKey) return "reopen" as const;
    if (key === "w" && !e.shiftKey) return "close" as const;
    if (key === "tab") return e.shiftKey ? "prev" as const : "next" as const;

    const digit = Number.parseInt(e.key, 10);
    if (!e.shiftKey && digit >= 1 && digit <= 9) return { jump: digit };

    return null;
}

export interface ChromeTabsStripProps extends TabTarget {
    titleBar?: boolean;
    position?: "left" | "top" | "bottom" | "right" | "titlebar";
    collapsible?: boolean;
}

export function ChromeTabsStrip({
    guildId,
    channelId,
    titleBar,
    position = "top",
    collapsible = false
}: ChromeTabsStripProps) {
    const forceUpdate = useForceUpdater();
    const [userId, setUserId] = useState("");

    const { maxTabWidth, enableKeybinds } = settings.use(["maxTabWidth", "enableKeybinds"]);

    const stripRef = useRef<HTMLDivElement>(null);
    const [tabWidth, setTabWidth] = useState(maxTabWidth);

    const [dragIndex, setDragIndex] = useState<number | null>(null);

    const containerRef = useRef<HTMLDivElement>(null);
    const [isHovered, setIsHovered] = useState(false);
    const isHoveredRef = useRef(false);
    isHoveredRef.current = isHovered;
    const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleContainerMouseEnter = useCallback(() => {
        if (!collapsible) return;
        if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current);
            hoverTimeoutRef.current = null;
        }
        setIsHovered(true);
    }, [collapsible]);

    const handleContainerMouseLeave = useCallback(() => {
        if (!collapsible) return;
        if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current);
        }
        hoverTimeoutRef.current = setTimeout(() => {
            setIsHovered(false);
            hoverTimeoutRef.current = null;
        }, 320);
    }, [collapsible]);

    useEffect(() => {
        if (!collapsible) {
            setIsHovered(false);
            return;
        }

        const EDGE_TRIGGER_PX = 8;
        const EXIT_BUFFER_PX = 16;

        const onMouseMove = (e: MouseEvent) => {
            const { clientX, clientY } = e;
            const width = window.innerWidth;
            const height = window.innerHeight;

            let inTriggerZone = false;
            if (position === "top" || position === "titlebar") {
                inTriggerZone = clientY <= EDGE_TRIGGER_PX;
            } else if (position === "bottom") {
                inTriggerZone = clientY >= height - EDGE_TRIGGER_PX;
            } else if (position === "left") {
                inTriggerZone = clientX <= EDGE_TRIGGER_PX;
            } else if (position === "right") {
                inTriggerZone = clientX >= width - EDGE_TRIGGER_PX;
            }

            let inContainer = false;
            const el = containerRef.current;
            if (el) {
                const rect = el.getBoundingClientRect();
                inContainer = (
                    clientX >= rect.left - EXIT_BUFFER_PX &&
                    clientX <= rect.right + EXIT_BUFFER_PX &&
                    clientY >= rect.top - EXIT_BUFFER_PX &&
                    clientY <= rect.bottom + EXIT_BUFFER_PX
                );
            }

            if (inTriggerZone || inContainer) {
                if (hoverTimeoutRef.current) {
                    clearTimeout(hoverTimeoutRef.current);
                    hoverTimeoutRef.current = null;
                }
                if (!isHoveredRef.current) {
                    setIsHovered(true);
                }
            } else if (isHoveredRef.current) {
                if (!hoverTimeoutRef.current) {
                    hoverTimeoutRef.current = setTimeout(() => {
                        setIsHovered(false);
                        hoverTimeoutRef.current = null;
                    }, 320);
                }
            }
        };

        const onMouseLeaveDoc = (e: MouseEvent) => {
            if (!e.relatedTarget) {
                if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
                hoverTimeoutRef.current = setTimeout(() => {
                    setIsHovered(false);
                    hoverTimeoutRef.current = null;
                }, 320);
            }
        };

        window.addEventListener("mousemove", onMouseMove, { passive: true });
        document.addEventListener("mouseleave", onMouseLeaveDoc);
        return () => {
            window.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseleave", onMouseLeaveDoc);
            if (hoverTimeoutRef.current) {
                clearTimeout(hoverTimeoutRef.current);
                hoverTimeoutRef.current = null;
            }
        };
    }, [collapsible, position]);

    const isCollapsed = collapsible && !isHovered;
    const isVertical = position === "left" || position === "right";

    const isFullscreen = useStateFromStores([ChannelRTCStore], () => ChannelRTCStore.isFullscreenInContext() ?? false);

    const targetRef = useRef({ guildId, channelId });
    targetRef.current = { guildId, channelId };

    useEffect(() => subscribe(forceUpdate), [forceUpdate]);

    useEffect(() => {
        const onReady = () => {
            const user = UserStore.getCurrentUser();
            if (!user) return;

            void initTabs(user.id, targetRef.current).then(() => setUserId(user.id));
        };

        onReady();
        FluxDispatcher.subscribe("CONNECTION_OPEN_SUPPLEMENTAL", onReady);
        return () => FluxDispatcher.unsubscribe("CONNECTION_OPEN_SUPPLEMENTAL", onReady);
    }, []);

    const tabs = getTabs();
    const activeId = getActiveTabId();
    const tabCount = tabs.length;

    const isTitle = position === "titlebar" || titleBar;

    const recalculateTabWidth = useCallback(() => {
        const strip = stripRef.current;
        if (!strip || tabCount === 0 || isVertical) return;

        const isTitleMode = position === "titlebar" || titleBar;
        const newTabBtnWidth = isTitleMode ? 32 : NEW_TAB_BUTTON_WIDTH;
        const overlapPx = isTitleMode ? 6 : 1;
        const stripWidth = strip.clientWidth;
        const available = stripWidth - newTabBtnWidth - 8;
        if (available <= 0) {
            setTabWidth(MIN_TAB_WIDTH);
            return;
        }

        const ideal = Math.floor((available + (tabCount - 1) * overlapPx) / tabCount);
        const minFloor = Math.max(16, Math.min(MIN_TAB_WIDTH, ideal));
        setTabWidth(Math.max(minFloor, Math.min(maxTabWidth, ideal)));
    }, [tabCount, maxTabWidth, isVertical, position, titleBar]);

    useLayoutEffect(recalculateTabWidth, [recalculateTabWidth]);

    useEffect(() => {
        const strip = stripRef.current;
        const container = containerRef.current;
        if (!strip) return;

        const observer = new ResizeObserver(recalculateTabWidth);
        observer.observe(strip);
        if (container) observer.observe(container);
        window.addEventListener("resize", recalculateTabWidth, { passive: true });
        return () => {
            observer.disconnect();
            window.removeEventListener("resize", recalculateTabWidth);
        };
    }, [recalculateTabWidth]);

    const openNewTab = useCallback(() => {
        const active = getActiveTab();
        const target = active
            ? { guildId: active.guildId, channelId: active.channelId }
            : targetRef.current;

        if (active) createTabAfter(active.id, target, true);
        else createTab(target, true);
    }, []);

    useEffect(() => {
        if (!enableKeybinds) return;

        const onKeyDown = (e: KeyboardEvent) => {
            if (isChromeTabSwitcherOpen()) {
                if (handleSwitcherKeyDown(e)) return;
            }

            const action = matchesKeybind(e);
            if (!action) return;

            if (typeof action === "object") {
                const index = action.jump === 9 ? getTabs().length - 1 : action.jump - 1;
                if (getTabs()[index]) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    activateTabByIndex(index);
                }
                return;
            }

            switch (action) {
                case "new":
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    openNewTab();
                    break;
                case "reopen":
                    if (settings.store.reopenTabKeybind) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        reopenClosedTab();
                    }
                    break;
                case "close": {
                    const active = getActiveTab();
                    if (active && getTabs().length > 1) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        closeTab(active.id);
                    }
                    break;
                }
                case "next":
                case "prev":
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    if (settings.store.ctrlTabSwitcher && getTabs().length > 1) {
                        cycleChromeTabSwitcher(action === "next" ? 1 : -1);
                    } else {
                        cycleTab(action === "next" ? 1 : -1);
                    }
                    break;
            }
        };

        const onKeyUp = (e: KeyboardEvent) => {
            if (isChromeTabSwitcherOpen()) {
                handleSwitcherKeyUp(e);
            }
        };

        const onBlur = () => {
            if (isChromeTabSwitcherOpen()) {
                cancelChromeTabSwitcher();
            }
        };

        window.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("keyup", onKeyUp, true);
        window.addEventListener("blur", onBlur);
        return () => {
            window.removeEventListener("keydown", onKeyDown, true);
            window.removeEventListener("keyup", onKeyUp, true);
            window.removeEventListener("blur", onBlur);
            cancelChromeTabSwitcher();
        };
    }, [enableKeybinds, openNewTab]);

    const handleDragStart = useCallback((index: number) => setDragIndex(index), []);

    const handleDragEnter = useCallback((index: number) => {
        setDragIndex(current => {
            if (current == null || current === index) return current;
            moveTab(current, index);
            return index;
        });
    }, []);

    const handleDragEnd = useCallback(() => setDragIndex(null), []);

    if (!userId || isFullscreen || tabCount === 0) return null;

    const isCompact = !isVertical && tabWidth < COMPACT_TAB_WIDTH;
    const isSuperCompact = !isVertical && tabWidth < SUPER_COMPACT_TAB_WIDTH;

    return (
        <div
            ref={containerRef}
            className={classes(
                cl("container"),
                titleBar && cl("container-titlebar"),
                position && cl(`container-${position}`),
                collapsible && cl("container-collapsible"),
                isCollapsed && cl("container-collapsed")
            )}
            onMouseEnter={handleContainerMouseEnter}
            onMouseLeave={handleContainerMouseLeave}
            onContextMenu={e => ContextMenuApi.openContextMenu(e, () => (
                <StripContextMenu onNewTab={openNewTab} />
            ))}
        >
            <div
                className={cl("strip")}
                ref={stripRef}
                role="tablist"
                style={{ "--tc-tab-width": isVertical ? "100%" : `${tabWidth}px` } as React.CSSProperties}
            >
                {tabs.map((tab, index) => (
                    <ChromeTab
                        key={tab.id}
                        tab={tab}
                        index={index}
                        isActive={tab.id === activeId}
                        canClose={tabCount > 1}
                        isDragging={dragIndex === index}
                        isBeforeActive={tabs[index + 1]?.id === activeId}
                        narrow={!isVertical && tabWidth < NARROW_TAB_WIDTH}
                        tiny={!isVertical && tabWidth < TINY_TAB_WIDTH}
                        compact={isCompact}
                        superCompact={isSuperCompact}
                        onDragStart={handleDragStart}
                        onDragEnter={handleDragEnter}
                        onDragEnd={handleDragEnd}
                    />
                ))}

                <button
                    className={classes(cl("new-tab"))}
                    onClick={openNewTab}
                    onMouseLeave={e => e.currentTarget.blur()}
                    aria-label="New tab"
                >
                    <PlusIcon size={16} />
                </button>
            </div>
        </div>
    );
}
