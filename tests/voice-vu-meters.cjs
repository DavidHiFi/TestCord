const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const esbuild = require('esbuild');
const root = 'src/testcordplugins/';
let checks = 0;
function check(name, fn) { fn(); checks++; console.log('PASS ' + name); }
function load(name, exports) {
    const writes = [];
    const React = {
        createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
        useReducer: () => [0, () => {}], useRef: value => ({ current: value }), useEffect: () => {},
        useLayoutEffect: () => {}, useCallback: fn => fn, useState: value => [value, () => {}]
    };
    const settings = [];
    const sandbox = {
        console, Date, Float32Array, Map, Set, Math, Number, Object, Array,
        setInterval, clearInterval, setTimeout, clearTimeout, React, VencordCreateElement: React.createElement,
        document: { hidden: false, addEventListener: () => {}, removeEventListener: () => {} },
        requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
        performance: { now: () => Date.now() },
        ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
        ErrorBoundary: { wrap: fn => fn },
        Logger: class { error() {} debug() {} warn() {} info() {} },
        definePlugin: p => p,
        definePluginSettings: def => {
            const store = Object.fromEntries(Object.entries(def).map(([key, value]) => [key, value.default ?? value.options?.find(o => o.default)?.value]));
            const result = { def, store, use: () => store, withPrivateSettings() { return this; } }; settings.push(result); return result;
        },
        OptionType: { BOOLEAN: 3, SELECT: 4, SLIDER: 5, STRING: 0 },
        makeRange: (a, b, step = 1) => Array.from({ length: Math.floor((b - a) / step) + 1 }, (_, i) => a + i * step),
        findByPropsLazy: () => ({ setLocalVolume: (id, volume) => writes.push([id, volume]) }),
        MediaEngineStore: { isLocalMute: () => false, getLocalVolume: () => 100, isSelfMute: () => false },
        UserStore: { getCurrentUser: () => ({ id: 'self' }), getUser: id => ({ id }) },
        RelationshipStore: { isFriend: () => false },
        SelectedChannelStore: { getVoiceChannelId: () => 'channel' },
        VoiceStateStore: { getVoiceStatesForChannel: () => ({ self: {}, alice: {}, bob: {} }) },
        DataStore: { set: () => Promise.resolve() }, plugins: {}, TestcordDevs: { DavidHiFi: {}, Kurtzon: {} },
        showToast: () => {}, Toasts: { Type: { MESSAGE: 0 } },
        meterStyle: ''
    };
    vm.createContext(sandbox);
    const source = fs.readFileSync(root + name + '/index.tsx', 'utf8')
        .replace(/^import .*;\r?\n/gm, '').replace('export default definePlugin(', 'const plugin = definePlugin(');
    const suffix = `\nglobalThis.test = { ${exports}, settings, setConnection: value => { connection = value; }, plugin };`;
    const helper = name === "StereoGuard" ? fs.readFileSync(root + name + "/protection.ts", "utf8").replace("export class VolumeHold", "class VolumeHold") : "";
    const input = helper + "\n" + source + suffix;
    const options = { loader: 'tsx', jsxFactory: 'VencordCreateElement', target: 'esnext' };
    let code;
    try {
        code = esbuild.transformSync(input, options).code;
    } catch (error) {
        // Confined environments cannot spawn esbuild's piped service process;
        // fall back to in-process TypeScript transpilation.
        if (error.code !== 'EPERM') throw error;
        const ts = require('typescript');
        code = ts.transpileModule(input, { fileName: 'plugin.tsx', compilerOptions: { jsx: ts.JsxEmit.React, jsxFactory: 'VencordCreateElement', target: ts.ScriptTarget.ESNext } }).outputText;
    }
    vm.runInContext(code, sandbox);
    return { api: sandbox.test, sandbox, writes };
}
const vu = load('VoiceVUMeters', 'readChannel, readLevels, newMeter, meters, VoiceMeter, createWebMeter, syncSelfInput, dropAll, getPan, smooth, MeterBar, tick, readNativeLevels, readStreamLevels, setStreamAmplitude, syncDesktopMeters, isAudioActive, audioActiveUsers, setLastScan: value => { lastScanAt = value; }, setSelfSentAt: value => { selfSentAt = value; }, getSelfSentAt: () => selfSentAt');
check('Meter frame loop waits 33 ms before asking for the next frame', () => {
    const loop = load('VoiceVUMeters', 'frameTick, meters, newMeter, meterDoms');
    const frames = [], timers = [];
    loop.sandbox.requestAnimationFrame = cb => frames.push(cb);
    loop.sandbox.setTimeout = (cb, ms) => timers.push([cb, ms]);
    loop.api.meters.set('a', loop.api.newMeter(true));
    loop.api.meterDoms.set('a', new Set());
    loop.api.frameTick();
    assert.equal(frames.length, 0);
    assert.deepEqual(timers.map(t => t[1]), [33]);
    timers[0][0]();
    assert.equal(frames.length, 1);
});
function tone(amp = .3) { return Float32Array.from({ length: 2048 }, (_, i) => amp * Math.sin(i * .1)); }
const sound = tone();
const silence = new Float32Array(2048);
function level(samples) { return vu.api.readChannel({ getFloatTimeDomainData: target => target.set(samples) }, new Float32Array(samples.length), -60); }
check('Hard left has active left and zero right', () => { assert(level(sound).rms > .7); assert.equal(level(silence).rms, 0); });
check('Hard right has zero left and active right', () => { assert.equal(level(silence).peak, 0); assert(level(sound).peak > .7); });
check('Scalar levels resolve SSRC identity rather than numeric array keys', () => {
    vu.api.meters.set('bob', vu.api.newMeter(true));
    vu.api.readLevels({ getUserIdBySsrc: ssrc => ssrc === 42 ? 'bob' : null }, { rtp: { inbound: { '0': { type: 'audio', ssrc: 42, audioLevel: .4 } } } });
    assert.equal(vu.api.meters.get('bob').amplitude, .4);
});
check('Conflicting SSRC and participant keys do not update either user', () => {
    vu.api.meters.set('alice', vu.api.newMeter(true));
    vu.api.readLevels({ getUserIdBySsrc: () => 'bob' }, { rtp: { inbound: { alice: { type: 'audio', ssrc: 42, audioLevel: .8 } } } });
    assert.equal(vu.api.meters.get('bob').amplitude, .4); assert.equal(vu.api.meters.get('alice').amplitude, 0);
});
check('Remote scalar participants keep two bars and a divider', () => {
    const rendered = vu.api.VoiceMeter({ userId: 'bob' });
    assert.equal(rendered.props['data-vu-meter'], 'level');
    assert.match(rendered.props.title, /one level per participant/);
    assert.equal(rendered.props.children.filter(Boolean).length, 3);
});
check('Remote scalar level follows local pan into each bar', () => {
    vu.sandbox.MediaEngineStore.getLocalPan = id => id === 'bob' ? { left: 1, right: 0 } : { left: 1, right: 1 };
    assert.deepEqual([...vu.api.getPan('bob')], [1, 0]);
    assert.deepEqual([...vu.api.getPan('alice')], [1, 1]);
    delete vu.sandbox.MediaEngineStore.getLocalPan;
    assert.deepEqual([...vu.api.getPan('bob')], [1, 1]);
});
check('Real stereo streams render separate bars and divider', () => {
    vu.api.meters.set('stereo', { ...vu.api.newMeter(false), tap: {} });
    const rendered = vu.api.VoiceMeter({ userId: 'stereo' });
    assert.equal(rendered.props['data-vu-meter'], 'lr');
    assert.equal(rendered.props.children.filter(Boolean).length, 3);
});
check('Peak marker holds for 1500 ms', () => {
    const m = vu.api.newMeter(false);
    vu.api.smooth(m, 0, .6, .9, 1000);
    vu.api.smooth(m, 0, 0, 0, 2400);
    assert.equal(m.peak[0], .9);
});
check('Peak marker falls at 12 dB per second after hold', () => {
    const m = vu.api.newMeter(false);
    vu.api.smooth(m, 0, .6, .9, 1000);
    vu.api.smooth(m, 0, 0, 0, 3500);
    assert(Math.abs(m.peak[0] - .7) < 1e-9);
});
check('Peak fall is independent of callback cadence', () => {
    const a = vu.api.newMeter(false), b = vu.api.newMeter(false);
    vu.api.smooth(a, 0, .6, .9, 1000);
    vu.api.smooth(b, 0, .6, .9, 1000);
    for (let t = 1050; t <= 3500; t += 50) vu.api.smooth(a, 0, 0, 0, t);
    vu.api.smooth(b, 0, 0, 0, 3500);
    assert(Math.abs(a.peak[0] - b.peak[0]) < 1e-9);
});
check('Each channel holds its own peak', () => {
    const m = vu.api.newMeter(false);
    vu.api.smooth(m, 0, .6, .9, 1000);
    vu.api.smooth(m, 1, 0, 0, 1000);
    assert.equal(m.peak[0], .9); assert.equal(m.peak[1], 0);
});
check('Full-scale peak marker remains inside the bar', () => {
    const rendered = vu.api.MeterBar({ width: 4, value: 1, peak: 1, showPeak: true });
    const marker = rendered.props.children[1];
    assert.match(marker.props.style.top, /^clamp\(0px,/);
    assert.equal(marker.props.style.height, 2);
});
check('Startup enables requested peak hold once, then respects later preferences', () => {
    vu.api.settings.store.showPeak = false;
    vu.api.meters.clear(); vu.api.plugin.start(); vu.api.plugin.stop();
    assert.equal(vu.api.settings.store.showPeak, true);
    vu.api.settings.store.showPeak = false;
    vu.api.meters.clear(); vu.api.plugin.start(); vu.api.plugin.stop();
    assert.equal(vu.api.settings.store.showPeak, false);
});
check('Identical mix and scalar readings can conceal reversed participant channels', () => {
    const wave = [.5, -.5];
    const sceneA = { alice: [wave, [0, 0]], bob: [[0, 0], wave] };
    const sceneB = { alice: [[0, 0], wave], bob: [wave, [0, 0]] };
    const mix = scene => [0, 1].map(c => wave.map((_, i) => scene.alice[c][i] + scene.bob[c][i]));
    const energy = channels => Math.sqrt(channels.flat().reduce((n, v) => n + v*v, 0)/4);
    assert.deepEqual(mix(sceneA), mix(sceneB));
    assert.equal(energy(sceneA.alice), energy(sceneB.alice));
    assert.equal(energy(sceneA.bob), energy(sceneB.bob));
    assert.notDeepEqual(sceneA.alice, sceneB.alice);
});
async function inputChecks() {
    const v = load('VoiceVUMeters', 'readChannel, readLevels, newMeter, meters, VoiceMeter, createWebMeter, syncSelfInput, dropAll, getPan, smooth, MeterBar, tick, readNativeLevels, setLastScan: value => { lastScanAt = value; }');
    const conn = { context: 'default' };
    v.api.setConnection(conn);
    let stopped = 0, closed = 0, requests = 0, constraints;
    const node = () => ({ connect() {}, disconnect() {} });
    v.sandbox.AudioContext = class {
        destination = {};
        createMediaStreamSource() { return node(); }
        createChannelSplitter() { return node(); }
        createAnalyser() { return { ...node(), fftSize: 1024 }; }
        createGain() { return { ...node(), gain: { value: 1 } }; }
        async resume() {}
        async close() { closed++; }
    };
    v.sandbox.MediaEngineStore.getInputDeviceId = () => 'native-input';
    v.sandbox.MediaEngineStore.getMediaEngine = () => ({ getAudioInputDevices: async () => [{ id: 'native-input', originalId: 'browser-input', name: 'Selected input' }] });
    const track = { getSettings: () => ({ channelCount: 2 }), stop: () => { stopped++; } };
    const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
    v.sandbox.navigator = { mediaDevices: {
        enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'browser-input', label: 'Selected input' }],
        getUserMedia: async value => { requests++; constraints = value; return stream; }
    } };
    await v.api.syncSelfInput(conn);
    check('Self capture selects the exact Discord input without processing', () => {
        assert.equal(constraints.audio.deviceId.exact, 'browser-input');
        assert.equal(constraints.audio.echoCancellation, false);
        assert.equal(constraints.audio.noiseSuppression, false);
        assert.equal(constraints.audio.autoGainControl, false);
        assert.equal(v.api.meters.get('self').ownsInput, true);
        assert.equal(v.api.VoiceMeter({ userId: 'self' }).props['data-vu-meter'], 'lr');
    });
    await v.api.syncSelfInput(conn);
    check('Self capture is reused while the selected device is unchanged', () => assert.equal(requests, 1));
    v.api.dropAll();
    check('Disconnect stops the capture track and closes its owned context', () => { assert.equal(stopped, 1); assert.equal(closed, 1); });
    let finish;
    v.sandbox.navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { finish = resolve; });
    const pending = v.api.syncSelfInput(conn);
    while (!finish) await new Promise(resolve => setImmediate(resolve));
    v.api.dropAll();
    finish(stream);
    await pending;
    check('Late input capture is discarded after disconnect', () => { assert.equal(stopped, 2); assert.equal(v.api.meters.size, 0); });
    console.log(`${checks} regression checks passed.`);
}
inputChecks().catch(error => { console.error(error); process.exitCode = 1; });

const nativeConnection = { context: 'default' };
vu.sandbox.MediaEngineStore.getMediaEngine = () => ({ connections: [nativeConnection] });
vu.api.setConnection(nativeConnection);
let nativeLevels = [];
let nativeBridgeInstalled = true;
vu.sandbox.DiscordNative = { nativeModules: { requireModule: () => ({
    getParticipantStereoLevels: () => ({ installed: nativeBridgeInstalled, connection: 1, levels: nativeLevels })
}) } };
function nativeTick() { vu.api.setLastScan(Date.now()); vu.api.tick(); }
function nativeLevel(userId, left, right, ageMs = 0) {
    return { userId, ageMs, channels: 2, rmsLeft: left, rmsRight: right, peakLeft: left, peakRight: right };
}
check('Native remote hard-left/right reaches independent participant bars despite local pan', () => {
    vu.api.meters.clear();
    vu.api.meters.set('alice', vu.api.newMeter(true)); vu.api.meters.set('bob', vu.api.newMeter(true));
    nativeLevels = [nativeLevel('alice', .5, 0), nativeLevel('bob', 0, .4)]; nativeTick();
    const a = vu.api.meters.get('alice'), b = vu.api.meters.get('bob');
    assert(a.display[0] > .8); assert.equal(a.display[1], 0);
    assert.equal(b.display[0], 0); assert(b.display[1] > .8);
    assert.equal(vu.api.VoiceMeter({userId:'alice'}).props['data-vu-meter'],'lr');
});
check('Missing native samples cannot reuse scalar levels as stereo', () => {
    vu.api.meters.clear(); const m = vu.api.newMeter(true); m.amplitude = .9; vu.api.meters.set('alice',m);
    nativeLevels = []; nativeTick(); assert.equal(m.display[0],0); assert.equal(m.display[1],0);
});
check('Stale, invalid and unknown native participant samples are ignored', () => {
    nativeLevels = [nativeLevel('alice', .8, .8, 151),nativeLevel('unknown',.8,.8),nativeLevel('bob',NaN,.4)];
    nativeTick(); assert.equal(vu.api.meters.get('alice').native,undefined); assert.equal(vu.api.meters.has('unknown'),false);
});
check('Native simultaneous channels swap without participant identity swapping', () => {
    vu.api.meters.clear();vu.api.meters.set('alice',vu.api.newMeter(true));vu.api.meters.set('bob',vu.api.newMeter(true));
    nativeLevels = [nativeLevel('alice',0,.5),nativeLevel('bob',.4,0)];nativeTick();
    assert.equal(vu.api.meters.get('alice').display[0],0);assert(vu.api.meters.get('alice').display[1]>.8);
    assert(vu.api.meters.get('bob').display[0]>.8);assert.equal(vu.api.meters.get('bob').display[1],0);
});
check('Audio activity tracks native levels and clears when they stop', () => {
    vu.api.meters.clear();
    vu.api.meters.set('alice', vu.api.newMeter(true)); vu.api.meters.set('bob', vu.api.newMeter(true));
    nativeLevels = [nativeLevel('alice', .5, 0), nativeLevel('bob', 0, .4)]; nativeTick();
    assert.equal(vu.api.isAudioActive('alice'), true);
    assert.equal(vu.api.isAudioActive('bob'), true);
    assert.equal(vu.api.isAudioActive('nobody'), false);
    vu.api.meters.get('alice').display[0] = 0; vu.api.meters.get('alice').display[1] = 0; vu.api.meters.get('alice').activeUntil = 0;
    nativeLevels = [nativeLevel('bob', 0, .4)]; nativeTick();
    assert.equal(vu.api.isAudioActive('alice'), false);
    assert.equal(vu.api.isAudioActive('bob'), true);
});
check('Flagged speaker the bridge misses falls back to stats after the gap, covered speakers stay native', () => {
    vu.api.meters.clear();
    vu.api.setConnection(nativeConnection);
    nativeConnection.localSpeakingFlags = { alice: 1, bob: 1, carl: 0 };
    const [a, b, c] = ['alice', 'bob', 'carl'].map(id => { const m = vu.api.newMeter(true); vu.api.meters.set(id, m); return m; });
    b.amplitude = .4; c.amplitude = .4;
    nativeLevels = [nativeLevel('alice', .5, 0)]; nativeTick();
    assert.equal(b.nativeGap, false); assert.equal(b.display[0], 0); // grace: hangover or first frames
    b.nativeMissAt = Date.now() - 600; nativeTick();
    assert.equal(b.nativeGap, true); assert(b.display[0] > 0);
    assert.equal(a.nativeGap, false); assert(a.display[0] > .8); assert.equal(a.display[1], 0);
    assert.equal(c.nativeGap, false); assert.equal(c.display[0], 0); // unflagged silence stays flat
    nativeLevels = [nativeLevel('alice', .5, 0), nativeLevel('bob', 0, .4)]; nativeTick();
    assert.equal(b.nativeGap, false); assert.equal(b.nativeMissAt, undefined); // bridge recovers, native wins again
    delete nativeConnection.localSpeakingFlags;
});
check('Stream meters ignore the native bridge so soundshare moves while it is installed', () => {
    vu.api.meters.clear();
    nativeLevels = [];
    vu.api.setStreamAmplitude('alice', .5); nativeTick();
    const s = vu.api.meters.get('stream:alice');
    assert.notEqual(s.nativeAvailable, true); assert(s.display[0] > .5);
    assert.equal(vu.api.isAudioActive('alice'), false); // soundshare is not the person's mic
});
check('Received audio lights the glow before the speaking flag arrives or while a stale zero flag lingers', () => {
    vu.api.meters.clear();
    nativeBridgeInstalled = false; // bridge not connected yet: stats are the only level source
    nativeConnection.localSpeakingFlags = { alice: 0 };
    const [a, b] = ['alice', 'bob'].map(id => { const m = vu.api.newMeter(true); m.amplitude = .3; vu.api.meters.set(id, m); return m; });
    nativeTick();
    assert.equal(vu.api.isAudioActive('alice'), true); // flag says silent, audio says otherwise
    assert.equal(vu.api.isAudioActive('bob'), true);   // no flag entry at all
    assert(a.display[0] === 0); // the bar keeps following the flag, only the glow reads the raw level
    delete nativeConnection.localSpeakingFlags;
    nativeBridgeInstalled = true;
});
check('The glow follows the first audio from the bridge without waiting for smoothing', () => {
    vu.api.meters.clear();
    const m = vu.api.newMeter(true); vu.api.meters.set('alice', m);
    nativeLevels = [nativeLevel('alice', .5, .5)]; nativeTick();
    assert.equal(vu.api.isAudioActive('alice'), true);
    assert((m.activeUntil ?? 0) > Date.now());
});
check('The glow ends once the audio stops, within the hold', () => {
    vu.api.meters.clear();
    nativeBridgeInstalled = false;
    const m = vu.api.newMeter(true); m.amplitude = .3; vu.api.meters.set('alice', m);
    nativeTick(); assert.equal(vu.api.isAudioActive('alice'), true);
    m.amplitude = 0;
    const armedUntil = m.activeUntil;
    nativeTick();
    assert.equal(m.activeUntil, armedUntil); // silence never extends the hold
    assert(armedUntil - Date.now() <= 200);
    m.activeUntil = Date.now() - 1; nativeTick();
    assert.equal(vu.api.isAudioActive('alice'), false);
    nativeBridgeInstalled = true;
});
check('Room noise below the active level does not light the glow', () => {
    vu.api.meters.clear();
    nativeBridgeInstalled = false;
    const m = vu.api.newMeter(true); m.amplitude = .0005; vu.api.meters.set('alice', m);
    nativeTick();
    assert.equal(vu.api.isAudioActive('alice'), false);
    nativeBridgeInstalled = true;
});
check('Soundshare audio never lights the streamer voice glow', () => {
    vu.api.meters.clear();
    nativeBridgeInstalled = false; // exercise the stats path, not the fake bridge
    const voiceConn = { context: 'default' };
    vu.api.setConnection(voiceConn);
    vu.sandbox.MediaEngineStore.getMediaEngine = () => ({ connections: [voiceConn, { context: 'stream', streamUserId: 'self', soundshareActive: true }] });
    vu.api.readStreamLevels({ context: 'stream', streamUserId: 'self', soundshareActive: true }, { rtp: { outbound: [{ type: 'audio', ssrc: 199, audioLevel: .5 }] } });
    vu.api.tick();
    nativeBridgeInstalled = true;
    assert.equal(vu.api.isAudioActive('self'), false);
    assert(vu.api.meters.get('stream:self').amplitude > .4);
});
check('Stream soundshare outbound feeds the streamer stream meter, not the voice meter', () => {
    vu.api.meters.clear();
    const voiceConn = { context: 'default' };
    vu.api.setConnection(voiceConn);
    vu.sandbox.MediaEngineStore.getMediaEngine = () => ({ connections: [voiceConn, { context: 'stream', streamUserId: 'self', soundshareActive: true }] });
    vu.api.readStreamLevels({ context: 'stream', streamUserId: 'self', soundshareActive: true }, { rtp: { outbound: [{ type: 'audio', ssrc: 199, audioLevel: .5 }] } });
    assert(vu.api.meters.get('stream:self').amplitude > .4);
});
check('Viewer stream connection inbound feeds the streamer stream meter', () => {
    vu.api.readStreamLevels({ context: 'stream', streamUserId: 'alice' }, { rtp: { inbound: { 0: { type: 'audio', ssrc: 322, audioLevel: .3 } } } });
    assert(vu.api.meters.get('stream:alice').amplitude > .2);
});
check('Stream without an audio track never creates a meter', () => {
    vu.api.readStreamLevels({ context: 'stream', streamUserId: 'carl' }, { rtp: { inbound: { 0: { type: 'video', ssrc: 5 } } } });
    assert.equal(vu.api.meters.has('stream:carl'), false);
});
check('Stream meter keys survive the desktop member sweep', () => {
    vu.api.syncDesktopMeters();
    assert(vu.api.meters.has('stream:alice'));
});
check('Stale stream meters release instead of pinning', () => {
    const m = vu.api.meters.get('stream:alice');
    m.lastStreamAt = Date.now() - 4000;
    nativeTick();
    assert.equal(vu.api.meters.has('stream:alice'), false);
});
vu.sandbox.MediaEngineStore.getMediaEngine = () => ({ connections: [nativeConnection] });
vu.api.setConnection(nativeConnection);
function selfTap(samples) {
    const reader = { getFloatTimeDomainData: target => target.set(samples) };
    return { output: {}, source: {}, splitter: {}, left: reader, right: reader, silent: {}, bufLeft: new Float32Array(2048), bufRight: new Float32Array(2048) };
}
check('Flagged speaker with no audio level shows no bars', () => {
    vu.api.meters.clear();
    nativeBridgeInstalled = false;
    nativeConnection.localSpeakingFlags = { carl: 1 };
    const m = vu.api.newMeter(true); vu.api.meters.set('carl', m);
    nativeTick();
    assert.equal(m.display[0], 0); assert.equal(m.display[1], 0);
    assert.equal(vu.api.isAudioActive('carl'), false);
    delete nativeConnection.localSpeakingFlags;
    nativeBridgeInstalled = true;
});
check('Self tap stays flat while Discord sends nothing, even with the mic loud', () => {
    vu.api.meters.clear();
    const m = vu.api.newMeter(true, selfTap(sound)); m.ownsInput = true; vu.api.meters.set('self', m);
    vu.api.setSelfSentAt(0); m.display[0] = 0; m.display[1] = 0; m.activeUntil = 0;
    nativeTick();
    assert.equal(m.display[0], 0); assert.equal(vu.api.isAudioActive('self'), false);
    vu.api.setSelfSentAt(Date.now());
    nativeTick();
    assert(m.display[0] > .3); assert.equal(vu.api.isAudioActive('self'), true);
});
check('Outbound above the send floor marks Discord as sending, silence and mute do not', () => {
    vu.api.setSelfSentAt(0);
    vu.api.readLevels(nativeConnection, { rtp: { outbound: { audioLevel: .0000305 } } });
    assert.equal(vu.api.getSelfSentAt(), 0);
    vu.api.readLevels(nativeConnection, { rtp: { outbound: { audioLevel: .2 } } });
    assert(vu.api.getSelfSentAt() > 0);
    vu.api.setSelfSentAt(0);
    vu.sandbox.MediaEngineStore.isSelfMute = () => true;
    vu.api.readLevels(nativeConnection, { rtp: { outbound: { audioLevel: .2 } } });
    vu.sandbox.MediaEngineStore.isSelfMute = () => false;
    assert.equal(vu.api.getSelfSentAt(), 0);
});
check('Silent self tap while Discord sends falls back to outbound levels', () => {
    const v = load('VoiceVUMeters', 'checkSelfMismatch, newMeter, meters, setLastStatsAt: value => { lastStatsAt = value; }');
    const m = v.api.newMeter(true); m.ownsInput = true; v.api.meters.set('self', m);
    const start = Date.now();
    v.api.setLastStatsAt(start);
    v.api.checkSelfMismatch(m, false, 0, start);
    v.api.checkSelfMismatch(m, false, 0, start + 1000);
    assert.equal(v.api.meters.get('self'), m, 'a short silence keeps the tap');
    v.api.checkSelfMismatch(m, false, .3, start + 1100);
    v.api.checkSelfMismatch(m, false, 0, start + 1200);
    v.api.checkSelfMismatch(m, false, 0, start + 3000);
    assert.equal(v.api.meters.get('self'), m, 'speech on the tap restarts the hold');
    v.api.checkSelfMismatch(m, true, 0, start + 3500);
    v.api.setLastStatsAt(start + 4300);
    v.api.checkSelfMismatch(m, false, 0, start + 4300);
    assert.equal(v.api.meters.has('self'), false, 'a tap silent through 3 s of sending is dropped, pauses included');
});
check('Self tap keeps fast stats while a stream meter is up', () => {
    const v = load('VoiceVUMeters', 'statsPollMs, newMeter, meters');
    const self = v.api.newMeter(true, {}); self.ownsInput = true; v.api.meters.set('self', self);
    const stream = v.api.newMeter(false); stream.nativeAvailable = true; v.api.meters.set('stream:self', stream);
    assert.equal(v.api.statsPollMs(), 250);
});
check('Discord voice activity drives the self meter and its send gate', () => {
    const v = load('VoiceVUMeters', 'syncVoiceActivity, readLevels, newMeter, meters, getSelfSentAt: () => selfSentAt, setLastStatsAt: value => { lastStatsAt = value; }');
    const listeners = {};
    const engine = { on: (e, fn) => { listeners[e] = fn; }, removeListener: (e, fn) => { if (listeners[e] === fn) delete listeners[e]; } };
    v.sandbox.MediaEngineStore.getMediaEngine = () => engine;
    const m = v.api.newMeter(true); v.api.meters.set('self', m);
    v.api.syncVoiceActivity(true);
    assert.equal(typeof listeners.voiceactivity, 'function', 'subscribes while a self meter is wanted');
    listeners.voiceactivity(-20, 1);
    assert.ok(Math.abs(m.amplitude - 0.1) < 1e-9, '-20 dB reads as 0.1 linear');
    assert.ok(Date.now() - v.api.getSelfSentAt() < 50, 'speaking opens the tap gate at once');
    v.api.readLevels({}, { rtp: { outbound: { type: 'audio', audioLevel: 0.9 } } });
    assert.ok(Math.abs(m.amplitude - 0.1) < 1e-9, 'stale stats do not overwrite fresh voice activity');
    listeners.voiceactivity(-100, 0);
    assert.equal(m.amplitude, 0, '-100 dB is silence');
    v.sandbox.MediaEngineStore.isSelfMute = () => true;
    listeners.voiceactivity(-10, 1);
    assert.equal(m.amplitude, 0, 'self mute shows nothing');
    v.api.syncVoiceActivity(false);
    assert.equal(listeners.voiceactivity, undefined, 'unsubscribes so the engine stops emitting');
});
check('A self tap that keeps going silent ends up suspended', () => {
    const src = require('node:fs').readFileSync('src/testcordplugins/VoiceVUMeters/index.tsx', 'utf8');
    const adopt = src.slice(src.indexOf('meter.ownsInput = true;'), src.indexOf('inputKey = deviceKey;'));
    assert.ok(!/inputMismatchDrops\s*=\s*0/.test(adopt), 'adopting a tap must not reset the drop count');
});
check('A silent self tap shows Discord voice level instead of flat bars', () => {
    const v = load('VoiceVUMeters', 'advanceEnvelopes, onVoiceActivity, newMeter, meters, setSelfSentAt: value => { selfSentAt = value; }');
    v.api.meters.clear();
    const m = v.api.newMeter(true, selfTap(silence)); m.ownsInput = true; v.api.meters.set('self', m);
    v.api.onVoiceActivity(-20, 1);
    v.api.advanceEnvelopes(Date.now());
    assert.ok(m.display[0] > .5 && m.display[1] > .5, 'dead tap falls back to the voice activity level at once');
    v.api.onVoiceActivity(-100, 0);
    m.display[0] = 0; m.display[1] = 0;
    v.api.advanceEnvelopes(Date.now() + 1000);
    assert.equal(m.display[0], 0, 'silence stays flat');
    v.sandbox.MediaEngineStore.isSelfMute = () => true;
    v.api.onVoiceActivity(-10, 1);
    v.api.advanceEnvelopes(Date.now() + 2000);
    assert.equal(m.display[0], 0, 'self mute stays flat');
});
check('A real tap level wins over the voice activity level', () => {
    const v = load('VoiceVUMeters', 'advanceEnvelopes, onVoiceActivity, newMeter, meters');
    v.api.meters.clear();
    const m = v.api.newMeter(true, selfTap(sound)); m.ownsInput = true; v.api.meters.set('self', m);
    v.api.onVoiceActivity(-50, 1);
    v.api.advanceEnvelopes(Date.now());
    assert.ok(m.display[0] > .7, 'tap with sound is shown as measured');
});
check('Own bars follow speech when Discord never sets the speaking flag', () => {
    const v = load('VoiceVUMeters', 'advanceEnvelopes, onVoiceActivity, readLevels, newMeter, meters');
    for (const tap of [selfTap(silence), undefined]) {
        v.api.meters.clear();
        const m = v.api.newMeter(true, tap); m.ownsInput = !!tap; v.api.meters.set('self', m);
        v.api.onVoiceActivity(-20, 0);
        v.api.readLevels({}, { rtp: { outbound: { type: 'audio', audioLevel: 0.1, audioDetected: 1 } } });
        v.api.advanceEnvelopes(Date.now());
        assert.ok(m.display[0] > .5 && m.display[1] > .5, 'bars show speech Discord detected even with flags 0');
    }
    v.api.meters.clear();
    const idle = v.api.newMeter(true, selfTap(silence)); idle.ownsInput = true; v.api.meters.set('self', idle);
    v.api.onVoiceActivity(-100, 0);
    v.api.readLevels({}, { rtp: { outbound: { type: 'audio', audioLevel: 0.012, audioDetected: 0 } } });
    v.api.advanceEnvelopes(Date.now() + 5000);
    assert.equal(idle.display[0], 0, 'no detected speech stays flat');
});
console.log(`${checks} total checks passed`);
