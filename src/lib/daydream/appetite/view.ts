// src/lib/daydream/appetite/view.ts
//
// The appetite ledger as the room reads it. PURE — a `.svelte` file may import
// this, so nothing here may reach `$lib/db` (a page module that does fails the
// BUILD, not the type-check).
//
// The job this module actually does is the owner's third ask: make the
// INFLUENCES legible. A lead on the ledger stores the pack KEYS it cited, not
// the text of those lines — the pack is reassembled nightly and yesterday's
// wording is gone. So `describeCite` turns a key back into a sentence about
// where the pressure came from. Deterministic, and honest about its own
// resolution: `q:3` becomes "a question you asked", never an invented quote.

import type { CapabilityKind, CapabilityStatus } from './spec';
import type { Tone } from '../priority';

export const KIND_LABEL: Readonly<Record<string, string>> = {
  data_source: 'Data source',
  news_source: 'News feed',
  watch: 'Watch',
  tool: 'Tool',
  feature: 'Site feature',
};

export const LANE_LABEL: Readonly<Record<string, string>> = {
  source: 'catalogue',
  watch: 'monitor',
  tool: 'toolsmith',
  feature: 'build',
};

export const STATUS_LABEL: Readonly<Record<string, string>> = {
  proposed: 'waiting on you',
  queued: 'queued',
  building: 'being built',
  shipped: 'shipped',
  declined: 'declined',
};

export function statusTone(status: string): Tone {
  switch (status) {
    case 'proposed':
      return 'action';
    case 'queued':
    case 'building':
      return 'steady';
    case 'shipped':
      return 'good';
    default:
      return 'quiet';
  }
}

/**
 * What a citation key meant.
 *
 * Prefix-matched, in the order the pack builds its sections. An unrecognised
 * key returns the key itself rather than a guess — a lead citing something
 * this function cannot name is a lead whose evidence changed shape, and
 * printing the raw key is how anyone would find that out.
 */
export function describeCite(key: string): string {
  if (key.startsWith('q:')) return 'a question you asked';
  if (key.startsWith('intent:')) return 'a type of question you keep asking';
  if (key.startsWith('unmet:')) return 'an unmet need from your questions';
  if (key.startsWith('fault:')) {
    const rest = key.slice('fault:'.length);
    const at = rest.indexOf(':');
    return at > 0 ? `a fault: ${rest.slice(at + 1)}` : 'a fault the engine raised';
  }
  if (key.startsWith('starved:')) return 'a measurement nothing writes';
  if (key.startsWith('source:')) return `the ${key.slice('source:'.length)} signal source`;
  if (key.startsWith('lead:')) return 'another idea already on this ledger';
  if (key === 'toolsets') return 'the toolsets jkai already has';
  if (key === 'apis') return 'the API catalogue';
  if (key === 'watches') return 'the watches already running';
  if (key === 'news') return 'the news feeds already wired in';
  if (key === 'schedules') return 'the scheduled workflows';
  return key;
}

/** Where an outcome reference points, when the shape says. */
export function outcomeHrefFor(ref: string | null): string | null {
  if (!ref) return null;
  if (/^https?:\/\//i.test(ref)) return ref;
  if (/^build:/.test(ref)) return `/jkai/builds/${ref.slice('build:'.length)}`;
  if (/^monitor:/.test(ref)) return '/jkai/daydreams/watches';
  return null;
}

export interface AppetiteLead {
  slug: string;
  kind: CapabilityKind;
  title: string;
  need: string;
  value: string;
  consumer: string;
  integrationHint: string | null;
  /** Citations, said in English. */
  evidence: string[];
  cites: string[];
  score: number;
  components: Record<string, number>;
  status: CapabilityStatus;
  recurrence: number;
  lane: string | null;
  outcome: string | null;
  outcomeRef: string | null;
  outcomeHref: string | null;
  lastSeenAt: string;
}

export interface AppetiteView {
  leads: AppetiteLead[];
  counts: { total: number; byStatus: Record<string, number>; byKind: Record<string, number> };
  /** Open leads in a lane that brings new data in. */
  newDataOpen: number;
  error: string | null;
}

export const EMPTY_APPETITE: AppetiteView = {
  leads: [],
  counts: { total: 0, byStatus: {}, byKind: {} },
  newDataOpen: 0,
  error: null,
};

/** Row → card. Separated from the loader so it is testable without a database. */
export function toLead(row: {
  slug: string;
  kind: CapabilityKind;
  title: string;
  need: string;
  value: string;
  consumer: string;
  integrationHint: string | null;
  cites: string[];
  score: number;
  components: Record<string, number>;
  status: CapabilityStatus;
  recurrence: number;
  lane: string | null;
  outcome: string | null;
  outcomeRef: string | null;
  lastSeenAt: string;
}): AppetiteLead {
  return {
    ...row,
    evidence: [...new Set(row.cites.map(describeCite))].slice(0, 4),
    outcomeHref: outcomeHrefFor(row.outcomeRef),
  };
}
