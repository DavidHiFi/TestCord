/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { TestcordDevs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, FluxDispatcher, SelectedChannelStore, showToast, Toasts, UserStore } from "@webpack/common";

const AgeVerificationStatus = {
    TEEN: 2,
    ADULT: 3
} as const;

const settings = definePluginSettings({
    teen: {
        description: "Set the teen age group instead of adult",
        type: OptionType.BOOLEAN,
        default: false,
        onChange(newValue: boolean) {
            apply();
            showToast(`Age group set to ${newValue ? "teen" : "adult"}`, Toasts.Type.SUCCESS);
        }
    },
    allowNsfwChannels: {
        description: "Unblock age restricted channels",
        type: OptionType.BOOLEAN,
        default: true
    }
});

function setAgeGroup() {
    const status = settings.plain.teen ? AgeVerificationStatus.TEEN : AgeVerificationStatus.ADULT;
    if (UserStore.getCurrentUser()?.ageVerificationStatus === status) return;

    // CLOSE_AGE_VERIFICATION_MODAL is only honoured while the current user is
    // pending, and INITIATE_AGE_VERIFICATION is what puts them in that state.
    FluxDispatcher.dispatch({ type: "INITIATE_AGE_VERIFICATION" });
    FluxDispatcher.dispatch({ type: "CLOSE_AGE_VERIFICATION_MODAL", status });
}

function allowNsfwChannels() {
    if (!settings.plain.allowNsfwChannels) return;

    const user = UserStore.getCurrentUser();
    if (!user || user.nsfwAllowed === true) return;

    // nsfwAllowed is what the age restricted channel gate actually reads, not
    // ageVerificationStatus. The user object is immutable, so it has to go back
    // through the store's map for listeners to pick it up.
    UserStore.getUsers()[user.id] = user.set("nsfwAllowed", true);
    UserStore.emitChange();

    // Each guild keeps its own "I want to see this" consent, so agreeing for
    // one guild does nothing for the next one.
    const channel = ChannelStore.getChannel(SelectedChannelStore.getChannelId());
    if (channel?.guild_id) FluxDispatcher.dispatch({ type: "GUILD_NSFW_AGREE", guildId: channel.guild_id });
}

function apply() {
    setAgeGroup();
    allowNsfwChannels();
}

export default definePlugin({
    name: "SetAge",
    description: "Gives accounts with no age group one, so Discord stops asking you to verify your age. Stays on this client only.",
    tags: ["Utility"],
    authors: [TestcordDevs.x2b],
    settings,

    start() {
        apply();
    },

    flux: {
        CURRENT_USER_UPDATE() {
            apply();
        },
        CHANNEL_SELECT() {
            allowNsfwChannels();
        }
    }
});
