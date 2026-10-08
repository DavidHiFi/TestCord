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

import { generateTextCss } from "@components/BaseText";
import { generateMarginCss } from "@components/margins";
import { classNameFactory as _classNameFactory, classNameToSelector } from "@utils/css";
import { removeFromArray } from "@utils/misc";

// Backwards compat for Vesktop
/** @deprecated Import this from `@utils/css` instead */
export const classNameFactory = _classNameFactory;

export interface Style {
    name: string;
    source: string;
    classNames: Record<string, string>;
    /** Set while the style is enabled. Kept for the enable/disable guards. */
    enabled: boolean;
    /**
     * Position in the cascade, assigned on first enable. The composed sheet has to list
     * styles in the order they were enabled, because that is the order `appendChild` used
     * to give them when each one had its own element.
     */
    order?: number;
    /** The style's own interpolated CSS, recomputed by {@link compileStyle}. */
    compiled: string;
}

export const styleMap = window.VencordStyles ??= new Map();

/**
 * Every managed style used to get its own `<style>` element appended to
 * {@link managedStyleRootNode}. With several hundred plugins enabled that is several
 * hundred stylesheet objects, each with its own CSSOM and its own bookkeeping in the
 * style invalidation pass, all of which the engine has to walk on a recalc. They share a
 * single container and have no ordering requirement against each other beyond enable
 * order, so they are composed into one element instead.
 */
const managedStyleNode = document.createElement("style");
let managedEnableCounter = 0;

/**
 * Enabled styles in cascade order, maintained on enable/disable instead of being rebuilt by
 * filtering and sorting the whole map. `style.order` is a unique counter, so this is just
 * that counter ascending.
 */
const enabledStyles: Style[] = [];

/** Last string written to the node, so an unchanged compose costs no DOM write at all. */
let composedCss = "";

/**
 * Assigning `textContent` reparses the entire concatenated sheet, so a run of toggles that
 * all land before the next paint only needs to pay for one parse rather than one each.
 * A microtask rather than `requestAnimationFrame`, because rAF does not fire in a
 * backgrounded tab and the styles would then never be applied.
 */
let composeScheduled = false;

function scheduleCompose() {
    if (composeScheduled) return;
    composeScheduled = true;

    queueMicrotask(() => {
        composeScheduled = false;

        const css = enabledStyles.map(s => s.compiled).join("\n");
        if (css === composedCss) return;

        composedCss = css;
        managedStyleNode.textContent = css;
    });
}

export const vencordRootNode = document.createElement("vencord-root");
/**
 * Houses all Vencord core styles. This includes all imported css files
 */
export const coreStyleRootNode = document.createElement("vencord-styles");
/**
 * Houses all plugin specific managed styles
 */
export const managedStyleRootNode = document.createElement("vencord-managed-styles");
/**
 * Houses the user's themes and quick css
 */
export const userStyleRootNode = document.createElement("vencord-user-styles");

vencordRootNode.style.display = "none";
vencordRootNode.append(coreStyleRootNode, managedStyleRootNode, userStyleRootNode);

export function initStyles() {
    const styles: HTMLStyleElement[] = [];
    const addStyle = (id: string) => {
        const s = document.createElement("style");
        s.id = id;
        styles.push(s);
        return s;
    };
    const osValuesNode = addStyle("vencord-os-theme-values");
    addStyle("vencord-text").textContent = generateTextCss();
    const rendererCssNode = addStyle("vencord-css-core");
    const vesktopCssNode = (IS_VESKTOP || IS_EQUIBOP) ? addStyle("vesktop-css-core") : null;
    addStyle("vencord-margins").textContent = generateMarginCss();
    coreStyleRootNode.replaceChildren(...styles);

    VencordNative.native.getRendererCss().then(css => rendererCssNode.textContent = css);
    if (IS_DEV) {
        VencordNative.native.onRendererCssUpdate(newCss => {
            rendererCssNode.textContent = newCss;
        });
    }

    if (IS_VESKTOP && VesktopNative.app.getRendererCss || IS_EQUIBOP && VesktopNative.app.getRendererCss) {
        VesktopNative.app.getRendererCss().then(css => vesktopCssNode!.textContent = css);
        VesktopNative.app.onRendererCssUpdate(newCss => {
            vesktopCssNode!.textContent = newCss;
        });
    }

    VencordNative.themes.getSystemValues().then(values => {
        const variables = Object.entries(values)
            .filter(([, v]) => !!v)
            .map(([k, v]) => `--${k}: ${v};`)
            .join("");
        osValuesNode.textContent = `:root{${variables}}`;
    });
}

document.addEventListener("DOMContentLoaded", () => {
    document.documentElement.append(vencordRootNode);
}, { once: true });

export function requireStyle(name: string) {
    const style = styleMap.get(name);
    if (!style) throw new Error(`Style "${name}" does not exist`);
    return style;
}

/**
 * A style's name can be obtained from importing a stylesheet with `?managed` at the end of the import
 * @param name The name of the style
 * @returns `false` if the style was already enabled, `true` otherwise
 * @example
 * import pluginStyle from "./plugin.css?managed";
 *
 * // Inside some plugin method like "start()" or "[option].onChange()"
 * enableStyle(pluginStyle);
 */
export function enableStyle(name: string) {
    const style = requireStyle(name);

    if (style.enabled)
        return false;

    style.enabled = true;
    if (style.order === undefined)
        style.order = managedEnableCounter++;

    // Ascending `order` is the cascade, and the counter is unique, so the insert position
    // is found by comparison rather than by re-sorting the list.
    const index = enabledStyles.findIndex(s => (s.order ?? 0) > (style.order ?? 0));
    if (index === -1) enabledStyles.push(style);
    else enabledStyles.splice(index, 0, style);

    compileStyle(style);

    if (!managedStyleNode.isConnected)
        managedStyleRootNode.appendChild(managedStyleNode);
    return true;
}

/**
 * @param name The name of the style
 * @returns `false` if the style was already disabled, `true` otherwise
 * @see {@link enableStyle} for info on getting the name of an imported style
 */
export function disableStyle(name: string) {
    const style = requireStyle(name);
    if (!style.enabled)
        return false;

    style.enabled = false;
    style.order = undefined;
    removeFromArray(enabledStyles, s => s === style);
    scheduleCompose();
    return true;
}

/**
 * @param name The name of the style
 * @returns `true` in most cases, may return `false` in some edge cases
 * @see {@link enableStyle} for info on getting the name of an imported style
 */
export const toggleStyle = (name: string) => isStyleEnabled(name) ? disableStyle(name) : enableStyle(name);

/**
 * @param name The name of the style
 * @returns Whether the style is enabled
 * @see {@link enableStyle} for info on getting the name of an imported style
 */
export const isStyleEnabled = (name: string) => requireStyle(name).enabled;

export function removeStyle(name: string) {
    const style = styleMap.get(name);
    if (!style) return false;
    styleMap.delete(name);
    removeFromArray(enabledStyles, s => s === style);
    scheduleCompose();
    return true;
}

/**
 * Sets the variables of a style
 * ```ts
 * // -- plugin.ts --
 * import pluginStyle from "./plugin.css?managed";
 * import { setStyleVars } from "@api/Styles";
 * import { findByPropsLazy } from "@webpack";
 * const classNames = findByPropsLazy("thin", "scrollerBase"); // { thin: "thin-31rlnD scrollerBase-_bVAAt", ... }
 *
 * // Inside some plugin method like "start()"
 * setStyleClassNames(pluginStyle, classNames);
 * enableStyle(pluginStyle);
 * ```
 * ```scss
 * // -- plugin.css --
 * .plugin-root [--thin]::-webkit-scrollbar { ... }
 * ```
 * ```scss
 * // -- final stylesheet --
 * .plugin-root .thin-31rlnD.scrollerBase-_bVAAt::-webkit-scrollbar { ... }
 * ```
 * @param name The name of the style
 * @param classNames An object where the keys are the variable names and the values are the variable values
 * @param recompile Whether to recompile the style after setting the variables, defaults to `true`
 * @see {@link enableStyle} for info on getting the name of an imported style
 */
export const setStyleClassNames = (name: string, classNames: Record<string, string>, recompile = true) => {
    const style = requireStyle(name);
    style.classNames = classNames;
    if (recompile && isStyleEnabled(style.name))
        compileStyle(style);
};

/**
 * Recomputes a style's interpolated CSS and refreshes the composed sheet.
 * @see {@link setStyleClassNames} for more info on style classnames
 */
export const compileStyle = (style: Style) => {
    style.compiled = style.source
        .replace(/\[--(\w+)\]/g, (match, name) => {
            const className = style.classNames[name];
            return className ? classNameToSelector(className) : match;
        });

    scheduleCompose();
};
