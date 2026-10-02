const fs = require("node:fs");
const vm = require("node:vm");
const esbuild = require("esbuild");

const paths = process.argv.length > 2 ? process.argv.slice(2) : ["src/testcordplugins/staffTag/index.tsx"];
for (const path of paths) {
    const source = fs.readFileSync(path, "utf8");
    const compiled = esbuild.transformSync(source, { loader: "tsx", format: "cjs", jsx: "automatic" }).code;
    const module = { exports: {} };
    const mockedCommon = new Proxy({}, {
        get(_target, key) {
            if (key === "PermissionsBits") throw new Error("PermissionsBits accessed during plugin startup");
            return {};
        }
    });
    const styleRoot = { children: [] };
    const requireMock = id => {
        if (id === "@api/Settings") return { definePluginSettings: options => ({ store: Object.fromEntries(Object.entries(options).map(([key, option]) => [key, option.default])), use() {} }) };
        if (id === "@api/Styles") return { managedStyleRootNode: styleRoot };
        if (id === "@utils/css") return {
            createAndAppendStyle(styleId, target) {
                const element = { id: styleId, textContent: "", remove() { target.children = target.children.filter(child => child !== element); } };
                target.children.push(element);
                return element;
            }
        };
        if (id === "@utils/types") return { __esModule: true, default: plugin => plugin, OptionType: { BOOLEAN: "boolean", STRING: "string" } };
        if (id === "@utils/constants") return { TestcordDevs: { DavidHiFi: {}, DevilBro: {} } };
        if (id === "@webpack/common") return mockedCommon;
        if (id === "react/jsx-runtime") return { jsx() {}, jsxs() {} };
        throw new Error(`Unexpected import: ${id}`);
    };
    vm.runInNewContext(compiled, { module, exports: module.exports, require: requireMock }, { filename: path });
    const plugin = module.exports.default;
    if (plugin?.name !== "StaffTag") throw new Error(`Plugin export missing: ${path}`);
    // The client passes managedStyle to enableStyle(), which only accepts the name of a "?managed" import.
    if (typeof plugin.managedStyle === "string" && /[{}]/.test(plugin.managedStyle)) throw new Error(`managedStyle holds raw CSS: ${path}`);
    plugin.start?.();
    if (!styleRoot.children.some(child => child.textContent.includes(".vc-stafftag"))) throw new Error(`start() did not add the badge style: ${path}`);
    plugin.stop?.();
    if (styleRoot.children.length) throw new Error(`stop() left the badge style behind: ${path}`);
    process.stdout.write(`Startup safe: ${path}\n`);
}
