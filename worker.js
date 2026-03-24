/**
 * Thrivepoint API — Cloudflare Worker
 *
 * Routes:
 *   GET  /api/config                  → family config (kids, tasks, rewards)
 *   PUT  /api/config                  → save family config
 *   GET  /api/ledger?kidId=k1         → full ledger for a kid
 *   POST /api/complete-task           → mark task done, add points
 *   POST /api/redeem-reward           → spend points on a reward
 *   GET  /api/today?kidId=k1          → today's completed task IDs
 *   DELETE /api/reset?kidId=k1        → reset today's tasks (dev only)
 *
 * Auth: all requests must include header  X-Thrivepoint-Pin: <pin>
 * CORS: allows requests from GitHub Pages origin
 */

const ALLOWED_ORIGINS = [
  'https://zgauba.github.io',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Thrivepoint-Pin',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status = 200, origin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // ── Auth check ─────────────────────────────────────────────────────────
    const config = await env.THRIVEPOINT_DB.get('family_config', { type: 'json' });
    const pin = request.headers.get('X-Thrivepoint-Pin');

    // Allow PUT /api/config without auth only if no config exists yet (first-time setup)
    const isFirstSetup = !config && path === '/api/config' && request.method === 'PUT';

    if (!isFirstSetup) {
      const expectedPin = config?.pin || '1234';
      if (pin !== expectedPin) {
        return json({ error: 'Unauthorized' }, 401, origin);
      }
    }

    // ── GET /api/config ─────────────────────────────────────────────────────
    if (path === '/api/config' && request.method === 'GET') {
      if (!config) return json({ error: 'No config found' }, 404, origin);
      return json(config, 200, origin);
    }

    // ── PUT /api/config ─────────────────────────────────────────────────────
    if (path === '/api/config' && request.method === 'PUT') {
      const body = await request.json();
      await env.THRIVEPOINT_DB.put('family_config', JSON.stringify(body));
      return json({ ok: true }, 200, origin);
    }

    // ── GET /api/today ──────────────────────────────────────────────────────
    if (path === '/api/today' && request.method === 'GET') {
      const kidId = url.searchParams.get('kidId');
      if (!kidId) return json({ error: 'kidId required' }, 400, origin);
      const key = `today_${kidId}_${todayKey()}`;
      const data = await env.THRIVEPOINT_DB.get(key, { type: 'json' });
      return json(data || { completedTaskIds: [], rewardIds: [] }, 200, origin);
    }

    // ── POST /api/complete-task ─────────────────────────────────────────────
    if (path === '/api/complete-task' && request.method === 'POST') {
      const { kidId, taskId, taskTitle, points } = await request.json();
      if (!kidId || !taskId) return json({ error: 'kidId and taskId required' }, 400, origin);

      // Update today's completed tasks
      const todayKvKey = `today_${kidId}_${todayKey()}`;
      const today = (await env.THRIVEPOINT_DB.get(todayKvKey, { type: 'json' })) || { completedTaskIds: [], rewardIds: [] };
      if (!today.completedTaskIds.includes(taskId)) {
        today.completedTaskIds.push(taskId);
      }
      await env.THRIVEPOINT_DB.put(todayKvKey, JSON.stringify(today), { expirationTtl: 60 * 60 * 48 }); // 48h TTL

      // Append to ledger
      const ledgerKey = `ledger_${kidId}`;
      const ledger = (await env.THRIVEPOINT_DB.get(ledgerKey, { type: 'json' })) || [];
      ledger.push({
        id: crypto.randomUUID(),
        type: 'earn',
        taskId,
        title: taskTitle || taskId,
        delta: points || 0,
        ts: Date.now(),
      });
      await env.THRIVEPOINT_DB.put(ledgerKey, JSON.stringify(ledger));

      return json({ ok: true }, 200, origin);
    }

    // ── POST /api/redeem-reward ─────────────────────────────────────────────
    if (path === '/api/redeem-reward' && request.method === 'POST') {
      const { kidId, rewardId, rewardTitle, cost } = await request.json();
      if (!kidId || !rewardId) return json({ error: 'kidId and rewardId required' }, 400, origin);

      // Append to ledger as a spend
      const ledgerKey = `ledger_${kidId}`;
      const ledger = (await env.THRIVEPOINT_DB.get(ledgerKey, { type: 'json' })) || [];
      ledger.push({
        id: crypto.randomUUID(),
        type: 'spend',
        rewardId,
        title: rewardTitle || rewardId,
        delta: -(cost || 0),
        ts: Date.now(),
      });
      await env.THRIVEPOINT_DB.put(ledgerKey, JSON.stringify(ledger));

      // Track today's redeemed rewards
      const todayKvKey = `today_${kidId}_${todayKey()}`;
      const today = (await env.THRIVEPOINT_DB.get(todayKvKey, { type: 'json' })) || { completedTaskIds: [], rewardIds: [] };
      if (!today.rewardIds) today.rewardIds = [];
      today.rewardIds.push(rewardId);
      await env.THRIVEPOINT_DB.put(todayKvKey, JSON.stringify(today), { expirationTtl: 60 * 60 * 48 });

      return json({ ok: true }, 200, origin);
    }

    // ── GET /api/ledger ─────────────────────────────────────────────────────
    if (path === '/api/ledger' && request.method === 'GET') {
      const kidId = url.searchParams.get('kidId');
      if (!kidId) return json({ error: 'kidId required' }, 400, origin);
      const ledger = (await env.THRIVEPOINT_DB.get(`ledger_${kidId}`, { type: 'json' })) || [];
      return json(ledger, 200, origin);
    }

    // ── DELETE /api/reset ───────────────────────────────────────────────────
    if (path === '/api/reset' && request.method === 'DELETE') {
      const kidId = url.searchParams.get('kidId');
      if (!kidId) return json({ error: 'kidId required' }, 400, origin);
      const key = `today_${kidId}_${todayKey()}`;
      await env.THRIVEPOINT_DB.delete(key);
      return json({ ok: true }, 200, origin);
    }

    return json({ error: 'Not found' }, 404, origin);
  },
};
