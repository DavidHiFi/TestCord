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

import ErrorBoundary from "@components/ErrorBoundary";
import { Logger } from "@utils/Logger";
import { JSX, ReactNode } from "react";

export type MessageAccessoryFactory = (props: Record<string, any>) => ReactNode;
export type MessageAccessory = {
    render: MessageAccessoryFactory;
    position?: number;
};

const logger = new Logger("MessageAccessories");

export const accessories = new Map<string, MessageAccessory>();

// `Failed to render ${key} Message Accessory` was rebuilt for every accessory on
// every rendered message, so a chat full of messages built one throwaway string
// per accessory per message. The key set changes only when a plugin starts or
// stops, so the messages are built once per registration instead.
const accessoryErrorMessages = new Map<string, string>();

export function addMessageAccessory(
    identifier: string,
    render: MessageAccessoryFactory,
    position?: number
) {
    accessories.set(identifier, {
        render,
        position,
    });
    accessoryErrorMessages.set(identifier, `Failed to render ${identifier} Message Accessory`);
}

export function removeMessageAccessory(identifier: string) {
    accessories.delete(identifier);
    accessoryErrorMessages.delete(identifier);
}

export function _modifyAccessories(
    elements: JSX.Element[],
    props: Record<string, any>
) {
    try {
        if (accessories.size === 0) return elements;

        for (const [key, accessory] of accessories.entries()) {
            const res = (
                <ErrorBoundary noop message={accessoryErrorMessages.get(key)} key={key}>
                    <accessory.render {...props} />
                </ErrorBoundary>
            );

            if (accessory.position == null) {
                elements.push(res);
                continue;
            }

            elements.splice(
                accessory.position < 0
                    ? elements.length + accessory.position
                    : accessory.position,
                0,
                res
            );
        }

        return elements;
    } catch (e) {
        logger.error("Failed to modify message accessories", e);
        return elements;
    }
}
