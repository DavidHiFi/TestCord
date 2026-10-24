/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { ActivityType } from "@vencord/discord-types/enums";
import { findComponentByCodeLazy } from "@webpack";
import { Popout, PresenceStore, useRef, UserStore, useStateFromStores } from "@webpack/common";

import type { MessageDecorationProps } from "../../api/MessageDecorations";

const settings = definePluginSettings({
    sources: {
        description: "Which listening activities to show covers for",
        type: OptionType.SELECT,
        options: [
            { label: "Everything", value: "all", default: true },
            { label: "Spotify only", value: "spotify" }
        ]
    }
});

const ActivityCard = findComponentByCodeLazy(".USER_PROFILE_LIVE_ACTIVITY_CARD),{themeType:");

function coverUrl(image: string) {
    if (image.startsWith("spotify:")) return `https://i.scdn.co/image/${image.slice("spotify:".length)}`;
    if (image.startsWith("mp:")) return `https://media.discordapp.net/${image.slice("mp:".length)}`;
    return image;
}

function ListeningCover({ message }: MessageDecorationProps) {
    const ref = useRef<HTMLDivElement>(null);
    // find, not filter: getActivities keeps the same objects until that user's presence
    // changes, so this stays reference-stable and the default identity check holds. A fresh
    // array never compared equal, so every row re-rendered on every presence emit.
    const activity = useStateFromStores(
        [PresenceStore],
        () => PresenceStore.getActivities(message.author.id).find(a =>
            a.type === ActivityType.LISTENING && !!a.assets?.large_image
        ) ?? null,
        [message.author.id]
    );

    const image = activity?.assets?.large_image;
    if (!activity || !image) return null;
    if (settings.plain.sources === "spotify" && !image.startsWith("spotify:")) return null;

    const url = coverUrl(image);
    if (!url) return null;

    return (
        <Popout
            position="top"
            renderPopout={() => (
                <div style={{ width: 267, height: 110 }}>
                    <ActivityCard activity={activity} currentUser={UserStore.getCurrentUser()} user={message.author} />
                </div>
            )}
            targetElementRef={ref}
        >
            {popoutProps => (
                <div ref={ref} style={{ width: 20, height: 20 }} {...popoutProps}>
                    <img
                        src={url}
                        alt=""
                        style={{ width: 20, height: 20, borderRadius: 3 }}
                        onError={e => { e.currentTarget.style.display = "none"; }}
                    />
                </div>
            )}
        </Popout>
    );
}

const Decorated = ErrorBoundary.wrap(ListeningCover, { noop: true });

export default definePlugin({
    id: "MessageListeningCover",
    name: "MessageListeningCover",
    description: "Shows the album cover of what an author is listening to",
    tags: ["Chat", "Privacy"],
    authors: [TestcordDevs.x2b],
    dependencies: ["MessageDecorationsAPI"],
    settings,
    renderMessageDecoration: props => {
        if (!props.message.author.id || props.message.author.id === UserStore.getCurrentUser()?.id) return null;
        return <Decorated {...props} />;
    }
});
