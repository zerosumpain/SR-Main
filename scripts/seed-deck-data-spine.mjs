// Seed "The Data Spine — Federation" — the phase-1 proving deck for sr. decks.
// Idempotent: deletes any existing deck with this slug, reinserts the tree,
// mints one share link and prints the share URL. Plain `pg` + SQL so it runs
// identically on homeserv (local DB) and the VPS (prod DB):
//   node scripts/seed-deck-data-spine.mjs            # uses DATABASE_URL from env or .env
// Content facts come from the data-spine study constants (spine.ts timeline,
// topology.ts supplier shares) — keep them in sync if the study corrects them.

import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

export const SLUG = 'data-spine-federation';

/** Deck spec — slides are ordered; `children` nest one zoom level down. */
export const DECK = {
  slug: SLUG,
  title: 'The Data Spine — Federation',
  description:
    'How a federated data spine answers questions about 24,000 schools without building a warehouse. Built on the Field Study №5 working model.',
  theme: 'editorial',
  slides: [
    {
      title: 'The Data Spine',
      layout: 'center',
      blocks: [
        {
          type: 'masthead',
          kicker: 'FIELD STUDY Nº5 · A PRESENTATION',
          title: 'The Data Spine',
          thesis:
            'England’s schools run on fifteen supplier estates holding records for millions of children. The DfE has committed to a “data spine” to join them up — one paragraph, no architecture. This is the case for moving questions instead of records.',
        },
      ],
    },
    {
      title: 'The estate today',
      layout: 'default',
      blocks: [
        {
          type: 'prose',
          lede: true,
          body: 'There is no single school database in England. **The estate is already federated** — it just doesn’t behave like it.',
        },
        {
          type: 'statRow',
          stats: [
            { n: '24,000', label: 'state schools' },
            { n: '15', label: 'MIS suppliers' },
            { n: '28m+', label: 'people in the NPD' },
            { n: '1', label: 'paragraph of published design' },
          ],
        },
        {
          type: 'prose',
          body: 'Every school already keeps its register in a management information system. The question the spine consultation must answer is custody: **connect** those estates with a query fabric, or **collect** them into another central store.',
        },
      ],
    },
    {
      title: 'Who holds the records',
      layout: 'default',
      blocks: [
        {
          type: 'chart',
          kind: 'bar',
          title: 'Who runs the school estate — MIS market share (indicative)',
          series: [
            {
              label: 'share of schools (%)',
              points: [
                { x: 0, y: 44 },
                { x: 1, y: 26 },
                { x: 2, y: 13 },
                { x: 3, y: 6.5 },
                { x: 4, y: 10.5 },
              ],
            },
          ],
          xLabels: ['Arbor', 'ESS SIMS', 'Bromcom', 'ScholarPack', '11 others'],
          yLabel: 'share %',
        },
        {
          type: 'prose',
          body: 'Three suppliers cover four schools in five — but a spine that only works for the majors excludes exactly the estates that serve nurseries, special schools and alternative provision. **The long tail is the design constraint.**',
        },
      ],
    },
    {
      title: 'The simulator',
      layout: 'full-bleed',
      blocks: [
        { type: 'embed', embed: 'federation-sim', config: {} },
        {
          type: 'prose',
          body: 'A working model: the real supplier market, 24,000 synthetic schools, and a query exchange between them. **Dive in to watch it answer.**',
        },
      ],
      children: [
        {
          title: 'Tuesday morning, 09:04',
          layout: 'full-bleed',
          blocks: [
            { type: 'embed', embed: 'federation-sim', config: { scenario: 'attendance', autoplay: true } },
            {
              type: 'prose',
              body: 'The daily attendance ask. The question goes **out** to every estate; per-school aggregates come **back**. No pupil record moves. This already happens today — through a commercial extraction pipe the DfE rents, not a spine it governs.',
            },
          ],
        },
        {
          title: 'The family that says no',
          layout: 'full-bleed',
          blocks: [
            { type: 'embed', embed: 'federation-sim', config: { scenario: 'optout', autoplay: true } },
            {
              type: 'prose',
              body: 'A voluntary query meets an opt-out. In a federated design the refusal is honoured **at source** — the supplier simply doesn’t answer for that family, and the return says so. In a central-copy design, the family’s data is already in the building.',
            },
          ],
        },
        {
          title: 'The query that gets refused',
          layout: 'full-bleed',
          blocks: [
            { type: 'embed', embed: 'federation-sim', config: { scenario: 'rogue', autoplay: true } },
            {
              type: 'prose',
              body: 'An over-broad ask — identifiable records, no legal basis — is **refused by the fabric itself** and stamped on the audit ledger. Guardrails as architecture, not policy documents.',
            },
          ],
        },
        {
          title: 'Blast radius',
          layout: 'full-bleed',
          blocks: [
            { type: 'embed', embed: 'federation-sim', config: { scenario: 'breach', autoplay: true } },
            {
              type: 'prose',
              body: 'When one estate is breached, a federation loses **one estate’s data**. A central store loses everything, for everyone, at once. Custody is the security model.',
            },
          ],
        },
      ],
    },
    {
      title: 'How we got here',
      layout: 'default',
      blocks: [
        {
          type: 'timeline',
          items: [
            { year: '2002', label: 'National Pupil Database begins', detail: 'Census-built store; now 28m+ people’s records, copied outward to researchers, government and journalists.' },
            { year: '2009', label: 'ContactPoint goes live', detail: '£224m universal index of every child in England.' },
            { year: '2010', label: 'ContactPoint switched off', detail: 'Scrapped within a year on privacy and proportionality grounds — the cautionary precedent.' },
            { year: '2020', label: 'ICO audits the DfE', detail: '“No clear picture of what data is held.” 139 recommendations.' },
            { year: '2024', label: 'Daily attendance feed goes mandatory', detail: 'Automated MIS extraction for all state schools — the spine’s live proof-of-concept.' },
            { year: '2025', label: 'Data (Use and Access) Act', detail: 'The legal plumbing a spine would run on.' },
            { year: '2026', label: 'White paper commits to the spine', detail: 'One paragraph on p.98 of “Every Child Achieving and Thriving”. Consultation promised for summer.' },
            { year: '2026', label: 'The custody question — open', detail: 'Connect (federate) vs collect (central store): the consultation is where the architecture gets decided.' },
          ],
        },
      ],
    },
    {
      title: 'The whole argument',
      layout: 'center',
      blocks: [
        {
          type: 'bigNumber',
          value: 0,
          label: 'pupil records moved by a federated query',
          sub: 'Aggregates return; records stay in the school’s estate, under the school’s custody. That is the whole argument.',
        },
        { type: 'quote', text: 'Move the questions, not the records.' },
      ],
    },
    {
      title: 'Explore the working model',
      layout: 'center',
      blocks: [
        {
          type: 'masthead',
          kicker: 'THE FULL FIELD STUDY',
          title: 'Interrogate it yourself',
          thesis:
            'Every scenario in this deck runs live in the full study — alongside the governance analysis, the legal gateways, and the ask-the-federation query anatomy.',
        },
        {
          type: 'prose',
          body: '[The Data Spine — Field Study №5](/projects/data-spine) · [The federation working model](/projects/data-spine/federation)',
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

async function insertSlides(client, deckId, slides, parentSlideId) {
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    const {
      rows: [row],
    } = await client.query(
      `INSERT INTO deck_slides (deck_id, parent_slide_id, position, title, layout, blocks)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [deckId, parentSlideId, i, s.title ?? null, s.layout ?? 'default', JSON.stringify(s.blocks)],
    );
    if (s.children?.length) await insertSlides(client, deckId, s.children, row.id);
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
      `INSERT INTO decks (slug, title, description, theme, is_public) VALUES ($1, $2, $3, $4, false) RETURNING id`,
      [DECK.slug, DECK.title, DECK.description, DECK.theme],
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
    console.log(`Seeded deck "${DECK.title}" (${count} slides)`);
    console.log(`Share URL: /decks/${DECK.slug}?t=${token}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

// Only run when executed directly (the vitest spec imports DECK without side effects).
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
