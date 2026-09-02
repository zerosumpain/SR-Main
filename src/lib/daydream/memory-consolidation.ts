// src/lib/daydream/memory-consolidation.ts
//
// The pure boundary around nightly memory consolidation.
//
// A model is allowed to propose the meaning of raw memories. It is not allowed
// to invent rows, silently drop an observation, or widen the vocabulary beyond
// lesson/value. Strict validation gives the model a chance to repair its whole
// reply. An explicit partial pass can then preserve only evidence-safe progress
// while leaving every unresolved memory pending for the next run.

export const MEMORY_THEME_KINDS = ['lesson', 'value'] as const;
export type MemoryThemeKind = (typeof MEMORY_THEME_KINDS)[number];

export const MEMORY_CONFIDENCE = ['high', 'medium'] as const;
export type MemoryConfidence = (typeof MEMORY_CONFIDENCE)[number];

export const MAX_MEMORIES_PER_CONSOLIDATION = 160;
export const MAX_THEMES_PER_CONSOLIDATION = 24;

export interface MemoryForConsolidation {
  id: string;
  category: string;
  content: string;
  confidence: string;
  createdAt: Date;
}

export interface ExistingMemoryTheme {
  id: string;
  kind: string;
  title: string;
  statement: string;
  guidance: string;
  confidence: string;
  sourceCount: number;
}

export interface ValidatedMemoryTheme {
  existingThemeId: string | null;
  kind: MemoryThemeKind;
  title: string;
  statement: string;
  guidance: string;
  confidence: MemoryConfidence;
  sourceMemoryIds: string[];
}

export interface ConsolidationPlan {
  themes: ValidatedMemoryTheme[];
  ignoredMemoryIds: string[];
  deferredMemoryIds: string[];
  warnings: string[];
  error: string | null;
}

export interface ConsolidationReferenceCatalog {
  memoryRefs: Record<string, string>;
  themeRefs: Record<string, string>;
}

export interface ConsolidationParseOptions {
  references?: ConsolidationReferenceCatalog;
  /** Keep valid progress and leave anything unresolved pending for a later run. */
  allowPartial?: boolean;
}

/** Stable enough for a DB natural key; identity is never delegated to a model. */
export function themeSlug(title: string): string {
  return (
    title
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'untitled-theme'
  );
}

function text(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function stringIds(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [
    ...new Set(
      v
        .filter((x): x is string => typeof x === 'string')
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  ];
}

function failed(error: string): ConsolidationPlan {
  return {
    themes: [],
    ignoredMemoryIds: [],
    deferredMemoryIds: [],
    warnings: [],
    error,
  };
}

function resolveReference(
  token: string,
  ids: ReadonlySet<string>,
  references: Record<string, string> | undefined,
): string | null {
  if (ids.has(token)) return token;
  const resolved = references?.[token];
  return resolved && ids.has(resolved) ? resolved : null;
}

/**
 * Parse the model reply strictly by default, or salvage only valid references
 * when the caller explicitly enables partial progress after a failed repair.
 *
 * Every pending memory must be named either under a theme or under `ignored`.
 * The latter is not deletion: it means the episode remains in the raw archive
 * but does not deserve permanent space in every future reasoning pack.
 */
export function parseConsolidationPlan(
  raw: string,
  pending: Array<Pick<MemoryForConsolidation, 'id'>>,
  existing: Array<Pick<ExistingMemoryTheme, 'id'>>,
  options: ConsolidationParseOptions = {},
): ConsolidationPlan {
  const clean = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(clean) as Record<string, unknown>;
  } catch {
    return failed('consolidator did not return JSON');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return failed('consolidator returned the wrong shape');
  }

  const partial = options.allowPartial === true;
  const pendingIds = new Set(pending.map((m) => m.id));
  const existingIds = new Set(existing.map((t) => t.id));
  const themes: ValidatedMemoryTheme[] = [];
  const seenExisting = new Set<string>();
  const seenNewSlugs = new Set<string>();
  const accounted = new Set<string>();
  const warnings: string[] = [];
  let list = Array.isArray(parsed.themes) ? parsed.themes : [];

  if (list.length > MAX_THEMES_PER_CONSOLIDATION) {
    const message = `consolidator proposed more than ${MAX_THEMES_PER_CONSOLIDATION} themes`;
    if (!partial) return failed(message);
    warnings.push(`${message}; later themes were deferred`);
    list = list.slice(0, MAX_THEMES_PER_CONSOLIDATION);
  }

  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      const message = 'a proposed theme was not an object';
      if (!partial) return failed(message);
      warnings.push(`${message}; it was skipped`);
      continue;
    }
    const o = item as Record<string, unknown>;
    const existingToken = o.existingThemeRef ?? o.existingThemeId;
    const rawExisting = existingToken == null ? null : text(existingToken, 100);
    const existingThemeId = rawExisting
      ? resolveReference(rawExisting, existingIds, options.references?.themeRefs)
      : null;
    if (rawExisting && !existingThemeId) {
      const message = `theme cites unknown existing reference ${rawExisting}`;
      if (!partial) return failed(message);
      warnings.push(`${message}; that proposed update was skipped`);
      continue;
    }
    if (existingThemeId && seenExisting.has(existingThemeId)) {
      const message = `existing theme ${rawExisting} was updated twice`;
      if (!partial) return failed(message);
      warnings.push(`${message}; the later update was skipped`);
      continue;
    }

    const kind = text(o.kind, 20) as MemoryThemeKind;
    const confidence = text(o.confidence, 20) as MemoryConfidence;
    const title = text(o.title, 100);
    const statement = text(o.statement, 600);
    const guidance = text(o.guidance, 500);

    if (!(MEMORY_THEME_KINDS as readonly string[]).includes(kind)) {
      const message = `unknown theme kind ${kind || '(empty)'}`;
      if (!partial) return failed(message);
      warnings.push(`${message}; that proposed theme was skipped`);
      continue;
    }
    if (!(MEMORY_CONFIDENCE as readonly string[]).includes(confidence)) {
      const message = `unknown theme confidence ${confidence || '(empty)'}`;
      if (!partial) return failed(message);
      warnings.push(`${message}; that proposed theme was skipped`);
      continue;
    }
    if (title.length < 4 || statement.length < 12 || guidance.length < 12) {
      const message = 'a theme is missing a usable title, statement, or guidance';
      if (!partial) return failed(message);
      warnings.push(`${message}; it was skipped`);
      continue;
    }

    const sourceTokens = stringIds(o.sourceMemoryRefs ?? o.sourceMemoryIds);
    const sourceMemoryIds: string[] = [];
    const unknownSources: string[] = [];
    for (const token of sourceTokens) {
      const id = resolveReference(token, pendingIds, options.references?.memoryRefs);
      if (id) sourceMemoryIds.push(id);
      else unknownSources.push(token);
    }
    if (unknownSources.length) {
      const message = `theme “${title}” cites unknown memory reference ${unknownSources.join(', ')}`;
      if (!partial) return failed(message);
      warnings.push(`${message}; unknown references were removed`);
    }
    if (sourceMemoryIds.length === 0) {
      const message = `theme “${title}” cites no valid new memories`;
      if (!partial) return failed(message);
      warnings.push(`${message}; it was skipped`);
      continue;
    }

    if (existingThemeId) seenExisting.add(existingThemeId);
    else {
      const slug = themeSlug(title);
      if (seenNewSlugs.has(slug)) {
        const message = `new theme “${title}” duplicates another title`;
        if (!partial) return failed(message);
        warnings.push(`${message}; the later theme was skipped`);
        continue;
      }
      seenNewSlugs.add(slug);
    }

    for (const id of sourceMemoryIds) accounted.add(id);

    themes.push({
      existingThemeId,
      kind,
      title,
      statement,
      guidance,
      confidence,
      sourceMemoryIds,
    });
  }

  const ignoredTokens = stringIds(parsed.ignoredMemoryRefs ?? parsed.ignoredMemoryIds);
  const ignoredMemoryIds: string[] = [];
  for (const token of ignoredTokens) {
    const id = resolveReference(token, pendingIds, options.references?.memoryRefs);
    if (!id) {
      const message = `ignored list cites unknown memory reference ${token}`;
      if (!partial) return failed(message);
      warnings.push(`${message}; it was removed`);
      continue;
    }
    ignoredMemoryIds.push(id);
    accounted.add(id);
  }

  const deferredMemoryIds = [...pendingIds].filter((id) => !accounted.has(id));
  if (deferredMemoryIds.length) {
    const message = `${deferredMemoryIds.length} ${deferredMemoryIds.length === 1 ? 'memory was' : 'memories were'} neither themed nor ignored`;
    if (!partial) return failed(message);
    warnings.push(`${message}; they remain pending for the next run`);
  }
  if (pendingIds.size > 0 && accounted.size === 0) {
    return failed('consolidator produced no valid progress');
  }

  return { themes, ignoredMemoryIds, deferredMemoryIds, warnings, error: null };
}
