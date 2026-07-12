// Seed "The sr. decks Showcase" — a public deck where every slide demonstrates
// the feature it describes: all eleven block types, all ten page designs, all
// seven chart kinds (the chart-room side journey), journey pills + nav map,
// autoplaying sim embeds, an iframe, and the animation set.
// Idempotent, same pattern as seed-deck-data-spine.mjs:
//   node scripts/seed-deck-showcase.mjs     # DATABASE_URL from env or ../.env

import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

export const SLUG = 'showcase';

export const DECK = {
  slug: SLUG,
  title: 'The sr. decks Showcase',
  description:
    'Every page design and block type in the deck system, live — each slide demonstrates the thing it describes.',
  theme: 'editorial',
  isPublic: true,
  slides: [
    {
      title: 'Every page in the box',
      layout: 'center',
      blocks: [
        {
          type: 'masthead',
          kicker: 'SR. DECKS · SHOWCASE',
          title: 'Every page in the box',
          thesis:
            'A live tour of the deck system — eleven block types, ten page designs, seven chart kinds, side journeys, found-and-painted imagery and two live embeds. Every slide demonstrates the thing it describes.',
        },
      ],
    },
    {
      title: 'The statement page',
      layout: 'statement',
      blocks: [{ type: 'quote', text: 'Every slide here is a demonstration of itself.' }],
    },
    {
      title: 'The big number',
      layout: 'statement',
      blocks: [
        {
          type: 'bigNumber',
          value: 24000,
          label: 'synthetic schools in the simulator, a few slides from here',
          sub: 'Numbers count up as the slide enters. This one is real — it is the working model from the data-spine study.',
        },
      ],
    },
    {
      title: 'The statement headline',
      layout: 'statement-left',
      blocks: [
        {
          type: 'headline',
          kicker: 'EDITORIAL TECHNIQUE Nº1',
          text: 'Whitespace is the loudest signal',
          dek: 'A statement headline rags left against emptiness — kicker, claim, one supporting line. This page is one.',
        },
      ],
    },
    {
      title: 'And its mirror',
      layout: 'statement-right',
      blocks: [
        {
          type: 'headline',
          kicker: 'EDITORIAL TECHNIQUE Nº2',
          text: 'The right edge answers back',
          dek: 'Statement-right breaks the rhythm after a left-pinned page — tension you can use.',
          align: 'right',
        },
      ],
    },
    {
      title: 'The vocabulary',
      layout: 'grid',
      blocks: [
        {
          type: 'prose',
          lede: true,
          body: '**The vocabulary.** Eleven typed blocks compose onto ten page designs. An art director — the LLM in the editor’s compose box and in /jkai — decides which; every result passes the same validation gate.',
        },
        {
          type: 'statRow',
          stats: [
            { n: '11', label: 'block types' },
            { n: '10', label: 'page designs' },
            { n: '7', label: 'chart kinds' },
            { n: '3', label: 'authoring paths' },
          ],
        },
      ],
    },
    {
      title: 'Split — line charts',
      layout: 'split',
      blocks: [
        {
          type: 'prose',
          lede: true,
          body: '**The split page** puts argument beside evidence. Charts are hand-rolled SVG — no library — and the lines draw themselves in as the slide arrives.',
        },
        {
          type: 'prose',
          body: 'The data is this system’s own build week: tests and page designs, batch by batch.',
        },
        {
          type: 'chart',
          kind: 'line',
          title: 'Seven build batches (real numbers)',
          series: [
            {
              label: 'unit tests passing',
              points: [
                { x: 1, y: 20 },
                { x: 2, y: 22 },
                { x: 3, y: 30 },
                { x: 4, y: 34 },
                { x: 5, y: 45 },
                { x: 6, y: 48 },
                { x: 7, y: 48 },
              ],
            },
            {
              label: 'page designs available',
              points: [
                { x: 1, y: 3 },
                { x: 2, y: 3 },
                { x: 3, y: 8 },
                { x: 4, y: 8 },
                { x: 5, y: 10 },
                { x: 6, y: 10 },
                { x: 7, y: 10 },
              ],
            },
          ],
          xLabel: 'build batch',
          yLabel: 'count',
        },
      ],
    },
    {
      title: 'The chart room',
      layout: 'split-flip',
      journeyLabel: 'the chart room',
      blocks: [
        {
          type: 'prose',
          lede: true,
          body: '**Flip the split** and the evidence leads. Bars grow from the baseline, staggered; categorical axes take real labels.\n\nThis page has a side journey — the pill below points **down into the chart room**: five more ways to draw a number. The map, bottom left, always knows the way back.',
        },
        {
          type: 'chart',
          kind: 'bar',
          title: 'Page designs used in this very deck',
          series: [
            {
              label: 'slides',
              points: [
                { x: 0, y: 2 },
                { x: 1, y: 3 },
                { x: 2, y: 1 },
                { x: 3, y: 1 },
                { x: 4, y: 1 },
                { x: 5, y: 5 },
                { x: 6, y: 5 },
                { x: 7, y: 3 },
                { x: 8, y: 2 },
                { x: 9, y: 2 },
              ],
            },
          ],
          xLabels: ['center', 'stmt', 'stmt-l', 'stmt-r', 'grid', 'split', 'flip', 'default', 'poster', 'bleed'],
        },
      ],
      children: [
        {
          title: 'Area — weight over time',
          layout: 'split',
          blocks: [
            {
              type: 'prose',
              lede: true,
              body: '**Area** gives a trend its weight — the fill fades up after the line draws. The data: how many chart kinds this system could draw, batch by batch. Tonight it jumped.',
            },
            {
              type: 'chart',
              kind: 'area',
              title: 'Chart kinds available, by build batch (real)',
              series: [
                {
                  label: 'chart kinds',
                  points: [
                    { x: 1, y: 2 },
                    { x: 2, y: 2 },
                    { x: 3, y: 2 },
                    { x: 4, y: 2 },
                    { x: 5, y: 7 },
                  ],
                },
              ],
              xLabel: 'build batch',
            },
          ],
        },
        {
          title: 'Slope — before and after',
          layout: 'split-flip',
          blocks: [
            {
              type: 'prose',
              lede: true,
              body: '**Slope charts** are the editorial before-and-after: two moments, one line each, values at both ends. This morning versus tonight, for this very system.',
            },
            {
              type: 'chart',
              kind: 'slope',
              title: 'This system, this morning → tonight',
              series: [
                { label: 'chart kinds', points: [{ x: 0, y: 2 }, { x: 1, y: 7 }] },
                { label: 'page designs', points: [{ x: 0, y: 8 }, { x: 1, y: 10 }] },
                { label: 'block types', points: [{ x: 0, y: 10 }, { x: 1, y: 11 }] },
              ],
              xLabels: ['this morning', 'tonight'],
            },
          ],
        },
        {
          title: 'Scatter — the shape of restraint',
          layout: 'split',
          blocks: [
            {
              type: 'prose',
              lede: true,
              body: '**Scatter** shows a relationship — here, every top-level slide of this deck: its order against how many blocks it carries. Flat and low is the point. Pages stay light.',
            },
            {
              type: 'chart',
              kind: 'scatter',
              title: 'This deck’s slides: position vs blocks carried',
              series: [
                {
                  label: 'slides',
                  points: [
                    { x: 1, y: 1 },
                    { x: 2, y: 1 },
                    { x: 3, y: 1 },
                    { x: 4, y: 1 },
                    { x: 5, y: 1 },
                    { x: 6, y: 2 },
                    { x: 7, y: 3 },
                    { x: 8, y: 2 },
                    { x: 9, y: 1 },
                    { x: 10, y: 2 },
                    { x: 11, y: 2 },
                    { x: 12, y: 3 },
                    { x: 13, y: 2 },
                    { x: 14, y: 2 },
                    { x: 15, y: 2 },
                    { x: 16, y: 4 },
                    { x: 17, y: 1 },
                  ],
                },
              ],
              xLabel: 'slide position',
              yLabel: 'blocks',
            },
          ],
        },
        {
          title: 'Donut — share of a whole',
          layout: 'split-flip',
          blocks: [
            {
              type: 'prose',
              lede: true,
              body: '**Donut** for shares of one whole, segments sweeping in with the count in the middle. The whole here is this deck: all twenty-five pages, by what leads them.',
            },
            {
              type: 'chart',
              kind: 'donut',
              title: 'This deck’s 25 pages, by family',
              segments: [
                { label: 'words lead', value: 8 },
                { label: 'data leads', value: 9 },
                { label: 'media leads', value: 6 },
                { label: 'interactive leads', value: 2 },
              ],
            },
          ],
        },
        {
          title: 'Sankey — where things flow',
          layout: 'split',
          blocks: [
            {
              type: 'prose',
              lede: true,
              body: '**Sankey** draws allocation — ribbons proportional to flow. Here: what this deck’s twenty-five pages are made from, through the art director, into the page families you have been walking.',
            },
            {
              type: 'chart',
              kind: 'sankey',
              title: 'Raw content through the art director',
              flows: [
                { from: 'words', to: 'art director', value: 8 },
                { from: 'numbers', to: 'art director', value: 9 },
                { from: 'site media', to: 'art director', value: 8 },
                { from: 'art director', to: 'text pages', value: 8 },
                { from: 'art director', to: 'data pages', value: 9 },
                { from: 'art director', to: 'media + interactive', value: 8 },
              ],
            },
          ],
        },
      ],
    },
    {
      title: 'How today went',
      layout: 'default',
      blocks: [
        {
          type: 'timeline',
          items: [
            { year: 'ph. 1', label: 'The engine', detail: 'Schema, block registry, the player, share-token URLs.' },
            { year: 'ph. 2', label: 'jkai builds decks', detail: 'presentation_build_from_spec — outline agreed in chat, one tool call, a URL back.' },
            { year: 'ph. 3', label: 'Decks join the nav', detail: 'A public gallery at /decks; revise-by-prompt tools.' },
            { year: 'ph. 4', label: 'The art director', detail: 'Paste raw content; the system chooses the page. Eight designs, better motion.' },
            { year: 'ph. 5', label: 'The chart room', detail: 'Sankey, donut, slope, area, scatter; statement headlines; the site-media picker.' },
            { year: 'ph. 6', label: 'Journeys', detail: 'Zoom gave way to a 2D field — pills lead down into side stories, the map leads home.' },
            { year: 'ph. 7', label: 'Pictures', detail: 'Found in the open commons or painted on demand — stored on-site, credited in the caption.' },
            { year: 'now', label: 'This showcase', detail: 'Timeline items cascade in down the spine — which is what this block is demonstrating.' },
          ],
        },
      ],
    },
    {
      title: 'The poster page',
      layout: 'poster',
      blocks: [
        { type: 'image', src: '/images/decks/federation-vista.jpg', alt: 'The federation simulator at rest — supplier estates around the exchange ring' },
        {
          type: 'masthead',
          kicker: 'PAGE DESIGN · POSTER',
          title: 'An image becomes the page',
          thesis: 'The scrim carries the words. This backdrop is the simulator you are about to meet.',
        },
      ],
    },
    {
      title: 'The humble figure',
      layout: 'split-flip',
      blocks: [
        {
          type: 'prose',
          lede: true,
          body: '**Figures** keep their captions — a mono kicker under the frame, the way the field studies label their evidence.',
        },
        {
          type: 'image',
          src: '/images/decks/federation-vista.jpg',
          alt: 'The federation exchange at ambient traffic',
          caption: 'FIG 01 — THE EXCHANGE AT AMBIENT TRAFFIC · SCREENSHOT, UNRETOUCHED',
        },
      ],
    },
    {
      title: 'Words beside a found photograph',
      layout: 'split',
      blocks: [
        {
          type: 'prose',
          lede: true,
          body: '**Found, not taken.** The deck searches the open commons — Openverse and Wikimedia — and keeps its own copy of what it finds. The caption carries the licence; the licence carries the credit.',
        },
        {
          type: 'prose',
          body: 'These are the Chicago Defender’s linotype operators, photographed by Russell Lee — searched, stored and credited by the system in one step.',
        },
        {
          type: 'image',
          src: '/api/blog/images/deck-media/linotype-operators-of-the-chicago-defender-d73c1b69f8.jpg',
          alt: 'Linotype operators in the Chicago Defender composing room',
          caption: 'PHOTO — RUSSELL LEE · CC BY 2.0 · VIA OPENVERSE',
        },
      ],
    },
    {
      title: 'A found photograph becomes the page',
      layout: 'poster',
      blocks: [
        {
          type: 'image',
          src: '/api/blog/images/deck-media/sunset-at-thurne-mill-3f1eaead82.jpg',
          alt: 'Sunset at Thurne Mill — boats moored beneath the windmill',
        },
        {
          type: 'masthead',
          kicker: 'PAGE DESIGN · POSTER, FOUND',
          title: 'Sunset does the talking',
          thesis:
            'One search, one import — Thurne Mill at dusk becomes the page. Photo — Michael Westley · CC BY-SA 2.0 · Wikimedia Commons.',
        },
      ],
    },
    {
      title: 'Painted from the content',
      layout: 'split-flip',
      blocks: [
        {
          type: 'prose',
          lede: true,
          body: '**And when the commons has nothing,** the deck paints its own. This image was generated from the deck’s idea of itself — pages on a desk, joined into journeys — and labelled honestly. Real photographs for real things; painted ones for ideas.',
        },
        {
          type: 'image',
          src: '/api/blog/images/deck-media/a-field-of-cream-paper-pages-laid-out-in-rows-on-899102978c.jpg',
          alt: 'A field of cream pages on a dark desk, joined by glowing threads',
          caption: 'IMAGE — AI-GENERATED · POLLINATIONS.AI · PROMPTED FROM THIS DECK’S OWN CONTENT',
        },
      ],
    },
    {
      title: 'Live interactives',
      layout: 'full-bleed',
      journeyLabel: 'the sim, staged',
      blocks: [
        { type: 'embed', embed: 'federation-sim', config: {} },
        {
          type: 'prose',
          body: '**Live interactives are blocks.** This is the real federation simulator — drag to orbit, click a supplier. The pill marks a side journey: press ↓ to walk it.',
        },
      ],
      children: [
        {
          title: 'Autoplay scenarios',
          layout: 'full-bleed',
          blocks: [
            { type: 'embed', embed: 'federation-sim', config: { scenario: 'move', autoplay: true } },
            {
              type: 'prose',
              body: 'Embeds take config — this slide auto-runs **“The child who moves”** the moment it opens. Each sub-slide can stage a different scenario.',
            },
          ],
        },
        {
          title: 'One level down',
          layout: 'statement',
          blocks: [
            { type: 'quote', text: 'You are on a side journey. ↑ climbs back out — the map, bottom left, shows the way.' },
          ],
        },
        {
          title: 'Any page, framed',
          layout: 'default',
          blocks: [
            {
              type: 'prose',
              lede: true,
              body: '**Existing site pages embed as slides.** This is the landing page — the real vital-signs tiles, live inside the deck.',
            },
            { type: 'iframe', src: '/', title: 'strangeramblings.com — live vital signs', height: 560 },
          ],
        },
      ],
    },
    {
      title: 'The registers of prose',
      layout: 'default',
      blocks: [
        {
          type: 'prose',
          style: 'lede',
          body: '**Prose comes in preset registers** — pick one from a dropdown and play. This is *lede*; below are __band__ and __cards__, borrowed from the field studies.',
        },
        {
          type: 'prose',
          style: 'band',
          body: 'Found. Painted. Credited.\n*The registers of prose are presets — this one is the federation band.*',
        },
        {
          type: 'prose',
          style: 'cards',
          body: '**Cards** carry detail-dense content — each paragraph becomes one, its bold opener the title.\n\n**Band** is the inverted creed above — short rhythmic statements at poster scale.\n\n**Aside** is the small mono register that closes this page.',
        },
        {
          type: 'prose',
          style: 'aside',
          body: 'SET IN DM SANS · FRAUNCES · JETBRAINS MONO — THE SAME REGISTERS AS THE FIELD STUDIES. SEE [THE DATA-SPINE DECK](/decks/data-spine-federation).',
        },
      ],
    },
    {
      title: 'Build your own',
      layout: 'center',
      blocks: [
        {
          type: 'masthead',
          kicker: 'BUILD YOUR OWN',
          title: 'Ask jkai for one',
          thesis: 'Decks are built by prompt, revised by prompt, or composed a slide at a time from raw content.',
          asks: [
            '“build a presentation about X” in /jkai',
            'paste content into the compose box — the art director picks the page',
            'insert live site media through the picker at /decks/<slug>/edit',
            'share with a tokened URL — or publish to the /decks gallery',
          ],
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    const line = env.split('\n').find((l) => l.startsWith('DATABASE_URL='));
    if (line) return line.slice('DATABASE_URL='.length).trim().replace(/^"|"$/g, '');
  } catch {
    /* fall through */
  }
  throw new Error('DATABASE_URL not set and no ../.env found');
}

/**
 * @param {import('pg').Client} client
 * @param {string} deckId
 * @param {Array<{title?: string, layout?: string, blocks: unknown[], journeyLabel?: string, children?: unknown[]}>} slides
 * @param {string | null} parentSlideId
 */
async function insertSlides(client, deckId, slides, parentSlideId) {
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    const {
      rows: [row],
    } = await client.query(
      `INSERT INTO deck_slides (deck_id, parent_slide_id, position, title, layout, blocks, journey_label)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [deckId, parentSlideId, i, s.title ?? null, s.layout ?? 'default', JSON.stringify(s.blocks), s.journeyLabel ?? null],
    );
    if (s.children?.length)
      await insertSlides(
        client,
        deckId,
        /** @type {Array<{title?: string, layout?: string, blocks: unknown[], journeyLabel?: string, children?: unknown[]}>} */ (s.children),
        row.id,
      );
  }
}

async function main() {
  const client = new pg.Client({ connectionString: resolveDatabaseUrl() });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM decks WHERE slug = $1', [DECK.slug]);
    const {
      rows: [deck],
    } = await client.query(
      `INSERT INTO decks (slug, title, description, theme, is_public) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [DECK.slug, DECK.title, DECK.description, DECK.theme, DECK.isPublic],
    );
    await insertSlides(client, deck.id, DECK.slides, null);

    const token = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(token).digest('hex');
    await client.query(
      `INSERT INTO deck_share (deck_id, token_hash, label, created_by) VALUES ($1, $2, 'seed link', 'seed-script')`,
      [deck.id, hash],
    );
    await client.query('COMMIT');

    const {
      rows: [{ count }],
    } = await client.query('SELECT count(*) FROM deck_slides WHERE deck_id = $1', [deck.id]);
    console.log(`Seeded deck "${DECK.title}" (${count} slides, public=${DECK.isPublic})`);
    console.log(`URL: /decks/${DECK.slug}  (share token for private use: ?t=${token})`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

const invoked = process.argv[1] ? process.argv[1].split('/').pop() : null;
if (invoked && import.meta.url.endsWith(invoked)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
