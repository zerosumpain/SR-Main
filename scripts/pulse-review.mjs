#!/usr/bin/env node
/**
 * Two-week post-deploy diagnostic for the orchestrator heartbeat redesign.
 * Deployed: 2026-04-27. Review window: 14 days.
 *
 * NOTE: The original spec described `pulse_events` / `pulse_settings` tables.
 * What actually shipped uses `heartbeat_actions` (action catalogue) and
 * `heartbeat_pulses` (per-tick results) with four system-scan activities:
 *   • chat-continuation      (60 s cadence)   auto-resumes paused conversations
 *   • conversation-checkin   (300 s cadence)  status notes on long-running jobs
 *   • build-progress-check   (300 s cadence)  nudges stale running builds
 *   • workflow-review        (1800 s cadence) LLM analysis of completed workflow runs
 * Plus dynamic `targeted` actions that the orchestrator registers via tool call.
 *
 * Usage (on the VPS):
 *   cd /opt/strange-rambling-svelte
 *   set -a && . ./.env && set +a
 *   node scripts/pulse-review.mjs
 *
 * Or from laptop:
 *   ssh johnk@157.180.19.38 'cd /opt/strange-rambling-svelte && set -a && . ./.env && set +a && node scripts/pulse-review.mjs'
 */

import pg from 'pg';

const { Client } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set.');
  console.error('  Fix: set -a && . ./.env && set +a');
  process.exit(1);
}

const client = new Client({ connectionString: DATABASE_URL });
await client.connect();

const WINDOW_DAYS = 14;
const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600_000);
const sinceIso = since.toISOString();
const deployDate = new Date('2026-04-27T00:00:00Z');

// ─── helpers ────────────────────────────────────────────────────────────────

function hr(char = '─', width = 70) { return char.repeat(width); }
function h2(title) { console.log(`\n${hr()}\n## ${title}\n${hr()}`); }
function h3(title) { console.log(`\n### ${title}`); }

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function fmtSeconds(s) {
  if (s == null) return '—';
  const n = Number(s);
  if (n < 90) return `${Math.round(n)}s`;
  if (n < 3600) return `${Math.round(n / 60)}m`;
  return `${(n / 3600).toFixed(1)}h`;
}

function fmtUsd(v) {
  if (v == null) return '$0.000000';
  return `$${Number(v).toFixed(6)}`;
}

async function q(sql, params = []) {
  const r = await client.query(sql, params);
  return r.rows;
}

// ─── banner ─────────────────────────────────────────────────────────────────

console.log(hr('═'));
console.log('  Orchestrator Heartbeat — 2-week Post-Deploy Review');
console.log(`  Deploy date : 2026-04-27`);
console.log(`  Review from : ${fmtDate(since)}`);
console.log(`  Run at      : ${fmtDate(new Date())}`);
console.log(hr('═'));

// ─── 1. Action catalogue ─────────────────────────────────────────────────────

h2('1. Action Catalogue (current state)');

const actions = await q(`
  SELECT name, kind, status, cadence_seconds,
         total_runs, total_cost_usd,
         last_run_at, next_run_at,
         active_hours_start, active_hours_end, active_hours_tz
  FROM heartbeat_actions
  ORDER BY kind, name
`);

if (actions.length === 0) {
  console.log('No heartbeat_actions rows — seed may not have run yet.');
} else {
  for (const a of actions) {
    const hours = a.active_hours_start
      ? `${a.active_hours_start}–${a.active_hours_end} ${a.active_hours_tz ?? 'UTC'}`
      : 'always';
    console.log(`\n${a.name}  [${a.kind}]  status=${a.status}`);
    console.log(`  cadence  : ${fmtSeconds(a.cadence_seconds)}   active hours: ${hours}`);
    console.log(`  total runs (all time): ${a.total_runs}   total cost: ${fmtUsd(a.total_cost_usd)}`);
    console.log(`  last run : ${fmtDate(a.last_run_at)}`);
    console.log(`  next run : ${fmtDate(a.next_run_at)}`);
  }
}

// ─── 2. Volume by action + outcome ──────────────────────────────────────────

h2('2. Volume by Action + Outcome (last 14 days)');

const volume = await q(`
  SELECT ha.name        AS action,
         ha.kind        AS action_kind,
         hp.outcome,
         COUNT(*)::int  AS n
  FROM heartbeat_pulses hp
  JOIN heartbeat_actions ha ON ha.id = hp.action_id
  WHERE hp.ts >= $1
  GROUP BY ha.name, ha.kind, hp.outcome
  ORDER BY ha.name, hp.outcome
`, [sinceIso]);

if (volume.length === 0) {
  console.log('No pulses in the last 14 days. Either the engine is not running or the deploy was recent.');
} else {
  let lastAction = null;
  for (const r of volume) {
    if (r.action !== lastAction) {
      console.log(`\n${r.action}  [${r.action_kind}]`);
      lastAction = r.action;
    }
    console.log(`  ${r.outcome.padEnd(12)} ${String(r.n).padStart(6)} pulses`);
  }

  // Also total since deploy date
  const totals = await q(`
    SELECT ha.name AS action, COUNT(*)::int AS n_since_deploy
    FROM heartbeat_pulses hp
    JOIN heartbeat_actions ha ON ha.id = hp.action_id
    WHERE hp.ts >= $1
    GROUP BY ha.name
    ORDER BY ha.name
  `, [deployDate.toISOString()]);

  console.log('\nSince deploy (2026-04-27):');
  for (const r of totals) {
    console.log(`  ${r.action.padEnd(30)} ${String(r.n_since_deploy).padStart(7)} total pulses`);
  }
}

// ─── 3. Cadence: configured vs actual inter-arrival ─────────────────────────

h2('3. Cadence: Configured vs Actual Inter-Arrival');
console.log('(Inter-arrival = (last_ts - first_ts) / (count - 1) over the window)');

const cadence = await q(`
  SELECT ha.name                  AS action,
         ha.cadence_seconds       AS configured_cadence_sec,
         COUNT(*)::int            AS n,
         MIN(hp.ts)               AS first_ts,
         MAX(hp.ts)               AS last_ts,
         CASE WHEN COUNT(*) > 1
              THEN ROUND(
                EXTRACT(EPOCH FROM (MAX(hp.ts) - MIN(hp.ts)))
                / (COUNT(*) - 1)
              )
              ELSE NULL
         END                      AS avg_inter_arrival_sec
  FROM heartbeat_pulses hp
  JOIN heartbeat_actions ha ON ha.id = hp.action_id
  WHERE hp.ts >= $1
  GROUP BY ha.name, ha.cadence_seconds
  ORDER BY ha.name
`, [sinceIso]);

for (const r of cadence) {
  const drift = r.avg_inter_arrival_sec != null
    ? ((Number(r.avg_inter_arrival_sec) - Number(r.configured_cadence_sec)) / Number(r.configured_cadence_sec) * 100).toFixed(0)
    : null;
  const driftStr = drift != null ? ` (${drift > 0 ? '+' : ''}${drift}% vs configured)` : '';
  console.log(`\n${r.action}`);
  console.log(`  configured: ${fmtSeconds(r.configured_cadence_sec)}   pulses in window: ${r.n}`);
  console.log(`  avg inter-arrival: ${fmtSeconds(r.avg_inter_arrival_sec)}${driftStr}`);
  console.log(`  first: ${fmtDate(r.first_ts)}   last: ${fmtDate(r.last_ts)}`);
}

// ─── 4. Error rows ───────────────────────────────────────────────────────────

h2('4. Error Rows (outcome = \'error\')');

const errors = await q(`
  SELECT ha.name, hp.ts, hp.summary, hp.details, hp.duration_ms
  FROM heartbeat_pulses hp
  JOIN heartbeat_actions ha ON ha.id = hp.action_id
  WHERE hp.ts >= $1
    AND hp.outcome = 'error'
  ORDER BY hp.ts DESC
  LIMIT 50
`, [sinceIso]);

if (errors.length === 0) {
  console.log('No error pulses in the last 14 days.');
} else {
  console.log(`${errors.length} error pulse(s):\n`);
  for (const r of errors) {
    console.log(`[${fmtDate(r.ts)}] ${r.name}  duration=${r.duration_ms}ms`);
    console.log(`  summary: ${r.summary}`);
    if (r.details) {
      const d = typeof r.details === 'string' ? JSON.parse(r.details) : r.details;
      if (d.error) console.log(`  error detail: ${JSON.stringify(d.error).slice(0, 200)}`);
    }
    console.log();
  }
}

// ─── 5. chat-continuation analysis ──────────────────────────────────────────

h2('5. chat-continuation — Auto-Resume Analysis');
console.log('(This activity is the implemented analogue of "self-prod" from the spec.)');
console.log('It detects paused conversations and either auto-continues (LLM call) or sends a nudge note.\n');

h3('5a. Fired outcome distribution by mode');

const ccModes = await q(`
  SELECT
    elem->>'mode' AS mode,
    COUNT(*)::int AS n
  FROM heartbeat_pulses hp
  JOIN heartbeat_actions ha ON ha.id = hp.action_id,
  LATERAL jsonb_array_elements(
    CASE WHEN hp.details ? 'acted' THEN hp.details->'acted' ELSE '[]'::jsonb END
  ) AS elem
  WHERE ha.name = 'chat-continuation'
    AND hp.ts >= $1
    AND hp.outcome = 'fired'
  GROUP BY mode
  ORDER BY n DESC
`, [sinceIso]);

if (ccModes.length === 0) {
  console.log('No fired chat-continuation pulses with acted[] details.');
} else {
  for (const r of ccModes) {
    const label = {
      'auto-continue': 'auto-continue (LLM resumes benign pause)',
      'soft-checkin':  'soft-checkin  (LLM checks in on silent pause)',
      'nudge':         'nudge         (note: blocking/questioning pause)',
      'cap-nudge':     'cap-nudge     (note: hit 6-per-day LLM cap)',
    }[r.mode] ?? r.mode;
    console.log(`  ${label.padEnd(52)} ${String(r.n).padStart(5)}`);
  }
}

h3('5b. Distinct conversations touched (fired)');

const ccConvs = await q(`
  SELECT
    COUNT(DISTINCT hp.conversation_id)::int AS distinct_convs,
    COUNT(*)::int                           AS total_fired_pulses
  FROM heartbeat_pulses hp
  JOIN heartbeat_actions ha ON ha.id = hp.action_id
  WHERE ha.name = 'chat-continuation'
    AND hp.ts >= $1
    AND hp.outcome = 'fired'
`, [sinceIso]);

const ccRow = ccConvs[0];
console.log(`  distinct conversations reached : ${ccRow?.distinct_convs ?? 0}`);
console.log(`  total fired pulses             : ${ccRow?.total_fired_pulses ?? 0}`);

h3('5c. Conversations that hit the daily LLM-continuation cap (≥ 6 auto-continues in any 24h window)');
console.log('(Queries orchestrator_chats for heartbeat reply messages from this activity)');

const ccCapped = await q(`
  SELECT
    conversation_id,
    DATE_TRUNC('day', created_at AT TIME ZONE 'UTC') AS day_utc,
    COUNT(*)::int AS n
  FROM orchestrator_chats
  WHERE created_at >= $1
    AND metadata->'heartbeat'->>'activity' = 'chat-continuation'
    AND metadata->'heartbeat'->>'kind'     = 'reply'
  GROUP BY conversation_id, day_utc
  HAVING COUNT(*) >= 6
  ORDER BY n DESC, day_utc DESC
`, [sinceIso]);

if (ccCapped.length === 0) {
  console.log('  No conversation hit the 6-per-day cap.');
} else {
  console.log(`  ${ccCapped.length} conversation-day(s) hit the cap:\n`);
  for (const r of ccCapped) {
    console.log(`    conv ${r.conversation_id}  day=${String(r.day_utc).slice(0, 10)}  LLM replies=${r.n}`);
  }
}

h3('5d. Skip-reason aggregate (non-fired ticks)');

const ccSkips = await q(`
  SELECT
    kv.key   AS reason,
    SUM((kv.value::text)::int)::int AS total
  FROM heartbeat_pulses hp
  JOIN heartbeat_actions ha ON ha.id = hp.action_id,
  LATERAL jsonb_each(
    CASE WHEN hp.details ? 'skippedReasons'
         THEN hp.details->'skippedReasons'
         ELSE '{}'::jsonb
    END
  ) AS kv
  WHERE ha.name = 'chat-continuation'
    AND hp.ts >= $1
  GROUP BY kv.key
  ORDER BY total DESC
`, [sinceIso]);

if (ccSkips.length === 0) {
  console.log('  No skip-reason data (details column may be null on ok-outcome rows).');
} else {
  for (const r of ccSkips) {
    const label = {
      tooStale:         'tooStale          (last msg > 25 min old)',
      tooFresh:         'tooFresh          (last msg < 2 min old)',
      activeJob:        'activeJob         (orchestrator job still running)',
      cooldown:         'cooldown          (per-conv 5-min cooldown)',
      lastWasHeartbeat: 'lastWasHeartbeat  (avoid reply-to-heartbeat loops)',
      llmCap:           'llmCap            (hit 6/day LLM cap)',
      error:            'error             (exception during action)',
    }[r.reason] ?? r.reason;
    console.log(`  ${label.padEnd(52)} ${String(r.total).padStart(7)}`);
  }
}

// ─── 6. conversation-checkin analysis ───────────────────────────────────────

h2('6. conversation-checkin — Long-Job Status Notes');

const ciStats = await q(`
  SELECT
    COUNT(*)::int                          AS total_pulses,
    COUNT(*) FILTER (WHERE outcome='fired')::int AS fired,
    COUNT(*) FILTER (WHERE outcome='ok')::int    AS ok_no_action,
    COUNT(*) FILTER (WHERE outcome='skipped')::int AS skipped
  FROM heartbeat_pulses hp
  JOIN heartbeat_actions ha ON ha.id = hp.action_id
  WHERE ha.name = 'conversation-checkin'
    AND hp.ts >= $1
`, [sinceIso]);

const ci = ciStats[0] ?? {};
console.log(`  Total pulses in window: ${ci.total_pulses ?? 0}`);
console.log(`    fired (checkin note sent) : ${ci.fired ?? 0}`);
console.log(`    ok    (no long jobs)      : ${ci.ok_no_action ?? 0}`);
console.log(`    skipped (outside hours)   : ${ci.skipped ?? 0}`);

const ciDetails = await q(`
  SELECT
    COUNT(DISTINCT elem->>'convId')::int AS distinct_convs,
    COUNT(*)::int                        AS total_checkins
  FROM heartbeat_pulses hp
  JOIN heartbeat_actions ha ON ha.id = hp.action_id,
  LATERAL jsonb_array_elements(
    CASE WHEN hp.details ? 'acted' THEN hp.details->'acted' ELSE '[]'::jsonb END
  ) AS elem
  WHERE ha.name = 'conversation-checkin'
    AND hp.ts >= $1
    AND hp.outcome = 'fired'
`, [sinceIso]);

const cid = ciDetails[0] ?? {};
console.log(`  Distinct conversations received at least one checkin : ${cid.distinct_convs ?? 0}`);
console.log(`  Total individual checkin notes posted                : ${cid.total_checkins ?? 0}`);

// ─── 7. build-progress-check analysis ───────────────────────────────────────

h2('7. build-progress-check — Running Build Nudges');

const bpcStats = await q(`
  SELECT
    COUNT(*)::int                          AS total_pulses,
    COUNT(*) FILTER (WHERE outcome='fired')::int AS fired,
    COUNT(*) FILTER (WHERE outcome='ok')::int    AS ok_no_action,
    COUNT(*) FILTER (WHERE outcome='skipped')::int AS skipped
  FROM heartbeat_pulses hp
  JOIN heartbeat_actions ha ON ha.id = hp.action_id
  WHERE ha.name = 'build-progress-check'
    AND hp.ts >= $1
`, [sinceIso]);

const bpc = bpcStats[0] ?? {};
console.log(`  Total pulses in window: ${bpc.total_pulses ?? 0}`);
console.log(`    fired (nudge sent) : ${bpc.fired ?? 0}`);
console.log(`    ok    (no slow builds): ${bpc.ok_no_action ?? 0}`);
console.log(`    skipped (outside hours): ${bpc.skipped ?? 0}`);

const bpcNudges = await q(`
  SELECT
    COUNT(DISTINCT elem->>'buildId')::int AS distinct_builds,
    COUNT(*)::int AS total_nudges
  FROM heartbeat_pulses hp
  JOIN heartbeat_actions ha ON ha.id = hp.action_id,
  LATERAL jsonb_array_elements(
    CASE WHEN hp.details ? 'acted' THEN hp.details->'acted' ELSE '[]'::jsonb END
  ) AS elem
  WHERE ha.name = 'build-progress-check'
    AND hp.ts >= $1
    AND hp.outcome = 'fired'
`, [sinceIso]);

const bpcn = bpcNudges[0] ?? {};
console.log(`  Distinct builds nudged : ${bpcn.distinct_builds ?? 0}`);
console.log(`  Total nudge notes sent : ${bpcn.total_nudges ?? 0}`);

// ─── 8. workflow-review LLM findings ────────────────────────────────────────

h2('8. workflow-review — LLM Run Analysis');

const wrStats = await q(`
  SELECT
    COUNT(*)::int                          AS total_pulses,
    COUNT(*) FILTER (WHERE outcome='fired')::int AS fired,
    COUNT(*) FILTER (WHERE outcome='ok')::int    AS ok_nothing_new,
    COUNT(*) FILTER (WHERE outcome='skipped')::int AS skipped
  FROM heartbeat_pulses hp
  JOIN heartbeat_actions ha ON ha.id = hp.action_id
  WHERE ha.name = 'workflow-review'
    AND hp.ts >= $1
`, [sinceIso]);

const wr = wrStats[0] ?? {};
console.log(`  Total pulses: ${wr.total_pulses ?? 0}  fired: ${wr.fired ?? 0}  ok: ${wr.ok_nothing_new ?? 0}  skipped: ${wr.skipped ?? 0}`);

const wrFired = await q(`
  SELECT hp.ts,
         hp.details->>'workflowName' AS workflow_name,
         hp.details->>'runId'        AS run_id,
         hp.details->>'review'       AS review,
         hp.cost_usd
  FROM heartbeat_pulses hp
  JOIN heartbeat_actions ha ON ha.id = hp.action_id
  WHERE ha.name = 'workflow-review'
    AND hp.ts >= $1
    AND hp.outcome = 'fired'
  ORDER BY hp.ts DESC
  LIMIT 10
`, [sinceIso]);

if (wrFired.length === 0) {
  console.log('\n  No reviewed runs yet.');
} else {
  console.log(`\n  Last ${wrFired.length} review(s):\n`);
  for (const r of wrFired) {
    console.log(`  [${fmtDate(r.ts)}] run=${r.run_id?.slice(0, 8) ?? '?'}  workflow="${r.workflow_name ?? '?'}"  cost=${fmtUsd(r.cost_usd)}`);
    if (r.review) {
      const lines = r.review.split('\n').map(l => '    ' + l);
      console.log(lines.join('\n'));
    }
    console.log();
  }
}

// ─── 9. targeted actions ────────────────────────────────────────────────────

h2('9. Targeted Actions (orchestrator-registered)');

const targeted = await q(`
  SELECT ha.name, ha.status, ha.goal, ha.cadence_seconds,
         ha.total_runs, ha.total_cost_usd, ha.conversation_id,
         ha.created_at, ha.completed_at
  FROM heartbeat_actions ha
  WHERE ha.kind = 'targeted'
  ORDER BY ha.created_at DESC
`);

if (targeted.length === 0) {
  console.log('No targeted actions registered.');
} else {
  console.log(`${targeted.length} targeted action(s):\n`);
  for (const a of targeted) {
    console.log(`  ${a.name}  status=${a.status}  runs=${a.total_runs}  cost=${fmtUsd(a.total_cost_usd)}`);
    console.log(`    conv   : ${a.conversation_id ?? '—'}`);
    console.log(`    goal   : ${(a.goal ?? '(none)').slice(0, 100)}`);
    console.log(`    created: ${fmtDate(a.created_at)}   completed: ${fmtDate(a.completed_at)}`);
    console.log();
  }

  // Targeted pulse breakdown
  const tpulses = await q(`
    SELECT ha.name, hp.outcome, COUNT(*)::int AS n,
           SUM(hp.cost_usd::numeric)::numeric AS cost
    FROM heartbeat_pulses hp
    JOIN heartbeat_actions ha ON ha.id = hp.action_id
    WHERE ha.kind = 'targeted'
      AND hp.ts >= $1
    GROUP BY ha.name, hp.outcome
    ORDER BY ha.name, hp.outcome
  `, [sinceIso]);

  if (tpulses.length > 0) {
    console.log('  Pulses in window:');
    for (const r of tpulses) {
      console.log(`    ${r.name}  ${r.outcome.padEnd(12)} x${r.n}  cost=${fmtUsd(r.cost)}`);
    }
  }
}

// ─── 10. LLM cost breakdown ──────────────────────────────────────────────────

h2('10. LLM Cost Breakdown (last 14 days)');

const cost = await q(`
  SELECT ha.name,
         SUM(hp.cost_usd::numeric)          AS total_usd,
         COUNT(*) FILTER (WHERE hp.cost_usd::numeric > 0)::int AS paid_pulses,
         AVG(hp.cost_usd::numeric) FILTER (WHERE hp.cost_usd::numeric > 0) AS avg_usd_per_paid
  FROM heartbeat_pulses hp
  JOIN heartbeat_actions ha ON ha.id = hp.action_id
  WHERE hp.ts >= $1
  GROUP BY ha.name
  ORDER BY total_usd DESC
`, [sinceIso]);

let grandTotal = 0;
for (const r of cost) {
  grandTotal += Number(r.total_usd ?? 0);
  console.log(`  ${r.name.padEnd(30)} total=${fmtUsd(r.total_usd)}  paid pulses=${r.paid_pulses}  avg/paid=${fmtUsd(r.avg_usd_per_paid)}`);
}
console.log(`\n  Grand total (14 days): ${fmtUsd(grandTotal)}`);

// ─── 11. jkai_memories — staleness snapshot ──────────────────────────────────

h2('11. jkai_memories — Staleness Snapshot');
console.log('(memory_update_review activity was not shipped — this is a direct table snapshot.)');

const memStats = await q(`
  SELECT
    category,
    confidence,
    COUNT(*)::int AS n,
    MIN(updated_at) AS oldest_updated,
    MAX(updated_at) AS newest_updated
  FROM jkai_memories
  WHERE superseded_by IS NULL
  GROUP BY category, confidence
  ORDER BY category, confidence
`);

if (memStats.length === 0) {
  console.log('No active jkai_memories rows.');
} else {
  let totalMems = 0;
  for (const r of memStats) {
    totalMems += r.n;
    const staleDays = Math.round((Date.now() - new Date(r.oldest_updated).getTime()) / 86400_000);
    console.log(`  ${r.category.padEnd(16)} [${r.confidence}]  n=${r.n}  oldest_update=${String(r.oldest_updated).slice(0, 10)} (${staleDays}d ago)`);
  }
  console.log(`\n  Total active memories: ${totalMems}`);

  // Memories not updated in the last 30 days
  const stale30 = await q(`
    SELECT id, category, content, updated_at
    FROM jkai_memories
    WHERE superseded_by IS NULL
      AND updated_at < NOW() - INTERVAL '30 days'
    ORDER BY updated_at ASC
    LIMIT 20
  `);

  if (stale30.length > 0) {
    console.log(`\n  ${stale30.length} memories not updated in 30+ days (consider reviewing):`);
    for (const r of stale30) {
      const days = Math.round((Date.now() - new Date(r.updated_at).getTime()) / 86400_000);
      console.log(`    [${r.category}] ${r.id.slice(0, 8)}…  ${days}d old — ${r.content.slice(0, 80)}`);
    }
  } else {
    console.log('  All memories updated within the last 30 days.');
  }
}

// ─── 12. Noise / signal summary ──────────────────────────────────────────────

h2('12. Noise vs Signal Summary');

const noiseRows = await q(`
  SELECT ha.name, COUNT(*)::int AS ok_n
  FROM heartbeat_pulses hp
  JOIN heartbeat_actions ha ON ha.id = hp.action_id
  WHERE hp.ts >= $1
    AND hp.outcome IN ('ok', 'skipped')
  GROUP BY ha.name
`, [sinceIso]);

const firedRows = await q(`
  SELECT ha.name, COUNT(*)::int AS fired_n
  FROM heartbeat_pulses hp
  JOIN heartbeat_actions ha ON ha.id = hp.action_id
  WHERE hp.ts >= $1
    AND hp.outcome = 'fired'
  GROUP BY ha.name
`, [sinceIso]);

const noiseMap = Object.fromEntries(noiseRows.map(r => [r.name, r.ok_n]));
const firedMap = Object.fromEntries(firedRows.map(r => [r.name, r.fired_n]));
const allNames = [...new Set([...Object.keys(noiseMap), ...Object.keys(firedMap)])].sort();

console.log('\n  action                          ok/skipped    fired    signal%');
console.log('  ' + '─'.repeat(65));
for (const name of allNames) {
  const noise = noiseMap[name] ?? 0;
  const fired = firedMap[name] ?? 0;
  const total = noise + fired;
  const pct = total > 0 ? Math.round(fired / total * 100) : 0;
  console.log(`  ${name.padEnd(32)} ${String(noise).padStart(10)}  ${String(fired).padStart(6)}   ${String(pct).padStart(5)}%`);
}

// ─── done ────────────────────────────────────────────────────────────────────

console.log(`\n${hr('═')}`);
console.log('  Review complete. Paste the output above into the worksheet at:');
console.log('  docs/superpowers/specs/2026-04-27-orchestrator-heartbeat-redesign-design.md');
console.log(hr('═'));

await client.end();
