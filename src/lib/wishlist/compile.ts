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
import type { Constraint, FeedRef, WishCriteria, WishKind } from './types';

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
    case 'text': {
      const op = r.op === 'excludes_any' ? 'excludes_any' : 'contains_any';
      const value = words(r.value);
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
  if (typeof raw.searchQuery === 'string' && raw.searchQuery.trim()) {
    feeds.push({ source: 'tavily', value: raw.searchQuery.trim().slice(0, 120) });
  }
  return feeds;
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
  const deadline = typeof r.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.deadline) ? r.deadline : null;
  const title = (typeof r.title === 'string' && r.title.trim() ? r.title.trim() : ask.trim()).slice(0, 120);

  return {
    kind,
    title,
    criteria: { maxPricePence: pounds(r.maxPricePounds), nearMissPct: 10, constraints },
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
