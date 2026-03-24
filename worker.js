/**
 * Thrivepoint API — Cloudflare Worker v2
 *
 * Routes:
 *   GET    /api/config                         → family config
 *   PUT    /api/config                         → save family config
 *   GET    /api/today?kidId=k1&date=YYYY-MM-DD → completions for a day (defaults to today)
 *   POST   /api/complete-task                  → mark task done, add points
 *   DELETE /api/uncomplete-task                → remove task completion + reverse points
 *   POST   /api/redeem-reward                  → spend points on a reward
 *   POST   /api/request-reward                 → kid requests a weekly reward for approval
 *   POST   /api/approve-reward                 → parent approves a pending reward request
 *   POST   /api/deny-reward                    → parent denies a pending reward request
 *   GET    /api/ledger?kidId=k1                → full ledger for a kid
 *   GET    /api/week?kidId=k1&weekStart=YYYY-MM-DD → per-day summary for a week
 *   GET    /api/reward-requests?kidId=k1       → pending reward requests for a kid
 *   DELETE /api/reset?kidId=k1                 → reset today's tasks (dev only)
 *
 * Auth: all requests must include header  X-Thrivepoint-Pin: <pin>
 */

const ALLOWED_ORIGINS = [
  'https://zgauba.github.io',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
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
  return new Date().toISOString().slice(0, 10);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // ── Auth ────────────────────────────────────────────────────────────────
    const config = await env.THRIVEPOINT_DB.get('family_config', { type: 'json' });
    const pin = request.headers.get('X-Thrivepoint-Pin');
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
      const date = url.searchParams.get('date') || todayKey();
      if (!kidId) return json({ error: 'kidId required' }, 400, origin);
      const key = `today_${kidId}_${date}`;
      const data = await env.THRIVEPOINT_DB.get(key, { type: 'json' });
      return json(data || { completedTaskIds: [], rewardIds: [] }, 200, origin);
    }

    // ── POST /api/complete-task ─────────────────────────────────────────────
    if (path === '/api/complete-task' && request.method === 'POST') {
      const { kidId, taskId, taskTitle, points } = await request.json();
      if (!kidId || !taskId) return json({ error: 'kidId and taskId required' }, 400, origin);

      const todayKvKey = `today_${kidId}_${todayKey()}`;
      const today = (await env.THRIVEPOINT_DB.get(todayKvKey, { type: 'json' })) || { completedTaskIds: [], rewardIds: [] };
      if (!today.completedTaskIds.includes(taskId)) {
        today.completedTaskIds.push(taskId);
      }
      await env.THRIVEPOINT_DB.put(todayKvKey, JSON.stringify(today), { expirationTtl: 60 * 60 * 48 });

      const ledgerKey = `ledger_${kidId}`;
      const ledger = (await env.THRIVEPOINT_DB.get(ledgerKey, { type: 'json' })) || [];
      const entryId = crypto.randomUUID();
      ledger.push({ id: entryId, type: 'earn', taskId, title: taskTitle || taskId, delta: points || 0, ts: Date.now() });
      await env.THRIVEPOINT_DB.put(ledgerKey, JSON.stringify(ledger));

      return json({ ok: true, entryId }, 200, origin);
    }

    // ── DELETE /api/uncomplete-task ─────────────────────────────────────────
    if (path === '/api/uncomplete-task' && request.method === 'DELETE') {
      const { kidId, taskId, points } = await request.json();
      if (!kidId || !taskId) return json({ error: 'kidId and taskId required' }, 400, origin);

      // Remove from today's completions
      const todayKvKey = `today_${kidId}_${todayKey()}`;
      const today = (await env.THRIVEPOINT_DB.get(todayKvKey, { type: 'json' })) || { completedTaskIds: [], rewardIds: [] };
      today.completedTaskIds = today.completedTaskIds.filter(id => id !== taskId);
      await env.THRIVEPOINT_DB.put(todayKvKey, JSON.stringify(today), { expirationTtl: 60 * 60 * 48 });

      // Remove the most recent earn entry for this task from the ledger
      const ledgerKey = `ledger_${kidId}`;
      const ledger = (await env.THRIVEPOINT_DB.get(ledgerKey, { type: 'json' })) || [];
      const idx = ledger.map(e => e.taskId).lastIndexOf(taskId);
      if (idx !== -1) ledger.splice(idx, 1);
      await env.THRIVEPOINT_DB.put(ledgerKey, JSON.stringify(ledger));

      return json({ ok: true }, 200, origin);
    }

    // ── POST /api/redeem-reward ─────────────────────────────────────────────
    if (path === '/api/redeem-reward' && request.method === 'POST') {
      const { kidId, rewardId, rewardTitle, cost } = await request.json();
      if (!kidId || !rewardId) return json({ error: 'kidId and rewardId required' }, 400, origin);

      const ledgerKey = `ledger_${kidId}`;
      const ledger = (await env.THRIVEPOINT_DB.get(ledgerKey, { type: 'json' })) || [];
      ledger.push({ id: crypto.randomUUID(), type: 'spend', rewardId, title: rewardTitle || rewardId, delta: -(cost || 0), ts: Date.now() });
      await env.THRIVEPOINT_DB.put(ledgerKey, JSON.stringify(ledger));

      const todayKvKey = `today_${kidId}_${todayKey()}`;
      const today = (await env.THRIVEPOINT_DB.get(todayKvKey, { type: 'json' })) || { completedTaskIds: [], rewardIds: [] };
      if (!today.rewardIds) today.rewardIds = [];
      today.rewardIds.push(rewardId);
      await env.THRIVEPOINT_DB.put(todayKvKey, JSON.stringify(today), { expirationTtl: 60 * 60 * 48 });

      return json({ ok: true }, 200, origin);
    }

    // ── POST /api/request-reward ────────────────────────────────────────────
    if (path === '/api/request-reward' && request.method === 'POST') {
      const { kidId, rewardId, rewardTitle, cost, note } = await request.json();
      if (!kidId || !rewardId) return json({ error: 'kidId and rewardId required' }, 400, origin);

      const reqKey = `reward_requests_${kidId}`;
      const requests = (await env.THRIVEPOINT_DB.get(reqKey, { type: 'json' })) || [];
      // Prevent duplicate pending requests for the same reward
      const alreadyPending = requests.some(r => r.rewardId === rewardId && r.status === 'pending');
      if (alreadyPending) return json({ ok: true, alreadyPending: true }, 200, origin);

      requests.push({
        id: crypto.randomUUID(),
        kidId,
        rewardId,
        rewardTitle: rewardTitle || rewardId,
        cost: cost || 0,
        note: note || '',
        status: 'pending',
        ts: Date.now(),
      });
      await env.THRIVEPOINT_DB.put(reqKey, JSON.stringify(requests));
      return json({ ok: true }, 200, origin);
    }

    // ── POST /api/approve-reward ────────────────────────────────────────────
    if (path === '/api/approve-reward' && request.method === 'POST') {
      const { kidId, requestId } = await request.json();
      if (!kidId || !requestId) return json({ error: 'kidId and requestId required' }, 400, origin);

      const reqKey = `reward_requests_${kidId}`;
      const requests = (await env.THRIVEPOINT_DB.get(reqKey, { type: 'json' })) || [];
      const req = requests.find(r => r.id === requestId);
      if (!req) return json({ error: 'Request not found' }, 404, origin);

      req.status = 'approved';
      req.approvedTs = Date.now();
      await env.THRIVEPOINT_DB.put(reqKey, JSON.stringify(requests));

      // Deduct points via ledger
      const ledgerKey = `ledger_${kidId}`;
      const ledger = (await env.THRIVEPOINT_DB.get(ledgerKey, { type: 'json' })) || [];
      ledger.push({ id: crypto.randomUUID(), type: 'spend', rewardId: req.rewardId, title: req.rewardTitle, delta: -(req.cost || 0), ts: Date.now() });
      await env.THRIVEPOINT_DB.put(ledgerKey, JSON.stringify(ledger));

      return json({ ok: true }, 200, origin);
    }

    // ── POST /api/deny-reward ───────────────────────────────────────────────
    if (path === '/api/deny-reward' && request.method === 'POST') {
      const { kidId, requestId } = await request.json();
      if (!kidId || !requestId) return json({ error: 'kidId and requestId required' }, 400, origin);

      const reqKey = `reward_requests_${kidId}`;
      const requests = (await env.THRIVEPOINT_DB.get(reqKey, { type: 'json' })) || [];
      const req = requests.find(r => r.id === requestId);
      if (req) { req.status = 'denied'; req.deniedTs = Date.now(); }
      await env.THRIVEPOINT_DB.put(reqKey, JSON.stringify(requests));

      return json({ ok: true }, 200, origin);
    }

    // ── GET /api/reward-requests ────────────────────────────────────────────
    if (path === '/api/reward-requests' && request.method === 'GET') {
      const kidId = url.searchParams.get('kidId');
      if (!kidId) return json({ error: 'kidId required' }, 400, origin);
      const requests = (await env.THRIVEPOINT_DB.get(`reward_requests_${kidId}`, { type: 'json' })) || [];
      return json(requests, 200, origin);
    }

    // ── GET /api/ledger ─────────────────────────────────────────────────────
    if (path === '/api/ledger' && request.method === 'GET') {
      const kidId = url.searchParams.get('kidId');
      if (!kidId) return json({ error: 'kidId required' }, 400, origin);
      const ledger = (await env.THRIVEPOINT_DB.get(`ledger_${kidId}`, { type: 'json' })) || [];
      return json(ledger.slice().reverse(), 200, origin); // newest first
    }

    // ── GET /api/week ───────────────────────────────────────────────────────
    // Returns per-day completion summary for a 7-day window starting weekStart
    if (path === '/api/week' && request.method === 'GET') {
      const kidId = url.searchParams.get('kidId');
      const weekStart = url.searchParams.get('weekStart') || todayKey();
      if (!kidId) return json({ error: 'kidId required' }, 400, origin);

      const startDate = new Date(weekStart + 'T00:00:00Z');
      const days = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(startDate);
        d.setUTCDate(d.getUTCDate() + i);
        const dateStr = d.toISOString().slice(0, 10);
        const key = `today_${kidId}_${dateStr}`;
        const data = await env.THRIVEPOINT_DB.get(key, { type: 'json' });
        days.push({ date: dateStr, completedTaskIds: data?.completedTaskIds || [], rewardIds: data?.rewardIds || [] });
      }

      // Also compute points earned per day from ledger
      const ledger = (await env.THRIVEPOINT_DB.get(`ledger_${kidId}`, { type: 'json' })) || [];
      const endDate = new Date(startDate);
      endDate.setUTCDate(endDate.getUTCDate() + 7);

      days.forEach(day => {
        const dayStart = new Date(day.date + 'T00:00:00Z').getTime();
        const dayEnd = dayStart + 86400000;
        day.pointsEarned = ledger
          .filter(e => e.type === 'earn' && e.ts >= dayStart && e.ts < dayEnd)
          .reduce((s, e) => s + e.delta, 0);
        day.pointsSpent = ledger
          .filter(e => e.type === 'spend' && e.ts >= dayStart && e.ts < dayEnd)
          .reduce((s, e) => s + Math.abs(e.delta), 0);
      });

      return json(days, 200, origin);
    }

    // ── DELETE /api/reset ───────────────────────────────────────────────────
    if (path === '/api/reset' && request.method === 'DELETE') {
      const kidId = url.searchParams.get('kidId');
      if (!kidId) return json({ error: 'kidId required' }, 400, origin);
      await env.THRIVEPOINT_DB.delete(`today_${kidId}_${todayKey()}`);
      return json({ ok: true }, 200, origin);
    }

    return json({ error: 'Not found' }, 404, origin);
  },
};
