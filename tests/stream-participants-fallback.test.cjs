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

const writerPatch = streamEnhancerPatches.find(p => p.find === "showParticipants:S=!0,width:R,height:L,idle:O,mode:P,popoutType:M,awaitingRemoteSessionInfo:w,callContainerDimensions:U}=e;l.useEffect");
const readerPatch = streamEnhancerPatches.find(p => p.find === "Q=D<=2*b+144,J=M&&!Q");

function applyPatch(code, { match, replace }) {
    const regex = new RegExp(match.source.replaceAll("\\i", "(?:[A-Za-z_$][\\w$]*)"), match.flags);
    assert.match(code, regex);
    return code.replace(regex, replace.replaceAll("$self", "plugin"));
}

const streamBefore = "function Stream(e,l){let{showParticipants:S=!0,width:R,height:L,idle:O,mode:P,popoutType:M,awaitingRemoteSessionInfo:w,callContainerDimensions:U}=e;l.useEffect();return S}";
const gridBefore = "function Grid(D,b,M){let Q=D<=2*b+144,J=M&&!Q;return J}";
const stream = applyPatch(streamBefore, writerPatch.replacement);
const grid = applyPatch(gridBefore, readerPatch.replacement);

function runInStrictContext(script, hookShows) {
    const context = vm.createContext({ plugin: { useShowStreamParticipants: () => hookShows } });
    return vm.runInContext(`"use strict";\n${script}`, context);
}

const renderStream = "Stream({},{useEffect(){}});";
const renderGrid = "Grid(500,0,true)";

test("grid renders before any writer: stock prop value, no ReferenceError", () => {
    assert.equal(runInStrictContext(`${grid}\n${renderGrid}`, false), true);
});

test("writer renders first: hook value overrides the stock prop", () => {
    assert.equal(runInStrictContext(`${stream}\n${renderStream}\n${grid}\n${renderGrid}`, false), false);
});

test("negative control: the pre-fix reader throws ReferenceError before any writer", () => {
    const legacyGrid = gridBefore.replace("J=M&&!Q", "J=vcShowParticipants&&!Q");
    assert.throws(
        () => runInStrictContext(`${legacyGrid}\n${renderGrid}`, false),
        error => error.name === "ReferenceError" && error.message === "vcShowParticipants is not defined"
    );
});
