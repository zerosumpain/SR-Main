/**
 * What the work cost — the owner's spend analytics over Claude Code sessions.
 *
 * Pure: the loader in ./spend.server.ts reads the rows, this module turns them
 * into the band's payload, and nothing here touches the database, so every
 * attribution rule is testable on its own.
 *
 * THE ATTRIBUTION, in order of evidence:
 *
 *  1. A session that opened pull requests is credited to the feature areas its
 *     PRs' releases changed, weighted by lines changed. A release that carried
 *     several PRs splits its churn evenly between them — release file lists are
 *     not per-PR, and pretending otherwise would be false precision.
 *  2. A session with no PR is credited to the areas it edited (Edit/Write file
 *     paths, subagents included since parser v5), weighted by edit count.
 *  3. A session with neither is "no code trail" under its project, so its cost
 *     is still counted and visible rather than silently dropped.
 *
 * A FEATURE AREA is derived from a path: the route segment for `src/routes/…`,
 * the module folder for `src/lib/…`, a small alias table merging the folders
 * that belong to one feature (the release log, the changelog and /releases are
 * one thing), and the whole repository for work outside SR-Main.
 *
 * PR NOT RECORDED is a fourth state, not a kind of "unshipped". Parser
 * versions before 4 never extracted PR numbers, and the transcripts behind those
 * sessions (4 Jun – 12 Aug 2026) are gone, so they can never be joined to a
 * release. Their spend is counted and shown, but kept out of every
 * shipped/unshipped share — counting it as "no released PR" read as ~$20k of
 * work that never shipped.
 *
 * Every cost here is an ESTIMATE: tokens × Anthropic list price, from the
 * transcript. It is what the work would have cost at API rates, not a bill.
 */

export const SITE_PROJECT = 'strange-rambling-svelte';

/** The first parser schema that extracted pull-request numbers from a transcript. */
export const PR_TRAIL_SCHEMA = 4;

export interface SpendBreakdownRow {
  model: string;
  source?: string;
  costUsd: number;
  tokens?: { input?: number; cacheRead?: number };
  rates?: { input?: number; cacheRead?: number } | null;
}

export interface SpendSessionRow {
  id: string;
  title: string | null;
  project: string;
  startedAt: string | null;
  costUsd: number;
  costKnown: boolean;
  prs: number[];
  touched: { path: string; count: number }[];
  tokens: { input?: number; output?: number; cacheRead?: number; cacheCreation?: number };
  breakdown: SpendBreakdownRow[];
  stages: { stage: string; costUsd: number }[];
  messageCount: number;
  /** Parser schema the row was ingested with; below PR_TRAIL_SCHEMA its PRs were never recorded. */
  schemaVersion?: number;
}

export interface SpendReleaseRow {
  id: number;
  deployedAt: string;
  prs: number[];
  files: { path: string; insertions: number; deletions: number }[];
  items: string[];
}

export interface AreaShare {
  key: string;
  share: number;
}

/** One session as the band and its finder see it. */
export interface SpendSession {
  id: string;
  title: string;
  project: string;
  date: string | null;
  costUsd: number;
  costKnown: boolean;
  prs: number[];
  releases: number;
  /** How the areas were found — the finder says so beside each row. */
  basis: 'pull-request' | 'edits' | 'none';
  /** False for sessions parsed before PR extraction existed: shipped or not is unknown. */
  prRecorded: boolean;
  areas: AreaShare[];
  /** Release item titles shipped by this session's PRs, for the finder's search. */
  items: string[];
  subagentUsd: number;
}

export interface FeatureArea {
  key: string;
  label: string;
  /** The ledger row this area folds under: `projects` for `projects/engine-room`. */
  group: string;
  groupLabel: string;
  costUsd: number;
  sessions: number;
  prs: number;
  releases: number;
  first: string | null;
  last: string | null;
  /** Cumulative cost by session date: [ISO day, running total]. */
  path: [string, number][];
  /** Share of this area's PR-recorded cost that came from PR-linked sessions. */
  linkedShare: number;
}

export interface FeatureGroup {
  key: string;
  label: string;
  costUsd: number;
  sessions: number;
  prs: number;
}

export interface SpendWeek {
  week: string;
  start: string;
  linked: number;
  unlinked: number;
  /** Spend from sessions whose PRs were never recorded. */
  unrecorded: number;
  cumulative: number;
}

export interface Slice {
  key: string;
  costUsd: number;
}

export interface SpendBand {
  window: { from: string | null; to: string | null };
  totals: {
    costUsd: number;
    sessions: number;
    linkedUsd: number;
    unlinkedUsd: number;
    /** Spend from sessions parsed before PR extraction — neither shipped nor unshipped. */
    unrecordedUsd: number;
    subagentUsd: number;
    /** Sessions parsed before v5 have no subagent split; their share is unknown, not zero. */
    subagentMeasuredSessions: number;
    prs: number;
    releases: number;
    churn: number;
    cacheReadShare: number | null;
    cacheSavingsUsd: number;
    reworkShare: number | null;
    medianSessionUsd: number;
    p90SessionUsd: number;
    partialSessions: number;
  };
  weeks: SpendWeek[];
  areas: FeatureArea[];
  /** Ledger rows: areas folded into their family, with sessions and PRs counted once. */
  groups: FeatureGroup[];
  byProject: Slice[];
  byModel: Slice[];
  byStage: Slice[];
  /** 7 rows (Mon–Sun) × 24 hours, Europe/London, by session start. */
  heat: number[][];
  sessions: SpendSession[];
  insights: string[];
}

// ── areas ───────────────────────────────────────────────────────────────────

/**
 * Route families whose children are separate features: `/projects/engine-room`
 * and `/projects/local-plan-navigator` share nothing but a URL prefix. Their
 * areas are `family/child`, grouped under the family in the ledger.
 */
const ROUTE_FAMILIES = new Set(['projects', 'admin', 'jkai']);

/** Folders that are one feature under several names. */
const AREA_ALIAS: Record<string, string> = {
  'release-log': 'releases',
  'claude-changelog': 'releases',
  changelog: 'releases',
  shipped: 'releases',
  shell: 'design-system',
  ui: 'design-system',
  landing: 'home',
  '(app)': 'home',
  db: 'database',
  migrations: 'database',
  auth: 'access',
  access: 'access',
};

const AREA_LABEL: Record<string, string> = {
  releases: 'Shipped (/releases)',
  'design-system': 'Design system',
  home: 'Landing page',
  database: 'Database & schema',
  access: 'Access & auth',
  core: 'Site core',
  'repo:claude-config': 'Claude config & memory',
  tooling: 'Tooling & CI',
  docs: 'Docs',
};

const REPO_LABEL: Record<string, string> = {
  'sr-health': 'SR-Health',
  'sr-jkai-core': 'SR-Jkai-Core',
  'sr-workflows': 'SR-Workflows',
  'sr-drive': 'SR-Drive',
  'sr-infra': 'SR-Infra',
  'sr-hex': 'SR-Hex',
  'sr-policy-engine': 'Policy Engine',
  'sr-policy-analysis': 'Policy Analysis',
};

function alias(segment: string): string {
  return AREA_ALIAS[segment] ?? segment;
}

/**
 * Feature area of an SR-Main repository-relative path.
 *
 * `src/routes/(group)/health/…` → `health`; `src/routes/api/releases/…` →
 * `releases`; `src/lib/components/releases/hub/x.svelte` → `releases`;
 * `src/lib/releases/x.ts` → `releases`; loose files under `src/lib` → `core`.
 */
export function siteAreaOf(path: string): string {
  const parts = path.replace(/^\.?\//, '').split('/').filter(Boolean);
  if (parts[0] === 'src' && parts[1] === 'routes') {
    const rest = parts.slice(2).filter((p) => !/^\(.*\)$/.test(p));
    if (rest[0] === 'api') rest.shift();
    if (rest.length <= 1) return rest[0] && !rest[0].startsWith('+') ? alias(rest[0]) : 'home';
    if (ROUTE_FAMILIES.has(rest[0]) && rest.length > 2 && !rest[1].startsWith('+') && !rest[1].startsWith('[')) {
      return `${rest[0]}/${rest[1]}`;
    }
    return alias(rest[0]);
  }
  if (parts[0] === 'src' && parts[1] === 'lib') {
    const rest = parts.slice(2);
    if (rest[0] === 'components' || rest[0] === 'server') rest.shift();
    return rest.length > 1 ? alias(rest[0]) : 'core';
  }
  if (parts[0] === 'scripts') return parts.length > 2 ? alias(parts[1]) : 'tooling';
  if (parts[0] === 'tests') {
    // tests/lib/jkai/x.test.ts tests the same feature as src/lib/jkai/x.ts.
    const rest = parts.slice(1);
    if (rest[0] === 'lib' || rest[0] === 'routes') return siteAreaOf(['src', ...rest].join('/'));
    return rest.length > 1 && rest[0] !== 'scripts' ? alias(rest[0]) : 'tooling';
  }
  if (parts[0] === 'docs' || /\.md$/i.test(path)) return 'docs';
  if (parts[0] === '.github' || parts[0] === 'vite-plugins') return 'tooling';
  return 'core';
}

/**
 * Feature area of a home-relative touched path (`<folder>/src/…`).
 * SR-Main work gets a site area; any other project is one area of its own.
 */
export function touchedAreaOf(path: string, project: string): string {
  const rel = path.replace(/^\/home\/[^/]+\//, '');
  if (project !== SITE_PROJECT) return `repo:${project}`;
  if (rel.startsWith('.claude/')) return 'repo:claude-config';
  // Drop the checkout folder, and homeserv's `repo/.worktrees/<name>/` with it.
  const inRepo = rel.replace(/^[^/]+\/\.worktrees\/[^/]+\//, '');
  return siteAreaOf(inRepo === rel ? rel.split('/').slice(1).join('/') : inRepo);
}

/** The ledger row an area folds under: `projects` for `projects/engine-room`. */
export function groupOf(key: string): string {
  return key.includes('/') && !key.startsWith('repo:') && !key.startsWith('none:') ? key.split('/')[0] : key;
}

export function areaLabel(key: string): string {
  if (AREA_LABEL[key]) return AREA_LABEL[key];
  if (key.startsWith('repo:')) {
    const repo = key.slice(5);
    return REPO_LABEL[repo] ?? repo;
  }
  if (key.startsWith('none:')) return `${areaLabel(`repo:${key.slice(5)}`)} · no code trail`;
  return `/${key}`;
}

// ── helpers ─────────────────────────────────────────────────────────────────

function normalise(weights: Map<string, number>): AreaShare[] {
  const total = [...weights.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  return [...weights.entries()]
    .map(([key, w]) => ({ key, share: w / total }))
    .sort((a, b) => b.share - a.share);
}

/** ISO week of a date, `YYYY-Www`, and that week's Monday. */
export function isoWeek(d: Date): { week: string; start: string } {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (dt.getUTCDay() + 6) % 7;
  const monday = new Date(dt);
  monday.setUTCDate(dt.getUTCDate() - dow);
  const thursday = new Date(dt);
  thursday.setUTCDate(dt.getUTCDate() - dow + 3);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { week: `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`, start: monday.toISOString().slice(0, 10) };
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

const LONDON = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', hourCycle: 'h23',
});
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function londonSlot(iso: string): [number, number] | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = LONDON.formatToParts(d);
  const day = DOW.indexOf(parts.find((p) => p.type === 'weekday')?.value ?? '');
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  return day < 0 || !Number.isFinite(hour) ? null : [day, hour % 24];
}

export function usd(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  if (n >= 100) return `$${Math.round(n)}`;
  return `$${n.toFixed(2)}`;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

// ── the band ────────────────────────────────────────────────────────────────

export function buildSpendBand(
  sessionRows: SpendSessionRow[],
  releaseRows: SpendReleaseRow[],
  window: { from?: string; to?: string } = {},
): SpendBand {
  const from = window.from || null;
  const to = window.to || null;
  const inWindow = (iso: string | null) => {
    if (!from && !to) return true;
    if (!iso) return false;
    const day = iso.slice(0, 10);
    return (!from || day >= from) && (!to || day <= to);
  };

  const releaseById = new Map(releaseRows.map((r) => [r.id, r]));
  // PR → releases that carried it.
  const releasesByPr = new Map<number, SpendReleaseRow[]>();
  for (const r of releaseRows) for (const pr of r.prs) (releasesByPr.get(pr) ?? releasesByPr.set(pr, []).get(pr)!).push(r);

  const rows = sessionRows.filter((s) => inWindow(s.startedAt));
  const sessions: SpendSession[] = [];
  const areaAcc = new Map<string, {
    cost: number; linked: number; unrecorded: number; sessions: Set<string>; prs: Set<number>; releases: Set<number>;
    points: [string, number][]; first: string | null; last: string | null;
  }>();
  const linkedPrs = new Set<number>();
  const linkedReleases = new Map<number, SpendReleaseRow>();
  const byProject = new Map<string, number>();
  const byModel = new Map<string, number>();
  const byStage = new Map<string, number>();
  const weekAcc = new Map<string, SpendWeek>();
  const heat = Array.from({ length: 7 }, () => Array<number>(24).fill(0));

  const groupAcc = new Map<string, { cost: number; sessions: Set<string>; prs: Set<number> }>();
  let unrecordedUsd = 0;
  let total = 0, linkedUsd = 0, unlinkedUsd = 0, subagentUsd = 0, subagentMeasured = 0;
  let cacheRead = 0, promptTokens = 0, cacheSavings = 0, partial = 0;

  for (const s of rows) {
    const cost = s.costUsd || 0;
    total += cost;
    if (!s.costKnown) partial++;

    // ── attribution ──
    const weights = new Map<string, number>();
    const areaPrs = new Map<string, Set<number>>();
    const areaReleases = new Map<string, Set<number>>();
    const prs = s.prs.filter((pr) => releasesByPr.has(pr));
    const sessionReleases = new Set<number>();
    let basis: SpendSession['basis'] = 'none';
    for (const pr of prs) {
      for (const r of releasesByPr.get(pr) ?? []) {
        sessionReleases.add(r.id);
        const split = 1 / Math.max(1, r.prs.length);
        for (const f of r.files) {
          const area = siteAreaOf(f.path);
          weights.set(area, (weights.get(area) ?? 0) + Math.max(1, f.insertions + f.deletions) * split);
          (areaPrs.get(area) ?? areaPrs.set(area, new Set()).get(area)!).add(pr);
          (areaReleases.get(area) ?? areaReleases.set(area, new Set()).get(area)!).add(r.id);
        }
      }
    }
    if (weights.size) basis = 'pull-request';
    else {
      for (const t of s.touched) {
        const area = touchedAreaOf(t.path, s.project);
        weights.set(area, (weights.get(area) ?? 0) + t.count);
      }
      if (weights.size) basis = 'edits';
      else weights.set(`none:${s.project}`, 1);
    }
    const areas = normalise(weights);
    const linked = basis === 'pull-request';
    const prRecorded = (s.schemaVersion ?? PR_TRAIL_SCHEMA) >= PR_TRAIL_SCHEMA || s.prs.length > 0;
    if (!linked && !prRecorded) unrecordedUsd += cost;
    else if (linked) {
      linkedUsd += cost;
      for (const pr of prs) linkedPrs.add(pr);
      for (const id of sessionReleases) {
        const r = releaseById.get(id);
        if (r) linkedReleases.set(id, r);
      }
    } else unlinkedUsd += cost;

    const day = s.startedAt?.slice(0, 10) ?? null;
    for (const a of areas) {
      const acc = areaAcc.get(a.key) ?? {
        cost: 0, linked: 0, unrecorded: 0, sessions: new Set(), prs: new Set(), releases: new Set(), points: [], first: null, last: null,
      };
      const part = cost * a.share;
      acc.cost += part;
      if (linked) acc.linked += part;
      else if (!prRecorded) acc.unrecorded += part;
      const gk = groupOf(a.key);
      const g = groupAcc.get(gk) ?? { cost: 0, sessions: new Set<string>(), prs: new Set<number>() };
      g.cost += part;
      g.sessions.add(s.id);
      for (const pr of areaPrs.get(a.key) ?? []) g.prs.add(pr);
      groupAcc.set(gk, g);
      acc.sessions.add(s.id);
      for (const pr of areaPrs.get(a.key) ?? []) acc.prs.add(pr);
      for (const r of areaReleases.get(a.key) ?? []) acc.releases.add(r);
      if (day) {
        acc.points.push([day, part]);
        if (!acc.first || day < acc.first) acc.first = day;
        if (!acc.last || day > acc.last) acc.last = day;
      }
      areaAcc.set(a.key, acc);
    }

    // ── breakdowns ──
    byProject.set(s.project, (byProject.get(s.project) ?? 0) + cost);
    let sub = 0;
    let sawSource = false;
    for (const b of s.breakdown) {
      const model = (b.model || 'unknown').replace(/-\d{8}$/, '');
      byModel.set(model, (byModel.get(model) ?? 0) + (b.costUsd || 0));
      if (b.source) sawSource = true;
      if (b.source === 'subagent') sub += b.costUsd || 0;
      const read = b.tokens?.cacheRead ?? 0;
      if (b.rates && b.rates.input != null && b.rates.cacheRead != null) {
        cacheSavings += (read * (b.rates.input - b.rates.cacheRead)) / 1e6;
      }
    }
    if (sawSource) { subagentMeasured++; subagentUsd += sub; }
    for (const st of s.stages) byStage.set(st.stage, (byStage.get(st.stage) ?? 0) + (st.costUsd || 0));
    cacheRead += s.tokens.cacheRead ?? 0;
    promptTokens += (s.tokens.input ?? 0) + (s.tokens.cacheRead ?? 0) + (s.tokens.cacheCreation ?? 0);

    if (s.startedAt) {
      const { week, start } = isoWeek(new Date(s.startedAt));
      const w = weekAcc.get(week) ?? { week, start, linked: 0, unlinked: 0, unrecorded: 0, cumulative: 0 };
      if (linked) w.linked += cost;
      else if (!prRecorded) w.unrecorded += cost;
      else w.unlinked += cost;
      weekAcc.set(week, w);
      const slot = londonSlot(s.startedAt);
      if (slot) heat[slot[0]][slot[1]] += cost;
    }

    const items = new Set<string>();
    for (const id of sessionReleases) {
      for (const t of releaseById.get(id)?.items ?? []) {
        if (items.size < 8) items.add(t);
      }
    }
    sessions.push({
      id: s.id,
      title: s.title || 'Untitled session',
      project: s.project,
      date: day,
      costUsd: cost,
      costKnown: s.costKnown,
      prs,
      releases: sessionReleases.size,
      basis,
      prRecorded,
      areas: areas.slice(0, 6).map((a) => ({ key: a.key, share: Number(a.share.toFixed(3)) })),
      items: [...items],
      subagentUsd: sub,
    });
  }

  // ── weeks: fill gaps so a quiet week reads as zero, then accumulate ──
  const weeks: SpendWeek[] = [];
  const keys = [...weekAcc.values()].sort((a, b) => a.start.localeCompare(b.start));
  if (keys.length) {
    const cursor = new Date(`${keys[0].start}T00:00:00Z`);
    const last = keys[keys.length - 1].start;
    let running = 0;
    while (cursor.toISOString().slice(0, 10) <= last) {
      const { week, start } = isoWeek(cursor);
      const w = weekAcc.get(week) ?? { week, start, linked: 0, unlinked: 0, unrecorded: 0, cumulative: 0 };
      running += w.linked + w.unlinked + w.unrecorded;
      weeks.push({ ...w, cumulative: running });
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
  }

  const areas: FeatureArea[] = [...areaAcc.entries()]
    .map(([key, a]) => {
      const byDay = new Map<string, number>();
      for (const [d, v] of a.points) byDay.set(d, (byDay.get(d) ?? 0) + v);
      let run = 0;
      const path = [...byDay.entries()].sort((x, y) => x[0].localeCompare(y[0]))
        .map(([d, v]) => [d, Number((run += v).toFixed(2))] as [string, number]);
      return {
        key,
        label: areaLabel(key),
        group: groupOf(key),
        groupLabel: areaLabel(groupOf(key)),
        costUsd: a.cost,
        sessions: a.sessions.size,
        prs: a.prs.size,
        releases: a.releases.size,
        first: a.first,
        last: a.last,
        path,
        linkedShare: a.cost - a.unrecorded > 0 ? a.linked / (a.cost - a.unrecorded) : 0,
      };
    })
    .sort((a, b) => b.costUsd - a.costUsd);

  const slices = (m: Map<string, number>) =>
    [...m.entries()].map(([key, costUsd]) => ({ key, costUsd })).filter((s) => s.costUsd > 0).sort((a, b) => b.costUsd - a.costUsd);

  const costs = rows.map((s) => s.costUsd || 0).sort((a, b) => a - b);
  const stageTotal = [...byStage.values()].reduce((a, b) => a + b, 0);
  const churn = [...linkedReleases.values()].reduce(
    (sum, r) => sum + r.files.reduce((n, f) => n + f.insertions + f.deletions, 0), 0);

  const band: SpendBand = {
    window: { from, to },
    totals: {
      costUsd: total,
      sessions: rows.length,
      linkedUsd,
      unlinkedUsd,
      unrecordedUsd,
      subagentUsd,
      subagentMeasuredSessions: subagentMeasured,
      prs: linkedPrs.size,
      releases: linkedReleases.size,
      churn,
      cacheReadShare: promptTokens > 0 ? cacheRead / promptTokens : null,
      cacheSavingsUsd: cacheSavings,
      reworkShare: stageTotal > 0 ? (byStage.get('fixes') ?? 0) / stageTotal : null,
      medianSessionUsd: quantile(costs, 0.5),
      p90SessionUsd: quantile(costs, 0.9),
      partialSessions: partial,
    },
    weeks,
    areas,
    groups: [...groupAcc.entries()]
      .map(([key, g]) => ({ key, label: areaLabel(key), costUsd: g.cost, sessions: g.sessions.size, prs: g.prs.size }))
      .sort((a, b) => b.costUsd - a.costUsd),
    byProject: slices(byProject),
    byModel: slices(byModel),
    byStage: slices(byStage),
    heat,
    sessions: sessions.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.costUsd - a.costUsd),
    insights: [],
  };
  band.insights = spendInsights(band);
  return band;
}

/**
 * The handful of sentences worth reading before the charts. Each is computed,
 * and each is omitted when its evidence is too thin to say anything.
 */
export function spendInsights(band: SpendBand): string[] {
  const out: string[] = [];
  const t = band.totals;
  if (!t.costUsd) return out;

  // The same grouped row the ledger leads with, so the sentence and the table agree.
  const top = band.groups.filter((g) => !g.key.startsWith('none:'))[0];
  if (top) {
    out.push(`${top.label} is the most expensive feature area: ${usd(top.costUsd)} across ${top.sessions} session${top.sessions === 1 ? '' : 's'}, ${pct(top.costUsd / t.costUsd)} of all spend.`);
  }

  const w = band.weeks;
  if (w.length >= 8) {
    const sum = (xs: SpendWeek[]) => xs.reduce((n, x) => n + x.linked + x.unlinked + x.unrecorded, 0);
    const recent = sum(w.slice(-4));
    const before = sum(w.slice(-8, -4));
    if (before > 0) {
      const change = recent / before - 1;
      if (Math.abs(change) >= 0.1) {
        out.push(`The last four weeks cost ${usd(recent)}, ${change > 0 ? 'up' : 'down'} ${pct(Math.abs(change))} on the four before.`);
      }
    }
  }

  const recorded = t.linkedUsd + t.unlinkedUsd;
  if (recorded > 0 && t.unlinkedUsd / recorded >= 0.2) {
    out.push(`${pct(t.unlinkedUsd / recorded)} of spend with a PR record (${usd(t.unlinkedUsd)}) opened no pull request that reached a release — reviews, ops and exploration, or work not yet shipped.`);
  }
  if (t.unrecordedUsd > 0) {
    out.push(`${usd(t.unrecordedUsd)} comes from sessions parsed before PR numbers were recorded, so whether it shipped is unknown; it is left out of the shipped shares.`);
  }

  if (t.subagentMeasuredSessions > 0 && t.subagentUsd > 0) {
    out.push(`Subagents account for ${usd(t.subagentUsd)} across the ${t.subagentMeasuredSessions} session${t.subagentMeasuredSessions === 1 ? '' : 's'} that record them.`);
  }

  if (t.reworkShare !== null && t.reworkShare >= 0.05) {
    out.push(`${pct(t.reworkShare)} of session cost went on follow-up fixes after a first result.`);
  }

  if (t.prs > 0) {
    out.push(`Shipped work averages ${usd(t.linkedUsd / t.prs)} per released pull request${t.churn > 0 ? ` and ${usd((t.linkedUsd / t.churn) * 1000)} per thousand lines changed` : ''}.`);
  }

  if (t.cacheSavingsUsd > 0 && t.cacheReadShare !== null) {
    out.push(`Prompt caching served ${pct(t.cacheReadShare)} of input tokens; at uncached input rates the same work would have cost about ${usd(t.cacheSavingsUsd)} more.`);
  }

  const priciest = [...band.sessions].sort((a, b) => b.costUsd - a.costUsd)[0];
  if (priciest && priciest.costUsd >= t.p90SessionUsd * 2 && band.sessions.length >= 10) {
    out.push(`The single priciest session, “${priciest.title}”, cost ${usd(priciest.costUsd)} — ${Math.round(priciest.costUsd / Math.max(0.01, t.medianSessionUsd))}× the median.`);
  }
  return out;
}
