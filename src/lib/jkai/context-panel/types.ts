import { z } from 'zod';

export const contextLensSchema = z.enum(['general', 'intel', 'research', 'health', 'daydream']);
export type ContextLens = z.infer<typeof contextLensSchema>;

/**
 * A drill key names what a double-click on this element opens — an opaque
 * target such as `entity:<uuid>` or `research-run:<id>` that
 * `$lib/jkai/context-panel/drill` parses and `drill.server` resolves into a
 * manifest. Optional: an element without one falls back to the card's key.
 */
const drill = z.string().min(1).optional();

const baseCard = {
  id: z.string().min(1),
  title: z.string().min(1),
  subtitle: z.string().optional(),
  href: z.string().optional(),
  drill,
};

export const metricCardSchema = z.object({
  ...baseCard,
  type: z.literal('metrics'),
  metrics: z.array(z.object({
    label: z.string(),
    value: z.string(),
    detail: z.string().optional(),
    tone: z.enum(['default', 'good', 'warn', 'bad']).optional(),
    drill,
  })).max(6),
});

export const seriesCardSchema = z.object({
  ...baseCard,
  type: z.literal('series'),
  unit: z.string().optional(),
  series: z.array(z.object({
    key: z.string(),
    label: z.string(),
    colour: z.string().optional(),
    points: z.array(z.object({ x: z.string(), y: z.number().finite() })).max(366),
  })).min(1).max(3),
});

export const barsCardSchema = z.object({
  ...baseCard,
  type: z.literal('bars'),
  rows: z.array(z.object({
    id: z.string(),
    label: z.string(),
    value: z.number().finite().nonnegative(),
    display: z.string().optional(),
    href: z.string().optional(),
    drill,
  })).max(12),
});

export const linksCardSchema = z.object({
  ...baseCard,
  type: z.literal('links'),
  rows: z.array(z.object({
    id: z.string(),
    label: z.string(),
    meta: z.string().optional(),
    note: z.string().optional(),
    href: z.string().optional(),
    drill,
  })).max(12),
});

export const noteCardSchema = z.object({
  ...baseCard,
  type: z.literal('note'),
  body: z.string(),
  tone: z.enum(['default', 'warn']).default('default'),
});

export const contextCardSchema = z.discriminatedUnion('type', [
  metricCardSchema,
  seriesCardSchema,
  barsCardSchema,
  linksCardSchema,
  noteCardSchema,
]);
export type ContextCard = z.infer<typeof contextCardSchema>;

export const contextPanelSchema = z.object({
  revision: z.string(),
  selectedLens: contextLensSchema,
  automaticLens: contextLensSchema,
  focus: z.object({ label: z.string(), reason: z.string() }),
  lenses: z.array(z.object({
    id: contextLensSchema,
    score: z.number().min(0).max(1),
    reason: z.string(),
  })),
  cards: z.array(contextCardSchema).max(8),
});

export type ContextPanel = z.infer<typeof contextPanelSchema>;

// ── Drill manifests ────────────────────────────────────────────────────────
//
// What a double-click opens. Composed on the server (`drill.server.ts`) and
// rendered generically by `ContextDrillModal.svelte`, so a new drill is a new
// resolver rather than a new modal. Actions are declared here and EXECUTED by
// the modal; the endpoint is constrained to this site's own API.

export const drillToneSchema = z.enum(['default', 'good', 'warn', 'bad', 'accent']);
export type DrillTone = z.infer<typeof drillToneSchema>;

export const drillFactSchema = z.object({
  label: z.string(),
  value: z.string(),
  detail: z.string().optional(),
  tone: drillToneSchema.optional(),
});
export type DrillFact = z.infer<typeof drillFactSchema>;

export const drillRowSchema = z.object({
  id: z.string(),
  label: z.string(),
  meta: z.string().optional(),
  note: z.string().optional(),
  href: z.string().optional(),
  /** `href` is off-site (a research source): open in a new tab, keep the modal. */
  external: z.boolean().optional(),
  /** Another drill this row opens — the modal navigates in place. */
  drill: z.string().optional(),
  tone: drillToneSchema.optional(),
  /** ISO time, when the row is an event. */
  when: z.string().optional(),
});
export type DrillRow = z.infer<typeof drillRowSchema>;

export const drillSectionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('rows'),
    id: z.string(),
    title: z.string(),
    rows: z.array(drillRowSchema).max(60),
    /** Shown instead of an empty list, so "nothing" is a statement. */
    empty: z.string().optional(),
  }),
  z.object({
    kind: z.literal('prose'),
    id: z.string(),
    title: z.string(),
    body: z.string(),
    tone: drillToneSchema.optional(),
  }),
  z.object({
    kind: z.literal('list'),
    id: z.string(),
    title: z.string(),
    items: z.array(z.string()).max(60),
  }),
]);
export type DrillSection = z.infer<typeof drillSectionSchema>;

export const drillActionSchema = z.object({
  id: z.string(),
  label: z.string(),
  /**
   * link    — navigate to `href`
   * ask     — hand `ask` to the composer (the context-prompt bridge)
   * post    — fetch `endpoint` with `body`, then re-read the manifest
   * prompt  — a post that first asks for one line of text (`promptLabel`),
   *           sent as `body[promptField]`
   * confirm — a post behind a two-click confirm; for anything destructive
   */
  kind: z.enum(['link', 'ask', 'post', 'prompt', 'confirm']),
  href: z.string().optional(),
  endpoint: z.string().startsWith('/api/').optional(),
  method: z.enum(['POST', 'DELETE']).optional(),
  body: z.record(z.string(), z.unknown()).optional(),
  promptLabel: z.string().optional(),
  promptDefault: z.string().optional(),
  promptField: z.string().optional(),
  ask: z.object({ label: z.string(), detail: z.string() }).optional(),
  tone: z.enum(['default', 'danger']).optional(),
  disabled: z.boolean().optional(),
  /** Why it is disabled, or what it will do. */
  note: z.string().optional(),
  /** After a successful post: what else to refresh. */
  refresh: z.enum(['panel', 'graph', 'memory']).optional(),
});
export type DrillAction = z.infer<typeof drillActionSchema>;

/**
 * The thread's entities as a graph, for the 3D map. Every concept the thread
 * produced (not the rail's twelve), each in one of four classes — the two the
 * rail already distinguishes by hue (known / new here) crossed with whether it
 * is one of the seven the rail is drawing right now.
 */
export const drillGraphClassSchema = z.enum(['view-known', 'view-new', 'thread-known', 'thread-new']);
export type DrillGraphClass = z.infer<typeof drillGraphClassSchema>;
export const drillGraphSchema = z.object({
  nodes: z.array(z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    note: z.string().nullable(),
    mentions: z.number(),
    cls: drillGraphClassSchema,
    /** The entity drill this node opens. */
    drill: z.string().optional(),
  })).max(400),
  edges: z.array(z.object({
    source: z.string(),
    target: z.string(),
    verb: z.string(),
    typed: z.boolean(),
  })).max(4000),
});
export type DrillGraph = z.infer<typeof drillGraphSchema>;

/** Points to put on a map: a daydream place with its cluster radius, or a
 *  geocoded intel place. Lat/lon leave the server one drill at a time. */
export const drillMapSchema = z.object({
  points: z.array(z.object({
    lat: z.number(),
    lon: z.number(),
    label: z.string(),
    note: z.string().optional(),
    radiusM: z.number().optional(),
    tone: drillToneSchema.optional(),
    drill: z.string().optional(),
  })).min(1).max(60),
  /** What produced the coordinates — a geocoder's own label, or "you named it". */
  provenance: z.string().optional(),
});
export type DrillMap = z.infer<typeof drillMapSchema>;

export const drillManifestSchema = z.object({
  target: z.string(),
  kind: z.enum([
    'entity', 'entities', 'relations',
    'research-desk', 'research-run',
    'thoughts', 'thought', 'places', 'place',
    'memory', 'memories',
    'card',
  ]),
  eyebrow: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  href: z.string().optional(),
  /** Set for `entity` manifests: the modal mounts the intel EntityCard. */
  entityId: z.string().optional(),
  graph: drillGraphSchema.optional(),
  map: drillMapSchema.optional(),
  facts: z.array(drillFactSchema).max(8).default([]),
  sections: z.array(drillSectionSchema).max(8).default([]),
  actions: z.array(drillActionSchema).max(8).default([]),
  ask: z.object({ label: z.string(), detail: z.string() }).optional(),
});
export type DrillManifest = z.infer<typeof drillManifestSchema>;
