import {open, mkdir, readFile, rename, unlink} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {constants} from 'node:fs';
import {POLICY, SafeError, initialState, parseSnapshot, applySnapshot, requireAuthorization} from './core.js';
import {simulateBooking} from './booking.js';
// A local file is the only availability transport. There is no HTTP/browser portal adapter.
export async function readBounded(path) {
  const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await f.stat();
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new SafeError('INVALID_INPUT_FILE');
    const buffer = Buffer.alloc(1024 * 1024 + 1);
    const {bytesRead} = await f.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 1024 * 1024) throw new SafeError('RESPONSE_TOO_LARGE');
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally { await f.close(); }
}
export async function saveState(dir, state) {
  const temp = join(dir, 'state.tmp');
  const f = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
  try { await f.writeFile(JSON.stringify(state)); await f.sync(); } finally { await f.close(); }
  await rename(temp, join(dir, 'state.json'));
}
async function loadState(dir) {
  try {
    const s = JSON.parse(await readBounded(join(dir, 'state.json')));
    if (s.version !== 1 || !Array.isArray(s.active) || !Array.isArray(s.delivered) || !s.active.every(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) || !s.delivered.every(d => s.active.includes(d)) || !Number.isFinite(s.lastAttempt) || !Number.isFinite(s.lastObserved)) throw new SafeError('INVALID_STATE');
    return s;
  } catch (e) { if (e.code === 'ENOENT') return initialState(); throw new SafeError('INVALID_STATE'); }
}
export async function tick(config, {dir = '.runtime', now = Date.now(), notify, read = readBounded} = {}) {
  if (config.provider.kind !== 'mock') requireAuthorization(config, now);
  dir = resolve(dir);
  await mkdir(dir, {recursive: true, mode: 0o700});
  const lockPath = join(dir, 'monitor.lock');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); } catch { throw new SafeError('MONITOR_LOCKED'); }
  try {
    const state = await loadState(dir);
    if (state.lastAttempt && now - state.lastAttempt < POLICY.intervalMs) return {status: 'NOT_DUE'};
    // Persist before I/O: failures, restarts, and duplicate launchd ticks cannot increase polling.
    state.lastAttempt = now;
    await saveState(dir, state);
    let raw;
    try { raw = await read(config.provider.path); } catch { return {status: 'PROVIDER_READ_FAILED'}; }
    const result = parseSnapshot(raw, now);
    const update = await applySnapshot(result, state, notify, now);
    const booking = simulateBooking(result, update.state, config, now);
    if (!result.error) await saveState(dir, booking.state);
    return {status: update.error || 'OK', booking: booking.status, simulatedAppointment: booking.state.mockBooking || null, confirmed: result.dates.filter(d => d.status === 'available').map(d => d.date), inferred: result.dates.filter(d => d.status === 'inferred').map(d => d.date), unavailable: result.dates.filter(d => d.status === 'unavailable').map(d => d.date), fresh: update.fresh};
  } finally { await lock.close(); await unlink(lockPath); }
}
export async function runSchedule(config, tickFn, {clock = Date.now, wait = ms => new Promise(r => setTimeout(r, ms)), signal} = {}) {
  if (!config.scheduleEnabled) throw new SafeError('SCHEDULE_DISABLED');
  requireAuthorization(config, clock());
  while (!signal?.aborted) {
    const started = clock();
    requireAuthorization(config, clock());
    await tickFn();
    await wait(Math.max(0, POLICY.intervalMs - (clock() - started)));
  }
}
