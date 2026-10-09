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

function createMemoryStorage(): Storage {
    const data = new Map<string, string>();

    const target = {
        get length() {
            return data.size;
        },
        clear() {
            data.clear();
        },
        getItem(key: string) {
            const value = data.get(key);
            return value === undefined ? null : value;
        },
        key(index: number) {
            return Array.from(data.keys())[index] ?? null;
        },
        removeItem(key: string) {
            data.delete(key);
        },
        setItem(key: string, value: string) {
            data.set(key, String(value));
        }
    };

    const isNamed = (prop: string | symbol): prop is string => typeof prop === "string" && !(prop in target);

    return new Proxy(target, {
        get(t, prop, receiver) {
            if (isNamed(prop)) {
                const value = data.get(prop);
                return value === undefined ? undefined : value;
            }
            return Reflect.get(t, prop, receiver);
        },
        set(t, prop, value) {
            if (isNamed(prop)) {
                data.set(prop, String(value));
                return true;
            }
            return Reflect.set(t, prop, value);
        },
        deleteProperty(t, prop) {
            if (isNamed(prop)) {
                data.delete(prop);
                return true;
            }
            return Reflect.deleteProperty(t, prop);
        },
        has(t, prop) {
            return isNamed(prop) ? data.has(prop) : Reflect.has(t, prop);
        },
        ownKeys() {
            return Array.from(data.keys());
        },
        getOwnPropertyDescriptor(t, prop) {
            if (isNamed(prop)) {
                return { configurable: true, enumerable: true, value: data.get(prop), writable: true };
            }
            return Reflect.getOwnPropertyDescriptor(t, prop);
        }
    }) as Storage;
}

let localStorage: Storage;
try {
    const storage = window.localStorage;
    storage.getItem("");
    localStorage = storage;
} catch {
    localStorage = createMemoryStorage();
}

export { localStorage };
