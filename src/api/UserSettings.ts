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

import { proxyLazy } from "@utils/lazy";
import { Logger } from "@utils/Logger";
import { findModuleId, proxyLazyWebpack, wreq } from "@webpack";

import { isPluginEnabled } from "./PluginManager";

interface UserSettingDefinition<T> {
    /**
     * Get the setting value
     */
    getSetting(): T;
    /**
     * Update the setting value
     * @param value The new value
     */
    updateSetting(value: T): Promise<void>;
    /**
     * Update the setting value
     * @param value A callback that accepts the old value as the first argument, and returns the new value
     */
    updateSetting(value: (old: T) => T): Promise<void>;
    /**
     * Stateful React hook for this setting value
     */
    useSetting(): T;
    userSettingsAPIGroup: string;
    userSettingsAPIName: string;
}

export const UserSettings: Record<PropertyKey, UserSettingDefinition<any>> | undefined = proxyLazyWebpack(() => {
    const modId = findModuleId('"textAndImages","renderSpoilers"');
    if (modId == null) return new Logger("UserSettingsAPI").error("Didn't find settings module.");

    return wreq(modId as any);
});

/**
 * `group\0name` -> definition index for the module above.
 *
 * getUserSetting walked every exported user setting and compared two string
 * fields on each. That module has hundreds of entries, and the API is reached
 * from settings renders, timestamp components and profile panels, so the walk
 * ran constantly. The module is a webpack singleton, so index it once per
 * resolved object instead of once per call.
 */
const userSettingIndexCache = new WeakMap<object, Map<string, UserSettingDefinition<any>>>();
let indexedUserSettingsModule: unknown = null;
let userSettingIndex: Map<string, UserSettingDefinition<any>> | null = null;

function getUserSettingIndex(): Map<string, UserSettingDefinition<any>> | null {
    const settings = UserSettings;
    if (!settings) return null;
    if (indexedUserSettingsModule === settings && userSettingIndex) return userSettingIndex;

    const cacheKey = settings as object;
    let index = userSettingIndexCache.get(cacheKey);
    if (!index) {
        index = new Map();
        for (const key in settings) {
            const definition = settings[key];
            if (!definition) continue;
            index.set(`${definition.userSettingsAPIGroup}\0${definition.userSettingsAPIName}`, definition);
        }
        userSettingIndexCache.set(cacheKey, index);
    }

    indexedUserSettingsModule = settings;
    userSettingIndex = index;
    return index;
}

/**
 * Get the setting with the given setting group and name.
 *
 * @param group The setting group
 * @param name The name of the setting
 */
export function getUserSetting<T = any>(group: string, name: string): UserSettingDefinition<T> | undefined {
    if (!isPluginEnabled("UserSettingsAPI")) throw new Error("Cannot use UserSettingsAPI without setting it as a dependency.");

    return getUserSettingIndex()?.get(`${group}\0${name}`) as UserSettingDefinition<T> | undefined;
}

/**
 * {@link getUserSettingDefinition}, lazy.
 *
 * Get the setting with the given setting group and name.
 *
 * @param group The setting group
 * @param name The name of the setting
 */
export function getUserSettingLazy<T = any>(group: string, name: string) {
    return proxyLazy(() => getUserSetting<T>(group, name));
}
