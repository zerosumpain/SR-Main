/**
 * Generate an explanatory illustration for a studio chapter.
 *
 * WHY A MODEL AND NOT THE FREE SERVICE
 *
 * The first version of this used pollinations.ai, keyless and free, following
 * the precedent in $lib/decks/image-sources.server.ts. Tested against the
 * actual ask — "a simple side-view diagram of rainwater running off a roof
 * into a drain and out to a river" — it produced a moody painting of two roofs
 * against a teal sky, with no drain, no river and no process in it. Free is
 * the right default for deck imagery, where the picture is decoration. It is
 * the wrong default here, where the picture is the explanation.
 *
 * Gemini's image models draw labelled diagrams competently and cost fractions
 * of a penny. The call goes through $lib/jkai/llm-client like every other LLM
 * call on the site — no direct provider SDK.
 *
 * WHAT THIS IS FOR
 *
 * Processes and physical arrangements that the SVG instruments cannot draw. It
 * must never carry a quantity: a bar chart is exact and operable, a generated
 * picture is neither, and a model will happily draw a plausible-looking axis
 * with invented numbers on it. That rule is enforced in the prompt below and
 * stated again in the kit docs.
 */
import { getLLMClient } from './llm-client';
import { coerceModelContext } from '$lib/constants/default-models';

/**
 * Cheap, fast, and good at labelled diagrams. Not the site default — the
 * default is a text model and cannot return an image at all.
 */
export const STUDIO_IMAGE_MODEL = 'google/gemini-3.1-flash-image';

/** Bytes plus the mime type, ready to write to a file. */
export interface GeneratedImage {
  bytes: Buffer;
  mime: string;
}

/**
 * House style, appended to every request so a build's illustrations look like
 * each other and like the page around them. Palette matches tokens.css.
 */
const STYLE =
  'Clean editorial explanatory diagram in a flat vector style. ' +
  'Warm cream background (#f2ead9), deep petrol teal (#0e5b66) as the primary colour, ' +
  'burnt orange (#c4570a) used sparingly for one emphasis only, dark warm ink (#1a1008) for outlines. ' +
  'Clear left-to-right or top-to-bottom reading order, generous negative space, no drop shadows, no gradients, no 3D. ' +
  'Label the parts with short words where labels help. ' +
  'Do NOT invent numbers, axes, charts, percentages or data of any kind.';

export function buildImagePrompt(subject: string): string {
  return `${subject.trim()}\n\n${STYLE}`;
}

/**
 * Pull the image out of an OpenRouter chat completion.
 *
 * Images come back on `message.images[].image_url.url` as a data URI. Shape is
 * defensive because this is a newer part of the API than the text path and a
 * silent undefined here would write a zero-byte PNG that renders as a broken
 * image and passes any check that only asks whether a file exists.
 */
export function extractImage(message: unknown): GeneratedImage | null {
  const images = (message as { images?: Array<{ image_url?: { url?: string } }> } | null)?.images;
  const url = Array.isArray(images) ? images[0]?.image_url?.url : undefined;
  if (typeof url !== 'string') return null;
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(url);
  if (!match) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length === 0) return null;
  return { bytes, mime: match[1].toLowerCase() };
}

export async function generateExplainerImage(subject: string): Promise<GeneratedImage> {
  if (!subject || !subject.trim()) throw new Error('no subject given');

  const { client, model } = await getLLMClient(
    coerceModelContext({ provider: 'openrouter', modelId: STUDIO_IMAGE_MODEL }),
  );

  const completion = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: buildImagePrompt(subject) }],
    // Non-standard but OpenRouter-supported: without it the model answers in
    // prose describing the picture it would have drawn.
    modalities: ['image', 'text'],
  } as Parameters<typeof client.chat.completions.create>[0]);

  const image = extractImage(
    (completion as { choices?: Array<{ message?: unknown }> }).choices?.[0]?.message,
  );
  if (!image) {
    throw new Error(
      `${model} returned no image. This model can refuse a subject it reads as a real person or event; rephrase in the abstract, or use an SVG instrument instead.`,
    );
  }
  return image;
}
