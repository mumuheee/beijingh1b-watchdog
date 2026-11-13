import {POLICY, target} from './core.js';
// Simulation only. No browser, HTTP transport, credential access or booking API exists.
export function simulateBooking(snapshot, state, config, now) {
  if (!config.mockAutoBook) return {state, status:'DISABLED'};
  if (config.provider.kind !== 'mock') return {state, status:'LIVE_BOOKING_NOT_IMPLEMENTED'};
  if (state.mockBooking) return {state, status:'ALREADY_SIMULATED'};
  if (snapshot.error || snapshot.observedAt < state.lastObserved) return {state, status:'NO_CONFIRMED_RESULT'};
  const dates = snapshot.dates.filter(d => d.status === 'available' && target(d.date,now)).map(d => d.date).sort();
  if (!dates.length) return {state, status:'NO_CONFIRMED_MATCH'};
  const date = dates[0];
  return {state:{...state,mockBooking:{id:`MOCK-Beijing-H1B-${date}`,date,location:POLICY.location,visaType:POLICY.visaType,status:'SIMULATED_ONLY_NO_REAL_APPOINTMENT'}},status:'SIMULATED_ONLY_NO_REAL_APPOINTMENT'};
}
