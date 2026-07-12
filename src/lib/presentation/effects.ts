// Registry of deck effects — Three.js particle simulations (and the site's
// live ECG) that render behind a slide's content (role "background") or play
// as the camera move into a slide (role "transition"). Allowlist by design,
// same contract as embeds.ts: the LLM/editor can only reference what's here.

export interface EffectDef {
  label: string;
  /** Editor grouping (dropdown optgroups). */
  category: 'Particle fields' | 'Print & type' | 'Live data' | 'Wipes';
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
  plexus: {
    label: 'Constellation',
    category: 'Particle fields',
    doc: 'slow-drifting points joined by hairlines when they near each other — networks, federation, systems joining up',
    roles: ['background'],
  },
  currents: {
    label: 'Ink currents',
    category: 'Particle fields',
    doc: 'hundreds of short ink strokes flowing along an invisible current field — movement, migration, data in motion',
    roles: ['background'],
  },
  orbits: {
    label: 'Orbits',
    category: 'Particle fields',
    doc: 'particles circling on faint elliptical rings like a star chart — cycles, systems in balance, the long view',
    roles: ['background'],
  },
  sea: {
    label: 'Point sea',
    category: 'Particle fields',
    doc: 'a receding sea of dots swelling in slow waves toward the horizon — calm scale, undercurrents, what lies beneath',
    roles: ['background'],
  },
  halftone: {
    label: 'Halftone screen',
    category: 'Print & type',
    doc: 'a living print halftone — a dot screen that breathes as a wave crosses it; editorial texture straight from the pressroom',
    roles: ['background'],
  },
  letterpress: {
    label: 'Loose type',
    category: 'Print & type',
    doc: 'oversized serif glyphs tumbling slowly like spilled type from a compositor tray — language, print, the craft of setting words',
    roles: ['background'],
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
  shatter: {
    label: 'Shatter wipe',
    category: 'Wipes',
    doc: 'the outgoing page breaks into angular shards that tumble away with the camera move — rupture, a hard break in the argument',
    roles: ['transition'],
  },
  inkbleed: {
    label: 'Ink-bleed wipe',
    category: 'Wipes',
    doc: 'ink blooms flood across the page then clear to reveal the next slide — like ink dropped in water; slow and painterly',
    roles: ['transition'],
  },
  slats: {
    label: 'Paper-slat wipe',
    category: 'Wipes',
    doc: 'staggered paper slats sweep across with the camera move — crisp and mechanical, the lightest of the wipes',
    roles: ['transition'],
  },
  dissolve: {
    label: 'Halftone dissolve',
    category: 'Wipes',
    doc: 'a granular halftone screen cascades across the page, dissolving it dot by dot — print-flavoured, between slats and melt in weight',
    roles: ['transition'],
  },
};

export const EFFECT_IDS = Object.keys(EFFECTS);

export const EFFECT_CATEGORIES = ['Particle fields', 'Print & type', 'Live data', 'Wipes'] as const;

/** Wipe effects replace the sweep as the transition overlay, keyed by id. */
export function isWipe(effect: string): boolean {
  return EFFECTS[effect]?.category === 'Wipes';
}

/** Wipes that consume the outgoing DOM (it drops fast; particles replace it). */
export const VEIL_WIPES = new Set(['melt', 'shatter']);

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
