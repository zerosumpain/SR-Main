/**
 * The curated face a promoted build wears on /projects.
 *
 * A published build used to render its own row verbatim: `title` as the
 * heading and the whole `prompt` as the blurb. The prompt is the instruction
 * that was typed to START the build ("build me a tool that…"), so the card read
 * as a work order sitting next to hand-written field studies. Promotion lets
 * those three strings be written properly, and stores them beside the build.
 *
 * Both ends of the trip live here — the API's validation and the page's
 * fallbacks — so a card can never be accepted in a shape the page won't render.
 */

/** Long enough for a real sentence of a heading, short enough not to reflow the grid. */
const MAX_TITLE = 120;
/** The card clamps to three lines; past ~400 chars the rest is never seen. */
const MAX_BLURB = 400;
/** The small right-hand line — "Interactive · Pay data". */
const MAX_TAG = 60;

export interface ProjectCardFields {
  cardTitle: string | null;
  cardBlurb: string | null;
  cardTag: string | null;
}

export type CardParseResult =
  | { ok: true; fields: Partial<ProjectCardFields> }
  | { ok: false; error: string };

const LIMITS: Array<[keyof ProjectCardFields, string, number]> = [
  ['cardTitle', 'title', MAX_TITLE],
  ['cardBlurb', 'blurb', MAX_BLURB],
  ['cardTag', 'tag', MAX_TAG],
];

/**
 * Pull the card fields out of a request body.
 *
 * A key that isn't present is left alone rather than nulled — the plain Publish
 * button posts only a slug and must not wipe a card someone curated. An empty
 * string IS meaningful: it clears the field back to the automatic fallback.
 */
export function normaliseCardFields(body: unknown): CardParseResult {
  const src = (body ?? {}) as Record<string, unknown>;
  const fields: Partial<ProjectCardFields> = {};

  for (const [key, label, max] of LIMITS) {
    if (!(key in src)) continue;
    const raw = src[key];
    if (raw === null) {
      fields[key] = null;
      continue;
    }
    if (typeof raw !== 'string') {
      return { ok: false, error: `${label} must be text` };
    }
    const trimmed = raw.trim();
    if (trimmed.length > max) {
      return { ok: false, error: `${label} is ${trimmed.length} characters — the limit is ${max}` };
    }
    fields[key] = trimmed || null;
  }

  return { ok: true, fields };
}

export interface PromotedBuild {
  title: string | null;
  prompt: string;
  cardTitle?: string | null;
  cardBlurb?: string | null;
  cardTag?: string | null;
  iterationsCompleted?: number | null;
}

export interface ResolvedProjectCard {
  heading: string;
  blurb: string;
  /** Null when nothing was curated — the card then shows its date instead. */
  tag: string | null;
  /** False while the card is still showing the build's own prompt. */
  curated: boolean;
}

/**
 * What the card actually renders, curated values winning over the automatic
 * ones. The fallbacks are exactly what /projects did before promotion existed,
 * so every card published up to now looks unchanged until it is edited.
 */
export function resolveProjectCard(build: PromotedBuild): ResolvedProjectCard {
  const heading = build.cardTitle?.trim() || build.title?.trim() || build.prompt.slice(0, 40);
  const blurb = build.cardBlurb?.trim() || build.prompt;
  const tag = build.cardTag?.trim() || null;
  return {
    heading,
    blurb,
    tag,
    curated: Boolean(build.cardTitle?.trim() || build.cardBlurb?.trim()),
  };
}
