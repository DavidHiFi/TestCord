const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const esbuild = require("esbuild");

function rule(text, selectorText) { return { cssText: text, selectorText }; }
function owner(rules) {
    return {
        cssRules: rules,
        deleteRule(index) { this.cssRules.splice(index, 1); },
        insertRule(text, index) { this.cssRules.splice(index, 0, rule(text, text.split("{")[0])); }
    };
}

const nested = Object.assign(owner([rule(".a:has(.b){}", ".a:has(.b)"), rule(".safe{}", ".safe")]), { cssText: "@media all{}" });
const sheet = owner([rule(".ordinary{}", ".ordinary"), rule(".x:has(.y){}", ".x:has(.y)"), nested]);
let intervals = 0;
let disconnected = false;
const sandbox = {
    document: { styleSheets: [sheet], head: {} },
    TestcordDevs: { DavidHiFi: {} },
    Logger: class { info() {} debug() {} },
    definePlugin: plugin => plugin,
    MutationObserver: class { observe() {} disconnect() { disconnected = true; } },
    setInterval() { intervals++; return 1; }, clearInterval() { intervals--; },
    setTimeout() { return 1; }, clearTimeout() {}
};
const source = fs.readFileSync("src/testcordplugins/HasStrip/index.tsx", "utf8").replace(/^import .*;\r?\n/gm, "").replace("export default definePlugin(", "globalThis.plugin = definePlugin(");
vm.createContext(sandbox);
vm.runInContext(esbuild.transformSync(source, { loader: "tsx" }).code, sandbox);
sandbox.plugin.start();
assert.deepEqual(sheet.cssRules.map(r => r.cssText), [".ordinary{}", "@media all{}"]);
assert.deepEqual(nested.cssRules.map(r => r.cssText), [".safe{}"]);
assert.equal(intervals, 1);
sandbox.plugin.stop();
assert.deepEqual(sheet.cssRules.map(r => r.cssText), [".ordinary{}", ".x:has(.y){}", "@media all{}"]);
assert.deepEqual(nested.cssRules.map(r => r.cssText), [".a:has(.b){}", ".safe{}"]);
assert.equal(intervals, 0);
assert(disconnected);
console.log("PASS nested :has() removal, ordinary rule preservation, restoration order and timer cleanup");
sandbox.plugin.start();
assert.equal(sheet.cssRules.length, 2);
assert.equal(nested.cssRules.length, 1);
sandbox.plugin.stop();
assert.equal(sheet.cssRules.length, 3);
console.log("PASS disable and re-enable processes the same stylesheet again");
sandbox.plugin.start();
sheet.insertRule = () => { throw new Error("Sheet detached"); };
assert.doesNotThrow(() => sandbox.plugin.stop());
assert.equal(intervals, 0);
console.log("PASS detached-sheet restoration failure does not leak timers or throw");
