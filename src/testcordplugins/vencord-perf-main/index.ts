/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";

export default definePlugin({
    id: "perf",
    aliases: ["vencord-perf-main"],
    name: "Perf",
description: "[RISKY]Collection of small performance improvements[RISKY]",
    tags: ["Developers", "Utility"],
    authors: [
        {
            id: 579731384868798464n,
            name: "void",
        },
    ],
patches: [{
        // The tooltip module uses flushSync to immediately push state changes which is kinda unnecessary
        // We bypass this by directly setting the state in a normal variable but still use setState to control the rendering
        find: "this.state.shouldShowTooltip!==",
        replacement: [{
            match: /\i\.flushSync\(\(\)=>\{this\.setState\(\{shouldShowTooltip:(\i)\}\)\}\)/,
            replace: (_, param) => "this.__open=" + param + ",this.setState({shouldShowTooltip:" + param + "})",
        }, {
            match: /this\.state\.shouldShowTooltip!==(\i)/,
            replace: "this.__open!==$1",
        }]
    }, {
        // cache getters
        // not sure if this one does a whole lot tbh
        find: "this.rebuildFavoriteEmojisWithoutFetchingLatest()",
        replacement: [{
            match: /null!=(\i)&&\((\i)\(\)\.each\(\i\.usableEmojis,(\i)\),\i\(\)\.each\(\i\.emoticons,(\i)\)\)/,
            replace: (_, e, n, r, a) => "const usableEmojis=" + e + "?.usableEmojis,emoticons=" + e + "?.emoticons;" +
                `null!=${e}&&(${n}().each(usableEmojis,${r}),${n}().each(emoticons,${a}))`,
        }]
    }, {
        // Kill loading spinner
        find: /\w\.\w\.getAppSpinnerSources\(\)/,
        replacement: [{
            match: /(\i)=\i\.\i\.getAppSpinnerSources\(\)/,
            replace: "$1=null",
        }]
    }, {
        // Remove canvas that renders stuff like confetti etc
        find: "Math.max(o.length,1)",
        replacement: {
            match: /,\i\.createElement\("canvas",\{ref:\i,className:\i,style:[^}]+\}\)/,
            replace: ",null",
        }
    }, {
        // Remove analytics from gateway, this cost me upwards of 100ms because they JSON.stringify the entire thing
        find: "getDispatchHandler needs to be passed in first!",
        replacement: {
            match: /\i=function\(\i\)\{(?=let \i=Date\.now\(\),\{guilds:\i,)/,
            replace: "$&return;",
        }
    }]
});
