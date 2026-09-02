// src/lib/daydream/memory-consolidation.ts
//
// The pure boundary around nightly memory consolidation.
//
// A model is allowed to propose the meaning of raw memories. It is not allowed
// to invent rows, silently drop an observation, or widen the vocabulary beyond
// lesson/value. This module validates the whole reply before the server writes
// any of it, so a malformed night leaves every memory pending for the retry.

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
  error: string | null;
}

/** Stable enough for a DB natural key; identity is never delegated to a model. */
export function themeSlug(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'untitled-theme';
}

function text(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function stringIds(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0))];
}

/**
 * Parse the model reply as an all-or-nothing plan.
 *
 * Every pending memory must be named either under a theme or under `ignored`.
 * The latter is not deletion: it means the episode remains in the raw archive
 * but does not deserve permanent space in every future reasoning pack.
 */
export function parseConsolidationPlan(
  raw: string,
  pending: Array<Pick<MemoryForConsolidation, 'id'>>,
  existing: Array<Pick<ExistingMemoryTheme, 'id'>>,
): ConsolidationPlan {
  const clean = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(clean) as Record<string, unknown>;
  } catch {
    return { themes: [], ignoredMemoryIds: [], error: 'consolidator did not return JSON' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { themes: [], ignoredMemoryIds: [], error: 'consolidator returned the wrong shape' };
  }

  const pendingIds = new Set(pending.map((m) => m.id));
  const existingIds = new Set(existing.map((t) => t.id));
  const themes: ValidatedMemoryTheme[] = [];
  const seenExisting = new Set<string>();
  const seenNewSlugs = new Set<string>();
  const accounted = new Set<string>();
  const list = Array.isArray(parsed.themes) ? parsed.themes : [];

  if (list.length > MAX_THEMES_PER_CONSOLIDATION) {
    return {
      themes: [],
      ignoredMemoryIds: [],
      error: `consolidator proposed more than ${MAX_THEMES_PER_CONSOLIDATION} themes`,
    };
  }

  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { themes: [], ignoredMemoryIds: [], error: 'a proposed theme was not an object' };
    }
    const o = item as Record<string, unknown>;
    const existingThemeId = o.existingThemeId == null ? null : text(o.existingThemeId, 100);
    if (existingThemeId && !existingIds.has(existingThemeId)) {
      return { themes: [], ignoredMemoryIds: [], error: `theme cites unknown existing id ${existingThemeId}` };
    }
    if (existingThemeId && seenExisting.has(existingThemeId)) {
      return { themes: [], ignoredMemoryIds: [], error: `existing theme ${existingThemeId} was updated twice` };
    }

    const kind = text(o.kind, 20) as MemoryThemeKind;
    const confidence = text(o.confidence, 20) as MemoryConfidence;
    const title = text(o.title, 100);
    const statement = text(o.statement, 600);
    const guidance = text(o.guidance, 500);
    const sourceMemoryIds = stringIds(o.sourceMemoryIds);

    if (!(MEMORY_THEME_KINDS as readonly string[]).includes(kind)) {
      return { themes: [], ignoredMemoryIds: [], error: `unknown theme kind ${kind || '(empty)'}` };
    }
    if (!(MEMORY_CONFIDENCE as readonly string[]).includes(confidence)) {
      return { themes: [], ignoredMemoryIds: [], error: `unknown theme confidence ${confidence || '(empty)'}` };
    }
    if (title.length < 4 || statement.length < 12 || guidance.length < 12) {
      return { themes: [], ignoredMemoryIds: [], error: 'a theme is missing a usable title, statement, or guidance' };
    }
    if (sourceMemoryIds.length === 0) {
      return { themes: [], ignoredMemoryIds: [], error: `theme “${title}” cites no new memories` };
    }
    for (const id of sourceMemoryIds) {
      if (!pendingIds.has(id)) {
        return { themes: [], ignoredMemoryIds: [], error: `theme “${title}” cites unknown memory ${id}` };
      }
      accounted.add(id);
    }

    if (existingThemeId) seenExisting.add(existingThemeId);
    else {
      const slug = themeSlug(title);
      if (seenNewSlugs.has(slug)) {
        return { themes: [], ignoredMemoryIds: [], error: `new theme “${title}” duplicates another title` };
      }
      seenNewSlugs.add(slug);
    }

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

  const ignoredMemoryIds = stringIds(parsed.ignoredMemoryIds);
  for (const id of ignoredMemoryIds) {
    if (!pendingIds.has(id)) {
      return { themes: [], ignoredMemoryIds: [], error: `ignored list cites unknown memory ${id}` };
    }
    accounted.add(id);
  }

  const missing = [...pendingIds].filter((id) => !accounted.has(id));
  if (missing.length) {
    return {
      themes: [],
      ignoredMemoryIds: [],
      error: `${missing.length} ${missing.length === 1 ? 'memory was' : 'memories were'} neither themed nor ignored`,
    };
  }

  return { themes, ignoredMemoryIds, error: null };
}
