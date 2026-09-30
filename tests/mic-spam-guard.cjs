const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const esbuild = require("esbuild");

const sourcePath = require("node:path").join(__dirname, "../src/testcordplugins/MicSpamGuard/index.tsx");
const source = fs.readFileSync(sourcePath, "utf8").replace(/^import .*;\r?\n/gm, "").replace("export default definePlugin(", "globalThis.plugin = definePlugin(");
const holdSource = fs.readFileSync(require("node:path").join(__dirname, "../src/testcordplugins/MicSpamGuard/protection.ts"), "utf8").replace("export class VolumeHold", "class VolumeHold");
const code = esbuild.transformSync(holdSource + "\n" + source, { loader: "tsx", format: "cjs" }).code;
const outcomes = [];
const toRaw = volume => volume === 0 ? 0 : (volume < 100 ? (volume / 100) ** 2.8 : 10 ** ((volume / 100 - 1) * 6 / 20)) * 100;
const toSlider = raw => raw === 0 ? 0 : (raw < 100 ? (raw / 100) ** (1 / 2.8) : 20 * Math.log10(raw / 100) / 6 + 1) * 100;

function setup(initial = {}) {
    let now = 100000;
    const volumes = new Map(Object.entries(initial));
    const writes = [];
    const persisted = new Map();
    const muted = new Set();
    const friends = new Set();
    const members = new Set(["1", "2", "3", "4"]);
    const emitter = { on() {}, off() {} };
    const conn = { context: "default", emitter, getUserIdBySsrc: () => "2" };
    let store;
    const sandbox = {
        Date: { now: () => now }, console, setInterval: () => 1, clearInterval() {},
        DataStore: { get: async key => persisted.get(key), set: async (key, value) => persisted.set(key, value), del: async key => persisted.delete(key) },
        plugins: {}, TestcordDevs: { DavidHiFi: { name: "DavidHiFi" } }, UserAreaButton() {}, openPluginModal() {},
        Logger: class { debug() {} error(...args) { throw Error(args.join(" ")); } },
        definePlugin: p => p,
        makeRange: (a, b, step = 1) => Array.from({ length: Math.floor((b - a) / step) + 1 }, (_, i) => a + i * step),
        OptionType: { BOOLEAN: 1, SLIDER: 2, SELECT: 3 },
        definePluginSettings: defs => {
            store = Object.fromEntries(Object.entries(defs).map(([key, def]) => [key, def.default ?? def.options?.find(o => o.default)?.value]));
            store.ignoreFriends = false;
            store.dynamicUserVolume = true;
            store.autoMute = false;
            store.notify = false;
            return { store, defs };
        },
        findByPropsLazy: () => ({ setLocalVolume: (user, value) => { assert(Number.isFinite(value)); volumes.set(user, value); writes.push({ user, value, at: now }); } }),
        findByCodeLazy: (...filters) => filters.includes("Math.log10") ? toSlider : toRaw,
        Button: {}, React: {}, RelationshipStore: { isFriend: user => friends.has(user) },
        SelectedChannelStore: { getVoiceChannelId: () => "channel" },
        UserStore: { getCurrentUser: () => ({ id: "1" }), getUser: user => ({ username: user, bot: user === "4" }) },
        VoiceStateStore: { getVoiceStatesForChannel: () => Object.fromEntries([...members].map(user => [user, {}])) },
        MediaEngineStore: { getMediaEngine: () => ({ connections: [conn] }), getLocalVolume: user => volumes.get(user) ?? 100, isLocalMute: user => muted.has(user) },
        showToast() {}, Toasts: { Type: { MESSAGE: 1 } }
    };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox);
    const run = expr => vm.runInContext(expr, sandbox);
    const stats = payload => { sandbox.payload = payload; run("onStats(payload)"); };
    const sample = (db, user = "2") => stats({ rtp: { inbound: { [user]: { audioLevel: db === -Infinity ? 0 : 10 ** (db / 20) } } } });
    const advance = ms => { for (let i = 0; i < ms; i += 100) { now += Math.min(100, ms - i); run("updateProtection(Date.now()); updateDynamics(Date.now())"); } };
    const speech = (db, ms, user = "2") => { for (let i = 0; i < ms; i += 100) { sample(db, user); advance(100); } };
    return { run, sample, stats, advance, speech, store, volumes, writes, persisted, muted, friends, members, plugin: sandbox.plugin };
}

async function test(name, body) {
    await body();
    outcomes.push({ name, passed: true });
    console.log(`PASS ${name}`);
}

(async () => {
    await test("Volume conversion filters match Discord's cached functions and 100% stays 100%", () => {
        const curve = JSON.parse(fs.readFileSync(require("node:path").join(__dirname, "fixtures/discord-volume-curve.json"), "utf8"));
        const context = vm.createContext({});
        vm.runInContext(curve.code, context);
        assert(/Math\.pow\([^,]+,\s*2\.8\)/.test(context.i.toString()));
        assert(context.r.toString().includes("Math.log10") && context.r.toString().includes("35714285714285715"));
        for (const slider of [5, 20, 60, 100, 200, 400, 1000]) {
            assert(Math.abs(context.i(slider) - toRaw(slider)) < 0.00001);
            assert(Math.abs(context.r(context.i(slider)) - slider) < 0.00001);
        }
        assert.equal(context.r(100), 100);
        assert(context.r(20) > 55 && context.r(20) < 57);
    });
    await test("Loud speech drops promptly and compression target is separate from mute threshold", () => {
        const t = setup();
        t.store.threshold = 90;
        t.speech(-3, 500);
        assert(t.volumes.get("2") < 65);
        t.speech(-3, 2500);
        assert(Math.abs(t.volumes.get("2") - 48) < 1);
    });
    await test("Quiet speech rises gradually and respects the 200% ceiling", () => {
        const t = setup();
        t.speech(-35, 1000);
        assert(t.volumes.get("2") < 115);
        t.speech(-35, 15000);
        assert(toSlider(t.volumes.get("2")) > 190 && toSlider(t.volumes.get("2")) <= 200.1);
    });
    await test("Silence and background noise do not trigger boost", () => {
        const t = setup();
        t.speech(-Infinity, 4000);
        t.speech(-50, 4000);
        assert.equal(t.writes.length, 0);
    });
    await test("Automatic balancing detects very quiet speech without boosting silence", () => {
        const t = setup();
        t.speech(-46, 16000);
        assert(toSlider(t.volumes.get("2")) > 190);
        t.speech(-Infinity, 14000);
        assert.equal(t.volumes.get("2"), 100);
    });
    await test("One-second desktop samples do not release gain between samples", () => {
        const t = setup();
        for (let i = 0; i < 8; i++) { t.sample(-3); t.advance(1000); }
        assert(t.volumes.get("2") < 65);
        assert(t.writes.filter(w => w.at >= 102000).every(w => w.value < 65));
    });
    await test("Loud to quiet transition recovers smoothly without jumping to 200", () => {
        const t = setup();
        t.speech(-3, 2000);
        const low = t.volumes.get("2");
        t.speech(-18, 300);
        assert(t.volumes.get("2") < 70 && t.volumes.get("2") >= low);
        t.speech(-Infinity, 12000);
        assert.equal(t.volumes.get("2"), 100);
        assert.equal(t.run("turnedDown.size"), 0);
    });
    await test("Boost returns to exact manual baseline during silence", () => {
        const t = setup({ "2": 137 });
        t.speech(-35, 15000);
        t.speech(-Infinity, 14000);
        assert.equal(t.volumes.get("2"), 137);
    });
    await test("Quiet boost fades smoothly after silence rather than snapping down", () => {
        const t = setup();
        t.speech(-35, 15000);
        t.speech(-Infinity, 1600);
        assert(t.volumes.get("2") > 150);
        t.speech(-Infinity, 12000);
        assert.equal(t.volumes.get("2"), 100);
    });
    await test("Manual volume changes become the baseline and manual zero remains zero", () => {
        const t = setup();
        t.speech(-3, 1000);
        t.volumes.set("2", 150);
        t.advance(100);
        assert.equal(t.run('turnedDown.get("2").base'), 150);
        t.run('restoreAll("silent")');
        assert.equal(t.volumes.get("2"), 150);
        t.speech(-3, 1000);
        t.volumes.set("2", 0);
        t.advance(100);
        t.speech(-35, 3000);
        assert.equal(t.volumes.get("2"), 0);
    });
    await test("Unlocked 600% baseline is never confused with 100% or 200%", () => {
        const t = setup({ "2": 600 });
        t.speech(-3, 1000);
        t.run('restoreAll("silent")');
        assert.equal(t.volumes.get("2"), 600);
    });
    await test("Automatic cut remains bounded for a very high manual baseline", () => {
        const t = setup({ "2": 6000 });
        t.speech(0, 4000);
        assert(t.volumes.get("2") >= 378);
        t.run('restoreAll("silent")');
        assert.equal(t.volumes.get("2"), 6000);
    });
    await test("Two users receive independent loud and quiet adjustments", () => {
        const t = setup();
        for (let i = 0; i < 160; i++) {
            t.stats({ rtp: { inbound: { "2": { audioLevel: 10 ** (-3 / 20) }, "3": { audioLevel: 10 ** (-35 / 20) } } } });
            t.advance(100);
        }
        assert(t.volumes.get("2") < 65);
        assert(toSlider(t.volumes.get("3")) > 190);
    });
    await test("Friends, self, bots, local mute and users outside the call are excluded", () => {
        const t = setup();
        t.store.ignoreFriends = true;
        t.friends.add("2");
        t.muted.add("3");
        for (const user of ["1", "2", "3", "4", "9"]) t.speech(0, 1000, user);
        assert.equal(t.writes.length, 0);
    });
    await test("Ignore restores immediately and Restore pauses until Resume", () => {
        const t = setup();
        t.speech(-3, 1000);
        t.run('toggleIgnored("2")');
        assert.equal(t.volumes.get("2"), 100);
        t.run('toggleIgnored("2")');
        t.speech(-3, 1000);
        t.run('restoreVolume("2", "manual")');
        t.speech(-3, 2000);
        assert.equal(t.volumes.get("2"), 100);
        t.run('pausedDynamics.delete("2")');
        t.speech(-3, 1000);
        assert(t.volumes.get("2") < 65);
    });
    await test("Malformed stats and video entries cannot trigger adjustments", () => {
        const t = setup();
        t.stats({ rtp: { inbound: { "2": [{ audioLevel: NaN }, { kind: "video", audioLevel: 1 }, { audioLevel: -1 }] } } });
        t.advance(1000);
        assert.equal(t.writes.length, 0);
    });
    await test("Multiple audio entries use the loudest sample, including SSRC mapping", () => {
        const t = setup();
        t.run("poll()");
        t.stats({ rtp: { inbound: [{ ssrc: 12, audioLevel: 0.7 }, { ssrc: 13, audioLevel: 0 }] } });
        t.advance(400);
        assert(t.volumes.get("2") < 65);
    });
    await test("Leaving the call restores held volumes and clears controller state", async () => {
        const t = setup();
        await t.plugin.start();
        t.run("poll()");
        t.speech(-3, 1000);
        t.members.delete("2");
        t.run("poll()");
        assert.equal(t.volumes.get("2"), 100);
        assert.equal(t.run("turnedDown.size"), 0);
        t.plugin.stop();
    });
    await test("Disable restores volumes and persistence ends with no stale holds", async () => {
        const t = setup();
        t.speech(-3, 1000);
        t.store.enabled = false;
        t.run("settings.defs.enabled.onChange()");
        await t.run("persistQueue");
        assert.equal(t.volumes.get("2"), 100);
        assert.equal(Object.keys(t.persisted.get("MicSpamGuard_held_volumes")).length, 0);
    });
    await test("Crash recovery restores exact saved raw volumes and rejects invalid values", async () => {
        const t = setup({ "2": 24 });
        t.persisted.set("MicSpamGuard_held_volumes", { "2": 600, "3": NaN, "4": -1 });
        await t.plugin.start();
        assert.equal(t.volumes.get("2"), 600);
        assert.equal(t.volumes.get("3"), undefined);
        assert.equal(t.volumes.get("4"), undefined);
        t.plugin.stop();
    });
    await test("Mute mode still holds and restores the manual volume", () => {
        const t = setup({ "2": 155 });
        t.store.dynamicUserVolume = false;
        t.store.threshold = 98;
        t.store.autoMute = true;
        t.speech(0, 1000);
        assert.equal(t.volumes.get("2"), 0);
        t.run('unmute("2", "manual")');
        assert.equal(t.volumes.get("2"), 155);
    });
    await test("Mute protection and volume controls remain separately configurable", () => {
        const t = setup(); t.store.autoMute = true;
        assert.equal(t.store.dynamicTarget, 65);
        assert.equal(t.store.dynamicMaxReduction, 12);
        assert.equal(t.store.dynamicMaxBoost, 6);
        assert.equal(t.store.dynamicResponse, 250);
        for (const key of ["threshold", "sensitivity", "autoUnmute", "dynamicTarget", "dynamicMaxReduction", "dynamicMaxBoost", "dynamicResponse"]) assert.equal(t.plugin.settings.defs[key].hidden(), false);
        t.store.dynamicUserVolume = false;
        assert.equal(t.plugin.settings.defs.dynamicTarget.hidden(), true);
        assert.equal(t.plugin.settings.defs.threshold.hidden(), false);
    });
    await test("Everyday loud speech is balanced without an extreme mute", () => {
        const t = setup(); t.store.autoMute = true; t.speech(-6, 5000);
        assert(t.volumes.get("2") > 0 && t.volumes.get("2") < 100);
        assert.equal(t.run("mutedByUs.size"), 0);
    });
    await test("Consecutive extreme samples mute while dynamic balancing is enabled", () => {
        const t = setup({"2":155}); t.store.autoMute = true;
        t.speech(-6, 1000); t.speech(0, 500);
        assert.equal(t.volumes.get("2"), 0);
        assert.equal(t.run("turnedDown.size"), 0);
        t.run('unmute("2", "manual")'); assert.equal(t.volumes.get("2"), 155);
    });
    await test("Normal samples break the extreme mute count", () => {
        const t = setup(); t.store.autoMute = true;
        for(let i=0;i<10;i++) { t.sample(0); t.advance(100); t.sample(-6); t.advance(100); }
        assert(t.volumes.get("2")>0); assert.equal(t.run("mutedByUs.size"),0);
    });
    await test("Old low thresholds cannot mute everyday speech", () => {
        const t = setup(); t.store.autoMute = true; t.store.threshold = 70;
        t.speech(-6, 5000); assert(t.volumes.get("2")>0);
    });
    await test("Fresh safe speech restores protection smoothly after the configured hold", () => {
        const t=setup({"2":155});t.run("poll()");t.store.autoMute=true;t.store.autoUnmute=3;t.store.dynamicUserVolume=false;
        t.speech(0,1000);assert.equal(t.volumes.get("2"),0);
        t.advance(10000);t.run("poll()");assert.equal(t.volumes.get("2"),0);
        t.speech(-20,3000);assert.equal(t.volumes.get("2"),0);
        t.speech(-20,500);assert(t.volumes.get("2")>0 && t.volumes.get("2")<100);
        t.speech(-20,1200);assert.equal(t.volumes.get("2"),155);
    });
    await test("Continuous blasts cannot periodically reopen a held volume", () => {
        const t=setup();t.run("poll()");t.store.autoMute=true;t.store.autoUnmute=3;
        t.speech(0,1000);const count=t.writes.length;t.speech(0,30000);
        assert.equal(t.volumes.get("2"),0);assert(t.writes.slice(count).every(w=>w.value===0));
    });
    await test("Zero and missing readings cannot falsely prove safe speech", () => {
        const t=setup();t.run("poll()");t.store.autoMute=true;t.store.autoUnmute=3;
        t.speech(0,1000);t.speech(-Infinity,12000);t.advance(12000);
        assert.equal(t.volumes.get("2"),0);
    });
    await test("A returning blast closes partial recovery before the next full-volume write", () => {
        const t=setup();t.run("poll()");t.store.autoMute=true;t.store.autoUnmute=3;t.store.dynamicUserVolume=false;
        t.speech(0,1000);t.speech(-20,3600);assert(t.volumes.get("2")>0);
        t.speech(0,100);assert.equal(t.volumes.get("2"),0);
        t.speech(-20,2000);assert.equal(t.volumes.get("2"),0);
    });
    await test("Brief natural speech pauses do not reset verified safe recovery", () => {
        const t=setup();t.run("poll()");t.store.autoMute=true;t.store.autoUnmute=3;t.store.dynamicUserVolume=false;
        t.speech(0,1000);t.speech(-20,2000);t.speech(-Infinity,500);t.speech(-20,2200);
        assert.equal(t.volumes.get("2"),100);
    });
    await test("Evidence gaps restart the complete safe interval", () => {
        const t=setup();t.run("poll()");t.store.autoMute=true;t.store.autoUnmute=3;
        t.speech(0,1000);t.speech(-20,2500);t.advance(2500);t.speech(-20,1500);
        assert.equal(t.volumes.get("2"),0);
    });
    await test("Another guard owns suppression without losing the original baseline", () => {
        const t=setup();t.run("poll()");t.store.autoMute=true;t.store.autoUnmute=3;
        t.run("plugins.StereoGuard={isHolding:()=>true,getHeldBaseline:()=>175}");
        t.speech(0,1000);assert.equal(t.run("savedVolume.get('2')"),175);
        t.speech(-20,6000);assert.equal(t.volumes.get("2"),0);
    });
    await test("Auto restore off never raises volume despite continuous safe speech", () => {
        const t=setup();t.run("poll()");t.store.autoMute=true;t.store.autoUnmute=0;
        t.speech(0,1000);t.speech(-20,20000);assert.equal(t.volumes.get("2"),0);
    });
    await test("Duplicated timestamps cannot fabricate continuing safe evidence", () => {
        const t=setup();t.run("poll()");t.store.autoMute=true;t.store.autoUnmute=3;
        t.speech(0,1000);t.sample(-20);const at=t.run("Date.now()");
        for(let i=0;i<50;i++){t.run(`volumeHolds.get("2").observe(true, ${at})`);t.advance(100);}
        assert.equal(t.volumes.get("2"),0);
    });
    await test("Manual volume changes during protection remain the user's choice", () => {
        const t=setup();t.run("poll()");t.store.autoMute=true;t.speech(0,1000);
        t.volumes.set("2",137);t.advance(100);
        assert.equal(t.volumes.get("2"),137);assert.equal(t.run("volumeHolds.size"),0);
    });
    await test("Disabling protection restores its mute and keeps balancing enabled", () => {
        const t=setup(); t.store.autoMute=true; t.speech(0,1000);
        t.store.autoMute=false; t.run("settings.defs.autoMute.onChange(false)");
        assert.equal(t.volumes.get("2"),100); assert(t.store.dynamicUserVolume);
    });
    await test("Gentler defaults keep ordinary loud speech near the manual volume", () => {
        const t=setup(); t.speech(-12,3000);
        assert(toSlider(t.volumes.get("2"))>90 && toSlider(t.volumes.get("2"))<100);
    });
    await test("Reduction limits and disabling boost are respected", () => {
        const t=setup(); t.store.dynamicMaxReduction=3; t.speech(0,3000);
        assert(t.volumes.get("2")>=70.7);
        t.run('restoreAll("silent")'); t.store.dynamicMaxBoost=0; t.speech(-35,5000);
        assert.equal(t.volumes.get("2"),100);
    });
    await test("Lower targets reduce more and faster response reacts sooner", () => {
        const a=setup(),b=setup(); a.store.dynamicResponse=150;b.store.dynamicResponse=400;
        a.speech(-3,300);b.speech(-3,300);assert(a.volumes.get("2")<b.volumes.get("2"));
        const c=setup(),d=setup();c.store.dynamicTarget=55;d.store.dynamicTarget=75;
        c.speech(-3,3000);d.speech(-3,3000);assert(c.volumes.get("2")<d.volumes.get("2"));
    });

    await test("A conflicting SSRC owner cannot mute or change the keyed participant", () => {
        const t=setup(); t.run("poll()"); t.store.autoMute=true;
        for(let i=0;i<5;i++) { t.stats({rtp:{inbound:{"3":{ssrc:12,audioLevel:1}}}});t.advance(1000); }
        assert.equal(t.writes.length,0);
    });
    await test("Self audio mislabeled under another member cannot affect anyone", () => {
        const t=setup();t.run("poll(); connection.getUserIdBySsrc=()=> '1'");t.store.autoMute=true;
        for(let i=0;i<5;i++) { t.stats({rtp:{inbound:{"2":{ssrc:12,audioLevel:1}}}});t.advance(1000); }
        assert.equal(t.writes.length,0);
    });
    await test("Explicit user identity conflicts cannot cause volume writes", () => {
        const t=setup();t.store.autoMute=true;
        for(let i=0;i<5;i++) { t.stats({rtp:{inbound:{"2":{userId:"1",audioLevel:1},"3":{user_id:"2",audioLevel:1}}}});t.advance(1000); }
        assert.equal(t.writes.length,0);
    });
    await test("Unknown numeric keys without a verified owner are ignored", () => {
        const t=setup();t.run("poll();connection.getUserIdBySsrc=()=>null");
        t.stats({rtp:{inbound:{"999":{audioLevel:1},"aggregate":{audioLevel:1}}}});t.advance(1000);
        assert.equal(t.writes.length,0);assert.equal(t.run("levels.has('999')"),false);
    });
    await test("Outgoing self audio never controls silent incoming participants", () => {
        const t=setup();t.store.autoMute=true;
        for(let i=0;i<5;i++) {t.stats({rtp:{outbound:{"1":{audioLevel:1}},inbound:{"2":{audioLevel:0},"3":{audioLevel:0}}}});t.advance(1000);}
        assert.equal(t.writes.length,0);
    });

    await test("Malformed explicit identities and outbound entries cannot control a member", () => {
        const t=setup();t.store.autoMute=true;
        for(let i=0;i<5;i++) {t.stats({rtp:{inbound:{"2":[{userId:1,audioLevel:1},{type:"outbound-rtp",audioLevel:1},{direction:"outbound",audioLevel:1}],"3":{user_id:"",audioLevel:1}}}});t.advance(1000);}
        assert.equal(t.writes.length,0);
    });
    await test("A failed SSRC lookup cannot fall back to a guessed participant", () => {
        const t=setup();t.run("poll();connection.getUserIdBySsrc=()=> {throw Error('no identity');}");t.store.autoMute=true;
        for(let i=0;i<5;i++) {t.stats({rtp:{inbound:{"2":{ssrc:12,audioLevel:1}}}});t.advance(1000);}
        assert.equal(t.writes.length,0);
    });

    await test("Startup migrates aggressive saved limits and restores held raw baselines", async () => {
        const t = setup({ "2": 20 });
        Object.assign(t.store, { dynamicTarget: 60, dynamicMaxReduction: 24, dynamicMaxBoost: 12, threshold: 80, sensitivity: 5, autoUnmute: 3 });
        t.persisted.set("MicSpamGuard_held_volumes", { "2": 155 });
        await t.plugin.start();
        assert.equal(t.store.dynamicTarget, 65);
        assert.equal(t.store.dynamicMaxReduction, 12);
        assert.equal(t.store.dynamicMaxBoost, 6);
        assert.equal(t.store.threshold, 98);
        assert.equal(t.store.sensitivity, 5);
        assert.equal(t.store.autoUnmute, 3);
        assert.equal(t.volumes.get("2"), 155);
        assert.equal(t.persisted.has("MicSpamGuard_held_volumes"), false);
        assert.equal(t.persisted.get("MicSpamGuard_balance_v2"), true);
        Object.assign(t.store, { dynamicTarget: 70, dynamicMaxReduction: 18, dynamicMaxBoost: 9, threshold: 95 });
        await t.plugin.start();
        assert.equal(t.store.dynamicTarget, 70);
        assert.equal(t.store.dynamicMaxReduction, 18);
        assert.equal(t.store.dynamicMaxBoost, 9);
        assert.equal(t.store.threshold, 95);
    });
    await test("Startup preserves already moderate saved settings", async () => {
        const t = setup();
        Object.assign(t.store, { dynamicTarget: 70, dynamicMaxReduction: 9, dynamicMaxBoost: 3, threshold: 95 });
        await t.plugin.start();
        assert.equal(t.store.dynamicTarget, 70);
        assert.equal(t.store.dynamicMaxReduction, 9);
        assert.equal(t.store.dynamicMaxBoost, 3);
        assert.equal(t.store.threshold, 95);
    });

    console.log(`${outcomes.length} behavior checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
