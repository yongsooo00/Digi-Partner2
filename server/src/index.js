import { sendPushNotification, WebPushError } from '@mmmike/web-push/send';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const APP_URL = 'https://yongsooo00.github.io/Digi-Partner2/';
const STAGE_MINUTES = {
  ver20: { '알': 1, '유년기 I': 10, '유년기 II': 360, '성장기': 1440, '성숙기': 2160, '완전체': 2880, '궁극체': 2880 },
  dmx: { '알': 1, '유년기 I': 10, '유년기 II': 720, '성장기': 1440, '성숙기': 1920, '완전체': 2400, '궁극체': 2880 },
  color: { '알': 8 / 60, '유년기 I': 10, '유년기 II': 720, '성장기': 1440, '성숙기': 2160, '완전체': 2880, '궁극체': 2880 }
};
const DMX_DECAY = { hunger: 2 * 60 * 60 * 1000, strength: 3 * 60 * 60 * 1000 };
const VER20_GAUGE_CYCLE = 30 * 60 * 1000;
const NIGHT_REMINDER_INTERVAL = 5 * 60 * 1000;

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extra } });
}
function cors(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = env.ALLOWED_ORIGIN || '*';
  const allowOrigin = allowed === '*' || origin === allowed ? (allowed === '*' ? '*' : origin) : 'null';
  return {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
    'access-control-max-age': '86400', vary: 'Origin'
  };
}
function authorized(request, env) {
  return Boolean(env.APP_TOKEN) && request.headers.get('Authorization') === `Bearer ${env.APP_TOKEN}`;
}
function familyOf(p) {
  const d = String(p.device || '');
  if (d.startsWith('Ver.20th')) return 'ver20';
  if (d.startsWith('Digimon X')) return 'dmx';
  if (d === 'Godzilla Color' || d.toLowerCase().includes('color')) return 'color';
  return null;
}
function dmxHeartCapacity(stage) {
  if (stage === '성숙기' || stage === '완전체') return 3;
  if (['궁극체', '초궁극체', '초초궁극체'].includes(stage)) return 4;
  return 2;
}
function stageRemainingMs(p, now) {
  const family = familyOf(p);
  const minutes = family && STAGE_MINUTES[family]?.[p.stage];
  if (!minutes) return null;
  const paused = p.sleeping && family === 'ver20';
  const running = !paused && Number.isFinite(p.stageStarted) ? Math.max(0, now - p.stageStarted) : 0;
  return Math.max(0, minutes * 60000 - Math.max(0, Number(p.stageElapsed) || 0) - running);
}
function deviceClockAbs(p, now) {
  const baseAt = Number.isFinite(p.deviceClockBaseAt) ? p.deviceClockBaseAt : p.start;
  const baseMinutes = Number.isFinite(p.deviceClockBaseMinutes) ? p.deviceClockBaseMinutes : 540;
  return baseMinutes + (now - (Number.isFinite(baseAt) ? baseAt : now)) / 60000;
}
function nextWakeAbs(p, now) {
  const clock = deviceClockAbs(p, now), day = Math.floor(clock / 1440);
  const [hh, mm] = String(p.wakeTime || (familyOf(p) === 'color' ? '08:00' : '07:00')).split(':').map(Number);
  const target = day * 1440 + (Number.isFinite(hh) ? hh : 7) * 60 + (Number.isFinite(mm) ? mm : 0);
  return target <= clock ? target + 1440 : target;
}
function stageKey(p) { return String(p.stageToken || p.stageStarted || p.start || 'stage'); }
async function alreadySent(env, key) {
  return Boolean(await env.DB.prepare('SELECT event_key FROM sent_events WHERE event_key = ?').bind(key).first());
}
async function markSent(env, key, now) {
  await env.DB.prepare('INSERT OR IGNORE INTO sent_events(event_key, sent_at) VALUES(?, ?)').bind(key, now).run();
}
async function sendToDevice(env, deviceId, payload) {
  const rows = await env.DB.prepare('SELECT endpoint, subscription_json FROM push_subscriptions WHERE device_id = ?').bind(deviceId).all();
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) throw new Error('VAPID secrets are not configured');
  const vapid = { publicKey: env.VAPID_PUBLIC_KEY, privateKey: JSON.parse(env.VAPID_PRIVATE_KEY), subject: env.VAPID_SUBJECT || 'mailto:admin@example.com' };
  let delivered = 0, removed = 0, failed = 0;
  for (const row of rows.results || []) {
    try {
      const ok = await sendPushNotification(JSON.parse(row.subscription_json), payload, vapid);
      if (ok) delivered++;
      else { await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(row.endpoint).run(); removed++; }
    } catch (error) {
      failed++;
      if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) {
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(row.endpoint).run(); removed++;
      }
      console.error('push send failed', error?.statusCode || error?.message || error);
    }
  }
  return { delivered, removed, failed };
}
async function notifyOnce(env, deviceId, key, now, payload) {
  if (await alreadySent(env, key)) return false;
  const result = await sendToDevice(env, deviceId, payload);
  if (result.delivered > 0 || result.removed > 0) await markSent(env, key, now);
  return result.delivered > 0;
}
function gaugeThresholdCrossed(mode, before, after) {
  if (mode === 'off') return false;
  if (mode === 'one') return before > 1 && after <= 1;
  if (mode === 'zero') return before > 0 && after <= 0;
  return (before > 1 && after <= 1) || (before > 0 && after <= 0);
}

async function handleRequest(request, env) {
  const headers = cors(request, env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const url = new URL(request.url);
  if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true, service: 'digi-partner-server', time: new Date().toISOString() }, 200, headers);
  if (!authorized(request, env)) return json({ ok: false, error: 'unauthorized' }, 401, headers);

  if (url.pathname === '/api/push/subscribe' && request.method === 'POST') {
    const body = await request.json().catch(() => null);
    if (!body?.deviceId || !body.subscription?.endpoint || !body.subscription?.keys?.p256dh || !body.subscription?.keys?.auth) return json({ ok: false, error: 'invalid subscription' }, 400, headers);
    const now = Date.now();
    await env.DB.prepare(`INSERT INTO push_subscriptions(endpoint, device_id, subscription_json, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET device_id=excluded.device_id, subscription_json=excluded.subscription_json, updated_at=excluded.updated_at`)
      .bind(body.subscription.endpoint, String(body.deviceId), JSON.stringify(body.subscription), now, now).run();
    return json({ ok: true }, 200, headers);
  }
  if (url.pathname === '/api/state' && request.method === 'POST') {
    const body = await request.json().catch(() => null);
    if (!body?.deviceId || !Array.isArray(body.partners)) return json({ ok: false, error: 'deviceId and partners[] required' }, 400, headers);
    const now = Date.now(); let saved = 0;
    const activeIds = new Set();
    for (const p of body.partners) {
      if (!p?.id || !familyOf(p)) continue;
      const partnerId = String(p.id);
      activeIds.add(partnerId);
      await env.DB.prepare(`INSERT INTO partners(partner_id, device_id, state_json, updated_at)
        VALUES(?, ?, ?, ?) ON CONFLICT(partner_id) DO UPDATE SET device_id=excluded.device_id, state_json=excluded.state_json, updated_at=excluded.updated_at`)
        .bind(partnerId, String(body.deviceId), JSON.stringify(p), now).run();
      saved++;
    }
    // Remove server-side records for partners deleted from this app's local list.
    const existing = await env.DB.prepare('SELECT partner_id FROM partners WHERE device_id = ?').bind(String(body.deviceId)).all();
    for (const row of existing.results || []) {
      if (!activeIds.has(String(row.partner_id))) {
        await env.DB.prepare('DELETE FROM partners WHERE partner_id = ? AND device_id = ?')
          .bind(String(row.partner_id), String(body.deviceId)).run();
      }
    }
    return json({ ok: true, saved, updatedAt: now }, 200, headers);
  }
  if (url.pathname === '/api/push/test' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    if (!body.deviceId) return json({ ok: false, error: 'deviceId required' }, 400, headers);
    const result = await sendToDevice(env, String(body.deviceId), {
      title: 'Digi Partner 알림 테스트', body: '앱이 닫혀 있어도 알림을 받을 수 있도록 연결되었습니다.',
      url: APP_URL, tag: 'digi-partner-test'
    });
    return json({ ok: true, ...result }, 200, headers);
  }
  return json({ ok: false, error: 'not found' }, 404, headers);
}

async function checkPartner(env, row, now) {
  let p;
  try { p = JSON.parse(row.state_json); } catch { return; }
  const family = familyOf(p);
  if (!family) return;
  const settings = p.notifications || {};
  let changed = false;

  if (p.sleeping && family === 'ver20') {
    if (p.sleepWakeAtAbs == null) { p.sleepWakeAtAbs = nextWakeAbs(p, now); changed = true; }
    if (deviceClockAbs(p, now) >= p.sleepWakeAtAbs) {
      p.sleeping = false; p.sleepWakeAtAbs = null;
      p.stageStarted = now; p.totalStarted = now; p.gaugeUpdatedAt = now;
      changed = true;
      if (settings.enabled !== false) await notifyOnce(env, row.device_id, `${row.partner_id}:${stageKey(p)}:auto-wake`, now, {
        title: '자동 기상', body: `${p.nickname || p.mon || '디지몬'}의 설정된 기상 시각이 되어 활동을 재개했습니다.`,
        url: APP_URL, tag: `digi-wake-${row.partner_id}`
      });
    }
  }

  const notificationsEnabled = settings.enabled !== false;
  // Evolution alerts are optional; all timers and gauge state continue regardless of notification settings.
  if (notificationsEnabled) {
    const remaining = stageRemainingMs(p, now);
    if (remaining !== null && remaining > 0 && Array.isArray(settings.offsets)) {
      const offsets = [...new Set(settings.offsets.map(Number).filter(x => Number.isFinite(x) && x > 0))].sort((a,b) => b-a);
      for (const minutes of offsets) if (remaining <= minutes * 60000) {
        const key = `${row.partner_id}:${stageKey(p)}:${p.mon || ''}:evolution:${minutes}`;
        await notifyOnce(env, row.device_id, key, now, {
          title: '진화 예정 알림',
          body: `${p.nickname || p.mon || '디지몬'}의 다음 단계까지 약 ${minutes >= 60 ? `${minutes / 60}시간` : `${minutes}분`} 남았습니다.`,
          url: APP_URL, tag: `digi-evo-${row.partner_id}-${minutes}`
        });
      }
    }
  }

  const mode = settings.gauge || 'both';
  for (const gauge of ['hunger', 'strength']) {
    if (family === 'dmx') {
      const unitsKey = `${gauge}Units`, stampKey = `${gauge}DecayAt`;
      let units = Number(settings[unitsKey]);
      if (!Number.isFinite(units)) units = dmxHeartCapacity(p.stage) * 2;
      const stamp = Number.isFinite(p[stampKey]) ? p[stampKey] : now;
      const drops = units > 0 ? Math.min(units, Math.floor(Math.max(0, now - stamp) / DMX_DECAY[gauge])) : 0;
      if (drops > 0) {
        const before = units / 2;
        units = Math.max(0, units - drops);
        settings[unitsKey] = units;
        p[stampKey] = stamp + drops * DMX_DECAY[gauge];
        changed = true;
        const after = units / 2;
        if (notificationsEnabled && gaugeThresholdCrossed(mode, before, after)) {
          const key = `${row.partner_id}:${stageKey(p)}:${gauge}:${after}:dmx-gauge`;
          await notifyOnce(env, row.device_id, key, now, {
            title: gauge === 'hunger' ? '배고픔 게이지 알림' : '힘 게이지 알림',
            body: `${p.nickname || p.mon || '디지몬'}의 ${gauge === 'hunger' ? '배고픔' : '힘'} 하트가 ${after}칸 남았습니다.`,
            url: APP_URL, tag: `digi-gauge-${row.partner_id}-${gauge}`
          });
        }
      }
    } else if (family === 'ver20' && !p.sleeping) {
      const stamp = Number.isFinite(p.gaugeUpdatedAt) ? p.gaugeUpdatedAt : now;
      const drops = Math.floor(Math.max(0, now - stamp) / VER20_GAUGE_CYCLE);
      if (drops > 0) {
        const before = Number(settings[gauge] ?? 4);
        const after = Math.max(0, before - drops);
        settings[gauge] = after;
        if (notificationsEnabled && gaugeThresholdCrossed(mode, before, after)) {
          const key = `${row.partner_id}:${stageKey(p)}:${gauge}:${after}:ver20-gauge`;
          await notifyOnce(env, row.device_id, key, now, {
            title: gauge === 'hunger' ? '배고픔 게이지 알림' : '훈련/힘 게이지 알림',
            body: `${p.nickname || p.mon || '디지몬'}의 ${gauge === 'hunger' ? '배고픔' : '훈련/힘'} 하트가 ${after}칸 남았습니다.`,
            url: APP_URL, tag: `digi-gauge-${row.partner_id}-${gauge}`
          });
        }
        p.gaugeUpdatedAt = stamp + drops * VER20_GAUGE_CYCLE;
        changed = true;
      }
    }
  }

  // Advance the reminder state while closed; the notification toggle controls delivery only.
  if (family === 'ver20' && p.nightSleepReminderEligible && !p.nightSleepReminderDone && p.stage !== '알' && !p.sleeping && p.nightSleepReminderStart) {
    const count = Number(p.nightSleepReminderCount || 0);
    const last = Number(p.nightSleepReminderLastAt || p.nightSleepReminderStart);
    if (count < 5 && now - last >= NIGHT_REMINDER_INTERVAL) {
      const next = count + 1;
      p.nightSleepReminderCount = next;
      p.nightSleepReminderLastAt = now;
      if (next >= 5) p.nightSleepReminderDone = true;
      p.nightSleepReminderMessage = `수면 안내 ${next}/5 · 실제 기기에서 디지몬이 잠들었다면 지금 [수면 처리]를 눌러 주세요.`;
      if (notificationsEnabled) await notifyOnce(env, row.device_id, `${row.partner_id}:${stageKey(p)}:night-sleep:${next}`, now, {
        title: 'Ver.20th 수면 처리 안내', body: p.nightSleepReminderMessage,
        url: APP_URL, tag: `digi-sleep-reminder-${row.partner_id}-${next}`
      });
      changed = true;
    }
  }

  if (changed) await env.DB.prepare('UPDATE partners SET state_json = ?, updated_at = ? WHERE partner_id = ?')
    .bind(JSON.stringify(p), now, row.partner_id).run();
}
async function checkScheduledEvents(env) {
  const now = Date.now();
  const rows = await env.DB.prepare('SELECT partner_id, device_id, state_json FROM partners').all();
  for (const row of rows.results || []) {
    try { await checkPartner(env, row, now); }
    catch (error) { console.error('partner processing failed', row.partner_id, error?.message || error); }
  }
}
export default {
  async fetch(request, env) { return handleRequest(request, env); },
  async scheduled(controller, env, ctx) { ctx.waitUntil(checkScheduledEvents(env)); }
};