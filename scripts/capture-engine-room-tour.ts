#!/usr/bin/env tsx
/**
 * capture-engine-room-tour.ts — screenshots for the Engine Room's site tour.
 *
 * The Engine Room is a PUBLIC page about a PRIVATE system. Most of the surfaces worth
 * showing (chat, the graph, the drive, admin) are full of real mail, real people and real
 * filenames, and the study's hard rule is that none of that is ever published — not
 * obscured, never written.
 *
 * So redaction happens BEFORE the pixels exist, not after. Painting over a bitmap leaves
 * the real string underneath in the source image and one missed corner is permanent; here
 * the page's own DOM is rewritten in the browser and the camera only ever sees stand-ins.
 * Two layers:
 *
 *   1. A global sweep over every text node — mail addresses, phone numbers, IPs, postcodes,
 *      long opaque tokens. Structural, so it catches surfaces nobody thought about.
 *   2. Per-surface `scrub` rules that replace the text of data-bearing elements with fixed
 *      stand-ins, whatever happens to be in them. Deterministic: it does not depend on
 *      knowing which names are real.
 *
 * Neither layer is trusted on its own. Every image is reviewed by eye before it ships.
 *
 * Run:  npx tsx scripts/capture-engine-room-tour.ts            (all surfaces)
 *       npx tsx scripts/capture-engine-room-tour.ts jkai drive (a subset, by id)
 *       BASE=http://localhost:5173 npx tsx scripts/capture-engine-room-tour.ts
 */
import { chromium, type Page } from 'playwright';
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(REPO, 'static', 'projects', 'engine-room', 'tour');
const BASE = process.env.BASE ?? 'http://localhost:5173';

/** Viewport for the shot. 16:10 — wide enough for the real layout, not so tall it needs scrolling. */
const VW = 1440;
const VH = 900;

/** Two deliveries per surface: a card thumbnail and the zoomed view behind the click. */
const THUMB_W = 760;
const FULL_W = 1800;

type Pool = 'person' | 'org' | 'subject' | 'file' | 'line' | 'thread';

interface Scrub {
  sel: string;
  pool: Pool;
}

interface Surface {
  id: string;
  path: string;
  /** Wait for this before shooting — a surface that shoots mid-skeleton looks broken. */
  waitFor?: string;
  /** Load condition. Surfaces holding an open stream never reach `networkidle`. */
  until?: 'load' | 'domcontentloaded' | 'networkidle';
  /** Extra settle time for charts, graph layouts and streamed panels. */
  settleMs?: number;
  /** Elements whose text is replaced with stand-ins. */
  scrub?: Scrub[];
  /** Elements removed outright — avatars, embedded images, anything not worth risking. */
  hide?: string[];
  /** Scroll down before shooting, when the interesting part is not at the top. */
  scrollTo?: number;
  /**
   * URL fragments whose JSON responses are rewritten before the page sees them.
   *
   * Required for anything drawn on a <canvas>: the knowledge graph paints its node
   * labels as pixels, so DOM redaction cannot touch them and reading the text back
   * cannot detect them. Redacting the payload upstream is the only thing that works.
   */
  routes?: string[];
  /**
   * Declares that this surface's canvas paints no text — a waveform, a sparkline, a
   * texture. Must be asserted by a human who has looked at it, because nothing
   * automated can read inside a canvas.
   */
  canvasDrawsNoText?: boolean;
}

// ---------------------------------------------------------------------------
// Stand-in pools. Deliberately bland and obviously invented: a reader should never
// wonder whether they are looking at a real person. Names are from the Met Office
// storm list, orgs are fictional, mail subjects are the dullest plausible.
// ---------------------------------------------------------------------------
const POOLS: Record<Pool, string[]> = {
  person: ['Alex Fenwick', 'Priya Nadeau', 'Tom Ashby', 'Marguerite Hall', 'Devan Okoro', 'Ruth Lindqvist'],
  org: ['Northgate Partners', 'Bramble Institute', 'Halden & Co', 'The Lowry Trust', 'Kestrel Analytics'],
  subject: [
    'Re: quarterly numbers',
    'Agenda for Thursday',
    'Draft for comment',
    'Room change — 14:00',
    'Follow-up from last week',
    'Invoice attached',
  ],
  file: [
    'quarterly-review.pdf',
    'site-notes.md',
    'budget-v3.xlsx',
    'photo-2026-04-11.jpg',
    'handover.docx',
    'readings.csv',
  ],
  line: [
    'Sample text stands in for the real content here.',
    'This line is a placeholder, not a real message.',
    'Content replaced before capture.',
  ],
  thread: ['A worked example', 'Placeholder conversation', 'Sample thread', 'Stand-in content'],
};

// ---------------------------------------------------------------------------
// The surfaces, in the order the tour tells them: the public face, then the
// assistant, then the machine room underneath it.
// ---------------------------------------------------------------------------
const SURFACES: Surface[] = [
  // ---- the public face -----------------------------------------------------
  // The one canvas on the landing page is the heartbeat waveform — a path, no labels.
  { id: 'home', path: '/', settleMs: 1400, canvasDrawsNoText: true },
  { id: 'blog', path: '/blog', settleMs: 900 },
  { id: 'projects', path: '/projects', settleMs: 900 },
  { id: 'decks', path: '/decks', settleMs: 900 },
  { id: 'releases', path: '/releases', settleMs: 900 },

  // ---- the assistant -------------------------------------------------------
  {
    // The chat hub holds an open stream, so `networkidle` never fires here.
    id: 'jkai',
    path: '/jkai',
    settleMs: 3200,
    until: 'domcontentloaded',
    scrub: [
      { sel: '[class*="thread"] [class*="title"], [class*="thread"] h3, [class*="thread"] h4', pool: 'thread' },
      { sel: '[class*="bubble"] p, [class*="message"] p, [class*="msg"] p', pool: 'line' },
      { sel: '[class*="preview"], [class*="snippet"]', pool: 'line' },
    ],
  },
  { id: 'canvases', path: '/jkai/canvas', settleMs: 2200 },
  // The wired graph, not the list — the list is a table, the editor is the argument.
  // The briefing canvas is the biggest one there is (24 nodes, 28 edges); it also holds
  // a messaging node, and a messaging node holds a real phone number, so the assertion
  // is doing real work on this surface rather than rubber-stamping it.
  { id: 'canvas', path: '/jkai/canvas/morning-briefing', settleMs: 3400, until: 'domcontentloaded' },
  {
    id: 'builds',
    path: '/jkai/builds',
    settleMs: 1600,
    scrub: [{ sel: '[class*="prompt"], [class*="brief"]', pool: 'line' }],
  },
  {
    // The graph's own node labels are real names, and so is the cluster list beside it.
    // Both are replaced by position rather than by matching, so unknown names are covered.
    id: 'intel',
    path: '/jkai/intel',
    settleMs: 2600,
    routes: ['/api/jkai/intel/'],
    scrub: [
      { sel: '[class*="cluster"] li, [class*="cluster"] button, [class*="legend"] li', pool: 'org' },
      { sel: 'svg text', pool: 'person' },
      { sel: '[class*="entity"] [class*="name"], [class*="node"] [class*="label"]', pool: 'person' },
      { sel: '[class*="note"] p, [class*="claim"] p, [class*="finding"] p', pool: 'line' },
      // The upcoming-events rail draws real timeline entries out of the graph.
      { sel: '[class*="tl-txt"]', pool: 'thread' },
    ],
  },
  {
    // The summaries are model-written prose about whatever the entity is, so they
    // name people, paths and the repository. Replaced wholesale, not pattern-matched.
    id: 'entities',
    path: '/jkai/intel/entities',
    settleMs: 1800,
    scrub: [
      { sel: 'tbody tr td:first-child, [class*="row"] [class*="name"], [class*="card"] h3', pool: 'person' },
      // The one-line summary moved into a `.sum` span when the register was rebuilt;
      // [class*="summary"] no longer matched anything and real prose survived the shot.
      { sel: 'tbody tr td:first-child div:not(:first-child), [class*="summary"], [class*="sum"], [class*="desc"]', pool: 'line' },
      { sel: '[class*="sub"], [class*="meta"]', pool: 'org' },
    ],
  },
  {
    // The briefing is, by design, a page of personal data: where he is, how he slept,
    // what the house is doing. Every value block is replaced.
    id: 'briefing',
    path: '/jkai/briefing',
    settleMs: 2000,
    // The bullets are the personal part — where he is, how he slept, what the house is
    // doing. The weather panels stay real: once the place name is a stand-in, a
    // temperature identifies nobody, and replacing them left the page reading
    // "This line is a placeholder" in 40px type, which helps no one understand the feature.
    scrub: [
      { sel: 'li, [class*="bullet"]', pool: 'line' },
      { sel: '[class*="place"], [class*="location"], [class*="where"] b, [class*="where"] strong', pool: 'org' },
    ],
  },
  {
    id: 'drive',
    path: '/drive',
    settleMs: 1600,
    hide: ['img[src*="/api/"], img[src*="blob"], [class*="thumb"] img'],
    scrub: [{ sel: '[class*="name"], td:first-child, [class*="file"] b', pool: 'file' }],
  },

  // ---- the machine room ----------------------------------------------------
  { id: 'admin', path: '/admin', settleMs: 1400 },
  { id: 'improvement', path: '/admin/ai/improvement', settleMs: 2000 },
  { id: 'architecture', path: '/admin/ops/architecture', settleMs: 2200 },
  { id: 'health', path: '/admin/connections/health', settleMs: 1800 },
  { id: 'costs', path: '/admin/ops/costs', settleMs: 2000 },
  { id: 'models', path: '/admin/ai/model-routing', settleMs: 1600 },
];

// ---------------------------------------------------------------------------
// The denylist: literal strings belonging to this system that must never appear in a
// published image, wherever they turn up — a table cell, an SVG label, a tooltip, a
// free-text summary the model wrote about its own source tree.
//
// This is the layer that catches what selectors miss. The entity summaries, for one,
// happily describe the repository by name and path because the model was reading it.
// Each entry is [pattern, replacement]; patterns are applied case-insensitively.
// ---------------------------------------------------------------------------
const DENY: Array<[string, string]> = [
  // Paths and hosts.
  ['/home/[a-z0-9_-]+', '/home/user'],
  ['strange[_-]rambling[_a-z]*', 'personal-site'],
  ['homeserv', 'origin-host'],
  ['tail[0-9a-f]+', 'tailnet'],
  // People. The graph is full of real ones; these are the recurring names.
  ['john\\s+kelly', 'Alex Fenwick'],
  ['katie\\s+kelly', 'Priya Nadeau'],
  ['\\bkelly\\b', 'Fenwick'],
  ['\\bjohnk?\\b', 'Alex'],
  // Organisations and places.
  ['\\bibca\\b', 'Northgate'],
  ['station\\s+place', 'Sample Location'],
  ['darlington', 'Sample Town'],
  ['england', 'the country'],
  // Device and account identifiers.
  ['life360[_a-z]*', 'tracker'],
  ['device_tracker\\.[a-z0-9_]+', 'device_tracker.sample'],
  // "282.5 km SSE of home" locates a house as surely as an address does.
  ['\\d+(\\.\\d+)?\\s*(km|mi|miles)\\s+[NSEW]{0,3}\\s*of\\s+home', '— km from home'],
];

/**
 * Patterns that must NOT survive redaction. Checked against the rendered text after
 * every layer has run; a hit fails the capture rather than writing the file.
 * Deliberately broader than DENY — it is the assertion, not the fix.
 */
const FORBIDDEN: Array<[string, RegExp]> = [
  ['home directory path', /\/home\/(?!user\b)[a-z0-9_-]+/i],
  ['repo name', /strange[_-]rambling/i],
  ['origin hostname', /homeserv/i],
  ['owner surname', /\bkell(y|ys)\b/i],
  ['tailnet', /\.ts\.net/i],
  ['real org', /\bIBCA\b/],
  ['home location', /station\s+place|darlington/i],
  ['device tracker id', /life360/i],
  ['distance from home', /\d+(\.\d+)?\s*(km|mi|miles)\s+[NSEW]{0,3}\s*of\s+home/i],
  ['mail address', /[A-Za-z0-9._%+-]+@(?!example\.com)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ['api key or token', /\b(sk|pk|ghp|gho|xox[bp])[-_][A-Za-z0-9]{10,}/],
  // Any UK mobile that is NOT the reserved 07700 900xxx drama range. Written as a
  // negative pattern so the real number never has to appear in this file.
  ['real UK mobile', /(?:\+44\s?\(?0?7|\b07)(?!700\s?900)\d{2}[\s-]?\d{3}[\s-]?\d{3}/],
];

// ---------------------------------------------------------------------------
// Layer 1 — the structural sweep. Runs in the page, over every text node, on every
// surface including the ones with no scrub rules.
// ---------------------------------------------------------------------------
async function sweep(page: Page, deny: Array<[string, string]>) {
  await page.evaluate((deny) => {
    const RULES: Array<[RegExp, string]> = [
      ...deny.map(([p, r]) => [new RegExp(p, 'gi'), r] as [RegExp, string]),
      // Mail addresses.
      [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, 'someone@example.com'],
      // Phone numbers. Ofcom reserves 07700 900xxx for exactly this.
      //
      // Tightly shaped on purpose: the first version was `\+?\d[\d\s().-]{8,}\d`, which
      // is also a perfect description of an ISO timestamp, so every log line in the
      // nightly report came out reading "Started: +44 7700 900000T19:30:56.551Z".
      // A redaction rule that fires on ordinary content is a rule nobody will keep.
      [/\+\d{1,3}[\s-]?\(?0?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}\b/g, '+44 7700 900000'],
      [/\b0\d{3,4}[\s-]?\d{3}[\s-]?\d{3,4}\b/g, '07700 900000'],
      // IPv4, including the ones hiding in a hostname column. RFC 5737 documentation range.
      [/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '203.0.113.10'],
      // UK postcodes.
      [/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/g, 'SW1A 1AA'],
      // Anything long and opaque enough to be a key, token or hash.
      [/\b[A-Za-z0-9_-]{24,}\b/g, '••••••••••••'],
      // Tailscale / internal hostnames.
      [/\b[a-z0-9-]+\.ts\.net\b/g, 'host.internal'],
    ];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    for (const n of nodes) {
      let v = n.nodeValue ?? '';
      if (!v.trim()) continue;
      for (const [re, sub] of RULES) v = v.replace(re, sub);
      if (v !== n.nodeValue) n.nodeValue = v;
    }
    // Attributes can leak too — a title tooltip or an alt text.
    for (const el of Array.from(document.querySelectorAll('[title], [alt], [aria-label]'))) {
      for (const a of ['title', 'alt', 'aria-label']) {
        const v = el.getAttribute(a);
        if (!v) continue;
        let out = v;
        for (const [re, sub] of RULES) out = out.replace(re, sub);
        if (out !== v) el.setAttribute(a, out);
      }
    }
  }, deny);
}

/**
 * The assertion. Reads back everything a viewer could read off the image — rendered
 * text plus SVG labels — and refuses the capture if anything on the forbidden list
 * survived. This is what makes the redaction a guarantee rather than a good intention.
 */
async function assertClean(page: Page, forbidden: Array<[string, RegExp]>, canvasHandled: boolean) {
  // A <canvas> is a blind spot: its content is pixels, so neither the redaction nor
  // this check can see inside it. The knowledge graph paints real names there and the
  // first version of this script passed it clean. So a surface with a canvas must
  // declare that its payload is redacted upstream, or it does not ship.
  const canvases = await page.evaluate(
    () => Array.from(document.querySelectorAll('canvas')).filter((c) => c.width > 200 && c.height > 200).length,
  );
  if (canvases > 0 && !canvasHandled) {
    throw new Error(`${canvases} canvas element(s) present and no route redaction declared — text inside cannot be verified`);
  }

  const text = await page.evaluate(() => {
    const body = document.body.innerText ?? '';
    const svg = Array.from(document.querySelectorAll('svg text, svg title'))
      .map((t) => t.textContent ?? '')
      .join('\n');
    const attrs = Array.from(document.querySelectorAll('[title], [alt], [aria-label]'))
      .flatMap((el) => ['title', 'alt', 'aria-label'].map((a) => el.getAttribute(a) ?? ''))
      .join('\n');
    return [body, svg, attrs].join('\n');
  });
  const hits = forbidden
    .filter(([, re]) => re.test(text))
    .map(([name, re]) => `${name} (${text.match(re)?.[0]})`);
  if (hits.length) throw new Error(`redaction incomplete — ${hits.join('; ')}`);
}

// ---------------------------------------------------------------------------
// Layer 2 — per-surface replacement. Text of matched elements is swapped for a
// stand-in regardless of what was in it.
// ---------------------------------------------------------------------------
async function scrub(page: Page, rules: Scrub[], pools: Record<Pool, string[]>) {
  await page.evaluate(
    ({ rules, pools }) => {
      let i = 0;
      for (const r of rules) {
        const pool = pools[r.pool];
        for (const el of Array.from(document.querySelectorAll(r.sel))) {
          const cur = (el.textContent ?? '').trim();
          if (!cur) continue;
          // Leave short structural labels alone — "Name", "Type", "3", a chevron.
          if (cur.length < 4) continue;
          el.textContent = pool[i++ % pool.length];
        }
      }
    },
    { rules, pools },
  );
}

// ---------------------------------------------------------------------------
// Layer 0 — payload redaction, upstream of the browser.
//
// Keys that carry a human-readable name somewhere in the intel payloads. Replaced with
// a stand-in chosen by a stable hash of the original, so one entity keeps one alias
// across nodes, edges, clusters and hover cards and the graph still reads as coherent.
// ---------------------------------------------------------------------------
const NAME_KEYS = new Set([
  'name', 'label', 'title', 'canonicalName', 'displayName', 'alias', 'aliases',
  'summary', 'description', 'text', 'snippet', 'preview', 'sourceName',
]);

function standIn(original: string, pool: string[]): string {
  let h = 0;
  for (let i = 0; i < original.length; i++) h = (h * 31 + original.charCodeAt(i)) >>> 0;
  return pool[h % pool.length];
}

function redactPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactPayload);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'string' && NAME_KEYS.has(k) && v.length > 2) {
        // Long strings are prose; short ones are names.
        out[k] = v.length > 60 ? standIn(v, POOLS.line) : standIn(v, [...POOLS.person, ...POOLS.org]);
      } else {
        out[k] = redactPayload(v);
      }
    }
    return out;
  }
  return value;
}

async function installRouteRedaction(page: Page, fragments: string[]) {
  await page.route(
    (url) => fragments.some((f) => url.pathname.includes(f)),
    async (route) => {
      const res = await route.fetch();
      const ct = res.headers()['content-type'] ?? '';
      if (!ct.includes('json')) return route.fulfill({ response: res });
      try {
        const body = redactPayload(await res.json());
        return route.fulfill({ response: res, body: JSON.stringify(body), contentType: 'application/json' });
      } catch {
        // A payload we cannot parse is a payload we cannot vouch for.
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
    },
  );
}

async function hide(page: Page, sels: string[]) {
  await page.evaluate((sels) => {
    for (const s of sels) {
      for (const el of Array.from(document.querySelectorAll(s))) {
        (el as HTMLElement).style.visibility = 'hidden';
      }
    }
  }, sels);
}

// ---------------------------------------------------------------------------

async function main() {
  const only = process.argv.slice(2);
  const list = only.length ? SURFACES.filter((s) => only.includes(s.id)) : SURFACES;
  if (!list.length) {
    console.error(`No surfaces matched: ${only.join(', ')}`);
    process.exit(1);
  }

  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: VW, height: VH },
    deviceScaleFactor: 2,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
  });

  const manifest: Array<{ id: string; path: string; capturedAt: string }> = [];
  const failures: string[] = [];

  for (const s of list) {
    const page = await ctx.newPage();
    try {
      process.stdout.write(`  ${s.id.padEnd(14)} ${s.path} … `);
      if (s.routes) await installRouteRedaction(page, s.routes);
      await page.goto(`${BASE}${s.path}`, { waitUntil: s.until ?? 'networkidle', timeout: 60_000 });
      if (s.waitFor) await page.waitForSelector(s.waitFor, { timeout: 30_000 }).catch(() => {});
      // Fonts must be settled or the shot shows fallback metrics.
      await page.evaluate(() => (document as Document & { fonts: FontFaceSet }).fonts.ready);
      await page.waitForTimeout(s.settleMs ?? 1000);
      if (s.scrollTo) {
        await page.evaluate((y) => window.scrollTo(0, y), s.scrollTo);
        await page.waitForTimeout(400);
      }

      // Redact, then re-settle: replacing text can reflow the layout.
      // Per-surface rules run FIRST — they replace whole elements, and the sweep then
      // cleans up anything they left behind (a stand-in never trips the sweep).
      if (s.scrub) await scrub(page, s.scrub, POOLS);
      if (s.hide) await hide(page, s.hide);
      await sweep(page, DENY);
      await page.waitForTimeout(350);

      // Prove it before writing a file. A failure here is a bug in the rules, not a
      // reason to publish the image anyway.
      await assertClean(page, FORBIDDEN, !!s.routes || !!s.canvasDrawsNoText);

      const png = await page.screenshot({ type: 'png' });

      await sharp(png).resize({ width: FULL_W, withoutEnlargement: true })
        .webp({ quality: 82 }).toFile(join(OUT, `${s.id}.webp`));
      await sharp(png).resize({ width: THUMB_W, withoutEnlargement: true })
        .webp({ quality: 78 }).toFile(join(OUT, `${s.id}-thumb.webp`));

      manifest.push({ id: s.id, path: s.path, capturedAt: new Date().toISOString() });
      console.log('ok');
    } catch (err) {
      console.log(`FAILED — ${(err as Error).message.split('\n')[0]}`);
      failures.push(s.id);
    } finally {
      await page.close();
    }
  }

  await browser.close();

  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ base: BASE, surfaces: manifest }, null, 2));
  console.log(`\n${manifest.length}/${list.length} captured → ${OUT}`);
  if (failures.length) {
    console.log(`failed: ${failures.join(', ')}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
