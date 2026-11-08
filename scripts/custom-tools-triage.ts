// Rank the stored custom tools so the owner can pick the few worth keeping.
//
//   DATABASE_URL=postgresql://... npx tsx scripts/custom-tools-triage.ts [--out report.md]
//   npx tsx scripts/custom-tools-triage.ts --print-sql            # the query, for psql
//   npx tsx scripts/custom-tools-triage.ts --rows rows.json --out report.md [--source "label"]
//
// READ-ONLY, and the code never leaves the database. Overhaul plan 2026-10-28,
// P2-0a / decision 8: 112 custom tools are enabled but not loaded; the owner
// picks perhaps 3-10, which come back only after principal phase 2. This script
// changes nothing — it re-enables, disables and deletes nothing.
//
// The query runs inside BEGIN READ ONLY … ROLLBACK and returns SIGNALS computed
// from `handler_code` in SQL (does it shell out, call the platform, fetch, touch
// secrets, write the database), never the code itself: a handler can hold a
// pasted credential, and a report is not where one should land. Descriptions are
// trimmed and anything shaped like a token is redacted.
//
// Production is not reachable from a workstation, so `--print-sql` hands the
// same query to psql on the database host (wrapped as JSON), and `--rows` ranks
// what came back. One query, two ways to run it.

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export const TRIAGE_SQL = `
SELECT
  name,
  toolset,
  enabled,
  created_by,
  run_count,
  error_count,
  last_run_at,
  created_at,
  left(regexp_replace(description, '\\s+', ' ', 'g'), 220) AS description,
  length(handler_code) AS code_chars,
  handler_code ~* '(child_process|execSync|execFile|spawn\\(|\\bexec\\(|bash -c|/bin/sh)' AS shells_out,
  handler_code ~* 'platform\\.(call|tool|invoke)|executeTool|callTool' AS calls_platform,
  handler_code ~* '\\bfetch\\(|axios|https?://' AS uses_network,
  handler_code ~* '(process\\.env|secret|api[_-]?key|token|password|bearer)' AS touches_secrets,
  handler_code ~* '\\b(insert into|update [a-z_]+ set|delete from|drop table|truncate)\\b|\\.insert\\(|\\.update\\(|\\.delete\\(' AS writes_db,
  handler_code ~* '(writeFile|appendFile|unlink|rmSync|mkdir)' AS writes_files,
  coalesce(chat.calls, 0)::int AS chat_calls
FROM custom_tools
LEFT JOIN (
  -- Calls from the owner's own chat turns (traces exist from 2026-08-08), as
  -- against run_count, which also counts self-improvement probe runs.
  SELECT s ->> 'tool' AS tool, count(*) AS calls
  FROM jkai_tool_traces t, LATERAL jsonb_array_elements(t.steps -> 'steps') s
  GROUP BY 1
) chat ON chat.tool = custom_tools.name
ORDER BY name
`.trim();

export interface TriageRow {
  name: string;
  toolset: string;
  enabled: boolean;
  created_by: string;
  run_count: number;
  error_count: number;
  last_run_at: string | null;
  created_at: string | null;
  description: string;
  code_chars: number;
  shells_out: boolean;
  calls_platform: boolean;
  uses_network: boolean;
  touches_secrets: boolean;
  writes_db: boolean;
  writes_files: boolean;
  /** Calls from chat turns (jkai_tool_traces), as against probe runs. */
  chat_calls?: number;
}

export interface Ranked extends TriageRow {
  errorRate: number | null;
  daysSinceRun: number | null;
  score: number;
  tier: 'keep-candidate' | 'review' | 'retire';
  reasons: string[];
  collides: boolean;
}

/** Long opaque strings (keys, tokens, hashes) are not for a report. */
export function redact(text: string): string {
  return (text ?? '').replace(/[A-Za-z0-9_\-+/=]{28,}/g, '[redacted]');
}

/**
 * The ranking. PURE, and deliberately simple enough to argue with: use is the
 * main signal (runs, recency, a low error rate), and every form of reach a
 * custom tool should not need on its own — a shell, the database, secrets, other
 * tools — costs points, because a kept tool still runs inside the web process.
 */
export function rank(rows: readonly TriageRow[], builtinNames: ReadonlySet<string>, now = Date.now()): Ranked[] {
  return rows
    .map((r) => {
      const runs = Number(r.run_count) || 0;
      const errors = Number(r.error_count) || 0;
      const errorRate = runs > 0 ? Math.min(1, errors / runs) : null;
      const daysSinceRun = r.last_run_at ? Math.floor((now - Date.parse(r.last_run_at)) / 86_400_000) : null;
      const reasons: string[] = [];
      const chatCalls = Number(r.chat_calls) || 0;
      let score = Math.log2(1 + runs) * 2 + Math.log2(1 + chatCalls) * 3;
      if (chatCalls > 0) reasons.push(`called from chat ${chatCalls}x`);
      else reasons.push('never called from a chat turn');
      if (daysSinceRun !== null && daysSinceRun <= 30) { score += 3; reasons.push('used in the last 30 days'); }
      else if (daysSinceRun !== null && daysSinceRun <= 90) { score += 1.5; reasons.push('used in the last 90 days'); }
      else if (runs === 0) reasons.push('never run');
      if (errorRate !== null) {
        score += (1 - errorRate) * 2;
        if (errorRate >= 0.5) reasons.push(`fails ${Math.round(errorRate * 100)}% of runs`);
      }
      if (r.shells_out) { score -= 3; reasons.push('shells out'); }
      if (r.writes_db) { score -= 1; reasons.push('writes the database'); }
      if (r.writes_files) { score -= 1; reasons.push('writes files'); }
      if (r.touches_secrets) { score -= 1; reasons.push('reads secrets or tokens'); }
      if (r.calls_platform) { score -= 0.5; reasons.push('calls other tools'); }
      const collides = builtinNames.has(r.name);
      if (collides) reasons.push('name collides with a built-in tool');
      if (!r.enabled) { score -= 2; reasons.push('disabled'); }

      const tier: Ranked['tier'] =
        r.enabled && !collides && !r.shells_out && chatCalls >= 1 && runs >= 3 && (errorRate ?? 1) < 0.3 && (daysSinceRun ?? 999) <= 90
          ? 'keep-candidate'
          : runs === 0 || (errorRate ?? 0) >= 0.5 || (daysSinceRun ?? 999) > 90 || collides
            ? 'retire'
            : 'review';
      return { ...r, chat_calls: chatCalls, run_count: runs, error_count: errors, errorRate, daysSinceRun, score: Math.round(score * 10) / 10, tier, reasons, collides };
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

const pct = (n: number | null) => (n === null ? '–' : `${Math.round(n * 100)}%`);
const cell = (s: string) => redact(s).replace(/\|/g, '\\|');
const flags = (r: Ranked) =>
  [r.shells_out && 'shell', r.calls_platform && 'platform', r.uses_network && 'net', r.touches_secrets && 'secrets', r.writes_db && 'db-write', r.writes_files && 'files']
    .filter(Boolean)
    .join(', ') || '–';

export function renderReport(ranked: readonly Ranked[], generatedAt: string, source: string): string {
  const enabled = ranked.filter((r) => r.enabled);
  const totals = ranked.reduce((a, r) => ({ runs: a.runs + r.run_count, errors: a.errors + r.error_count }), { runs: 0, errors: 0 });
  const byTier = (t: Ranked['tier']) => ranked.filter((r) => r.tier === t);
  const toolsets = new Map<string, number>();
  for (const r of ranked) toolsets.set(r.toolset, (toolsets.get(r.toolset) ?? 0) + 1);
  const row = (r: Ranked, i: number) =>
    `| ${i + 1} | \`${r.name}\` | ${cell(r.toolset)} | ${r.score} | ${r.chat_calls ?? 0} | ${r.run_count} | ${pct(r.errorRate)} | ${r.daysSinceRun ?? 'never'} | ${flags(r)} | ${cell(r.created_by)} | ${cell(r.description).slice(0, 140)} |`;
  const head = '| # | Tool | Toolset | Score | Chat calls | Runs | Errors | Days since run | Reach | Created by | What it says it does |\n|---|---|---|---|---|---|---|---|---|---|---|';

  return [
    '# Custom tools triage',
    '',
    `Generated ${generatedAt} from ${source} by \`scripts/custom-tools-triage.ts\` (read-only; handler code is not included).`,
    '',
    '## Summary',
    '',
    `- ${ranked.length} custom tools, ${enabled.length} enabled. None is loaded into jkai today (2026-10-28 overhaul audit), so these numbers are history, not current use.`,
    `- Lifetime: ${totals.runs} runs and ${totals.errors} errors (${pct(totals.runs ? totals.errors / totals.runs : null)}).`,
    `- ${byTier('keep-candidate').length} keep candidates, ${byTier('review').length} to review, ${byTier('retire').length} to retire.`,
    `- ${ranked.filter((r) => r.shells_out).length} shell out, ${ranked.filter((r) => r.touches_secrets).length} read secrets or tokens, ${ranked.filter((r) => r.writes_db).length} write the database, ${ranked.filter((r) => r.calls_platform).length} call other tools, ${ranked.filter((r) => r.collides).length} collide with a built-in name.`,
    `- Toolsets: ${[...toolsets].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} (${n})`).join(', ')}.`,
    '',
    '## How to use this',
    '',
    'Pick about 3 to 10 to keep (decision 8). Kept tools come back only after principal phase 2, under a `custom:` prefix, in the web process only, and never on the WhatsApp, heartbeat, bridge or unattended lanes. Everything else is disabled with `update_tool`. Nothing in this report has been changed.',
    '',
    `- ${ranked.filter((r) => (r.chat_calls ?? 0) > 0).length} were ever called from a chat turn (traces start 2026-08-08); the rest of \`run_count\` is self-improvement probe runs.`,
    '',
    'Score: `2*log2(1+runs) + 3*log2(1+chat calls)`, +3 if run in the last 30 days (+1.5 for 90), +2 scaled by success rate, then -3 for a shell, -1 each for database writes, file writes and secrets, -0.5 for calling other tools, -2 if disabled. A keep candidate is enabled, has been called from chat at least once, has run at least 3 times in the last 90 days with under 30% errors, does not shell out and does not collide with a built-in name.',
    '',
    '## Shortlist: the ten strongest keep candidates',
    '',
    byTier('keep-candidate').slice(0, 10).map((r) => `- \`${r.name}\` (${cell(r.toolset)}): ${r.reasons.join('; ')}.`).join('\n') || '_None._',
    '',
    '## Keep candidates',
    '',
    byTier('keep-candidate').length ? head + '\n' + byTier('keep-candidate').map(row).join('\n') : '_None meet the bar. The review list is where to look._',
    '',
    '## Review',
    '',
    byTier('review').length ? head + '\n' + byTier('review').map(row).join('\n') : '_None._',
    '',
    '## Retire',
    '',
    'Never run, failing at least half the time, idle for over 90 days, or shadowing a built-in.',
    '',
    byTier('retire').length ? head + '\n' + byTier('retire').map(row).join('\n') : '_None._',
    '',
  ].join('\n');
}

/** Every built-in tool name, by the same grep `tests/skills/tool-names-exist.test.ts` uses. */
function builtinToolNames(): Set<string> {
  try {
    const out = execFileSync('bash', ['-c', `grep -rhoE "name: '[a-z0-9_]+'" src/lib/tools/tools/*.ts | sed "s/name: '//;s/'//" | sort -u`], { encoding: 'utf8' });
    return new Set(out.trim().split('\n').filter(Boolean));
  } catch {
    return new Set();
  }
}

async function loadRows(): Promise<{ rows: TriageRow[]; source: string }> {
  const rowsFlag = process.argv.indexOf('--rows');
  if (rowsFlag >= 0) {
    const file = process.argv[rowsFlag + 1];
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return { rows: Array.isArray(parsed) ? parsed : parsed.rows ?? [], source: `rows exported by psql (${file})` };
  }
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const { rows } = await client.query(TRIAGE_SQL);
    await client.query('ROLLBACK');
    return { rows, source: 'DATABASE_URL (BEGIN READ ONLY … ROLLBACK)' };
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  if (process.argv.includes('--print-sql')) {
    // For psql: the query as one JSON array, still read-only.
    process.stdout.write(`BEGIN READ ONLY;\nSELECT coalesce(json_agg(t), '[]'::json) FROM (\n${TRIAGE_SQL}\n) t;\nROLLBACK;\n`);
    return;
  }
  const { rows, source } = await loadRows();
  const labelFlag = process.argv.indexOf('--source');
  const label = labelFlag >= 0 ? process.argv[labelFlag + 1] : source;
  const report = renderReport(rank(rows, builtinToolNames()), new Date().toISOString(), label);
  const outFlag = process.argv.indexOf('--out');
  if (outFlag >= 0) writeFileSync(process.argv[outFlag + 1], report);
  else process.stdout.write(report);
}

if (process.argv[1]?.endsWith('custom-tools-triage.ts')) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
