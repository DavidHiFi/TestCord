/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import { transformSync } from "esbuild";

import { makeRange } from "../src/utils/types";

const source = readFileSync(new URL("../src/testcordplugins/RoundedVcPfp/index.tsx", import.meta.url), "utf8")
    .replace(/^import .*;\r?\n/gm, "")
    .replace("export default definePlugin(", "globalThis.plugin = definePlugin(");
let lookups = 0;
let user: { getDefaultAvatarURL?: unknown; } = {};
const store: Record<string, unknown> = {
    avatarRadius: 5,
    cornerRadius: 12,
    zoom: 100,
    hideTileBackground: false,
    enableGlow: false,
    glowColor: "#45475a"
};
const sandbox = {
    EquicordDevs: { mochienya: {} }, TestcordDevs: { DavidHiFi: {} },
    definePlugin: (plugin: unknown) => plugin,
    definePluginSettings: () => ({ store }), OptionType: { SLIDER: 5 }, style: "",
    makeRange,
    UserStore: { getUser: () => { lookups++; return user; } },
    VoiceStateStore: { getVoiceStateForUser: () => undefined },
    getUserAvatarUrl: () => undefined
};
vm.createContext(sandbox);
vm.runInContext(transformSync(source, { loader: "tsx", format: "cjs" }).code, sandbox);
const plugin = (sandbox as typeof sandbox & { plugin: { getVoiceBackgroundStyles(props: { className?: string; participantUserId?: string; }): Record<string, string> | undefined; }; }).plugin;

const styles = (props: { participantUserId: string; }) => plugin.getVoiceBackgroundStyles({ className: "tile", participantUserId: props.participantUserId }) ?? {};

test("Only participant tiles receive avatar styles", () => {
    for (const props of [{ participantUserId: "1" }, { className: "other", participantUserId: "1" }, { className: "tile" }]) {
        assert.equal(plugin.getVoiceBackgroundStyles(props), undefined);
    }
    assert.equal(lookups, 0);
});

test("The callable default avatar fallback applies to tiles", () => {
    user = { getDefaultAvatarURL: () => "default-avatar" };
    const result = plugin.getVoiceBackgroundStyles({ className: "tile_example", participantUserId: "1" });
    assert.equal(result?.["--full-res-avatar"], 'url("default-avatar")');
    assert.equal(result?.["--vc-pfp-radius"], "12px");
});

test("A missing or noncallable default avatar uses the CDN fallback", () => {
    for (const value of [undefined, "not-a-function"]) {
        user = { getDefaultAvatarURL: value };
        assert.equal(plugin.getVoiceBackgroundStyles({ className: "tile", participantUserId: "1" })?.["--full-res-avatar"], 'url("https://cdn.discordapp.com/embed/avatars/0.png")');
    }
});

test("Picture masking follows the radius slider and the theme slot is always set", () => {
    Object.assign(store, { avatarRadius: 24 });
    const result = styles({ participantUserId: "1" });
    assert.ok(result["--vc-pfp-avatar-mask"]?.includes("rx%3D'24'"));
    assert.equal(result["--vc-pfp-avatar-radius"], "24%");
    assert.equal(result["--vc-pfp-glow-slot"], "1");
    Object.assign(store, { avatarRadius: 5 });
});

test("The glow emits no filter while the box still shows or the toggle is off", () => {
    Object.assign(store, { hideTileBackground: false, enableGlow: true });
    const result = styles({ participantUserId: "1" });
    assert.equal(result["background"], "");
    assert.equal(result["--vc-pfp-hide-bg"], "");
    assert.equal(result["--vc-pfp-glow-filter"], "");

    Object.assign(store, { hideTileBackground: true, enableGlow: false });
    const floating = styles({ participantUserId: "1" });
    assert.equal(floating["background"], "none");
    assert.equal(floating["--vc-pfp-hide-bg"], "1");
    assert.equal(floating["--vc-pfp-glow-filter"], "");
    Object.assign(store, { enableGlow: false });
});

test("The glow filter composes both layers from the configured hex", () => {
    Object.assign(store, { hideTileBackground: true, enableGlow: true, glowColor: "#45475a" });
    const result = styles({ participantUserId: "1" });
    assert.equal(result["--vc-pfp-glow-filter"], "drop-shadow(0 0 14px rgba(69, 71, 90, 0.4)) drop-shadow(0 0 3px rgba(69, 71, 90, 0.6))");

    Object.assign(store, { glowColor: "#a8c" });
    assert.equal(styles({ participantUserId: "1" })["--vc-pfp-glow-filter"], "drop-shadow(0 0 14px rgba(170, 136, 204, 0.4)) drop-shadow(0 0 3px rgba(170, 136, 204, 0.6))");
    Object.assign(store, { enableGlow: true, glowColor: "not-a-color" });
    assert.equal(styles({ participantUserId: "1" })["--vc-pfp-glow-filter"], "");
    Object.assign(store, { hideTileBackground: false, enableGlow: false, glowColor: "#45475a" });
});
