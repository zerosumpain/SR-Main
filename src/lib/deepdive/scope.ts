/**
 * Research scope — the definition stage's output.
 *
 * Until now the engine could only ever search the open web. `tavily.ts` carried
 * an `excludeDomains` passthrough and nothing else; `include_domains` appears
 * nowhere in the codebase. So "research this, but only in government sources"
 * was not expressible, and neither was "start from these three pages".
 *
 * Three modes, deliberately distinct:
 *
 *  - `open`      — the whole web. What every run did before.
 *  - `bounded`   — PREFER these domains. Others are still admissible but rank
 *                  lower, so a thin allow-list cannot starve the run.
 *  - `exclusive` — ONLY these domains, enforced at the search API and again on
 *                  every URL that comes back.
 *
 * The distinction between bounded and exclusive is the whole point: a bounded
 * scope that silently hard-filtered would be exclusive with a friendlier name,
 * and an exclusive scope that silently widened when it found nothing would be
 * lying about where its answer came from. An exclusive scope that returns
 * nothing must surface as "no sources matched your scope" — a near-miss filter
 * returning empty rather than erroring is a recurring trap in this codebase.
 */

export type ScopeMode = 'open' | 'bounded' | 'exclusive';

export interface ResearchScope {
  mode: ScopeMode;
  /** Registrable domains to prefer (bounded) or require (exclusive). */
  includeDomains: string[];
  /** Domains to reject outright. Applied in every mode; beats inclusions. */
  excludeDomains: string[];
  /** Pages to read directly, without searching for them first. */
  seedUrls: string[];
  /** Restrict to material from the last N days. */
  recency: { days: number } | null;
  /** Named preset this scope came from, for display and reuse. */
  process: string | null;
}

export const OPEN_SCOPE: ResearchScope = {
  mode: 'open',
  includeDomains: [],
  excludeDomains: [],
  seedUrls: [],
  recency: null,
  process: null,
};

const MODES: ScopeMode[] = ['open', 'bounded', 'exclusive'];

/**
 * Reduce anything domain-shaped to a bare registrable host: no scheme, no
 * `www.`, no port, no path, lowercased. Users paste full URLs into domain
 * fields constantly, and Tavily wants hosts.
 */
function normaliseDomain(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let s = value.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z]+:\/\//, '');
  s = s.split('/')[0];
  s = s.split('?')[0];
  s = s.split('#')[0];
  s = s.split(':')[0];
  s = s.replace(/^www\./, '');
  if (!s || !s.includes('.')) return null;
  return s;
}

function normaliseDomainList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const d = normaliseDomain(entry);
    if (d && !out.includes(d)) out.push(d);
  }
  return out;
}

function normaliseSeedUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    try {
      const u = new URL(entry.trim());
      // Anything that is not http(s) is either unfetchable or an injection
      // vector (javascript:, file:, data:).
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
      if (!out.includes(u.toString())) out.push(u.toString());
    } catch {
      // Not a URL — drop it.
    }
  }
  return out;
}

/** Normalise arbitrary input (a jsonb column, a tool argument) into a scope. */
export function coerceScope(value: unknown): ResearchScope {
  if (!value || typeof value !== 'object') return { ...OPEN_SCOPE };
  const raw = value as Record<string, unknown>;

  const includeDomains = normaliseDomainList(raw.includeDomains);
  const excludeDomains = normaliseDomainList(raw.excludeDomains);
  const seedUrls = normaliseSeedUrls(raw.seedUrls);

  let mode: ScopeMode = MODES.includes(raw.mode as ScopeMode) ? (raw.mode as ScopeMode) : 'open';
  // A bounded or exclusive scope with nothing to bind to is just an open scope
  // wearing a label. Downgrade it so the UI and the logs tell the truth.
  if (mode !== 'open' && includeDomains.length === 0) mode = 'open';

  let recency: { days: number } | null = null;
  const days = (raw.recency as { days?: unknown } | null | undefined)?.days;
  if (typeof days === 'number' && Number.isFinite(days) && days >= 1) {
    recency = { days: Math.floor(days) };
  }

  return {
    mode,
    includeDomains,
    excludeDomains,
    seedUrls,
    recency,
    process: typeof raw.process === 'string' && raw.process.trim() ? raw.process.trim() : null,
  };
}

/** Search options this scope implies, shaped for `tavily.search`. */
export function scopeToSearchOptions(scope: ResearchScope): {
  includeDomains?: string[];
  excludeDomains?: string[];
  topic?: 'general' | 'news';
  days?: number;
} {
  const out: ReturnType<typeof scopeToSearchOptions> = {};
  // Only `exclusive` filters at the API. `bounded` deliberately does not — it
  // expresses preference through ranking so a thin allow-list cannot starve
  // the run of material.
  if (scope.mode === 'exclusive' && scope.includeDomains.length) {
    out.includeDomains = scope.includeDomains;
  }
  if (scope.excludeDomains.length) out.excludeDomains = scope.excludeDomains;
  if (scope.recency) {
    // Tavily only honours `days` on the news topic.
    out.topic = 'news';
    out.days = scope.recency.days;
  }
  return out;
}

/** True when `host` is `domain` itself or a subdomain of it. */
function hostMatches(host: string, domain: string): boolean {
  if (host === domain) return true;
  // The dot matters: "notgov.uk".endsWith("gov.uk") is true but they are
  // different registrable domains.
  return host.endsWith(`.${domain}`);
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Whether a result URL is admissible. Applied to everything the search returns,
 * because an API-level filter is a request, not a guarantee.
 */
export function scopeAdmits(scope: ResearchScope, url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  if (scope.excludeDomains.some((d) => hostMatches(host, d))) return false;
  if (scope.mode === 'exclusive') {
    return scope.includeDomains.some((d) => hostMatches(host, d));
  }
  return true;
}

/** Credibility uplift for a preferred domain under a bounded scope. */
export const BOUNDED_PREFERENCE_BONUS = 0.15;

export function credibilityBonus(scope: ResearchScope, url: string): number {
  if (scope.mode !== 'bounded') return 0;
  const host = hostOf(url);
  if (!host) return 0;
  return scope.includeDomains.some((d) => hostMatches(host, d)) ? BOUNDED_PREFERENCE_BONUS : 0;
}

/** One-line human description, for logs and the definition stage summary. */
export function describeScope(scope: ResearchScope): string {
  const parts: string[] = [];
  if (scope.mode === 'exclusive') {
    parts.push(`Only ${scope.includeDomains.join(', ')}`);
  } else if (scope.mode === 'bounded') {
    parts.push(`Preferring ${scope.includeDomains.join(', ')}`);
  } else {
    parts.push('Anywhere on the web');
  }
  if (scope.excludeDomains.length) parts.push(`excluding ${scope.excludeDomains.join(', ')}`);
  if (scope.recency) parts.push(`from the last ${scope.recency.days} days`);
  if (scope.seedUrls.length) parts.push(`starting from ${scope.seedUrls.length} given page(s)`);
  return parts.join(', ');
}
