import { ASSISTANT_ENTRIES } from './entries/assistant';
import { BUILDING_ENTRIES } from './entries/building';
import { CUSTOM_ENTRY } from './entries/custom';
import { OWNER_ENTRIES } from './entries/owner';
import { PLANNED_ENTRIES } from './entries/planned';
import { WORKFLOWS_ENTRIES } from './entries/workflows';
import { CUSTOM_TOOLSET_PREFIX, type CapabilityEntry } from './types';

/**
 * The capability manifest, assembled (plan point 7, slice 7b). PURE: entries
 * only, no tool module, no registry, no I/O — see `./types`.
 *
 * Order is the order jkai's keyword rows are tried in Core, so a new row goes
 * at the end of its group rather than at the top.
 */
export const CAPABILITIES: readonly CapabilityEntry[] = [
  ...ASSISTANT_ENTRIES,
  ...BUILDING_ENTRIES,
  ...WORKFLOWS_ENTRIES,
  ...OWNER_ENTRIES,
  CUSTOM_ENTRY,
  ...PLANNED_ENTRIES,
];

export function isCustomToolset(toolset: string): boolean {
  return toolset.startsWith(CUSTOM_TOOLSET_PREFIX);
}

/** The row describing a toolset; every `custom:*` toolset is the custom row. */
export function capabilityForToolset(toolset: string): CapabilityEntry | undefined {
  if (isCustomToolset(toolset)) return CUSTOM_ENTRY;
  return CAPABILITIES.find((c) => c.toolsets.includes(toolset));
}

/** The toolset's one-line description for `getToolsetManifest` and jkai_help. */
export function toolsetBlurb(toolset: string): string | undefined {
  const row = capabilityForToolset(toolset);
  if (!row) return undefined;
  if (row === CUSTOM_ENTRY) return `Saved custom tools (${toolset.slice(CUSTOM_TOOLSET_PREFIX.length)}) — preview, owner-only, read-only`;
  return row.blurb;
}

export function plannedCapabilities(): CapabilityEntry[] {
  return CAPABILITIES.filter((c) => c.status === 'planned');
}

/**
 * What a principal is told about. A member hears only of live, member-safe
 * rows (decision 17: owner-only first); the owner hears of everything.
 */
export function capabilitiesFor(principalId: string | undefined): CapabilityEntry[] {
  if (!principalId || principalId === 'owner') return [...CAPABILITIES];
  return CAPABILITIES.filter((c) => c.memberSafe && c.status === 'live');
}

/** FNV-1a over the serialised rows: changes exactly when a row does. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Carried on the catalogue so a receiver can tell one manifest from another. */
export const CAPABILITIES_VERSION = `c1-${fnv1a(JSON.stringify(CAPABILITIES))}`;

export interface CapabilityHit {
  entry: CapabilityEntry;
  score: number;
}

const STOP_WORDS = new Set(['the', 'and', 'for', 'can', 'you', 'my', 'me', 'a', 'an', 'of', 'to', 'is', 'it', 'on', 'in', 'what', 'how', 'do', 'with', 'from', 'jkai']);

/**
 * Rank rows against a query: a keyword-pattern match first, then words shared
 * with the id, title and blurb.
 *
 * A planned row only ever outranks a live one on a strictly better score, and
 * the caller lists live hits beside it, so a weak match on a planned row
 * cannot tell John a live feature does not exist (plan risk: false "not
 * built yet").
 */
export function rankCapabilities(query: string, rows: readonly CapabilityEntry[] = CAPABILITIES, limit = 5): CapabilityHit[] {
  const text = query.trim();
  if (!text) return [];
  const terms = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
  const hits: CapabilityHit[] = [];
  for (const entry of rows) {
    let score = 0;
    for (const source of entry.keywords ?? []) {
      try {
        if (new RegExp(source, 'i').test(text)) score += 3;
      } catch {
        // A row whose pattern does not compile ranks on words alone; the
        // drift test is what catches it.
      }
    }
    const haystack = `${entry.id} ${entry.title} ${entry.blurb}`.toLowerCase();
    for (const t of terms) if (haystack.includes(t)) score += entry.title.toLowerCase().includes(t) || entry.id.includes(t) ? 2 : 1;
    if (score > 0) hits.push({ entry, score });
  }
  const rank = (h: CapabilityHit) => h.score * 10 + (h.entry.status === 'planned' ? 0 : 1);
  return hits.sort((a, b) => rank(b) - rank(a)).slice(0, limit);
}
