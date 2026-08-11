#!/usr/bin/env node
/**
 * studio-image.mjs — generate an illustration for a process the SVG kit
 * cannot draw, and write it into the build's own tree.
 *
 * Usage, from the workspace:
 *   node <repo>/scripts/studio-image.mjs \
 *     --prompt "a simple diagram showing rainwater moving from roof to drain to river" \
 *     --out assets/water-cycle.png
 *
 * WHEN TO USE IT, AND WHEN NOT TO
 *
 * The instruments in instruments.js are better than a generated image for
 * anything with numbers in it — a bar, a flow, a funnel, a timeline are exact,
 * on-brand, and the reader can operate them. A generated image cannot be
 * trusted with a quantity and must never carry one.
 *
 * Reach for this only when the thing being explained is physical, spatial or
 * atmospheric and a diagram would be worse: what a piece of equipment looks
 * like, how something is arranged in space, the feel of a place. Treat it as
 * an illustration, not as evidence.
 *
 * HOW IT WORKS
 *
 * Posts the subject to /api/jkai/studio/image, which draws it with a Gemini
 * image model through the site's LLM gateway and returns the bytes. The image
 * is written into your workspace, never hotlinked, so the explainer keeps
 * working regardless of what any third party does later.
 *
 * The free keyless service (pollinations.ai, as used by the deck editor) is
 * kept only as a fallback when the route is unreachable, and it is genuinely
 * worse at this: asked for "a simple side-view diagram of rainwater running
 * off a roof into a drain and out to a river" it drew a moody painting of two
 * roofs against a teal sky, with no drain, no river, and no process in it.
 * Free is right for decoration and wrong when the picture IS the explanation.
 *
 * The caption is not optional. Every generated image is labelled as
 * AI-generated in the markup this prints, for the same reason the deck editor
 * does it: a reader is entitled to know which pictures are real.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, extname } from 'node:path';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const prompt = arg('prompt');
const out = arg('out');
const width = Number(arg('width', '1200'));
const height = Number(arg('height', '675'));
const style = arg(
  'style',
  // The house look, appended so a build's illustrations are consistent with
  // one another and with the palette around them.
  'clean editorial illustration, flat vector style, muted warm cream background, deep petrol teal and burnt orange accents, generous negative space, no text, no lettering, no watermark',
);

if (!prompt || !out) {
  console.error(
    'studio-image: need both --prompt and --out.\n' +
      '  node scripts/studio-image.mjs --prompt "..." --out assets/thing.png\n' +
      '\nUse this only for physical or spatial subjects. For anything with a\n' +
      'number in it use the SVG instruments — they are exact and operable.',
  );
  process.exit(2);
}

const ext = extname(out).toLowerCase();
if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
  console.error(`studio-image: --out must end in .png, .jpg or .webp (got "${ext || 'nothing'}").`);
  process.exit(2);
}

console.error('studio-image: drawing…');

/** The good path: the site's own model, through the LLM gateway. */
async function viaGateway() {
  const api = process.env.JKAI_API_URL;
  const token = process.env.JKAI_BRIDGE_TOKEN;
  if (!api || !token) return { skip: 'JKAI_API_URL / JKAI_BRIDGE_TOKEN are not set in this shell' };
  const res = await fetch(`${api}/api/jkai/studio/image`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ subject: prompt }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) return { skip: `the image route returned ${res.status}: ${(await res.text()).slice(0, 200)}` };
  const type = res.headers.get('content-type') || '';
  if (!type.startsWith('image/')) return { skip: `the image route returned "${type}"` };
  return { buf: Buffer.from(await res.arrayBuffer()) };
}

/** The fallback: free, keyless, and markedly worse at diagrams. */
async function viaFreeService() {
  const url =
    `https://image.pollinations.ai/prompt/${encodeURIComponent(`${prompt}. ${style}`)}` +
    `?width=${width}&height=${height}&nologo=true`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(90_000),
    headers: { 'user-agent': 'strangeramblings.com jkai studio' },
  });
  if (!res.ok) throw new Error(`the free image service returned ${res.status}`);
  const type = res.headers.get('content-type') || '';
  if (!type.startsWith('image/')) throw new Error(`expected an image, got "${type}"`);
  return Buffer.from(await res.arrayBuffer());
}

let buf;
try {
  const primary = await viaGateway();
  if (primary.buf) {
    buf = primary.buf;
  } else {
    console.error(`studio-image: ${primary.skip} — falling back to the free service, which draws atmosphere rather than diagrams.`);
    buf = await viaFreeService();
  }
} catch (err) {
  console.error(
    `studio-image: could not generate an image (${err.message}).\n` +
      'Do NOT block the chapter on this and do not retry more than once — ' +
      'write the chapter with an SVG instrument instead.',
  );
  process.exit(1);
}
if (buf.length === 0) {
  console.error('studio-image: the service returned an empty image.');
  process.exit(1);
}

const target = resolve(process.cwd(), out);
await mkdir(dirname(target), { recursive: true });
await writeFile(target, buf);

const kb = Math.round(buf.length / 1024);
console.error(`studio-image: wrote ${out} (${kb}KB)`);

// Printed on stdout so the agent can paste it straight in. The path is
// project-root-relative with no leading slash, which is the only form that
// resolves on both surfaces a reader reaches.
const rel = out.replace(/^\.?\//, '');
const alt = prompt.replace(/"/g, '&quot;').slice(0, 180);
console.log(`<figure class="ex-figure">
  <img src="${rel}" alt="${alt}" width="${width}" height="${height}" loading="lazy">
  <figcaption>Illustration · AI-generated</figcaption>
</figure>`);
