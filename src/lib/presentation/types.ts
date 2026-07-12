// sr. decks — block + slide types. The zod schemas in registry.ts are the
// runtime source of truth; these interfaces are their TS mirror for components.
// Spec: docs/superpowers/specs/2026-07-11-decks-presentation-capability.md

export type BlockType =
  | 'masthead'
  | 'headline'
  | 'prose'
  | 'bigNumber'
  | 'statRow'
  | 'quote'
  | 'timeline'
  | 'image'
  | 'chart'
  | 'embed'
  | 'iframe';

export interface MastheadBlock {
  type: 'masthead';
  kicker?: string;
  title: string;
  thesis?: string;
  asks?: string[];
}

/** Editorial statement headline: kicker → headline → dek hierarchy. The
 *  bold assertive fact page — display type, not a paragraph. */
export interface HeadlineBlock {
  type: 'headline';
  kicker?: string;
  /** The statement itself — short, assertive, ≤ ~12 words. */
  text: string;
  /** One-line dek (supporting subline) under the statement. */
  dek?: string;
  align?: 'left' | 'center' | 'right';
}

export type ProseStyle =
  | 'body'
  | 'lede'
  | 'band'
  | 'cards'
  | 'aside'
  | 'pull'
  | 'columns'
  | 'callout';

/** Markdown-lite body: # …#### headings, **bold**, *italic*, __underline__,
 *  [text](url), blank-line paragraphs. `style` picks a preformatted register:
 *  body | lede (large opener) | band (full-width inverted emphasis band) |
 *  cards (each paragraph a bordered card) | aside (small mono footnote). */
export interface ProseBlock {
  type: 'prose';
  body: string;
  /** Legacy pre-style flag — equivalent to style: 'lede'. */
  lede?: boolean;
  style?: ProseStyle;
}

export interface BigNumberBlock {
  type: 'bigNumber';
  value: number;
  label: string;
  unit?: string;
  sub?: string;
  /** Decimal places for the count-up display (default 0). */
  dp?: number;
}

export interface StatRowBlock {
  type: 'statRow';
  stats: { n: string; label: string }[];
}

export interface QuoteBlock {
  type: 'quote';
  text: string;
  attribution?: string;
  url?: string;
}

export interface TimelineBlock {
  type: 'timeline';
  items: { year: string; label: string; detail?: string }[];
}

export interface ImageBlock {
  type: 'image';
  src: string;
  alt: string;
  caption?: string;
}

export type ChartKind = 'line' | 'bar' | 'area' | 'scatter' | 'slope' | 'donut' | 'sankey';

export interface ChartBlock {
  type: 'chart';
  kind: ChartKind;
  title?: string;
  /** For line/bar/area/scatter/slope. Slope reads each series' first and last point. */
  series?: { label: string; points: { x: number; y: number }[] }[];
  /** For donut: labelled shares of a whole. */
  segments?: { label: string; value: number }[];
  /** For sankey: acyclic from→to flows. */
  flows?: { from: string; to: string; value: number }[];
  xLabel?: string;
  yLabel?: string;
  /** Categorical x-axis labels, indexed by each distinct x value's rank
   *  (bar charts: "Arbor", "SIMS"… instead of 0, 1…; slope: the two ends). */
  xLabels?: string[];
}

/** A registered interactive from $lib/presentation/embeds.ts. */
export interface EmbedBlock {
  type: 'embed';
  embed: string;
  config?: Record<string, unknown>;
}

/** Site-relative URL only — embeds existing dynamic pages as a fallback. */
export interface IframeBlock {
  type: 'iframe';
  src: string;
  title: string;
  height?: number;
}

export type Block =
  | MastheadBlock
  | HeadlineBlock
  | ProseBlock
  | BigNumberBlock
  | StatRowBlock
  | QuoteBlock
  | TimelineBlock
  | ImageBlock
  | ChartBlock
  | EmbedBlock
  | IframeBlock;

import type { SlideLayoutId } from './layouts';

export type SlideLayout = SlideLayoutId;

/** What the player load returns per slide (DeckSlide row, blocks typed). */
export interface SlideNode {
  id: string;
  parentSlideId: string | null;
  position: number;
  title: string | null;
  layout: SlideLayout;
  blocks: Block[];
  hasChildren: boolean;
  /** Names the journey into this slide's children (the pill text). */
  journeyLabel: string | null;
  /** Manual-arrange overrides: block index → frame in % of the stage.
   *  Present = the slide is hand-laid; absent = the layout archetype rules. */
  geometry: Record<string, BlockFrame> | null;
}

export interface BlockFrame {
  x: number;
  y: number;
  w: number;
}

export interface DeckMeta {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  theme: string;
}
