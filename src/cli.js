import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve, dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {SafeError, validateConfig, initialState, parseSnapshot, applySnapshot, requireAuthorization} from './core.js';
import {tick, runSchedule, readBounded} from './runtime.js';
import {notifier} from './notify.js';
import {simulateBooking} from './booking.js';
async function main() {
  const [command, configPath] = process.argv.slice(2);
  if (command === 'demo' || command === 'demo-booking') {
    let state = initialState();
    const now = Date.parse('2026-11-13T00:00:00Z');
    for (const name of ['available', 'available', 'unavailable', 'failed', 'malformed', 'available']) {
      const raw = await readFile(new URL(`../test/fixtures/${name}.json`, import.meta.url), 'utf8');
      const snapshot = parseSnapshot(raw, now);
      const result = await applySnapshot(snapshot, state, notifier('console'), now);
      state = result.state;
      if (command === 'demo-booking') {
        const booking = simulateBooking(snapshot, state, {provider:{kind:'mock'},mockAutoBook:true}, now);
        state = booking.state;
        console.log(JSON.stringify({booking: booking.status, simulatedAppointment: state.mockBooking || null}));
      }
      console.log(JSON.stringify({fixture: name, status: result.error || 'OK', fresh: result.fresh}));
    }
    return;
  }
  if (!['check', 'scheduled-check', 'run', 'validate-schedule', 'test-notification'].includes(command) || !configPath) throw new SafeError('USAGE: node src/cli.js demo | demo-booking | check CONFIG | run CONFIG | validate-schedule CONFIG | test-notification CONFIG');
  const config = validateConfig(JSON.parse(await readBounded(configPath)));
  config.provider.path = resolve(dirname(resolve(configPath)), config.provider.path);
  if (command === 'validate-schedule' || command === 'scheduled-check') {
    if (!config.scheduleEnabled) throw new SafeError('SCHEDULE_DISABLED');
    requireAuthorization(config, Date.now());
    if (command === 'validate-schedule') { console.log('SCHEDULE_CONFIG_VALID'); return; }
  }
  // macOS secrets are loaded into process memory, never written to configuration/logs.
  const env = {...process.env};
  if (process.platform === 'darwin' && (config.provider.kind !== 'mock' || command === 'test-notification')) {
    const names = config.notification === 'telegram' ? ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'] : config.notification === 'ntfy' ? ['NTFY_TOPIC', 'NTFY_TOKEN'] : [];
    for (const name of names) if (!env[name]) {
      try { env[name] = execFileSync('/usr/bin/security', ['find-generic-password', '-s', `beijing-h1b.${name}`, '-a', 'slot-monitor', '-w'], {encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:10000}).trim(); }
      catch { throw new SafeError('KEYCHAIN_SECRET_UNAVAILABLE'); }
    }
  }
  if (command === 'test-notification') {
    await notifier(config.notification, {env, testOnly:true})(['2026-12-07']);
    console.log('TEST_NOTIFICATION_SENT'); return;
  }
  // Mock CLI never sends external notifications, even if selected in a config.
  const notify = notifier(config.provider.kind === 'mock' ? 'console' : config.notification, {env});
  const dir = resolve(dirname(resolve(configPath)), '.runtime', config.provider.kind);
  const once = async () => { const result = await tick(config, {dir, notify}); console.log(JSON.stringify(result)); return result; };
  if (command === 'run') await runSchedule(config, once);
  else {
    const result = await once();
    if (!['OK', 'NOT_DUE'].includes(result.status)) process.exitCode = 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e instanceof SafeError ? e.code : 'OPERATION_FAILED'); process.exitCode = 1; });
}
