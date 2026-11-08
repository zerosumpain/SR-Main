// The Lab report (spec §11.1): the scorecard as JSON and as one
// self-contained HTML page (no scripts, no network), written under
// scripts/hometowns/reports/ (git-ignored output). `latest.html` and
// `latest.json` always point at the newest run, which is what the local
// report server shows.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Check, GateResult, Verdict } from './gates';
import type { Scorecard } from './summary';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPORT_DIR = join(HERE, '..', 'reports');

const esc = (s: unknown) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const fmt = (v: unknown): string => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return v > 0 ? '∞' : '—';
    if (Math.abs(v) >= 10000) return Math.round(v).toLocaleString('en-GB');
    return String(Math.round(v * 1000) / 1000);
  }
  return String(v);
};

const pill = (v: Verdict | 'identical' | 'provisional' | null) => {
  const label = v === null ? 'pending' : v;
  return `<span class="pill ${esc(label)}">${esc(label)}</span>`;
};

function checkRow(c: Check): string {
  const v = c.provisional ? 'provisional' : c.ok === null ? 'pending' : c.ok ? 'pass' : 'fail';
  const ci = c.ci && c.ci.n > 1 ? `<span class="ci">[${fmt(c.ci.lo)}, ${fmt(c.ci.hi)}]</span>` : '';
  return `<tr><td>${esc(c.name)}${c.note ? `<div class="note">${esc(c.note)}</div>` : ''}</td><td class="num">${esc(fmt(c.value))} ${ci}</td><td>${esc(c.target)}</td><td class="num">${c.n ?? ''}</td><td>${pill(v as Verdict)}</td></tr>`;
}

function gateCard(g: GateResult): string {
  return `<section class="gate ${g.verdict}">
  <header><h3>${esc(g.id)} · ${esc(g.title)}</h3>${g.m0 ? '<span class="tag">M0 exit</span>' : ''}${pill(g.verdict)}</header>
  ${g.note ? `<p class="note">${esc(g.note)}</p>` : ''}
  <table><thead><tr><th>Check</th><th class="num">Value [95% CI]</th><th>Target</th><th class="num">n</th><th></th></tr></thead><tbody>${g.checks.map(checkRow).join('')}</tbody></table>
</section>`;
}

/** Median population by day for each bot, drawn as direct-labelled lines. */
function popChart(s: Scorecard): string {
  const rows = s.bots.filter((b) => b.popByDay.length > 1);
  if (!rows.length) return '';
  const W = 760;
  const H = 300;
  const L = 56;
  const R = 110;
  const T = 12;
  const B = 28;
  const days = Math.max(...rows.map((b) => b.popByDay.length));
  const maxPop = Math.max(10, ...rows.flatMap((b) => b.popByDay));
  const x = (d: number) => L + ((W - L - R) * d) / Math.max(1, days - 1);
  const y = (p: number) => T + (H - T - B) * (1 - p / maxPop);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxPop * f));
  const grid = ticks.map((p) => `<line x1="${L}" x2="${W - R}" y1="${y(p)}" y2="${y(p)}" class="grid"/><text x="${L - 6}" y="${y(p) + 4}" class="axis" text-anchor="end">${esc(fmt(p))}</text>`).join('');
  const xt = [1, Math.round(days / 2), days].map((d) => `<text x="${x(d - 1)}" y="${H - 8}" class="axis" text-anchor="middle">day ${d}</text>`).join('');
  const lines = rows
    .map((b, k) => {
      const pts = b.popByDay.map((p, d) => `${x(d).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
      const lastY = y(b.popByDay[b.popByDay.length - 1]);
      return `<polyline points="${pts}" class="line ${b.bot === 'balanced' ? 'lead' : ''}" style="--k:${k}"/><text x="${W - R + 6}" y="${lastY + 4}" class="lbl ${b.bot === 'balanced' ? 'lead' : ''}">${esc(b.bot)}</text>`;
    })
    .join('');
  return `<figure><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Median population by day for each bot">${grid}${xt}${lines}</svg><figcaption>Median population at each Regional Day, by bot (mixed counties).</figcaption></figure>`;
}

function botTable(s: Scorecard): string {
  const head = '<tr><th>Bot</th><th class="num">Towns</th><th class="num">Final pop (median) [CI]</th><th class="num">Happy</th><th class="num">Village</th><th class="num">Town</th><th class="num">City</th><th class="num">Metro</th><th class="num">Helper days</th><th class="num">Composite</th><th class="num">Sessions</th><th>Most refused</th></tr>';
  const rows = s.bots
    .map(
      (b) =>
        `<tr><td>${esc(b.bot)}</td><td class="num">${b.n}</td><td class="num">${fmt(b.finalPop.est)} <span class="ci">[${fmt(b.finalPop.lo)}, ${fmt(b.finalPop.hi)}]</span></td><td class="num">${fmt(b.happy)}</td>${b.tierDays
          .map((d, k) => `<td class="num">${d === null ? '—' : fmt(d)}<div class="note">${Math.round(b.tierShare[k] * 100)}%</div></td>`)
          .join('')}<td class="num">${fmt(b.helperDays)}</td><td class="num">${fmt(b.composite)}</td><td class="num">${fmt(b.sessions)}</td><td class="note">${b.refusals.map(([k, n]) => `${esc(k)} ×${n}`).join('<br>')}</td></tr>`,
    )
    .join('');
  return `<table class="wide"><thead>${head}</thead><tbody>${rows}</tbody></table><p class="note">Tier columns: median Regional Day the tier was reached (— if the median town did not), and the share of towns that reached it.</p>`;
}

function abSection(s: Scorecard): string {
  if (!s.ab) return '';
  const a = s.ab;
  const rows = a.metrics.map((m) => `<tr><td>${esc(m.name)}</td><td class="num">${fmt(m.base)}</td><td class="num">${fmt(m.variant)}</td><td class="num">${fmt(m.diff.est)} <span class="ci">[${fmt(m.diff.lo)}, ${fmt(m.diff.hi)}]</span></td><td class="num">${fmt(m.rel * 100)}%</td><td>${m.diff.lo > 0 || m.diff.hi < 0 ? 'significant' : 'within noise'}</td></tr>`).join('');
  const gates = a.gates.map((g) => `<tr><td>${esc(g.id)}</td><td>${pill(g.base)}</td><td>${pill(g.variant)}</td></tr>`).join('');
  return `<h2>Paired A/B: ${esc(a.variant)}</h2><p class="note">${a.pairs} paired towns (same seed, same seat). Overrides: <code>${esc(JSON.stringify(a.overrides))}</code></p>
<table><thead><tr><th>Metric</th><th class="num">Base</th><th class="num">Variant</th><th class="num">Δ [95% CI]</th><th class="num">Δ / base</th><th></th></tr></thead><tbody>${rows}</tbody></table>
<table><thead><tr><th>Gate</th><th>Base</th><th>Variant</th></tr></thead><tbody>${gates}</tbody></table>`;
}

function sweepSection(s: Scorecard): string {
  if (!s.sweep) return '';
  const sw = s.sweep;
  const cell = (r: Record<string, number>, k: string) => `<td class="num">${fmt(r[k])}</td>`;
  const rows = sw.rows
    .map((r) => `<tr class="${r.fragile ? 'fragile' : r.dead ? 'dead' : ''}"><td><code>${esc(r.path)}</code></td>${sw.outcomes.map((k) => cell(r.down, k)).join('')}${sw.outcomes.map((k) => cell(r.up, k)).join('')}<td>${r.fragile ? 'fragile' : r.dead ? 'dead' : ''}</td></tr>`)
    .join('');
  const hdr = sw.outcomes.map((k) => `<th class="num">${esc(k)}</th>`).join('');
  return `<h2>Sensitivity sweep (±20%, one at a time)</h2><p class="note">${sw.seeds} seeds × 6 Balanced towns × ${sw.days} days per variant. Values are outcome ÷ baseline. Fragile: an outcome moves more than 2×. Dead: every outcome moves less than 1% both ways.</p>
<table class="wide"><thead><tr><th rowspan="2">Parameter</th><th colspan="${sw.outcomes.length}">×0.8</th><th colspan="${sw.outcomes.length}">×1.2</th><th rowspan="2"></th></tr><tr>${hdr}${hdr}</tr></thead><tbody>${rows}</tbody></table>`;
}

function offRuleSection(s: Scorecard): string {
  if (!s.offRule) return '';
  const rows = s.offRule.rows.map((r) => `<tr><td>${esc(r.system)}</td><td>${pill(r.status === 'identical' ? 'identical' : (r.status as Verdict))}</td><td>${esc(r.firstDivergence ?? '—')}</td><td class="note">${esc(r.note)}</td></tr>`).join('');
  return `<h2>Off-rule identity runs</h2><table><thead><tr><th>System off</th><th></th><th>First divergence</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table>`;
}

const CSS = `
:root{--bg:#f7f6f2;--card:#fff;--ink:#1d2321;--muted:#5d6762;--line:#dcdcd4;--pass:#2f6b45;--passbg:#e2efe5;--fail:#9b2d2d;--failbg:#f6e1df;--pend:#7a5a12;--pendbg:#f4ecd6;--lead:#0f5c6e;--series:#8a938e}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#141816;--card:#1c211f;--ink:#e6e9e7;--muted:#9aa5a0;--line:#2f3633;--pass:#8fd0a5;--passbg:#1f3427;--fail:#f0a39b;--failbg:#3a2220;--pend:#e6c879;--pendbg:#3a3220;--lead:#7cc6d6;--series:#6f7a75}}
:root[data-theme="dark"]{--bg:#141816;--card:#1c211f;--ink:#e6e9e7;--muted:#9aa5a0;--line:#2f3633;--pass:#8fd0a5;--passbg:#1f3427;--fail:#f0a39b;--failbg:#3a2220;--pend:#e6c879;--pendbg:#3a3220;--lead:#7cc6d6;--series:#6f7a75}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1180px;margin:0 auto;padding:24px 16px 64px}h1{font-size:26px;margin:0 0 4px}h2{font-size:19px;margin:36px 0 10px}h3{font-size:16px;margin:0}
.meta{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px 16px;margin:14px 0;color:var(--muted);font-size:13px}.meta b{display:block;color:var(--ink);font-weight:600;font-size:14px;word-break:break-all}
.pill{display:inline-block;padding:1px 10px;border-radius:100px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.03em}
.pill.pass,.pill.identical{background:var(--passbg);color:var(--pass)}.pill.fail{background:var(--failbg);color:var(--fail)}.pill.pending,.pill.provisional{background:var(--pendbg);color:var(--pend)}
.tag{font-size:12px;color:var(--muted);border:1px solid var(--line);border-radius:100px;padding:0 8px;margin-left:auto}
.gate{background:var(--card);border:1px solid var(--line);border-radius:2px;padding:14px 16px;margin:12px 0}.gate header{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.gate header .pill:last-child{margin-left:8px}
.gate.fail{border-left:4px solid var(--fail)}.gate.pass{border-left:4px solid var(--pass)}.gate.pending{border-left:4px solid var(--pend)}
table{width:100%;border-collapse:collapse;margin-top:10px;font-size:13.5px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:600}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.ci{color:var(--muted);font-size:12px}.note{color:var(--muted);font-size:12.5px}
.scroll{overflow-x:auto}.wide{min-width:900px}tr.fragile td{background:var(--failbg)}tr.dead td{background:var(--pendbg)}
.regress{background:var(--failbg);color:var(--fail);border-radius:2px;padding:10px 14px}.ok{background:var(--passbg);color:var(--pass);border-radius:2px;padding:10px 14px}
figure{margin:12px 0;background:var(--card);border:1px solid var(--line);border-radius:2px;padding:12px}svg{width:100%;height:auto}figcaption{color:var(--muted);font-size:12.5px}
.grid{stroke:var(--line)}.axis{fill:var(--muted);font-size:11px}.line{fill:none;stroke:var(--series);stroke-width:1.5}.line.lead{stroke:var(--lead);stroke-width:3}.lbl{fill:var(--muted);font-size:11px}.lbl.lead{fill:var(--lead);font-weight:700}
code{font-size:12.5px}
`;

export function renderHtml(s: Scorecard): string {
  const m0 = s.gates.filter((g) => g.m0);
  const rest = s.gates.filter((g) => !g.m0);
  const reg =
    s.regressions === undefined
      ? '<p class="note">No baseline for this profile yet: write one with <code>--baseline write</code>.</p>'
      : s.regressions.length
        ? `<div class="regress"><b>${s.regressions.length} regressions against the baseline</b><ul>${s.regressions.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></div>`
        : '<div class="ok"><b>No regressions against the baseline.</b></div>';
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hometowns Lab</title><style>${CSS}</style></head><body><main>
<h1>Hometowns Lab · ${esc(s.profile)} ${pill(s.verdict)}</h1>
<p>M0 exit (G3, G8, G9, G10, G12): ${pill(s.m0)}</p>
<div class="meta"><div>Run<b>${esc(s.createdAt.replace('T', ' ').slice(0, 19))} UTC</b></div><div>Seeds × days<b>${s.config.seeds} × ${s.config.days} (${s.config.seats} seats)</b></div><div>Town-days<b>${fmt(s.townDays)}</b></div><div>Wall time<b>${fmt(s.wallMs / 1000)} s on ${s.workers < 0 ? 'all' : s.workers} workers</b></div><div>Engine hash<b>${esc(s.engineHash)}</b></div><div>Params hash<b>${esc(s.paramsHash)}${s.variant ? ` (${esc(s.variant)})` : ''}</b></div><div>Reverted months<b>${s.alerts.reverted}</b></div><div>Move errors<b>${s.alerts.refusedErrors}</b></div></div>
${reg}
<h2>M0 gates</h2>${m0.map(gateCard).join('')}
<h2>Bots</h2>${popChart(s)}<div class="scroll">${botTable(s)}</div>
<h2>The other gates</h2>${rest.map(gateCard).join('')}
${abSection(s)}${sweepSection(s)}${offRuleSection(s)}
<p class="note">The scorecard JSON beside this page holds every number here.</p>
</main></body></html>`;
}

/** The reports folder's front page: every run, newest first, with its verdicts. */
export function renderIndex(dir = REPORT_DIR): string {
  const runs: { name: string; s: Pick<Scorecard, 'createdAt' | 'profile' | 'verdict' | 'm0' | 'config' | 'variant' | 'townDays' | 'wallMs' | 'engineHash'> & { regressions?: string[] } }[] = [];
  for (const name of existsSync(dir) ? readdirSync(dir) : []) {
    const f = join(dir, name, 'scorecard.json');
    if (!existsSync(f)) continue;
    try {
      runs.push({ name, s: JSON.parse(readFileSync(f, 'utf8')) });
    } catch {
      // A half-written run is skipped, not fatal.
    }
  }
  runs.sort((a, b) => (a.s.createdAt < b.s.createdAt ? 1 : -1));
  const rows = runs
    .map(
      ({ name, s }) =>
        `<tr><td><a href="${esc(name)}/index.html">${esc(s.createdAt.replace('T', ' ').slice(0, 16))}</a></td><td>${esc(s.profile)}${s.variant ? ` · ${esc(s.variant)}` : ''}</td><td class="num">${s.config.seeds} × ${s.config.days}</td><td>${pill(s.verdict)}</td><td>${pill(s.m0)}</td><td class="num">${s.regressions === undefined ? '—' : s.regressions.length}</td><td class="num">${fmt(s.wallMs / 1000)} s</td><td><code>${esc(s.engineHash)}</code></td><td><a href="${esc(name)}/scorecard.json">json</a></td></tr>`,
    )
    .join('');
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hometowns Lab runs</title><style>${CSS}</style></head><body><main>
<h1>Hometowns Lab runs</h1><p><a href="latest.html">The latest report</a> · <a href="latest.json">its scorecard</a></p>
<div class="scroll"><table class="wide"><thead><tr><th>Run (UTC)</th><th>Profile</th><th class="num">Seeds × days</th><th>Verdict</th><th>M0 exit</th><th class="num">Regressions</th><th class="num">Wall</th><th>Engine</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="9">No runs yet.</td></tr>'}</tbody></table></div>
</main></body></html>`;
}

/** Writes scorecard.json and index.html into reports/<stamp>-<profile>/, and refreshes latest.* and the front page. Returns the folder. */
export function writeReport(s: Scorecard, dir = REPORT_DIR): string {
  const stamp = s.createdAt.replace(/[:.]/g, '-').slice(0, 19);
  const out = join(dir, `${stamp}-${s.profile}${s.variant ? '-' + s.variant.replace(/[^a-z0-9.×-]+/gi, '_') : ''}`);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'scorecard.json'), JSON.stringify(s, null, 1));
  writeFileSync(join(out, 'index.html'), renderHtml(s));
  copyFileSync(join(out, 'scorecard.json'), join(dir, 'latest.json'));
  copyFileSync(join(out, 'index.html'), join(dir, 'latest.html'));
  writeFileSync(join(dir, 'index.html'), renderIndex(dir));
  return out;
}
