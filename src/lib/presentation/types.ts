// sr. decks — block + slide types. The zod schemas in registry.ts are the
// runtime source of truth; these interfaces are their TS mirror for components.
// Spec: docs/superpowers/specs/2026-07-11-decks-presentation-capability.md
//
// Every CONTENT block accepts an optional `step` (1–12): a build step — the
// block stays hidden until the presenter's Nth forward press within the slide
// (see steps.ts). Effect blocks are atmosphere, not content, so they don't.

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
  | 'code'
  | 'video'
  | 'effect'
  | 'embed'
  | 'iframe';

export interface MastheadBlock {
  type: 'masthead';
  kicker?: string;
  title: string;
  thesis?: string;
  asks?: string[];
  step?: number;
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
  step?: number;
}

export type ProseStyle =
  | 'body'
  | 'lede'
  | 'band'
  | 'cards'
  | 'aside'
  | 'pull'
  | 'columns'
  | 'callout'
  | 'numbered'
  | 'ledger'
  | 'interview'
  | 'manifesto'
  | 'verse'
  | 'checklist';

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
  step?: number;
}

export interface BigNumberBlock {
  type: 'bigNumber';
  value: number;
  label: string;
  unit?: string;
  sub?: string;
  /** Decimal places for the count-up display (default 0). */
  dp?: number;
  step?: number;
}

export interface StatRowBlock {
  type: 'statRow';
  stats: { n: string; label: string }[];
  step?: number;
}

export type QuoteStyle = 'rail' | 'pull' | 'boxed';

export interface QuoteBlock {
  type: 'quote';
  text: string;
  attribution?: string;
  url?: string;
  /** rail (default accent left rail) | pull (huge centered) | boxed (inset card). */
  style?: QuoteStyle;
  step?: number;
}

export interface TimelineBlock {
  type: 'timeline';
  items: { year: string; label: string; detail?: string }[];
  step?: number;
}

export interface ImageBlock {
  type: 'image';
  src: string;
  alt: string;
  caption?: string;
  step?: number;
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
  step?: number;
}

/** Syntax-highlighted source panel (Shiki, editorial framing). */
export interface CodeBlock {
  type: 'code';
  code: string;
  /** Shiki language id (ts, python, bash, json…); unknown ids render plain. */
  lang?: string;
  /** Mono header label above the panel — usually a filename. */
  title?: string;
  caption?: string;
  step?: number;
}

/** Motion figure: a site-hosted mp4/webm (e.g. an uploaded
 *  /api/blog/images/deck-media/… file) or a YouTube/Vimeo URL rendered as a
 *  privacy-enhanced embed. See video.ts for the accepted shapes. */
export interface VideoBlock {
  type: 'video';
  src: string;
  caption?: string;
  /** File videos only: start playing (muted) when the slide arrives. */
  autoplay?: boolean;
  loop?: boolean;
  /** File videos only: poster image shown before play. */
  poster?: string;
  step?: number;
}

/** A registered effect from $lib/presentation/effects.ts — a Three.js
 *  particle simulation (or the live ECG) behind the slide's content
 *  (role "background") or played as the camera move in (role "transition"). */
export interface EffectBlock {
  type: 'effect';
  effect: string;
  role: 'background' | 'transition';
  /** 0.1–1, how present the effect is (default 0.5). */
  intensity?: number;
  tint?: 'ink' | 'accent' | 'petrol';
}

/** A registered interactive from $lib/presentation/embeds.ts. */
export interface EmbedBlock {
  type: 'embed';
  embed: string;
  config?: Record<string, unknown>;
  step?: number;
}

/** Site-relative URL only — embeds existing dynamic pages as a fallback. */
export interface IframeBlock {
  type: 'iframe';
  src: string;
  title: string;
  height?: number;
  step?: number;
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
  | CodeBlock
  | VideoBlock
  | EffectBlock
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

/** The slide stage's fixed design size, logical px. Slides are laid out at
 *  exactly this size everywhere (player, editor canvas, print/PDF) and then
 *  uniformly transform-scaled to fit their host — resizing the window scales
 *  the whole composition in proportion instead of reflowing it. */
export const STAGE_W = 1280;
export const STAGE_H = 720;
