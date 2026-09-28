// How /admin/access PRESENTS the catalogue: one role per person plus adds,
// family as one three-way choice, and per area only the choices that differ.
//
// Pure, and Main-only on purpose. `catalogue.ts` and `effective.ts` are
// byte-shared with SR-Drive, SR-Jkai-Core and SR-Health, so anything that only
// shapes the editor or normalises a save lives here instead.
//
// Spec: docs/superpowers/specs/2026-09-28-people-and-app-registration.md

import {
  AREAS,
  levelOf,
  parsePermissions,
  satisfies,
  type AreaId,
  type Level,
  type Permission,
} from './catalogue';

/** A role seeded beside the catalogue's BUILT_IN_GROUPS; never deletable. */
export const EXTRA_BUILT_IN_ROLES: readonly {
  id: string;
  label: string;
  description: string;
  grants: readonly Permission[];
}[] = [
  {
    id: 'friend',
    label: 'Friend',
    description: 'News, chat with jkai and games. Never anyone’s location.',
    grants: ['news:self', 'jkai.chat:self', 'games:self'],
  },
];

/**
 * Built-ins renamed for the one-role model. Applied only while a row still
 * carries the label it was seeded with — a name the owner chose is theirs.
 */
export const BUILT_IN_RELABEL: Record<string, { from: string; label: string; description: string }> = {
  'family-circle': {
    from: 'Family Circle',
    label: 'Family',
    description: 'Games, and the family’s live locations on a map.',
  },
  'family-admin': {
    from: 'Family Admin',
    label: 'Parent',
    description: 'Everything Family has, plus their kids’ location history.',
  },
};

export type FamilyLevel = 'none' | 'circle' | 'parent';

export const FAMILY_CHOICES: readonly { value: FamilyLevel; label: string; blurb: string }[] = [
  { value: 'none', label: 'None', blurb: 'No locations.' },
  { value: 'circle', label: 'Circle', blurb: 'Their own and the family’s live locations.' },
  { value: 'parent', label: 'Parent', blurb: 'Also their kids’ location history. Pick the kids below.' },
];

export function familyLevel(grants: Iterable<Permission>): FamilyLevel {
  const set = new Set(grants);
  if (set.has('family:admin')) return 'parent';
  if (set.has('family:circle')) return 'circle';
  return 'none';
}

export function withFamily(grants: readonly Permission[], level: FamilyLevel): Permission[] {
  const rest = grants.filter((g) => g !== 'family:circle' && g !== 'family:admin');
  if (level === 'circle') return [...rest, 'family:circle'];
  if (level === 'parent') return [...rest, 'family:circle', 'family:admin'];
  return rest;
}

/** One choice in an area's row. `level: null` is Off. */
export interface AreaChoice {
  level: Level | null;
  label: string;
}

/** Areas the editor shows no control for; see `normaliseGrants`. */
export const DERIVED_AREAS: ReadonlySet<AreaId> = new Set(['jkai.knowledge']);

/**
 * Per area, only the choices that change something. The catalogue's own
 * level text ("Same as self", "Nothing yet") is why: three radios that all
 * meant one thing read as three different grants.
 */
export const AREA_CHOICES: Record<AreaId, readonly AreaChoice[]> = {
  news: [{ level: null, label: 'Off' }, { level: 'self', label: 'On' }],
  research: [
    { level: null, label: 'Off' },
    { level: 'self', label: 'Own' },
    { level: 'all', label: '+ read everyone’s' },
    { level: 'admin', label: '+ edit everyone’s' },
  ],
  drive: [
    { level: null, label: 'Off' },
    { level: 'self', label: 'Own' },
    { level: 'all', label: '+ read everyone’s' },
    { level: 'admin', label: '+ edit everyone’s' },
  ],
  home: [
    { level: null, label: 'Off' },
    { level: 'self', label: 'House' },
    { level: 'all', label: '+ voice log' },
  ],
  'jkai.chat': [
    { level: null, label: 'Off' },
    { level: 'self', label: 'Own' },
    { level: 'all', label: '+ read everyone’s' },
    { level: 'admin', label: '+ manage everyone’s' },
  ],
  'jkai.notes': [
    { level: null, label: 'Off' },
    { level: 'self', label: 'Own' },
    { level: 'all', label: '+ read everyone’s' },
    { level: 'admin', label: '+ edit everyone’s' },
  ],
  'jkai.intel': [
    { level: null, label: 'Off' },
    { level: 'self', label: 'Own' },
    { level: 'all', label: '+ read everyone’s' },
    { level: 'admin', label: '+ edit everyone’s' },
  ],
  'jkai.knowledge': [{ level: null, label: 'Off' }, { level: 'self', label: 'On' }],
  games: [{ level: null, label: 'Off' }, { level: 'self', label: 'On' }],
  health: [{ level: null, label: 'Off' }, { level: 'all', label: 'Read yours' }],
  workflows: [
    { level: null, label: 'Off' },
    { level: 'self', label: 'Own' },
    { level: 'all', label: '+ read everyone’s' },
    { level: 'admin', label: '+ edit everyone’s' },
  ],
  admin: [{ level: null, label: 'Off' }, { level: 'self', label: 'On' }],
};

/** Short names for a one-line summary of what someone holds. */
const SHORT: Record<AreaId, string> = {
  news: 'news',
  research: 'research',
  drive: 'drive',
  home: 'home',
  'jkai.chat': 'chat',
  'jkai.notes': 'notes',
  'jkai.intel': 'intel',
  'jkai.knowledge': 'recall',
  games: 'games',
  health: 'your health',
  workflows: 'workflows',
  admin: 'showcase',
};

/** The areas the editor draws, in catalogue order. */
export const EDITABLE_AREAS = AREAS.filter((a) => !DERIVED_AREAS.has(a.id));

/**
 * The choice an area's row shows as held: the highest choice the grants
 * satisfy. A stored level with no choice of its own (`news:all`, which means
 * the same as `news:self`) shows as the choice below it.
 */
export function heldChoice(grants: Iterable<Permission>, area: AreaId): Level | null {
  const list = [...grants];
  let held: Level | null = null;
  for (const c of AREA_CHOICES[area]) {
    if (c.level && satisfies(list, `${area}:${c.level}` as Permission)) held = c.level;
  }
  return held;
}

export function withAreaLevel(grants: readonly Permission[], area: AreaId, level: Level | null): Permission[] {
  const rest = grants.filter((g) => !g.startsWith(`${area}:`));
  return level ? [...rest, `${area}:${level}` as Permission] : rest;
}

/**
 * What every save stores: catalogue-valid, family:admin always with
 * family:circle (the routes check circle exactly, and the catalogue that
 * would imply it is shared with three other apps), recall held exactly when
 * any intel level is.
 */
export function normaliseGrants(values: readonly unknown[]): Permission[] {
  // Each area grant as the choice it means: `games:all` is `games:self`,
  // `health:self` is nothing. Otherwise a role giving games:self would leave
  // a stored games:all looking like an add.
  const parsed = parsePermissions(values);
  const out: Permission[] = parsed.filter((g) => g === 'family:circle' || g === 'family:admin');
  for (const a of AREAS) {
    if (a.id === 'jkai.knowledge') continue;
    const level = heldChoice(parsed, a.id);
    if (level) out.push(`${a.id}:${level}` as Permission);
  }
  if (out.includes('family:admin') && !out.includes('family:circle')) out.push('family:circle');
  if (levelOf(out, 'jkai.intel') !== null) out.push('jkai.knowledge:self');
  return out;
}

/**
 * The adds worth storing on top of a role: normalised, then without anything
 * the role already gives. Holding `research:all` from the role makes a stored
 * `research:self` a grant that changes nothing.
 */
export function pruneAdds(roleGrants: readonly Permission[], adds: readonly unknown[]): Permission[] {
  const role = normaliseGrants(roleGrants);
  return normaliseGrants(adds).filter((g) => !satisfies(role, g));
}

/**
 * The single role to read from a stored list: the one whose grants cover all
 * the others (Family Admin ⊇ Family Circle), else the one granting the most.
 * Rows from before the one-role model can hold several.
 */
export function strongestRole(
  ids: readonly string[],
  grantsOf: ReadonlyMap<string, readonly Permission[]>,
): string | null {
  const known = ids.filter((id) => grantsOf.has(id));
  if (known.length === 0) return null;
  const covers = (a: string, b: string) => (grantsOf.get(b) ?? []).every((g) => satisfies(grantsOf.get(a) ?? [], g));
  const top = known.find((a) => known.every((b) => covers(a, b)));
  if (top) return top;
  return [...known].sort((a, b) => (grantsOf.get(b)?.length ?? 0) - (grantsOf.get(a)?.length ?? 0))[0];
}

/** "chat, news, games" — the areas held, in catalogue order, without recall. */
export function summarise(grants: Iterable<Permission>): string[] {
  const list = [...grants];
  return EDITABLE_AREAS.filter((a) => heldChoice(list, a.id) !== null).map((a) => {
    const level = heldChoice(list, a.id);
    const choices = AREA_CHOICES[a.id];
    // Only multi-step areas say how far: "research (+ read everyone’s)".
    const extra = choices.length > 2 && level && level !== 'self' ? ` (${choices.find((c) => c.level === level)?.label})` : '';
    return `${SHORT[a.id]}${extra}`;
  });
}

