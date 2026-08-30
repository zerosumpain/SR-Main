/**
 * Article imagery — the style vocabulary and the prompt composer.
 *
 * Pure and dependency-free, so the editor can show exactly the prompt that will
 * be sent before spending anything on it. A generation the author cannot
 * preview the prompt of is a slot machine.
 *
 * THE SPLIT THAT MATTERS. Two halves make a prompt and they come from different
 * places:
 *
 *   SUBJECT — what the picture is OF. Only the article knows this, so a model
 *             reads the post and drafts it (see ./image-gen.server).
 *   STYLE   — how it is drawn. This is a fixed vocabulary, written out below,
 *             and never generated.
 *
 * Keeping style deterministic is what makes the feature usable rather than a
 * novelty: the same theme gives the same look across every post on the blog, an
 * author can compare two themes over one subject, and a bad result is
 * attributable to the subject line the author can edit rather than to a phrase
 * a model invented that nobody can see. It is the same "rules decide, the model
 * only phrases" split the daydream engine and the writing desk both use.
 */

export const IMAGE_ASPECTS = ['16:9', '4:3', '1:1', '3:4', '9:16'] as const;
export type ImageAspect = (typeof IMAGE_ASPECTS)[number];

/** A cover sits above a full-bleed column; wide is nearly always right. */
export const DEFAULT_ASPECT: ImageAspect = '16:9';

export type ImageStyle = {
  key: string;
  label: string;
  /** One line for the picker. */
  hint: string;
  /**
   * Appended to the subject. Written as a description of the IMAGE, not as an
   * instruction to the model — image models respond to "a photograph of…"
   * far more reliably than to "draw me a photograph".
   */
  fragment: string;
};

/**
 * The themes.
 *
 * `editorial` leads and is the default. The reading surface is warm cream with
 * a burnt-orange accent and a heavy display face; a stock-photograph cover
 * fights all three, where a flat editorial illustration sits inside the design
 * rather than on top of it. The photographic themes are still here because a
 * post about a real place or object wants a real picture — the default is a
 * default, not a rule.
 */
export const IMAGE_STYLES: readonly ImageStyle[] = [
  {
    key: 'editorial',
    label: 'Editorial illustration',
    hint: 'Flat, limited palette — sits inside the site design. Default.',
    fragment:
      'Editorial illustration in the style of a broadsheet weekend supplement. Flat vector shapes, ' +
      'no gradients, a deliberately limited palette of warm cream, burnt orange and deep charcoal ' +
      'with one petrol-blue accent. Bold simple forms, generous negative space, subtle paper grain. ' +
      'Conceptual rather than literal. No text, no lettering, no logos.',
  },
  {
    key: 'photoreal',
    label: 'Photorealistic',
    hint: 'A real photograph — natural light, shallow depth of field.',
    fragment:
      'A photorealistic photograph. Natural available light, shallow depth of field, 35mm lens, ' +
      'muted natural colour grading, fine film grain. Documentary framing, nothing staged. ' +
      'No text, no watermark.',
  },
  {
    key: 'tilt-shift',
    label: 'Tilt-shift',
    hint: 'Miniature-model effect — a real scene made to look like a diorama.',
    fragment:
      'A tilt-shift photograph taken from a high vantage point, making the scene look like a ' +
      'miniature model. Extremely shallow plane of focus with strong blur above and below a sharp ' +
      'central band, highly saturated colour, bright even daylight. No text.',
  },
  {
    key: 'animation',
    label: 'Animation',
    hint: 'Hand-drawn animated film — clean linework, painted backgrounds.',
    fragment:
      'A frame from a hand-drawn animated film. Clean confident linework, flat cel shading, ' +
      'lush painted background, warm cinematic light. Expressive and uncluttered. ' +
      'No text, no subtitles.',
  },
  {
    key: 'isometric',
    label: 'Isometric',
    hint: 'Technical, systems-y — good for anything with parts.',
    fragment:
      'A clean isometric illustration on a plain background. Precise 2:1 isometric projection, ' +
      'flat colour with soft ambient occlusion, muted palette with a single warm accent. ' +
      'Every component clearly separated and legible. No text, no labels.',
  },
  {
    key: 'blueprint',
    label: 'Blueprint',
    hint: 'Technical drawing — white line on deep blue.',
    fragment:
      'A technical blueprint drawing. Fine white and pale-cyan linework on a deep Prussian blue ' +
      'ground, orthographic projection, construction lines, hatching and dimension marks. ' +
      'Drafted rather than rendered. No readable text or annotation.',
  },
  {
    key: 'risograph',
    label: 'Risograph',
    hint: 'Two-colour print — visible misregistration and texture.',
    fragment:
      'A two-colour risograph print in fluorescent orange and deep blue on off-white paper. ' +
      'Visible halftone dots, slight ink misregistration, blotchy uneven coverage, coarse texture. ' +
      'Bold simplified shapes. No text.',
  },
  {
    key: 'watercolour',
    label: 'Watercolour',
    hint: 'Loose and wet — soft edges, visible paper.',
    fragment:
      'A loose watercolour painting on cold-pressed paper. Wet-on-wet bleeding, soft undefined ' +
      'edges, pooling pigment, visible paper texture and generous white space. ' +
      'Restrained palette. No text.',
  },
  {
    key: 'noir',
    label: 'Noir',
    hint: 'High-contrast black and white, hard shadows.',
    fragment:
      'A high-contrast black and white photograph in the film-noir tradition. Hard directional ' +
      'light, deep crushed blacks, blown highlights, long dramatic shadows and strong diagonals. ' +
      'Heavy grain. No text.',
  },
];

export const DEFAULT_STYLE = 'editorial';

export function findStyle(key: unknown): ImageStyle {
  const found = IMAGE_STYLES.find((s) => s.key === key);
  // An unrecognised key resolves to the default rather than throwing. This is
  // on the generation path, and refusing to draw because a stale key arrived
  // from an old tab is a worse failure than drawing in the house style.
  return found ?? IMAGE_STYLES.find((s) => s.key === DEFAULT_STYLE)!;
}

export function isAspect(value: unknown): value is ImageAspect {
  return typeof value === 'string' && (IMAGE_ASPECTS as readonly string[]).includes(value);
}

/** Subjects longer than this stop steering the image and start diluting it. */
export const MAX_SUBJECT_LENGTH = 600;

/**
 * Compose the final prompt.
 *
 * Subject first, style second, and that order is deliberate: these models weight
 * the opening of a prompt most heavily, so leading with the style produces nine
 * variations of the style and one nod to the article.
 */
export function composePrompt(subject: string, styleKey: string): string {
  const cleaned = subject.replace(/\s+/g, ' ').trim().slice(0, MAX_SUBJECT_LENGTH);
  if (!cleaned) return '';
  const style = findStyle(styleKey);
  // A trailing full stop before the style fragment, so the two halves read as
  // two sentences rather than running together into one noun phrase.
  const stem = /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
  return `${stem}\n\n${style.fragment}`;
}

/**
 * The instruction the drafting model gets when reading an article.
 *
 * It asks for a SCENE, not a summary. The failure mode this is written against
 * is a model that returns "an illustration about artificial intelligence and
 * personal websites" — a topic label, which produces a stock image of a glowing
 * brain. Naming concrete objects is what produces a picture worth looking at.
 */
export const BRIEF_SYSTEM_PROMPT = `You read a blog post and describe ONE image to sit at the top of it.

Return a single sentence describing a concrete visual SCENE. Name real, specific, physical things — objects, places, materials, light, a moment.

Rules:
- NEVER describe the topic ("an image about machine learning"). Describe a scene.
- NEVER include a style, medium, camera, palette or artist. Those are chosen separately and yours would fight them.
- NEVER include text, words, letters, signage, logos or a title in the scene.
- NEVER depict a real identifiable person.
- Prefer the specific over the general: one workbench, not "technology"; a rained-on platform at dusk, not "travel".
- If the post is abstract, choose a physical metaphor with real objects in it.
- One sentence. Under 45 words. No preamble, no quotes, no explanation.`;

/**
 * Strip the things a drafting model adds despite being told not to.
 *
 * Every one of these has been observed from instruction-following models in
 * this codebase: wrapping quotes, a "Sure, here's..." preamble, and a trailing
 * style clause it was explicitly told to omit. Cheaper to remove than to
 * re-prompt.
 */
export function cleanBrief(raw: string): string {
  let s = (raw ?? '').trim();
  s = s.replace(/^(?:sure|certainly|here(?:'s| is))\b[^\n]*?[:\n]/i, '').trim();
  s = s.replace(/^["'“”']+|["'“”']+$/g, '').trim();
  // A leading "Image:" / "Scene:" label.
  s = s.replace(/^(?:image|scene|prompt|description)\s*:\s*/i, '').trim();
  s = s.replace(/\s+/g, ' ');
  return s.slice(0, MAX_SUBJECT_LENGTH);
}
