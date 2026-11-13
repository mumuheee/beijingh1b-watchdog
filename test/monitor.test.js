import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, rm, writeFile, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {POLICY, day, beijingDay, parseSnapshot, initialState, applySnapshot, validateConfig, requireAuthorization, target} from '../src/core.js';
import {tick, runSchedule} from '../src/runtime.js';
import {notifier} from '../src/notify.js';
const now = Date.parse('2026-11-13T00:00:00Z');
const fixture = name => readFile(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8');
const base = () => ({schemaVersion:1,status:'ok',location:'Beijing',visaType:'H-1B',observedAt:new Date(now).toISOString(),complete:true,appointments:[]});
const parsed = (appointments, over = {}) => parseSnapshot(JSON.stringify({...base(), appointments, ...over}), now);
const slot = (date='2026-12-07', status='available') => ({date,status});
const config = () => ({provider:{kind:'authorized-file',path:'fixture'},notification:'console',scheduleEnabled:true,authorization:{providerId:'approved-feed',evidence:'Written test-only permission',expiresAt:'2026-12-01T00:00:00Z',location:'Beijing',visaType:'H-1B',minimumIntervalMinutes:30}});
const temp = async fn => {const dir=await mkdtemp(join(tmpdir(),'visa-test-')); try {await fn(dir);} finally {await rm(dir,{recursive:true,force:true});}};
for (const name of ['available','unavailable','inferred','empty']) test(`fixture ${name} parses`, async () => assert.equal(parseSnapshot(await fixture(name),now).error,null));
for (const name of ['failed','malformed']) test(`fixture ${name} fails closed`, async () => assert.ok(parseSnapshot(await fixture(name),now).error));
for (const date of ['2026-12-07','2026-12-31','2027-01-01','2027-01-08']) test(`inclusive target ${date}`, () => assert.equal(target(date,now),true));
for (const date of ['2026-12-06','2027-01-09','2026-01-01','2027-12-07']) test(`outside target ${date}`, () => assert.equal(target(date,now),false));
for (const date of ['2026-02-29','2026-12-32','2027-01-00','2027-13-01','12/07/2026']) test(`invalid day ${date}`, () => assert.throws(()=>day(date)));
test('Beijing year boundary uses Asia/Shanghai, not host timezone',()=> {
 assert.equal(beijingDay('2026-12-31T16:00:00Z'),'2027-01-01');
 assert.equal(beijingDay('2026-12-31T15:59:59Z'),'2026-12-31');
 assert.equal(beijingDay('2027-01-08T16:00:00Z'),'2027-01-09');
 assert.equal(beijingDay('2026-12-06T16:00:00Z'),'2026-12-07');
 assert.equal(beijingDay('2027-01-01T00:00:00+08:00'),'2027-01-01');
 assert.equal(beijingDay('2026-12-07'),'2026-12-07');
 assert.throws(()=>beijingDay('2026-12-07T00:00:00'));
});
test('past Beijing date filtered',()=>assert.equal(target('2026-12-07',Date.parse('2026-12-07T16:00:00Z')),false));
for (const over of [{}, {schemaVersion:2}, {status:'failed'}, {location:'Shanghai'}, {visaType:'B-2'}, {complete:'true'}, {appointments:{}}, {observedAt:'2026-01-01T00:00:00Z'}, {observedAt:'2027-01-01T00:00:00Z'}, {token:'do-not-log'}]) {
 test(`strict schema ${JSON.stringify(over)}`,()=> {
 const raw = Object.keys(over).length ? {...base(),...over} : {};
 assert.ok(parseSnapshot(JSON.stringify(raw),now).error);
 });
}
for (const appointments of [[{date:'2026-12-07',status:true}], [slot('2026-12-07','unknown')], [slot(),slot('2026-12-07','unavailable')], [{date:'2026-12-07',status:'available',password:'SECRET'}], [slot('2026-02-29')], ['2026-12-07']]) test('invalid or conflicting entries fail entire response',()=> assert.ok(parsed(appointments).error));
test('unknown JSON and HTML never mean empty',()=> {
 for(const raw of ['{}','[]','null','<html>Challenge SECRET</html>','{"error":"SECRET"}']) {
 const result=parseSnapshot(raw,now); assert.ok(result.error); assert.equal(JSON.stringify(result).includes('SECRET'),false);
 }
});
test('size limited',()=>assert.equal(parseSnapshot(' '.repeat(1024*1024+1),now).error,'RESPONSE_TOO_LARGE'));
test('duplicate consistent dates dedup; timestamps normalized',()=> {
 const r=parsed([slot('2026-12-31T16:00:00Z'),slot('2027-01-01')]); assert.deepEqual(r.dates,[slot('2027-01-01')]);
});
test('confirmed only; inferred and unavailable never notify',async()=> {
 const sent=[]; const r=await applySnapshot(parsed([slot(),slot('2026-12-31','inferred'),slot('2027-01-01','unavailable')]),initialState(),async d=>sent.push(d),now);
 assert.deepEqual(sent,[['2026-12-07']]); assert.deepEqual(r.state.active,['2026-12-07']);
});
test('appearance, repeat, disappearance, reappearance re-notifies',async()=> {
 let s=initialState(), sent=[];
 for(const appointments of [[slot()],[slot()],[],[slot()]]) s=(await applySnapshot(parsed(appointments),s,async d=>sent.push(d),now)).state;
 assert.deepEqual(sent,[['2026-12-07'],['2026-12-07']]);
});
test('explicit unavailable resets even on partial snapshot',async()=> {
 let s=(await applySnapshot(parsed([slot()]),initialState(),async()=>{},now)).state;
 s=(await applySnapshot(parsed([slot('2026-12-07','unavailable')],{complete:false}),s,async()=>{},now)).state;
 const r=await applySnapshot(parsed([slot()]),s,async()=>{},now); assert.equal(r.fresh.length,1);
});
test('failures, malformed, partial and inferred snapshots preserve known presence',async()=> {
 let s=(await applySnapshot(parsed([slot()]),initialState(),async()=>{},now)).state;
 for(const r of [parseSnapshot('broken',now),parsed([],{complete:false}),parsed([slot('2026-12-07','inferred')])]) {
 s=(await applySnapshot(r,s,async()=>assert.fail('unexpected notification'),now)).state;
 assert.deepEqual(s.active,['2026-12-07']);
 }
 assert.equal((await applySnapshot(parsed([slot()]),s,async()=>assert.fail(),now)).fresh.length,0);
});
test('notification failures retry without marking delivered',async()=> {
 const first=await applySnapshot(parsed([slot()]),initialState(),async()=>{throw new Error('SECRET');},now);
 assert.equal(first.error,'NOTIFICATION_FAILED'); assert.deepEqual(first.state.delivered,[]);
 const next=await applySnapshot(parsed([slot()]),first.state,async()=>{},now); assert.deepEqual(next.state.delivered,['2026-12-07']);
});
test('out-of-order observations preserve state',async()=> {
 const s={...initialState(),lastObserved:now+1}; const r=await applySnapshot(parsed([]),s,async()=>{},now); assert.equal(r.error,'OUT_OF_ORDER_RESPONSE'); assert.equal(r.state,s);
});
test('config rejects portal credentials and arbitrary providers',()=> {
 assert.throws(()=>validateConfig({...config(),password:'SECRET'}));
 assert.throws(()=>validateConfig({...config(),provider:{kind:'https',path:POLICY.portal}}));
});
test('authorization required, scoped, unexpired and permits 30 minutes',()=> {
 requireAuthorization(config(),now);
 for(const a of [null,{...config().authorization,expiresAt:'2026-01-01T00:00:00Z'},{...config().authorization,location:'Shanghai'},{...config().authorization,visaType:'B-2'},{...config().authorization,evidence:''},{...config().authorization,minimumIntervalMinutes:60}]) assert.throws(()=>requireAuthorization({...config(),authorization:a},now));
 assert.throws(()=>requireAuthorization({...config(),provider:{kind:'mock',path:'mock'}},now));
});
test('persistent 30 minute cadence, restart dedup and reappearance',async()=>temp(async dir=> {
 let calls=0, sent=[];
 let raw=JSON.stringify({...base(),appointments:[slot()]});
 const run=async time=>tick(config(),{dir,now:time,notify:async d=>sent.push(d),read:async()=>{calls++;return raw;}});
 assert.equal((await run(now)).status,'OK'); assert.equal((await run(now+1)).status,'NOT_DUE');
 raw=JSON.stringify({...base(),observedAt:new Date(now+POLICY.intervalMs).toISOString()});
 await run(now+POLICY.intervalMs);
 raw=JSON.stringify({...base(),observedAt:new Date(now+2*POLICY.intervalMs).toISOString(),appointments:[slot()]});
 await run(now+2*POLICY.intervalMs);
 assert.equal(calls,3); assert.equal(sent.length,2);
 assert.equal((await stat(join(dir,'state.json'))).mode & 0o777,0o600);
}));
test('failed reads consume cadence; no tight retry',async()=>temp(async dir=> {
 const opts={dir,now,notify:async()=>{},read:async()=>{throw new Error('SECRET');}};
 assert.equal((await tick(config(),opts)).status,'PROVIDER_READ_FAILED');
 assert.equal((await tick(config(),opts)).status,'NOT_DUE');
}));
test('concurrent check blocked',async()=>temp(async dir=> {
 let release;const pending=new Promise(r=>release=r);let entered;const ready=new Promise(r=>entered=r);
 const first=tick(config(),{dir,now,notify:async()=>{},read:async()=>{entered();await pending;return fixture('empty');}});
 await ready;await assert.rejects(tick(config(),{dir,now,notify:async()=>{}}),/MONITOR_LOCKED/);release();await first;
}));
test('corrupt state fails closed',async()=>temp(async dir=> {
 await writeFile(join(dir,'state.json'),'garbage SECRET');
 await assert.rejects(tick(config(),{dir,now,notify:async()=>{}}),/INVALID_STATE/);
}));
test('scheduler mock and disabled gates; valid schedule waits exactly 30 minutes',async()=> {
 await assert.rejects(runSchedule({...config(),scheduleEnabled:false},async()=>{}),/SCHEDULE_DISABLED/);
 await assert.rejects(runSchedule({...config(),provider:{kind:'mock'}},async()=>{},{clock:()=>now}),/PROVIDER_NOT_AUTHORIZED/);
 const controller=new AbortController();let checks=0;
 await runSchedule(config(),async()=>{checks++;},{clock:()=>now,signal:controller.signal,wait:async ms=>{assert.equal(ms,30*60_000);controller.abort();}});
 assert.equal(checks,1);
});
for(const channel of ['telegram','ntfy']) test(`${channel} sends only minimal message with protected transport`,async()=> {
 let request;
 const send=notifier(channel,{env:{TELEGRAM_BOT_TOKEN:'123:TEST_ONLY',TELEGRAM_CHAT_ID:'456',NTFY_TOPIC:'test_topic_long_random_123',NTFY_TOKEN:'TEST_ONLY'},request:async(url,options)=>{request={url,...options};return {ok:true,json:async()=>({ok:true})};}});
 await send(['2026-12-07']);assert.equal(request.redirect,'error');assert.ok(request.signal);assert.match(request.body,/Beijing H-1B/);assert.match(request.body,/manually/);
 assert.equal(request.body.includes('TEST_ONLY'),false);
});
test('transport errors never expose secret-bearing URL or response',async()=> {
 for(const response of [null,{ok:false},{ok:true,json:async()=>({ok:false})}]) {
 const send=notifier('telegram',{env:{TELEGRAM_BOT_TOKEN:'123:SECRET',TELEGRAM_CHAT_ID:'456'},request:async()=>{if(!response)throw new Error('https://SECRET');return response;}});
 await assert.rejects(send(['2026-12-07']),e=>e.message==='NOTIFICATION_FAILED');
 }
});
test('notification credentials required',async()=> {
 for(const channel of ['telegram','ntfy']) await assert.rejects(notifier(channel,{env:{},request:()=>assert.fail() })(['2026-12-07']),/NOTIFICATION_CONFIG/);
});
test('offline demo CLI reports reappearance and errors',()=> {
 const out=execFileSync(process.execPath,['src/cli.js','demo'],{encoding:'utf8'});
 assert.equal((out.match(/MOCK\/LOCAL ONLY/g)||[]).length,2);assert.match(out,/PROVIDER_FAILED/);assert.match(out,/INVALID_JSON/);
});

test('invalid wall times rejected instead of rolling over',()=> {
 for(const value of ['2026-12-31T24:00:00Z','2026-12-07T12:60:00Z','2026-12-07T12:00:60Z']) assert.throws(()=>beijingDay(value));
});
test('pending alert is not retried from inferred or absent partial data',async()=> {
 const s=(await applySnapshot(parsed([slot()]),initialState(),async()=>{throw new Error();},now)).state;
 for(const r of [parsed([],{complete:false}),parsed([slot('2026-12-07','inferred')])]) {
 const result=await applySnapshot(r,s,async()=>assert.fail('unconfirmed retry'),now);assert.deepEqual(result.fresh,[]);
 }
});
test('after target end authorization cannot enable a scheduler',()=> assert.throws(()=>requireAuthorization(config(),Date.parse('2027-01-08T16:00:00Z')),/TARGET_WINDOW_CLOSED/));
test('test phone push unmistakably labels simulated data',async()=> {
 for(const channel of ['telegram','ntfy']) {
 let body;
 await notifier(channel,{testOnly:true,env:{TELEGRAM_BOT_TOKEN:'123:TEST_ONLY',TELEGRAM_CHAT_ID:'456',NTFY_TOPIC:'test_topic_long_random_123',NTFY_TOKEN:'TEST_ONLY'},request:async(url,opts)=>{body=JSON.parse(opts.body);return {ok:true,json:async()=>({ok:true})};}})(['2026-12-07']);
 assert.match(body.text || body.message,/TEST ONLY.*simulated data/);
 }
});
test('scheduler rechecks authorization on every cycle',async()=> {
 let clock=now, checks=0;
 await assert.rejects(runSchedule(config(),async()=>{checks++;},{clock:()=>clock,wait:async()=>{clock=Date.parse('2026-12-02T00:00:00Z');}}),/PROVIDER_NOT_AUTHORIZED/);
 assert.equal(checks,1);
});
