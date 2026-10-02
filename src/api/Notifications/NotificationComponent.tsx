/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import "./styles.css";

import { useSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { classes } from "@utils/misc";
import { React, useEffect, useRef, useState } from "@webpack/common";

import { NotificationData } from "./Notifications";

export default ErrorBoundary.wrap(function NotificationComponent({
    title,
    body,
    richBody,
    color,
    icon,
    onClick,
    onClose,
    image,
    permanent,
    className,
    dismissOnClick
}: NotificationData & { className?: string; }) {
    const { timeout, position } = useSettings(["notifications.timeout", "notifications.position"]).notifications;

    const [isHover, setIsHover] = useState(false);

    // The countdown used to be a 10ms interval calling setState every tick, so a
    // single visible notification produced ~500 React re-renders and ~500 event
    // loop wakeups over its 5s lifetime, purely to move a progress bar. The bar
    // is now a CSS animation running on the compositor, and JS only has to fire
    // once, when the lifetime is actually over.
    //
    // `remaining` is the time left, so hovering pauses the bar (via
    // animation-play-state) without losing the time already served. The bar's
    // duration deliberately tracks `timeout` only: changing a running
    // animation's duration restarts it, and a restart would jump the bar
    // backwards every time the pointer crossed it.
    const remaining = useRef(timeout);
    const segmentStart = useRef(Date.now());
    const [barDuration, setBarDuration] = useState(timeout);

    useEffect(() => {
        remaining.current = timeout;
        segmentStart.current = Date.now();
        setBarDuration(timeout);
    }, [timeout]);

    useEffect(() => {
        if (timeout === 0 || permanent) return;
        if (isHover) return;

        segmentStart.current = Date.now();
        const id = setTimeout(() => onClose!(), remaining.current);

        return () => {
            clearTimeout(id);
            remaining.current = Math.max(0, remaining.current - (Date.now() - segmentStart.current));
        };
    }, [timeout, isHover, permanent]);

    return (
        <button
            className={classes("vc-notification-root", className)}
            style={position === "bottom-right" ? { bottom: "1rem" } : { top: "3rem" }}
            onClick={() => {
                onClick?.();
                if (dismissOnClick !== false)
                    onClose!();
            }}
            onContextMenu={e => {
                e.preventDefault();
                e.stopPropagation();
                onClose!();
            }}
            onMouseEnter={() => setIsHover(true)}
            onMouseLeave={() => setIsHover(false)}
        >
            <div className="vc-notification">
                {icon && <img className="vc-notification-icon" src={icon} alt="" />}
                <div className="vc-notification-content">
                    <div className="vc-notification-header">
                        <h2 className="vc-notification-title">{title}</h2>
                        <button
                            className="vc-notification-close-btn"
                            onClick={e => {
                                e.preventDefault();
                                e.stopPropagation();
                                onClose!();
                            }}
                        >
                            <svg
                                width="24"
                                height="24"
                                viewBox="0 0 24 24"
                                role="img"
                                aria-labelledby="vc-notification-dismiss-title"
                            >
                                <title id="vc-notification-dismiss-title">Dismiss Notification</title>
                                <path fill="currentColor" d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
                            </svg>
                        </button>
                    </div>
                    {richBody ?? <p className="vc-notification-p">{body}</p>}
                </div>
            </div>
            {image && <img className="vc-notification-img" src={image} alt="" />}
            {timeout !== 0 && !permanent && (
                <div
                    className={classes("vc-notification-progressbar", isHover && "paused")}
                    style={{
                        animationDuration: `${barDuration}ms`,
                        backgroundColor: color || "var(--brand-500)"
                    }}
                />
            )}
        </button>
    );
}, {
    onError: ({ props }) => props.onClose!()
});
