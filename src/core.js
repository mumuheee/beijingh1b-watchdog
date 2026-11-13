// This is a normalized provider contract, NOT a parser for undocumented portal APIs.
export const POLICY = Object.freeze({
  portal: 'https://www.usvisascheduling.com/en-US/schedule/',
  location: 'Beijing', visaType: 'H-1B', timezone: 'Asia/Shanghai',
  start: '2026-12-07', end: '2027-01-08', intervalMs: 30 * 60 * 1000
});
export class SafeError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new SafeError('INVALID_DATE');
  const d = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(+d) || d.toISOString().slice(0, 10) !== value) throw new SafeError('INVALID_DATE');
  return value;
}
export function beijingDay(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return day(value);
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new SafeError('AMBIGUOUS_TIMESTAMP');
  day(value.slice(0, 10));
  const time = value.slice(11, 19).split(':').map(Number);
  if (time[0] > 23 || time[1] > 59 || time[2] > 59) throw new SafeError('INVALID_DATE');
  const d = new Date(value);
  if (!Number.isFinite(+d)) throw new SafeError('INVALID_DATE');
  return new Intl.DateTimeFormat('en-CA', {timeZone: POLICY.timezone, year: 'numeric', month: '2-digit', day: '2-digit'}).format(d);
}
export function instant(value) {
  beijingDay(value);
  if (!value.includes('T')) throw new SafeError('TIMESTAMP_REQUIRED');
  return +new Date(value);
}
function exactKeys(obj, keys) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || Object.keys(obj).some(k => !keys.includes(k))) throw new SafeError('SCHEMA_ERROR');
}
export function parseSnapshot(raw, now = Date.now()) {
  try {
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > 1024 * 1024) throw new SafeError('RESPONSE_TOO_LARGE');
    let s;
    try { s = JSON.parse(raw); } catch { throw new SafeError('INVALID_JSON'); }
    exactKeys(s, ['schemaVersion', 'status', 'location', 'visaType', 'observedAt', 'complete', 'appointments']);
    if (s.schemaVersion !== 1) throw new SafeError('SCHEMA_ERROR');
    if (s.status !== 'ok') throw new SafeError('PROVIDER_FAILED');
    if (s.location !== POLICY.location || s.visaType !== POLICY.visaType) throw new SafeError('SCOPE_MISMATCH');
    const observedAt = instant(s.observedAt);
    if (now - observedAt > 35 * 60_000 || observedAt - now > 5 * 60_000) throw new SafeError('STALE_RESPONSE');
    if (typeof s.complete !== 'boolean' || !Array.isArray(s.appointments) || s.appointments.length > 1000) throw new SafeError('SCHEMA_ERROR');
    const byDay = new Map();
    for (const a of s.appointments) {
      exactKeys(a, ['date', 'status']);
      if (!['available', 'unavailable', 'inferred'].includes(a.status)) throw new SafeError('SCHEMA_ERROR');
      const date = beijingDay(a.date);
      if (byDay.has(date) && byDay.get(date) !== a.status) throw new SafeError('CONFLICTING_AVAILABILITY');
      byDay.set(date, a.status);
    }
    const dates = [...byDay].map(([date, status]) => ({date, status})).sort((a,b) => a.date.localeCompare(b.date));
    return {error: null, observedAt, complete: s.complete && !dates.some(d => d.status === 'inferred'), dates};
  } catch (error) {
    return {error: error instanceof SafeError ? error.code : 'PARSE_ERROR', dates: [], complete: false};
  }
}
export function target(date, now) {
  return date >= POLICY.start && date <= POLICY.end && date >= beijingDay(new Date(now).toISOString());
}
export function initialState() { return {version: 1, active: [], delivered: [], lastAttempt: 0, lastObserved: 0}; }
// Failure is uncertainty, never evidence of disappearance. Only complete snapshots clear absences.
export async function applySnapshot(result, state, notify, now) {
  if (result.error) return {state, error: result.error, fresh: []};
  if (result.observedAt < state.lastObserved) return {state, error: 'OUT_OF_ORDER_RESPONSE', fresh: []};
  const active = new Set(result.complete ? [] : state.active);
  for (const d of result.dates) {
    if (d.status === 'available' && target(d.date, now)) active.add(d.date);
    if (d.status === 'unavailable') active.delete(d.date);
  }
  for (const date of active) if (!target(date, now)) active.delete(date);
  const delivered = new Set(state.delivered.filter(d => active.has(d)));
  const confirmed = new Set(result.dates.filter(d => d.status === 'available').map(d => d.date));
  const fresh = [...active].filter(d => confirmed.has(d) && !delivered.has(d)).sort();
  let error = null;
  if (fresh.length) {
    try { await notify(fresh); fresh.forEach(d => delivered.add(d)); }
    catch { error = 'NOTIFICATION_FAILED'; }
  }
  return {state: {...state, active: [...active].sort(), delivered: [...delivered].sort(), lastObserved: result.observedAt}, error, fresh};
}
export function validateConfig(c) {
  exactKeys(c, ['provider', 'notification', 'scheduleEnabled', 'authorization', 'mockAutoBook']);
  if (c.mockAutoBook !== undefined && typeof c.mockAutoBook !== 'boolean') throw new SafeError('INVALID_CONFIG');
  exactKeys(c.provider, ['kind', 'path']);
  if (!['mock', 'authorized-file'].includes(c.provider.kind) || typeof c.provider.path !== 'string' || !c.provider.path) throw new SafeError('INVALID_PROVIDER');
  if (!['console', 'telegram', 'ntfy'].includes(c.notification) || typeof c.scheduleEnabled !== 'boolean') throw new SafeError('INVALID_CONFIG');
  if (c.authorization !== null && c.authorization !== undefined) {
    exactKeys(c.authorization, ['providerId', 'evidence', 'expiresAt', 'location', 'visaType', 'minimumIntervalMinutes']);
  }
  return c;
}
export function requireAuthorization(config, now) {
  if (beijingDay(new Date(now).toISOString()) > POLICY.end) throw new SafeError('TARGET_WINDOW_CLOSED');
  const a = config.authorization;
  if (config.provider.kind !== 'authorized-file' || !a || typeof a.providerId !== 'string' || !a.providerId.trim() || typeof a.evidence !== 'string' || !a.evidence.trim() || a.location !== POLICY.location || a.visaType !== POLICY.visaType || typeof a.minimumIntervalMinutes !== 'number' || a.minimumIntervalMinutes < 0 || a.minimumIntervalMinutes > 30 || instant(a.expiresAt) <= now) throw new SafeError('PROVIDER_NOT_AUTHORIZED');
}
