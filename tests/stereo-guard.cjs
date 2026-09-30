const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path'),esbuild=require('esbuild');
let count=0;
function test(name,fn){fn();count++;console.log('PASS '+name);}
const helper=fs.readFileSync(path.join(__dirname,'../src/testcordplugins/StereoGuard/protection.ts'),'utf8').replace('export class VolumeHold','class VolumeHold');
const source=fs.readFileSync(path.join(__dirname,'../src/testcordplugins/StereoGuard/index.tsx'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default definePlugin(','const plugin = definePlugin(');
function setup(){
 let now=100000;const volumes=new Map([['alice',175],['bob',100]]),writes=[],saved=new Map();
 const output={stream:{getAudioTracks:()=>[{getSettings:()=>({channelCount:2})}]}};
 const conn={context:'default',outputs:{alice:output}};
 const sandbox={console,Date:{now:()=>now},setInterval:()=>1,clearInterval(){},plugins:{}, TestcordDevs: { DavidHiFi: { name: "DavidHiFi" } },UserAreaButton(){},openPluginModal(){},React:{},Button:{},Logger:class{debug(){}error(...args){throw Error(args.join(' '));}},
 DataStore:{set:(k,v)=>{saved.set(k,v);return Promise.resolve();},get:async k=>saved.get(k),del:async k=>saved.delete(k)},
 definePlugin:p=>p,makeRange:(a,b,step=1)=>Array.from({length:Math.floor((b-a)/step)+1},(_,i)=>a+i*step),OptionType:{BOOLEAN:3,SELECT:4,SLIDER:5,STRING:0},
 definePluginSettings:def=>({def,store:Object.fromEntries(Object.entries(def).map(([k,d])=>[k,d.default??d.options?.find(x=>x.default)?.value]))}),
 findByPropsLazy:()=>({setLocalVolume:(id,value)=>{assert(Number.isFinite(value));volumes.set(id,value);writes.push({id,value,at:now});}}),
 MediaEngineStore:{getMediaEngine:()=>({connections:[conn]}),isLocalMute:()=>false,getLocalVolume:id=>volumes.get(id)??100},
 UserStore:{getCurrentUser:()=>({id:'self'}),getUser:id=>({id})},RelationshipStore:{isFriend:()=>false},showToast(){},Toasts:{Type:{MESSAGE:1}},navigator:{}};
 vm.createContext(sandbox);vm.runInContext(esbuild.transformSync(helper+'\n'+source+'\nglobalThis.api={sample,poll,settings,meters,mute,unmute,volumeHolds,savedVolume,updateProtection};connection=globalThis.conn;', {loader:'tsx'}).code, Object.assign(sandbox,{conn}));
 const tone=Float32Array.from({length:2048},(_,i)=>.3*Math.sin(i*.1)),zero=new Float32Array(2048);
 const node={disconnect(){}};
 const meter={source:node,processor:{...node},silent:node,output,mono:false,bufLeft:tone,bufRight:zero,frameAt:{value:now},score:0,pans:[],panAt:[],loudTicks:[],lastTriggerAt:0};
 sandbox.api.meters.set('alice',meter);sandbox.api.settings.store.autoUnmute=3;
 function frame(kind,ms=100){now+=ms;meter.frameAt.value=now;meter.bufLeft=kind==='silence'?zero:tone;meter.bufRight=kind==='hot'?zero:kind==='silence'?zero:tone;sandbox.api.sample('alice',meter,now,1);sandbox.api.updateProtection(now);}
 function hold(){frame('hot');assert.equal(volumes.get('alice'),0);}
 function advance(ms){now+=ms;sandbox.api.updateProtection(now);}
 return {sandbox,volumes,writes,meter,conn,frame,hold,advance,now:()=>now};
}
test('Sustained stereo remains at zero without timer reopenings',()=>{const t=setup();t.hold();for(let i=0;i<300;i++)t.frame('hot');assert.equal(t.volumes.get('alice'),0);assert.equal(t.volumes.get('bob'),100);});
test('Missing or stale stereo frames never count as quiet evidence',()=>{const t=setup();t.hold();t.advance(20000);assert.equal(t.volumes.get('alice'),0);});
test('Fresh silent owned frames permit a slow return to the exact baseline',()=>{const t=setup();t.hold();for(let i=0;i<31;i++)t.frame('silence');assert.equal(t.volumes.get('alice'),0);for(let i=0;i<5;i++)t.frame('silence');assert(t.volumes.get('alice')>0&&t.volumes.get('alice')<175);for(let i=0;i<15;i++)t.frame('silence');assert.equal(t.volumes.get('alice'),175);});
test('A stereo relapse immediately closes partial recovery',()=>{const t=setup();t.hold();for(let i=0;i<37;i++)t.frame('silence');assert(t.volumes.get('alice')>0);t.frame('hot');assert.equal(t.volumes.get('alice'),0);});
test('A safe-audio gap restarts the complete quiet period',()=>{const t=setup();t.hold();for(let i=0;i<25;i++)t.frame('silence');t.advance(1000);for(let i=0;i<15;i++)t.frame('silence');assert.equal(t.volumes.get('alice'),0);});
test('Manual zero cannot be restored over the owner\'s change',()=>{const t=setup();t.hold();for(let i=0;i<37;i++)t.frame('silence');t.volumes.set('alice',0);t.advance(50);assert.equal(t.volumes.get('alice'),0);assert.equal(t.sandbox.api.volumeHolds.size,0);});
test('Another guard prevents stereo recovery from raising its held user',()=>{const t=setup();t.sandbox.plugins.MicSpamGuard={isHolding:()=>true,getHeldBaseline:()=>137};t.hold();assert.equal(t.sandbox.api.savedVolume.get('alice'),137);for(let i=0;i<60;i++)t.frame('silence');assert.equal(t.volumes.get('alice'),0);});
test('Unsafe samples that are not consecutive cannot accumulate into a mute',()=>{const t=setup();for(let i=0;i<6;i++){t.meter.frameAt.value=t.now()+1;t.sandbox.api.sample('alice',t.meter,t.now()+1,6);t.frame('silence');}assert.equal(t.volumes.get('alice'),175);});
test('Restoration after disconnection releases the guard hold',()=>{const t=setup();t.hold();delete t.conn.outputs.alice;t.sandbox.api.poll();assert.equal(t.volumes.get('alice'),175);assert.equal(t.sandbox.api.volumeHolds.size,0);});
console.log(count+' stereo protection checks passed.');
