import {POLICY, SafeError} from './core.js';
const text = dates => `Beijing H-1B confirmed dates (Asia/Shanghai): ${dates.join(', ')}. Availability may change. Confirm and book manually: ${POLICY.portal}`;
// Fixed destinations; redirects denied so notification secrets cannot follow a redirect.
export function notifier(channel, {env = process.env, request = fetch, output = console.log, testOnly = false} = {}) {
  const message = dates => (testOnly ? 'TEST ONLY — simulated data, no real availability. ' : '') + text(dates);
  if (channel === 'console') return async dates => output(`MOCK/LOCAL ONLY: ${text(dates)}`);
  return async dates => {
    let url, body, headers = {'Content-Type': 'application/json'};
    if (channel === 'telegram') {
      if (!/^\d+:[A-Za-z0-9_-]+$/.test(env.TELEGRAM_BOT_TOKEN || '') || !/^-?\d+$/.test(env.TELEGRAM_CHAT_ID || '')) throw new SafeError('NOTIFICATION_CONFIG');
      url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
      body = {chat_id: env.TELEGRAM_CHAT_ID, text: message(dates), link_preview_options: {is_disabled: true}};
    } else if (channel === 'ntfy') {
      if (!/^[A-Za-z0-9_-]{20,128}$/.test(env.NTFY_TOPIC || '') || !env.NTFY_TOKEN || /[\r\n]/.test(env.NTFY_TOKEN)) throw new SafeError('NOTIFICATION_CONFIG');
      url = 'https://ntfy.sh/';
      headers.Authorization = `Bearer ${env.NTFY_TOKEN}`;
      body = {topic: env.NTFY_TOPIC, title: testOnly ? 'TEST ONLY — Beijing H-1B' : 'Beijing H-1B availability', message: message(dates), click: POLICY.portal};
    } else throw new SafeError('NOTIFICATION_CONFIG');
    try {
      const response = await request(url, {method: 'POST', headers, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(10_000)});
      if (!response.ok) throw new SafeError('NOTIFICATION_FAILED');
      if (channel === 'telegram' && (await response.json()).ok !== true) throw new SafeError('NOTIFICATION_FAILED');
    } catch { throw new SafeError('NOTIFICATION_FAILED'); }
  };
}
