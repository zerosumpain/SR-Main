import { z } from 'zod';

/**
 * The desk: the right-hand half of /jkai.
 *
 * A desk PAGE belongs to one assistant message. It is a document — sections of
 * blocks on a 12-column grid — rather than a list of fixed card types, so a new
 * presentation is a new arrangement of primitives, not a new component. Pages
 * are built by ops (`PanelOp`) streamed while the turn runs, reduced by
 * `applyPanelOp` on both sides of the wire, and persisted on the assistant
 * row as `metadata.panel` so a reload restores exactly what was seen.
 *
 * Every block shares one envelope. `title`/`note`/`foot` turn a block into a
 * card; without them it renders bare. `source` says which tool call or composer
 * made it (shown as provenance). `ask` hands a prompt to the composer, `drill`
 * opens a ContextDrillModal manifest, `href` links out.
 *
 * Proposal + mock: https://claude.ai/artifact/WaBF4AJ5dxHs3BJPAH5my6
 *
 * SHARED, byte for byte, with SR-Main (`shared-with-main.json` here,
 * `shared-with-extracted.json` there): Main's `show_in_panel` tool validates
 * the model's page against this file, Core draws it. Change one, copy to the
 * other and re-record both hashes. That is why it imports nothing but zod.
 */

/**
 * Links a block may carry: absolute http(s) or a site-relative path. A model
 * writes some of these pages (`show_in_panel`), so `javascript:` and
 * protocol-relative `//host` are refused here, for every producer at once.
 */
const safeHref = z.string().max(2000).refine((h) => /^(https?:\/\/|\/(?!\/))/i.test(h), 'href must be http(s) or a site path');

const tone = z.enum(['default', 'good', 'warn', 'bad', 'accent']);
export type PanelTone = z.infer<typeof tone>;

const askSchema = z.object({ label: z.string().max(120), detail: z.string().max(2000) });

const envelope = {
  id: z.string().min(1).max(120),
  /** Columns of the desk's 12-column grid. Collapses to 12 on a narrow desk. */
  span: z.union([z.literal(12), z.literal(8), z.literal(6), z.literal(4)]).default(12),
  title: z.string().max(140).optional(),
  note: z.string().max(140).optional(),
  foot: z.string().max(600).optional(),
  source: z.string().max(140).optional(),
  href: safeHref.optional(),
  drill: z.string().max(400).optional(),
  ask: askSchema.optional(),
};

const finite = z.number().finite();

export const figuresBlockSchema = z.object({
  ...envelope,
  type: z.literal('figures'),
  items: z.array(z.object({
    label: z.string().max(40),
    value: z.string().max(24),
    unit: z.string().max(16).optional(),
    /** A short change reading: "▲ 9", "flat", "2 need you". */
    delta: z.string().max(32).optional(),
    /** up = teal, down = accent — the /health/analytics convention, never good/error. */
    direction: z.enum(['up', 'down', 'flat']).optional(),
    spark: z.array(finite).max(60).optional(),
    tone: tone.optional(),
  })).min(1).max(6),
});

export const seriesBlockSchema = z.object({
  ...envelope,
  type: z.literal('series'),
  unit: z.string().max(24).optional(),
  /** Totals anchor at zero; averages never do (the analytics rule). */
  zero: z.boolean().default(false),
  series: z.array(z.object({
    key: z.string().max(60),
    label: z.string().max(60),
    points: z.array(z.object({ x: z.string().max(40), y: finite })).min(1).max(400),
  })).min(1).max(3),
});

export const barsBlockSchema = z.object({
  ...envelope,
  type: z.literal('bars'),
  rows: z.array(z.object({
    id: z.string().max(120),
    label: z.string().max(80),
    value: finite.nonnegative(),
    display: z.string().max(32).optional(),
    highlight: z.boolean().optional(),
    href: safeHref.optional(),
    drill: z.string().max(400).optional(),
  })).min(1).max(16),
});

export const heatBlockSchema = z.object({
  ...envelope,
  type: z.literal('heat'),
  columns: z.array(z.string().max(24)).min(1).max(24),
  rows: z.array(z.object({ label: z.string().max(24), values: z.array(finite.nullable()).max(24) })).min(1).max(24),
  unit: z.string().max(24).optional(),
});

export const rowsBlockSchema = z.object({
  ...envelope,
  type: z.literal('rows'),
  /** Numbered rows read as a ranking or a sequence; unnumbered as a list. */
  numbered: z.boolean().default(false),
  rows: z.array(z.object({
    id: z.string().max(200),
    title: z.string().max(240),
    sub: z.string().max(400).optional(),
    meta: z.string().max(60).optional(),
    tone: tone.optional(),
    href: safeHref.optional(),
    /** `href` is off-site: open in a new tab. */
    external: z.boolean().optional(),
    drill: z.string().max(400).optional(),
    ask: askSchema.optional(),
  })).max(40),
  /** Shown instead of an empty list, so "nothing" is a statement. */
  empty: z.string().max(200).optional(),
});

export const tableBlockSchema = z.object({
  ...envelope,
  type: z.literal('table'),
  columns: z.array(z.string().max(60)).min(1).max(12),
  rows: z.array(z.array(z.union([z.string().max(400), finite, z.null()])).max(12)).max(200),
  /** Column index to tint as the pick. */
  pick: z.number().int().min(0).max(11).optional(),
});

export const timelineBlockSchema = z.object({
  ...envelope,
  type: z.literal('timeline'),
  events: z.array(z.object({
    id: z.string().max(200),
    when: z.string().max(40),
    what: z.string().max(240),
    sub: z.string().max(240).optional(),
    hot: z.boolean().optional(),
    href: safeHref.optional(),
  })).min(1).max(40),
});

export const kvBlockSchema = z.object({
  ...envelope,
  type: z.literal('kv'),
  items: z.array(z.object({ label: z.string().max(60), value: z.string().max(200), tone: tone.optional() })).min(1).max(24),
});

export const proseBlockSchema = z.object({
  ...envelope,
  type: z.literal('prose'),
  /** Markdown, rendered through the chat's own sanitising renderer. */
  markdown: z.string().max(4000),
  tone: tone.optional(),
});

export const entityBlockSchema = z.object({
  ...envelope,
  type: z.literal('entity'),
  entityId: z.string().max(120),
  name: z.string().max(200),
  kind: z.string().max(60).optional(),
  summary: z.string().max(600).optional(),
});

/** Any chat artifact (`render_chart`/`render_table`/`render_diagram`), rendered by the existing Artifact component. */
export const artifactBlockSchema = z.object({
  ...envelope,
  type: z.literal('artifact'),
  /** Validated with `isArtifact` at the projector; kept opaque here to avoid duplicating that contract. */
  artifact: z.record(z.string(), z.unknown()),
});

/**
 * A button. The same vocabulary as the drill modal's actions
 * (`context-panel/types.ts` drillActionSchema), restated here so this file
 * stays self-contained.
 *
 * link    — navigate to `href`
 * ask     — hand `ask` to the composer
 * post    — fetch `endpoint` with `body`
 * prompt  — a post that first asks for one line of text
 * confirm — a post behind a two-click confirm
 *
 * A MODEL-authored page may only carry `link` and `ask` (`MODEL_ACTION_KINDS`):
 * a button that posts to the site's API, written by a model that may have just
 * read a hostile web page, is a prompt-injection route to a destructive call.
 */
export const panelActionSchema = z.object({
  id: z.string().max(120),
  label: z.string().max(80),
  kind: z.enum(['link', 'ask', 'post', 'prompt', 'confirm']),
  href: safeHref.optional(),
  endpoint: z.string().startsWith('/api/').max(400).optional(),
  method: z.enum(['POST', 'DELETE']).optional(),
  body: z.record(z.string(), z.unknown()).optional(),
  promptLabel: z.string().max(120).optional(),
  promptDefault: z.string().max(400).optional(),
  promptField: z.string().max(60).optional(),
  ask: askSchema.optional(),
  tone: z.enum(['default', 'danger']).optional(),
  disabled: z.boolean().optional(),
  note: z.string().max(200).optional(),
  refresh: z.enum(['panel', 'graph', 'memory']).optional(),
});
export type PanelAction = z.infer<typeof panelActionSchema>;

export const MODEL_ACTION_KINDS: ReadonlySet<PanelAction['kind']> = new Set(['link', 'ask']);

export const actionsBlockSchema = z.object({
  ...envelope,
  type: z.literal('actions'),
  items: z.array(panelActionSchema).min(1).max(6),
});

const leafBlockSchema = z.discriminatedUnion('type', [
  figuresBlockSchema,
  seriesBlockSchema,
  barsBlockSchema,
  heatBlockSchema,
  rowsBlockSchema,
  tableBlockSchema,
  timelineBlockSchema,
  kvBlockSchema,
  proseBlockSchema,
  entityBlockSchema,
  artifactBlockSchema,
  actionsBlockSchema,
]);
export type PanelLeafBlock = z.infer<typeof leafBlockSchema>;

/** A nested 12-column grid — how a bespoke layout is expressed without a new block type. One level deep. */
export const groupBlockSchema = z.object({
  ...envelope,
  type: z.literal('group'),
  blocks: z.array(leafBlockSchema).min(1).max(12),
});

export const panelBlockSchema = z.union([leafBlockSchema, groupBlockSchema]);
export type PanelBlock = z.infer<typeof panelBlockSchema>;
export type PanelBlockInput = z.input<typeof panelBlockSchema>;
export type PanelBlockType = PanelBlock['type'];

export const panelSectionSchema = z.object({
  id: z.string().min(1).max(60),
  /** Mono section label. Empty = no label row. */
  label: z.string().max(60).default(''),
  blocks: z.array(panelBlockSchema).max(24),
});
export type PanelSection = z.infer<typeof panelSectionSchema>;

/**
 * Who filled the page. Ordered by priority: a block from a higher producer wins
 * its id. `quiet` marks a turn that produced nothing — the desk holds the
 * previous substantive page and says so.
 */
export const panelProducerSchema = z.enum(['model', 'turn', 'context', 'thread', 'today']);
export type PanelProducer = z.infer<typeof panelProducerSchema>;

export const panelHeadSchema = z.object({
  /** Mono kicker: what made the page ("THIS TURN", "HEALTH", "TODAY"). */
  kicker: z.string().max(60),
  /** Router domains or anchors, shown muted after the kicker. */
  context: z.array(z.string().max(40)).max(6).default([]),
  title: z.string().max(120),
  standfirst: z.string().max(240).optional(),
});
export type PanelHead = z.infer<typeof panelHeadSchema>;

export const panelPageSchema = z.object({
  version: z.literal(1).default(1),
  producer: panelProducerSchema,
  head: panelHeadSchema,
  sections: z.array(panelSectionSchema).max(12),
  /** The turn called no tool that produced a block and the router said casual/meta. */
  quiet: z.boolean().default(false),
});
export type PanelPage = z.infer<typeof panelPageSchema>;

/**
 * The stream ops. Idempotent by block id so a reconnecting SSE replay is safe:
 * an upsert replaces the block with the same id wherever it sits.
 */
export const panelOpSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('head'), head: panelHeadSchema, producer: panelProducerSchema.optional() }),
  z.object({ kind: z.literal('upsert'), section: z.string().min(1).max(60), sectionLabel: z.string().max(60).optional(), block: panelBlockSchema }),
  z.object({ kind: z.literal('remove'), id: z.string() }),
  z.object({ kind: z.literal('quiet') }),
  /** Clear every section. Lets a producer rebuild the page in a new order (a model page leads, tool blocks follow). */
  z.object({ kind: z.literal('reset') }),
]);
export type PanelOp = z.infer<typeof panelOpSchema>;

/** Validate one block; a block that fails is dropped by the caller, never the page. */
export function parseBlock(input: unknown): PanelBlock | null {
  const r = panelBlockSchema.safeParse(input);
  return r.success ? r.data : null;
}

export function parsePage(input: unknown): PanelPage | null {
  const r = panelPageSchema.safeParse(input);
  return r.success ? r.data : null;
}

export function emptyPage(head: PanelHead, producer: PanelProducer = 'turn'): PanelPage {
  return { version: 1, producer, head: { ...head, context: head.context ?? [] }, sections: [], quiet: false };
}
