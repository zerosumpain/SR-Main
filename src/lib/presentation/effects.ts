// Registry of deck effects — Three.js particle simulations (and the site's
// live ECG) that render behind a slide's content (role "background") or play
// as the camera move into a slide (role "transition"). Allowlist by design,
// same contract as embeds.ts: the LLM/editor can only reference what's here.

export interface EffectDef {
  label: string;
  /** One-liner surfaced to the LLM via BLOCK_DOCS. */
  doc: string;
  /** Which roles this effect can play. */
  roles: ('background' | 'transition')[];
}

export const EFFECTS: Record<string, EffectDef> = {
  drift: {
    label: 'Paper drift',
    doc: 'ambient dust motes drifting slowly across the page — quiet texture for statement/title slides',
    roles: ['background', 'transition'],
  },
  starfield: {
    label: 'Starfield',
    doc: 'a deep parallax particle field, slow push forward — scale and space, good behind big numbers',
    roles: ['background', 'transition'],
  },
  heartbeat: {
    label: 'Live heartbeat',
    doc: "the site's live ECG trace (the landing-page heartbeat) sweeping behind the content — living-data feel",
    roles: ['background'],
  },
};

export const EFFECT_IDS = Object.keys(EFFECTS);

export type EffectTint = 'ink' | 'accent' | 'petrol';

export const TINT_COLORS: Record<EffectTint, string> = {
  ink: '#1c1611',
  accent: '#c4570a',
  petrol: '#0e5b66',
};
