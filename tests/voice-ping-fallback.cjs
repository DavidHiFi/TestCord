const fs = require('node:fs');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const source = fs.readFileSync(process.argv[2] || 'src/testcordplugins/PanelLayout/index.tsx', 'utf8');
const pattern = source.match(/match: (\/\(\?<=_handleControlPing.+?\/),/)[1];
const match = new RegExp(pattern.slice(1, -1).replaceAll('\\i', '[A-Za-z_$][\\w$]*'));
const replacement = source.match(/replace: "(\(\$& && Date\.now[^\"]+)"/)[1];
let variants = 0;
for (const [file, original] of Object.entries({ a: '_handleControlPing(e){a.b.supports(c.d.NATIVE_PING)||this._handlePing(e)}', b: '_handleControlPing(p){x.y.supports(z.w.NATIVE_PING)||this._handlePing(p)}' })) {
    if (!original.includes('_handleControlPing(')) continue;
    assert.equal([...original.matchAll(new RegExp(match.source, 'g'))].length, 1);
    const patched = original.replace(match, replacement);
    const oldMethod = original.match(/_handleControlPing\([A-Za-z_$][\w$]*\)\{[^}]+\}/)[0];
    const method = patched.match(/_handleControlPing\([A-Za-z_$][\w$]*\)\{[^}]+\}/)[0];
    const supportCall = oldMethod.match(/([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\.supports\(([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\.NATIVE_PING\)/);
    const run = (code, native, pings) => {
        const sandbox = { Date: {now: () => 100000}, [supportCall[1]]: {[supportCall[2]]: {supports: () => native}}, [supportCall[3]]: {[supportCall[4]]: {NATIVE_PING: 'native'}} };
        const conn = vm.runInNewContext(`({${code},_handlePing(e){if(e!==undefined)this._pings.push({time:Date.now(),value:e})},_pings:[]})`, sandbox);
        conn._pings = structuredClone(pings);
        conn._handleControlPing(61);
        return conn._pings;
    };
    assert.equal(run(oldMethod, true, []).length, 0, 'Baseline reproduces blank native ping');
    assert.equal(run(method, true, []).at(-1).value, 61, 'Empty native ping uses voice heartbeat');
    assert.equal(run(method, true, [{time:99000,value:42}]).at(-1).value, 42, 'Fresh native ping takes priority');
    assert.equal(run(method, true, [{time:89999,value:42}]).at(-1).value, 61, 'Stale native ping recovers');
    assert.equal(run(method, false, [{time:99000,value:42}]).at(-1).value, 61, 'Web voice behavior stays intact');
    assert.equal(run(method, true, [{time:90000,value:42}]).at(-1).value, 61, 'Boundary recovers at ten seconds');
    variants++;
    console.log(`${file}: match and six behavior checks passed`);
}
assert.ok(variants >= 2, 'Both identifier layouts verified');
