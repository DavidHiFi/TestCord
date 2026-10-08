/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const esbuild = require("esbuild");

const source = fs.readFileSync(path.join(__dirname, "../src/testcordplugins/StreamEnhancer/patches.ts"), "utf8");
const sandbox = { module: { exports: {} } };
vm.runInNewContext(esbuild.transformSync(source, { loader: "ts", format: "cjs" }).code, sandbox);
const { streamEnhancerPatches } = sandbox.module.exports;

const fixture = 'function preview(){let C="stock";return null!=A&&u.Ay.supports(m.O5.VIDEO)&&null!=x&&null!=f&&f.state!==p.XYD.ENDED&&f.state!==p.XYD.FAILED?i.jsx(c.A,{videoComponent:A,streamId:x,streamPreviewURL:g,videoSpinnerContext:a.u.REMOTE_STREAM}):C}';
let patched = fixture;
for (const patch of streamEnhancerPatches) {
    if (typeof patch.find !== "string" || !fixture.includes(patch.find)) continue;
    for (const replacement of [].concat(patch.replacement)) {
        const match = new RegExp(replacement.match.source.replaceAll("\\i", "(?:[A-Za-z_$][\\w$]*)"), replacement.match.flags);
        patched = patched.replace(match, replacement.replace.replaceAll("$self", "plugin"));
    }
}

function render({ video, cover }) {
    const context = {
        A: video ? {} : null, x: "stream", f: { state: "LIVE" }, g: "thumbnail",
        u: { Ay: { supports: () => true } }, m: { O5: { VIDEO: 1 } },
        p: { XYD: { ENDED: "ENDED", FAILED: "FAILED" } },
        i: { jsx: () => "playing-video" }, c: { A: {} }, a: { u: { REMOTE_STREAM: 1 } },
        plugin: { shouldSpoofStreamPanelPreview: () => true, renderSpoofedStreamPanelPreview: () => cover }
    };
    return vm.runInNewContext(`${patched};preview()`, context);
}

test("configured spoof preserves playable video", () => {
    assert.equal(render({ video: true, cover: "custom-thumbnail" }), "playing-video");
});
test("unavailable video keeps the stock fallback (2026-10-09: Watch Stream gate patches removed; live video takes priority and custom previews stay on the static surfaces)", () => {
    assert.equal(render({ video: false, cover: "custom-thumbnail" }), "stock");
});
test("missing custom thumbnail preserves the stock fallback", () => {
    assert.equal(render({ video: false, cover: null }), "stock");
});
test("no Watch Stream gate patches are installed (2026-10-09 regression guard)", () => {
    for (const patch of streamEnhancerPatches) {
        for (const replacement of [].concat(patch.replacement)) {
            const text = replacement.replace;
            if (!text) continue;
            if (String(text).includes("shouldGateStreamPanelVideo")) {
                assert.fail("a video-branch gate re-appeared in patches.ts; verify shouldGateStreamPanelVideo detection before restoring it");
            }
        }
    }
});
