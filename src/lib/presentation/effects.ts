// Registry of deck effects — Three.js particle simulations (and the site's
// live ECG) that render behind a slide's content (role "background") or play
// as the camera move into a slide (role "transition"). Allowlist by design,
// same contract as embeds.ts: the LLM/editor can only reference what's here.

export interface EffectDef {
  label: string;
  /** Editor grouping (dropdown optgroups). */
  category: 'Particle fields' | 'Live data' | 'Wipes';
  /** One-liner surfaced to the LLM via BLOCK_DOCS. */
  doc: string;
  /** Which roles this effect can play. */
  roles: ('background' | 'transition')[];
}

export const EFFECTS: Record<string, EffectDef> = {
  drift: {
    label: 'Paper drift',
    category: 'Particle fields',
    doc: 'ambient dust motes drifting slowly across the page — quiet texture for statement/title slides',
    roles: ['background', 'transition'],
  },
  starfield: {
    label: 'Starfield',
    category: 'Particle fields',
    doc: 'a deep parallax particle field, slow push forward — scale and space, good behind big numbers',
    roles: ['background', 'transition'],
  },
  heartbeat: {
    label: 'Live heartbeat',
    category: 'Live data',
    doc: "the site's live ECG trace (the landing-page heartbeat) sweeping behind the content — living-data feel",
    roles: ['background'],
  },
  melt: {
    label: 'Melt wipe',
    category: 'Wipes',
    doc: 'the outgoing page melts into ink particles that blow away with the camera move — the boldest transition; chapter boundaries only',
    roles: ['transition'],
  },
};

export const EFFECT_IDS = Object.keys(EFFECTS);

export const EFFECT_CATEGORIES = ['Particle fields', 'Live data', 'Wipes'] as const;

export type EffectTint = 'ink' | 'accent' | 'petrol';

/** Stage-relative px rect a melt wipe spawns its particles from. */
export interface Zone {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const TINT_COLORS: Record<EffectTint, string> = {
  ink: '#1c1611',
  accent: '#c4570a',
  petrol: '#0e5b66',
};
