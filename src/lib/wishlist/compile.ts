// Turning what was asked into what the sweep checks — the PURE half.
//
// A model reads the ask once, when the item is added (compile.server.ts). Its
// answer is untrusted text, so everything it says passes through here: unknown
// fields are dropped, a GPU must be one the ranking knows, feeds must have the
// shape we build URLs from, and pounds become pence. What survives is shown on
// the page as the item's criteria, so a misread is visible, not silent.

import { canonicalGpu, gpuScore } from './gpu';
import { isHukdTag } from './sources/hukd';
import { isOcukCategory } from './sources/ocuk';
import { isAllowedPricerunnerUrl, isPricerunnerCategory } from './sources/pricerunner';
import { isRedditSub } from './sources/reddit';
import { isScanCategory } from './sources/scan';
import { isUnit } from './units';
import { SCHOOL_HOLIDAYS } from './dates';
import type { Constraint, FeedRef, ValueFactor, WishCriteria, WishKind } from './types';

export interface CompiledWish {
  kind: WishKind;
  title: string;
  criteria: WishCriteria;
  feeds: FeedRef[];
  urls: string[];
  targetPricePence: number | null;
  forPerson: string | null;
  deadline: string | null;
  /** Things the model said that were refused, for the page to show. */
  dropped: string[];
}

const words = (v: unknown, max = 8, len = 40): string[] =>
  (Array.isArray(v) ? v : [])
    .filter((w): w is string => typeof w === 'string')
    .map((w) => w.trim().slice(0, len))
    .filter(Boolean)
    .slice(0, max);

/** Words that describe a wish rather than a listing. */
const VAGUE = new Set([
  'sunny', 'sun', 'warm', 'hot', 'cheap', 'budget', 'affordable', 'good', 'great', 'nice', 'best', 'big', 'small',
  'family', 'family-friendly', 'fun', 'luxury', 'luxurious', 'relaxing', 'quiet', 'romantic', 'decent', 'quality',
]);

const pounds = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[£,]/g, '')) : NaN;
  return Number.isFinite(n) && n > 0 && n < 1_000_000 ? Math.round(n * 100) : null;
};

function constraintOf(raw: unknown, dropped: string[]): Constraint | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  switch (r.field) {
    case 'gpu': {
      const name = typeof r.value === 'string' ? canonicalGpu(r.value) : null;
      if (!name || gpuScore(name) === null) {
        dropped.push(`GPU "${String(r.value)}" is not in the ranking`);
        return null;
      }
      return { field: 'gpu', op: 'rank_gte', value: name };
    }
    case 'ram_gb':
    case 'storage_gb': {
      const n = Number(r.value);
      if (!Number.isFinite(n) || n <= 0 || n > 100_000) return null;
      return { field: r.field, op: 'gte', value: Math.round(n) };
    }
    case 'ram_type': {
      const types = words(r.value).map((t) => t.toUpperCase()).filter((t) => /^DDR\d$/.test(t));
      return types.length ? { field: 'ram_type', op: 'in', value: types } : null;
    }
    case 'attr': {
      const n = Number(r.value);
      const label = typeof r.label === 'string' ? r.label.trim().slice(0, 40) : '';
      if (!isUnit(r.unit)) {
        dropped.push(`"${label || String(r.unit)}" — no reader for unit "${String(r.unit)}"`);
        return null;
      }
      if (!label || !Number.isFinite(n) || n <= 0 || n > 1_000_000) return null;
      return { field: 'attr', label, unit: r.unit, op: r.op === 'lte' ? 'lte' : 'gte', value: n, ...(r.essential === true ? { essential: true } : {}) };
    }
    case 'text': {
      const op = r.op === 'excludes_any' ? 'excludes_any' : 'contains_any';
      const value = words(r.value);
      // A "must mention" made only of words that describe the wish, not the
      // listing, rules out everything: the model asked twice for "sunny" on a
      // holiday, despite the prompt, and no deal title says it (2026-10-31).
      if (op === 'contains_any' && value.length && value.every((w) => VAGUE.has(w.toLowerCase()))) {
        dropped.push(`"must mention ${value.join(' / ')}" — listings do not say that`);
        return null;
      }
      return value.length ? { field: 'text', op, value } : null;
    }
    default:
      dropped.push(`unknown constraint "${String(r.field)}"`);
      return null;
  }
}

function feedsOf(raw: Record<string, unknown>, dropped: string[]): FeedRef[] {
  const feeds: FeedRef[] = [];
  for (const t of words(raw.hukdTags, 4)) {
    const slug = t.toLowerCase();
    if (isHukdTag(slug)) feeds.push({ source: 'hukd-tag', value: slug });
    else dropped.push(`hotukdeals tag "${t}"`);
  }
  for (const c of words(raw.pricerunnerCategories, 3, 120)) {
    if (isPricerunnerCategory(c)) feeds.push({ source: 'pricerunner-cl', value: c });
    else dropped.push(`PriceRunner category "${c}"`);
  }
  for (const c of words(raw.overclockersCategories, 2, 200)) {
    const path = c.toLowerCase().replace(/^\/+|\/+$/g, '');
    if (isOcukCategory(path)) feeds.push({ source: 'ocuk-cat', value: path });
    else dropped.push(`Overclockers category "${c}"`);
  }
  for (const c of words(raw.scanCategories, 2, 200)) {
    if (isScanCategory(c)) feeds.push({ source: 'scan-cat', value: c });
    else dropped.push(`Scan category "${c}"`);
  }
  for (const c of words(raw.subreddits, 2)) {
    const sub = c.toLowerCase().replace(/^r\//, '');
    if (isRedditSub(sub)) feeds.push({ source: 'reddit', value: sub });
    else dropped.push(`subreddit "${c}"`);
  }
  if (raw.holidayPirates === true) feeds.push({ source: 'holidaypirates', value: 'deals' });
  if (typeof raw.searchQuery === 'string' && raw.searchQuery.trim()) {
    feeds.push({ source: 'tavily', value: raw.searchQuery.trim().slice(0, 120) });
  }
  return feeds;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/**
 * The travel window: a named school holiday from the table (so "February half
 * term" is the table's dates, not the model's recollection), or explicit dates.
 */
function datesOf(raw: unknown, dropped: string[]): Constraint | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.schoolHoliday === 'string' && r.schoolHoliday.trim()) {
    const hit = SCHOOL_HOLIDAYS.find((h) => h.name.toLowerCase() === (r.schoolHoliday as string).trim().toLowerCase());
    if (hit) return { field: 'dates', from: hit.from, to: hit.to, label: hit.name };
    dropped.push(`school holiday "${r.schoolHoliday}" is not in the table`);
  }
  const from = typeof r.from === 'string' && ISO_DATE.test(r.from) ? r.from : null;
  const to = typeof r.to === 'string' && ISO_DATE.test(r.to) ? r.to : from;
  if (!from || !to) return null;
  const span = (Date.parse(to) - Date.parse(from)) / DAY_MS;
  if (!(span >= 0 && span <= 400)) {
    dropped.push(`travel dates ${from} to ${to}`);
    return null;
  }
  const label = typeof r.label === 'string' ? r.label.trim().slice(0, 60) : '';
  return { field: 'dates', from, to, label };
}

const PC_MEASURES = ['gpu', 'cpu', 'ram_gb', 'storage_gb'] as const;

/** What value means for this item: at most 5 factors, weights normalised to 1. */
function valueOf(raw: unknown, dropped: string[]): ValueFactor[] {
  const out: ValueFactor[] = [];
  for (const f of (Array.isArray(raw) ? raw : []).slice(0, 5)) {
    if (!f || typeof f !== 'object') continue;
    const r = f as Record<string, unknown>;
    const measure = r.measure;
    const label = typeof r.label === 'string' ? r.label.trim().slice(0, 40) : '';
    const weight = Number(r.weight);
    const ref = Number(r.ref);
    if (!(isUnit(measure) || (PC_MEASURES as readonly unknown[]).includes(measure))) {
      dropped.push(`value factor "${label || String(measure)}" — no reader for "${String(measure)}"`);
      continue;
    }
    if (!label || !(weight > 0) || !(ref > 0)) continue;
    out.push({ label, measure: measure as ValueFactor['measure'], weight, ref, better: r.better === 'lower' ? 'lower' : 'higher' });
  }
  const total = out.reduce((n, f) => n + f.weight, 0);
  return out.map((f) => ({ ...f, weight: Math.round((f.weight / total) * 100) / 100 }));
}

export function validateCompiled(raw: unknown, ask: string): CompiledWish {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const dropped: string[] = [];
  const urls = words(r.urls, 5, 500).filter((u) => {
    try {
      const url = new URL(u);
      if (url.protocol !== 'https:') return false;
      // A PriceRunner URL must be one robots.txt lets us read.
      return url.hostname !== 'www.pricerunner.com' || isAllowedPricerunnerUrl(u);
    } catch {
      return false;
    }
  });
  const kind: WishKind = r.kind === 'track' && urls.length ? 'track' : 'hunt';
  const constraints = (Array.isArray(r.constraints) ? r.constraints : [])
    .map((c) => constraintOf(c, dropped))
    .filter((c): c is Constraint => c !== null)
    .slice(0, 12);
  const travel = datesOf(r.travelDates, dropped);
  if (travel) constraints.push(travel);
  // A trip's hunt is over once the trip has started.
  const asked = typeof r.deadline === 'string' && ISO_DATE.test(r.deadline) ? r.deadline : null;
  const leaves = travel?.field === 'dates' ? travel.from : null;
  const deadline = asked && leaves ? (asked < leaves ? asked : leaves) : (asked ?? leaves);
  const title = (typeof r.title === 'string' && r.title.trim() ? r.title.trim() : ask.trim()).slice(0, 120);

  return {
    kind,
    title,
    criteria: {
      maxPricePence: pounds(r.maxPricePounds),
      nearMissPct: 10,
      constraints,
      value: valueOf(r.value, dropped),
      ...(r.pricePer === 'person' || r.pricePer === 'total'
        ? { price: { per: r.pricePer, party: Number.isInteger(r.partySize) && (r.partySize as number) > 0 && (r.partySize as number) <= 20 ? (r.partySize as number) : null } }
        : {}),
    },
    feeds: kind === 'hunt' ? feedsOf(r, dropped) : [],
    urls: kind === 'track' ? urls : [],
    targetPricePence: pounds(r.targetPricePounds),
    forPerson: typeof r.forPerson === 'string' && r.forPerson.trim() ? r.forPerson.trim().slice(0, 60) : null,
    deadline,
    dropped,
  };
}

/** Pull the first JSON object out of a model reply (fences and chatter tolerated). */
export function parseModelJson(reply: string): unknown {
  const s = reply.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}
