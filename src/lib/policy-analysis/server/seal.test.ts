// SEALING — the cipher, the key's life, and the promise that no column was missed.
//
// The last of those is the one that cannot be reviewed by reading. A free-text
// column added to a policy table and not listed in `SEALED_FIELDS` is invisible:
// the feature keeps working, the dashboard reads correctly, and a sealed run
// quietly writes that column in the clear. So the manifest is checked against the
// schema mechanically, and a new column fails this test until somebody decides
// which side of the line it is on.
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KEY_DESTROYED, SEALED_FIELDS, SEAL_PREFIX, mintKey, openSeal, readKey, sealRow, sealWithKey, shredKey, unsealRow } from './seal';

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'policy-seal-'));
  process.env.POLICY_SEAL_KEY_DIR = dir;
});
afterAll(() => { delete process.env.POLICY_SEAL_KEY_DIR; });

/**
 * A FRESH ID PER CALL, from the same source production uses.
 *
 * This was built from `Date.now()`, which collides whenever two calls land in
 * the same millisecond — and `mintKey` opens with `wx` precisely so that minting
 * twice for one id is an error. It passed here and failed on the gate box, which
 * is faster: a green local run meant "no two calls happened to share a
 * millisecond", not "the ids are unique".
 */
const id = () => randomUUID();

describe('the key', () => {
  it('is minted once, read back, and gone after a shred', async () => {
    const analysis = id();
    const key = await mintKey(analysis);
    expect(key).toHaveLength(32);
    expect(existsSync(path.join(dir, `${analysis}.key`))).toBe(true);
    expect((await readKey(analysis))?.equals(key)).toBe(true);

    // Minting twice would replace the key the existing rows were written under.
    await expect(mintKey(analysis)).rejects.toThrow();

    expect(await shredKey(analysis)).toBe(true);
    expect(await readKey(analysis)).toBeNull();
    expect(existsSync(path.join(dir, `${analysis}.key`))).toBe(false);
    // Shredding what is already gone is the purge's normal case, not a failure.
    expect(await shredKey(analysis)).toBe(false);
  });
});

describe('the codec', () => {
  it('round-trips text and json, and tags what it wrote', async () => {
    const analysis = id();
    const seal = sealWithKey(await mintKey(analysis));
    const secret = 'The Council is accountable for delivery — “unpublished draft”, £2.4m.';
    const enc = seal.text(secret);
    expect(enc.startsWith(SEAL_PREFIX)).toBe(true);
    expect(enc).not.toContain('Council');
    expect(seal.readText(enc)).toBe(secret);

    const data = { otherAnalysisTitle: 'A different private paper', mentions: ['passage_0001'], severity: 0.62 };
    const encoded = seal.json(data);
    expect(JSON.stringify(encoded)).not.toContain('private paper');
    expect(seal.readJson(encoded)).toEqual(data);
    await shredKey(analysis);
  });

  it('passes plaintext through, so a row written before sealing existed still reads', async () => {
    const seal = sealWithKey(await mintKey(id()));
    expect(seal.readText('an ordinary statement')).toBe('an ordinary statement');
    expect(seal.readJson({ kind: 'claim' })).toEqual({ kind: 'claim' });
  });

  it('fails CLOSED on a wrong key rather than handing back the ciphertext', async () => {
    const mine = sealWithKey(await mintKey(id()));
    const theirs = sealWithKey(await mintKey(id()));
    const enc = mine.text('the paper says something');
    expect(theirs.readText(enc)).toBe(KEY_DESTROYED);
    expect(theirs.readText(enc)).not.toContain(enc.slice(SEAL_PREFIX.length, 40));
  });

  it('is inert on an unsealed run — no prefix, no cipher, no key read', () => {
    const seal = openSeal();
    expect(seal.sealed).toBe(false);
    expect(seal.text('x')).toBe('x');
    expect(sealRow(seal, 'artefact', { statement: 'x', data: { a: 1 } })).toEqual({ statement: 'x', data: { a: 1 } });
  });

  it('reads a destroyed run as a sentinel and refuses to write to it', () => {
    const seal = sealWithKey(null);
    expect(seal.sealed).toBe(true);
    expect(seal.destroyed).toBe(true);
    expect(seal.readText(`${SEAL_PREFIX}whatever`)).toBe(KEY_DESTROYED);
    expect(seal.readText('plain')).toBe('plain');
    expect(() => seal.text('x')).toThrow();
  });
});

describe('a row', () => {
  it('goes in encrypted and comes out as it went, field for field', async () => {
    const seal = sealWithKey(await mintKey(id()));
    const row = {
      id: 's1_0_claim', kind: 'claim', origin: 'extracted_fact', confidence: 0.9,
      label: 'Accountability', statement: 'The Council is accountable.', sourceQuote: 'is accountable for delivery',
      section: 'Delivery', url: null, page: 4, fromId: null, toId: null,
      data: { category: 'responsibility', notes: 'The paper states this' },
    };
    const stored = sealRow(seal, 'artefact', row);
    // The parts a query needs are untouched; the words are gone.
    expect(stored.id).toBe('s1_0_claim');
    expect(stored.kind).toBe('claim');
    expect(stored.confidence).toBe(0.9);
    expect(stored.page).toBe(4);
    expect(stored.url).toBeNull();
    const dump = JSON.stringify(stored);
    for (const word of ['Accountability', 'Council', 'accountable for delivery', 'Delivery', 'responsibility']) {
      expect(dump).not.toContain(word);
    }
    expect(unsealRow(seal, 'artefact', stored)).toEqual(row);
  });
});

/**
 * THE COMPLETENESS CHECK.
 *
 * Every `text()` and `jsonb()` column on the five sealed tables is either in the
 * manifest or in the list below, which says why it stays readable. A column in
 * neither fails here — which is the only way this ever gets noticed, because a
 * column left in the clear breaks nothing and shows nothing.
 */
const CLEAR: Record<string, string[]> = {
  policy_analyses: [
    'owner',        // scopes every query in the feature
    'depth', 'model', 'thinking_level', 'status', // execution settings and lifecycle, not the paper
  ],
  policy_documents: [
    'mime_type',    // decides the extractor before any key is read
    'sha256',       // the run's own integrity check; the shared offline pack already withholds it
  ],
  policy_stages: [
    'run_id', 'name', 'status', // the queue and the progress rail
    'output',       // `{ artefactIds, contractVersion, rejected }` — identifiers this pipeline minted
  ],
  policy_executions: ['run_id', 'status'],
  policy_artefacts: [
    'id', 'kind', 'origin', 'source_id', 'from_id', 'to_id', 'relation', 'temporal',
    // Identifiers and the graph. The twelve structural checks and three indexes
    // read these, and none of them is a word from the document.
  ],
};

const TABLE_FOR: Record<keyof typeof SEALED_FIELDS, string> = {
  analysis: 'policy_analyses',
  document: 'policy_documents',
  stage: 'policy_stages',
  execution: 'policy_executions',
  artefact: 'policy_artefacts',
};

function columnsOf(table: string): string[] {
  const schema = readFileSync('src/lib/db/schema.ts', 'utf8');
  const start = schema.indexOf(`pgTable('${table}', {`);
  if (start < 0) throw new Error(`table ${table} not found in schema.ts`);
  const end = schema.indexOf('\n}', start);
  const block = schema.slice(start, end);
  return [...block.matchAll(/\b(?:text|jsonb)\('([a-z_0-9]+)'/g)].map((m) => m[1]);
}

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

describe('every free-text column is accounted for', () => {
  for (const [kind, table] of Object.entries(TABLE_FOR) as [keyof typeof SEALED_FIELDS, string][]) {
    it(`${table}`, () => {
      const spec = SEALED_FIELDS[kind];
      const sealed = [...spec.text, ...spec.json].map(snake);
      const declared = new Set([...sealed, ...(CLEAR[table] ?? [])]);
      const unaccounted = columnsOf(table).filter((c) => !declared.has(c));
      expect(unaccounted, `add these to SEALED_FIELDS.${kind} or to CLEAR.${table} with a reason`).toEqual([]);
    });
  }
});
