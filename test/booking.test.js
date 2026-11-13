import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {initialState,parseSnapshot,POLICY} from '../src/core.js';
import {simulateBooking} from '../src/booking.js';
import {tick} from '../src/runtime.js';
const now=Date.parse('2026-11-13T00:00:00Z');
const cfg={provider:{kind:'mock',path:'fixture'},notification:'console',scheduleEnabled:false,mockAutoBook:true};
const parse=(appointments,over={})=>parseSnapshot(JSON.stringify({schemaVersion:1,status:'ok',location:'Beijing',visaType:'H-1B',observedAt:new Date(now).toISOString(),complete:true,appointments,...over}),now);
const slot=(date,status='available')=>({date,status});
test('mock booking opt-in chooses earliest confirmed target; exactly one simulation',()=>{
 const result=parse([slot('2027-01-08'),slot('2026-12-06'),slot('2026-12-31','inferred'),slot('2027-01-01'),slot('2026-12-07','unavailable')]);
 const first=simulateBooking(result,initialState(),cfg,now);
 assert.equal(first.state.mockBooking.date,'2027-01-01');
 assert.equal(first.state.mockBooking.status,'SIMULATED_ONLY_NO_REAL_APPOINTMENT');
 assert.equal(simulateBooking(result,first.state,cfg,now).status,'ALREADY_SIMULATED');
});
test('disabled, unconfirmed, failed and wrong-scope responses never book',()=>{
 for(const result of [parse([]),parse([slot('2026-12-07','inferred')]),parse([slot('2026-12-07','unavailable')]),parse([slot('2026-12-07')],{status:'failed'}),parse([slot('2026-12-07')],{location:'Shanghai'}),parseSnapshot('bad',now)]) assert.equal(simulateBooking(result,initialState(),cfg,now).state.mockBooking,undefined);
 assert.equal(simulateBooking(parse([slot('2026-12-07')]),initialState(),{...cfg,mockAutoBook:false},now).status,'DISABLED');
});
test('authorized availability feed is never treated as booking authorization',()=>{
 const r=simulateBooking(parse([slot('2026-12-07')]),initialState(),{...cfg,provider:{kind:'authorized-file'}},now);assert.equal(r.status,'LIVE_BOOKING_NOT_IMPLEMENTED');assert.equal(r.state.mockBooking,undefined);
});
test('simulation persisted across process restarts and cannot create second appointment',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'booking-'));
 try {
 let time=now;
 const read=async()=>JSON.stringify({schemaVersion:1,status:'ok',location:'Beijing',visaType:'H-1B',observedAt:new Date(time).toISOString(),complete:true,appointments:[slot('2026-12-07')]});
 const first=await tick(cfg,{dir,now:time,notify:async()=>{},read});assert.equal(first.booking,'SIMULATED_ONLY_NO_REAL_APPOINTMENT');
 time+=POLICY.intervalMs;
 const next=await tick(cfg,{dir,now:time,notify:async()=>{},read});assert.equal(next.booking,'ALREADY_SIMULATED');
 const state=JSON.parse(await readFile(join(dir,'state.json'),'utf8'));assert.equal(state.mockBooking.date,'2026-12-07');
 } finally {await rm(dir,{recursive:true,force:true});}
});
