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
import { Channel, User } from "@vencord/discord-types";
import { JSX } from "react";

export type DecoratorProps = {
    type: "guild" | "dm";
    user: User;
    /** only present when this is a DM list item */
    channel: Channel;
    /** only present when this is a guild list item */
    isOwner: boolean;
};

export type MemberListDecoratorFactory = (props: DecoratorProps) => JSX.Element | null;
type OnlyIn = "guilds" | "dms";

export const decoratorsFactories = new Map<string, { render: MemberListDecoratorFactory, onlyIn?: OnlyIn; }>();

// Same reasoning as the message decoration/accessory registries: this string was
// rebuilt for every decorator on every rendered member row, and the member list
// renders a row per member per scroll frame.
const decoratorErrorMessages = new Map<string, string>();

export function addMemberListDecorator(identifier: string, render: MemberListDecoratorFactory, onlyIn?: OnlyIn) {
    decoratorsFactories.set(identifier, { render, onlyIn });
    decoratorErrorMessages.set(identifier, `Failed to render ${identifier} Member List Decorator`);
}

export function removeMemberListDecorator(identifier: string) {
    decoratorsFactories.delete(identifier);
    decoratorErrorMessages.delete(identifier);
}

export function __getDecorators(props: DecoratorProps, type: "guild" | "dm"): JSX.Element | null {
    if (decoratorsFactories.size === 0) return null;

    const decorators: JSX.Element[] = [];

    for (const [key, { render: Decoration, onlyIn }] of decoratorsFactories) {
        if ((onlyIn === "guilds" && type !== "guild") || (onlyIn === "dms" && type !== "dm")) continue;

        decorators.push(
            <ErrorBoundary noop key={key} message={decoratorErrorMessages.get(key)}>
                <Decoration {...props} type={type} />
            </ErrorBoundary>
        );
    }

    if (decorators.length === 0) return null;

    return (
        <div className="vc-member-list-decorators-wrapper">
            {decorators}
        </div>
    );
}
