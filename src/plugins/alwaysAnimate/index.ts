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

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { classNameToSelector } from "@utils/css";
import definePlugin, { OptionType } from "@utils/types";
import { findCssClassesLazy } from "@webpack";

const MemberListClasses = findCssClassesLazy("members", "membersWrap");

let memberFreezeEl: HTMLStyleElement | null = null;

function updateMemberListFreeze(enabled: boolean) {
    if (!enabled) {
        memberFreezeEl?.remove();
        memberFreezeEl = null;
        return;
    }
    const selectors: string[] = [];
    for (const key of ["members", "membersWrap"] as const) {
        const cls = (MemberListClasses as Record<string, unknown>)[key];
        if (typeof cls === "string" && cls) {
            try {
                const sel = classNameToSelector(cls);
                selectors.push(sel, `${sel} *`);
            } catch { /* class not resolved yet, skip */ }
        }
    }
    if (!selectors.length) return;
    // Pausing settles the compositor: gradient and nameplate art stays visible
    // but stops repainting every frame. Overrides Discord's infinite member
    // list keyframe animations.
    const css = `${selectors.join(",")} { animation-play-state: paused !important; }`;
    if (!memberFreezeEl) {
        memberFreezeEl = document.createElement("style");
        memberFreezeEl.id = "vc-always-animate-member-freeze";
        document.head?.appendChild(memberFreezeEl);
    }
    if (memberFreezeEl.textContent !== css) memberFreezeEl.textContent = css;
}

const settings = definePluginSettings({
    icons: {
        type: OptionType.BOOLEAN,
        description: "Always animate server icons, avatars, decor and more",
        default: true,
    },
    statusEmojis: {
        type: OptionType.BOOLEAN,
        description: "Always animate status emojis",
        default: true,
    },
    serverBanners: {
        type: OptionType.BOOLEAN,
        description: "Always animate server banners",
        default: true,
    },
    nameplates: {
        type: OptionType.BOOLEAN,
        description: "Always animate nameplates",
        default: true,
    },
    roleGradients: {
        type: OptionType.BOOLEAN,
        description: "Always animate role gradients",
        default: true,
    },
    excludeMemberList: {
        type: OptionType.BOOLEAN,
        description: "Leave the server member list out of this. Member list patches are skipped and its animations are paused, so large servers stay smooth. Chat and everything else keeps animating. Animated avatars there still follow the Icons toggle above. Needs a restart for the patch part, the pause applies instantly.",
        default: false,
        restartNeeded: true,
        onChange: value => updateMemberListFreeze(value)
    }
});

export default definePlugin({
    id: "AlwaysAnimate",
    name: "AlwaysAnimate",
    description: "Animates anything that can be animated",
    tags: ["Appearance", "Fun"],
    authors: [Devs.FieryFlames],
    settings,
    patches: [
        {
            find: /canAnimate:(?!\s*(?:!0|true|["']))[^,{}]+?(?=[,}](?!\s*=)(?![^;{}]*\}\s*=))/,
            predicate: () => settings.store.icons,
            all: true,
            replacement: {
                match: /canAnimate:(?!\s*(?:!0|true|["']))[^,{}]+?(?=[,}](?!\s*=)(?![^;{}]*\}\s*=))/g,
                replace: "canAnimate:!0"
            }
        },
        {
            // Status emojis
            find: "#{intl::GUILD_OWNER}),children:",
            predicate: () => settings.store.statusEmojis,
            replacement: {
                match: /(\.CUSTOM_STATUS.+?animateEmoji:)\i/,
                replace: "$1!0"
            }
        },
        {
            // Guild Banner
            find: "#{intl::DISCOVERABLE_GUILD_HEADER_PUBLIC_INFO}",
            predicate: () => settings.store.serverBanners,
            replacement: {
                match: /(guildBanner:\i,animate:)\i(?=}\):null)/,
                replace: "$1!0"
            }
        },
        {
            // Gradient roles in chat
            find: "contentOnly:",
            replacement: {
                match: /animate:\i/,
                replace: "animate:!0"
            }
        },
        {
            // Gradient roles in member list
            find: '="left",className:',
            predicate: () => !settings.store.excludeMemberList,
            replacement: {
                match: /,animateGradient:/,
                replace: ",animateGradient:!0,_oldAnimateGradient:"
            }
        },
        {
            // Nameplates
            find: ".MINI_PREVIEW,[",
            predicate: () => settings.store.nameplates,
            replacement: {
                match: /animate:\i,loop:/,
                replace: "animate:true,loop:true,_loop:"
            },
        },
        {
            // Role Gradients
            find: "includeConvenienceGlow:r,animateGradient:",
            predicate: () => settings.store.roleGradients,
            replacement: {
                match: /(includeConvenienceGlow:\i,animateGradient:(\i)\}=e),(\i="username"===\i)/,
                replace: "$1;$2=!0;let $3"
            }
        },
    ],
    start() {
        if (settings.store.excludeMemberList) updateMemberListFreeze(true);
    },
    stop() {
        updateMemberListFreeze(false);
    }
});
