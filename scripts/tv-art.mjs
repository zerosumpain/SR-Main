#!/usr/bin/env node
/**
 * tv-art.mjs — paint sr. tv's background pictures (static/tv-art/*.webp).
 *
 * Run by hand, once per new picture; the pictures are committed and served as
 * plain files, so nothing here runs on the site. Each costs one OpenRouter
 * image call (OpenAI's image model, about $0.22 each).
 *
 *   OPENROUTER_API_KEY=… node scripts/tv-art.mjs [name …]
 *
 * The key falls back to keys.json's `openrouterApiKey`. The TV shows each
 * picture at 22% behind a dark wash (TvStage .tv-art), so the prompts ask for
 * dark, quiet paintings with the interest on the right, away from the words.
 * Needs ffmpeg (with libwebp) on the PATH.
 */
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

// openai/gpt-5-image answered with no image at all (2026-11-03); this one paints.
const MODEL = 'openai/gpt-5.4-image-2';
const STYLE =
  'Painterly gouache illustration, warm and quiet, deep browns, umber and cream with small burnt-orange highlights and a touch of muted teal. ' +
  'Low evening light. Most of the picture is dark; the left third is almost empty shadow. Soft edges, visible brush texture. ' +
  'No people’s faces, no text, no letters, no logos, no watermark. Wide 3:2 landscape.';

const PICTURES = {
  menu: 'A cosy terraced-house living room in Darlington at dusk: a lamp glowing on a side table, a sofa in shadow, a board game half set up on the coffee table, a model steam locomotive on the bookshelf, rain on the window.',
  lobby: 'Seen from above, a kitchen table at night under one warm pendant light: scattered letter tiles, a few playing cards, a plate of biscuits, two mugs of tea and a teapot, phones face down.',
  link: 'A stone railway viaduct crossing a North East England valley at night, a lit train crossing it, amber glow on the horizon, moorland in silhouette.',
};

async function key() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const keys = JSON.parse(await readFile(resolve(process.cwd(), 'keys.json'), 'utf8').catch(() => '{}'));
  if (!keys.openrouterApiKey) throw new Error('Set OPENROUTER_API_KEY (or run from a checkout with keys.json)');
  return keys.openrouterApiKey;
}

async function paint(name, apiKey) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'x-title': 'sr. tv art' },
    body: JSON.stringify({ model: MODEL, modalities: ['image', 'text'], messages: [{ role: 'user', content: `${PICTURES[name]} ${STYLE}` }] }),
  });
  if (!res.ok) throw new Error(`${name}: OpenRouter ${res.status} ${(await res.text()).slice(0, 300)}`);
  const out = await res.json();
  const url = out.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url?.startsWith('data:image/')) throw new Error(`${name}: no image in the answer (${String(out.choices?.[0]?.message?.content ?? out.error?.message ?? '').slice(0, 300)})`);
  const png = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  const file = resolve('static/tv-art', `${name}.webp`);
  await mkdir(resolve('static/tv-art'), { recursive: true });
  // Shown dim and soft: 1600 wide at webp q70 is plenty. ffmpeg, because the repo has no image library.
  const raw = join(tmpdir(), `tv-art-${name}.png`);
  await writeFile(raw, png);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-vf', "scale='min(1600,iw)':-2", '-c:v', 'libwebp', '-quality', '70', file]);
  await rm(raw, { force: true });
  console.log(`${name}: ${file}${out.usage?.cost ? ` · $${out.usage.cost}` : ''}`);
}

const apiKey = await key();
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(PICTURES);
for (const name of names) {
  if (!PICTURES[name]) throw new Error(`No picture called ${name}: ${Object.keys(PICTURES).join(', ')}`);
  await paint(name, apiKey);
}
