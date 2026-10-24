/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
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

import { disableStyle, enableStyle, setStyleClassNames } from "@api/Styles";
import { Devs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { findCssClassesLazy } from "@webpack";

import style from "./messagePopover.css?managed";

// Looked up separately: findCssClasses requires every name to live in the same module,
// so asking for both at once returns nothing whenever Discord splits them.
const messageListItemClasses = findCssClassesLazy("messageListItem");
const messageClasses = findCssClassesLazy("message");

export default definePlugin({
    id: "MessagePopoverAPI",
    name: "MessagePopoverAPI",
    description: "API to add buttons to message popovers.",
    authors: [Devs.KingFish, Devs.Ven, Devs.Nuckyz],

    start() {
        try {
            const mli = (messageListItemClasses as any)?.messageListItem ?? "messageListItem";
            const msg = (messageClasses as any)?.message ?? "message";
            setStyleClassNames(style, {
                messageListItem: mli,
                message: msg
            });
        } catch (e) {
            new Logger("MessagePopoverAPI").warn("Failed to resolve message classes:", e);
        }
        enableStyle(style);
    },

    stop() {
        disableStyle(style);
    },

    patches: [
        {
            find: "#{intl::MESSAGE_UTILITIES_A11Y_LABEL}),children",
            replacement: {
                match: /\{togglePopout:\i,.+?message:(\i)\}\)\]\}\):null,(?!Vencord\.Api\.MessagePopover)(?:.*?\(?\(0,\i\.jsx\)\(([\w$]+(?:\.[\w$]+)*),\{label:)?|(\i\s*[?&]\s*(?:(?:\(0,)?\i\.jsxs?\)?\(\i,?|\i\()\{message:(\i).{0,200}?togglePopout:\i\}\))/,
                replace: (m, msg1, btn, oldFull, msg2) => {
                    if (msg1) {
                        const i = m.indexOf("):null,") + 7;
                        const capturedBtn = btn ? `Vencord.Api.MessagePopover._captureToolbarButton(${btn})` : "null";
                        return m.slice(0, i) + `Vencord.Api.MessagePopover._buildPopoverElements(${capturedBtn},${msg1}),` + m.slice(i);
                    }
                    return `Vencord.Api.MessagePopover._buildPopoverElements(null,${msg2}),${oldFull}`;
                }
            }
        },
        {
            find: "#{intl::MESSAGE_UTILITIES_A11Y_LABEL}",
            replacement: {
                match: /className:(\i\(\)\(\i\.className,.{0,80}?\)),(onClick:.{0,150}?children:\(0,\i\.jsxs?\)\([\w$]+(?:\.[\w$]+)*,\{className:)(\i\.innerClassName),children:(\[\i,\i\])/,
                replace: 'className:"vc-message-popover "+$1,$2$3+" vc-message-popover-bar",children:Vencord.Api.MessagePopover._wrapPopoverBar($4)'
            }
        },
        {
            find: 'role:"article",onMouseEnter',
            replacement: {
                match: /(?<=null!=(\i)\?\(0,\i\.jsxs?\)\("div",\{className:)\i\.\i(?=,children:\1\}\))/,
                replace: '$&+" vc-message-popover-slot"'
            }
        }
    ]
});
