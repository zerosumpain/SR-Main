// scenarios.ts — defensible starting stances (presets), saved-scenario persistence, and
// permalink encode/decode of the full strategy state. Mirrors the policy-engine scenario
// machinery (scenario identity, A/B compare, shareable #s= links).

import { defaultState } from './engine';
import { CAPABILITY_IDS } from './capabilities';
import { POSTURE_IDS } from './postures';
import { MATURITY_DIMENSIONS } from '$lib/dfe-data-strategy/maturity';
import type { StrategyState } from '$lib/dfe-data-strategy/types';

export interface Preset {
  name: string;
  description: string;
  eli5Name?: string;
  eli5Desc?: string;
  postures: Record<string, number>;
  allocation: Record<string, number>;
}

const even = (): Record<string, number> => {
  const a: Record<string, number> = {};
  for (const id of CAPABILITY_IDS) a[id] = Math.round(1000 / CAPABILITY_IDS.length) / 10;
  return a;
};

export const PRESETS: Preset[] = [
  {
    name: 'Status quo',
    description:
      'Carry on as now: balanced postures, effort spread evenly across every capability. The honest baseline — and usually too thin to move the hardest pressures.',
    eli5Name: 'Carry on as now',
    eli5Desc: 'Keep doing a bit of everything, the way things are today.',
    postures: { 'operating-model': 0, 'build-buy': 0, openness: 0, 'standards-pace': 0, delivery: 0, ambition: 0 },
    allocation: even(),
  },
  {
    name: 'Centralised platform-first',
    description:
      'Build one strong central platform and team, buy capability to move fast, standardise up front. Strong on infrastructure and quality; tested against the federated reality of the school system.',
    eli5Name: 'One big central platform',
    eli5Desc: 'Build one central data system and team, and buy tools to get going quickly.',
    postures: { 'operating-model': -0.7, 'build-buy': 0.3, openness: 0.1, 'standards-pace': -0.3, delivery: -0.3, ambition: 0.2 },
    allocation: { platform: 22, interoperability: 16, quality: 16, governance: 14, value: 12, skills: 8, sharing: 6, ethics: 6 },
  },
  {
    name: 'Federated standards-first',
    description:
      'Meet partners where they are: standards and identifiers up front, partner-led delivery, ownership pushed to domains. Strong on interoperability and sharing; demands real coordination capacity.',
    eli5Name: 'Agree standards, work through partners',
    eli5Desc: 'Set common rules first, then let schools, councils and agencies own their own data.',
    postures: { 'operating-model': 0.7, 'build-buy': 0, openness: -0.3, 'standards-pace': -0.6, delivery: 0.4, ambition: 0 },
    allocation: { interoperability: 22, sharing: 18, governance: 16, skills: 14, quality: 10, ethics: 8, platform: 7, value: 5 },
  },
  {
    name: 'AI-ambition-led',
    description:
      'Chase use-cases and AI value now, buying platform capability to accelerate. Delivers visible value fast — and is flagged hard when it runs ahead of data quality and governance.',
    eli5Name: 'Go for AI and quick wins',
    eli5Desc: 'Push for AI and useful results now, and buy the tools to do it fast.',
    postures: { 'operating-model': -0.3, 'build-buy': 0.5, openness: 0, 'standards-pace': 0.2, delivery: 0, ambition: 0.8 },
    allocation: { value: 22, platform: 18, quality: 16, skills: 14, governance: 10, interoperability: 10, ethics: 6, sharing: 4 },
  },
  {
    name: 'Trust & governance-first',
    description:
      'Earn the social licence first: secure-by-default, foundations before use, heavy investment in governance, ethics and quality. Safest on trust; slowest to visible value.',
    eli5Name: 'Earn trust first',
    eli5Desc: 'Get the rules, ethics and data quality right before doing anything flashy.',
    postures: { 'operating-model': -0.2, 'build-buy': 0, openness: 0.6, 'standards-pace': -0.2, delivery: 0, ambition: -0.5 },
    allocation: { governance: 20, ethics: 20, quality: 18, interoperability: 12, skills: 10, platform: 8, sharing: 8, value: 4 },
  },
];

// ---- equality (posture + allocation; maturity is the lead's own assessment) ----
const round1 = (x: number) => Math.round(x * 10) / 10;
export function sameStance(a: StrategyState, b: { postures: Record<string, number>; allocation: Record<string, number> }): boolean {
  for (const id of POSTURE_IDS) if (round1(a.postures[id] ?? 0) !== round1(b.postures[id] ?? 0)) return false;
  for (const id of CAPABILITY_IDS) if (Math.round(a.allocation[id] ?? 0) !== Math.round(b.allocation[id] ?? 0)) return false;
  return true;
}

// ---- merge a partial/loaded state with the defaults so every key exists ----
export function mergeState(partial: Partial<StrategyState> | null | undefined): StrategyState {
  const base = defaultState();
  if (!partial) return base;
  return {
    postures: { ...base.postures, ...(partial.postures ?? {}) },
    allocation: { ...base.allocation, ...(partial.allocation ?? {}) },
    maturityCurrent: { ...base.maturityCurrent, ...(partial.maturityCurrent ?? {}) },
    maturityTarget: { ...base.maturityTarget, ...(partial.maturityTarget ?? {}) },
  };
}

export function stateFromPreset(p: Preset, keepMaturity?: StrategyState): StrategyState {
  const base = defaultState();
  return {
    postures: { ...base.postures, ...p.postures },
    allocation: { ...base.allocation, ...p.allocation },
    maturityCurrent: keepMaturity ? { ...keepMaturity.maturityCurrent } : base.maturityCurrent,
    maturityTarget: keepMaturity ? { ...keepMaturity.maturityTarget } : base.maturityTarget,
  };
}

// ---- permalink encode/decode (browser only) ----
export function encodeState(s: StrategyState): string {
  try {
    return btoa(unescape(encodeURIComponent(JSON.stringify(s))));
  } catch {
    return '';
  }
}
export function decodeState(token: string): StrategyState | null {
  try {
    const json = decodeURIComponent(escape(atob(token)));
    const o = JSON.parse(json);
    if (o && typeof o === 'object' && o.postures && o.allocation) return mergeState(o);
  } catch {
    /* ignore */
  }
  return null;
}
export function tokenFromHash(hash: string): string | null {
  const m = (hash || '').match(/[#&]s=([^&]+)/);
  return m ? m[1] : null;
}

// ---- saved scenarios (localStorage) ----
export interface SavedScenario {
  id: string;
  name: string;
  state: StrategyState;
  at: number;
}
const SAVED_KEY = 'keystone-saved-v1';
let _counter = 0;
export function makeSaved(name: string, state: StrategyState): SavedScenario {
  _counter += 1;
  return { id: `s${_counter}-${name.replace(/\W+/g, '').slice(0, 8)}`, name, state: structuredClone(state), at: 0 };
}
export function loadSaved(): SavedScenario[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map((s: SavedScenario) => ({ ...s, state: mergeState(s.state) })) : [];
  } catch {
    return [];
  }
}
export function persistSaved(list: SavedScenario[]): void {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(list));
  } catch {
    /* quota */
  }
}

export const MATURITY_TARGET_IDS = MATURITY_DIMENSIONS.map((d) => d.id);
