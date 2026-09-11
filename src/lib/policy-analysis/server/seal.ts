/**
 * SEALED RUNS — erasure that does not depend on finding the copies.
 *
 * A `DELETE` cannot give the guarantee this feature was asked for. Anything alive
 * at 02:30 is in up to fourteen nightly `pg_dump`s under `~/backups/vps-pg` and in
 * every restic snapshot beside them; deleted tuples sit in heap pages and WAL
 * until vacuum and checkpoint; and a run's own prose reaches OTHER analyses
 * through cross-policy findings and through the prompts those runs stored. No
 * amount of deleting reaches all of that.
 *
 * So a sealed run never writes readable bytes in the first place. Every free-text
 * column is AES-256-GCM under a key that lives OUTSIDE the database — therefore
 * outside the only thing that is ever pulled off the VPS — and purging the run
 * destroys the key first. Every copy of the ciphertext, wherever it has got to,
 * becomes permanently unreadable at that moment, without anyone having to find
 * it. That is the whole idea; the row deletion afterwards is hygiene.
 *
 * WHAT THIS DOES NOT COVER, and the UI says so at submission rather than at
 * deletion, because submission is when it can still be acted on: the model
 * provider received the document, and if research is enabled the search provider
 * received queries derived from it. Neither is reachable from here.
 */
import { randomBytes } from 'node:crypto';
import { chmod, mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { decryptWith, encryptWith } from '$lib/secrets/crypto';

/**
 * Tags a value as ciphertext.
 *
 * Non-sealed runs, and every row written before this existed, hold plaintext in
 * the same columns. The decoder must pass those through untouched rather than
 * throwing, and it must not guess from the shape of the string — a policy paper
 * can contain anything, including something that looks like hex triples. A
 * prefix makes it unambiguous, and the version in it means a future cipher can
 * be introduced without a migration.
 */
export const SEAL_PREFIX = 'sealed:v1:';

/** What a reader sees where a value cannot be decoded. Never a throw: a dashboard that 500s tells them less than one that says this. */
export const KEY_DESTROYED = '[sealed — the key for this run has been destroyed]';

/**
 * Where the keys live.
 *
 * `data/` by default, because ci-deploy rsyncs it WITHOUT `--delete` (so a
 * release does not take the keys of runs in flight) and because nothing backs it
 * up — `backup-vps-db.sh` takes a database dump and nothing else is pulled off
 * the VPS. Both of those are properties of the deployment, not of this code, so
 * they are asserted in `docs/implementation/policy-analysis.md` where an ops
 * change would be read against them.
 */
export function keyDir(): string {
  return process.env.POLICY_SEAL_KEY_DIR || path.join(process.cwd(), 'data', 'policy-keys');
}

const keyPath = (analysisId: string) => path.join(keyDir(), `${analysisId}.key`);

/** Mint a run's key. Fails loudly: a sealed run that silently fell back to plaintext would be the worst outcome here. */
export async function mintKey(analysisId: string): Promise<Buffer> {
  const dir = keyDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700).catch(() => {});
  const key = randomBytes(32);
  // `wx` so minting twice for one id is an error rather than silently replacing
  // the key that the run's existing rows were written under.
  const handle = await open(keyPath(analysisId), 'wx', 0o600);
  try {
    await handle.write(key.toString('hex'));
    await handle.sync();
  } finally {
    await handle.close();
  }
  return key;
}

/** The run's key, or null once it has been destroyed (or if it never existed). */
export async function readKey(analysisId: string): Promise<Buffer | null> {
  const hex = await readFile(keyPath(analysisId), 'utf8').catch(() => null);
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex.trim())) return null;
  return Buffer.from(hex.trim(), 'hex');
}

/**
 * Destroy a run's key.
 *
 * Overwrite, flush, then unlink. On a journalling filesystem an overwrite is not
 * a guarantee against the raw device, and pretending otherwise would be the kind
 * of overclaim this feature exists to avoid. **The guarantee is that the key was
 * never in a backup** — it is a file on the VPS, and the only thing ever pulled
 * off the VPS is a database dump. The overwrite is defence in depth against the
 * live disk, not the load-bearing part.
 *
 * Returns false when there was nothing to destroy, which a purge treats as "the
 * key is already gone" rather than as a failure.
 */
export async function shredKey(analysisId: string): Promise<boolean> {
  const file = keyPath(analysisId);
  const info = await stat(file).catch(() => null);
  if (!info) return false;
  await writeFile(file, randomBytes(Math.max(info.size, 64)), { flag: 'r+' }).catch(() => {});
  const handle = await open(file, 'r+').catch(() => null);
  if (handle) {
    try { await handle.sync(); } finally { await handle.close(); }
  }
  await rm(file, { force: true });
  return true;
}

/**
 * A codec for one analysis.
 *
 * `null` key means "not sealed" and every method is the identity, so the
 * ordinary path pays nothing — no branch in the caller, no file read, no cipher.
 */
export type Seal = {
  readonly sealed: boolean;
  /** True when the run IS sealed but its key is gone: the rows are ciphertext nobody can read. */
  readonly destroyed: boolean;
  text(value: string): string;
  textOrNull(value: string | null): string | null;
  json<T>(value: T): T;
  readText(value: string): string;
  readTextOrNull(value: string | null): string | null;
  readJson<T>(value: T): T;
};

const PASSTHROUGH: Seal = {
  sealed: false,
  destroyed: false,
  text: (v) => v,
  textOrNull: (v) => v,
  json: (v) => v,
  readText: (v) => v,
  readTextOrNull: (v) => v,
  readJson: (v) => v,
};

/** The codec for a run that is not sealed — exported so callers need no null check. */
export const openSeal = (): Seal => PASSTHROUGH;

export function sealWithKey(key: Buffer | null): Seal {
  if (!key) {
    // Sealed, key gone. Writing is refused outright rather than silently
    // producing plaintext beside ciphertext; reading yields the sentinel.
    return {
      sealed: true,
      destroyed: true,
      text: () => { throw new Error('This run is sealed and its key has been destroyed; it cannot be written to.'); },
      textOrNull: () => { throw new Error('This run is sealed and its key has been destroyed; it cannot be written to.'); },
      json: () => { throw new Error('This run is sealed and its key has been destroyed; it cannot be written to.'); },
      readText: (v) => (typeof v === 'string' && v.startsWith(SEAL_PREFIX) ? KEY_DESTROYED : v),
      readTextOrNull: (v) => (typeof v === 'string' && v.startsWith(SEAL_PREFIX) ? KEY_DESTROYED : v),
      readJson: <T>(v: T): T => (typeof v === 'string' && v.startsWith(SEAL_PREFIX) ? (KEY_DESTROYED as unknown as T) : v),
    };
  }

  const enc = (plain: string) => `${SEAL_PREFIX}${encryptWith(key, plain)}`;
  const dec = (value: string): string => {
    if (!value.startsWith(SEAL_PREFIX)) return value;
    try {
      return decryptWith(key, value.slice(SEAL_PREFIX.length));
    } catch {
      // A wrong key, a truncated column or a tampered tag. Fail closed and
      // visibly — returning the ciphertext would put it on the page.
      return KEY_DESTROYED;
    }
  };

  return {
    sealed: true,
    destroyed: false,
    text: enc,
    textOrNull: (v) => (v === null || v === undefined ? v : enc(v)),
    // JSON goes in as one string rather than field by field: a `data` object's
    // KEYS are as disclosive as its values (`otherAnalysisTitle`, `searchStrategy`)
    // and a per-field scheme would leave the shape of every artefact in the clear.
    json: <T>(v: T): T => (v === null || v === undefined ? v : (enc(JSON.stringify(v)) as unknown as T)),
    readText: dec,
    readTextOrNull: (v) => (v === null || v === undefined ? v : dec(v)),
    readJson: <T>(v: T): T => {
      if (typeof v !== 'string' || !v.startsWith(SEAL_PREFIX)) return v;
      const plain = dec(v);
      if (plain === KEY_DESTROYED) return {} as unknown as T;
      try { return JSON.parse(plain) as T; } catch { return {} as unknown as T; }
    },
  };
}

/** The codec for an analysis, from its `sealed` flag. */
export async function sealFor(analysis: { id: string; sealed: boolean | null }): Promise<Seal> {
  if (!analysis.sealed) return PASSTHROUGH;
  return sealWithKey(await readKey(analysis.id));
}

/**
 * EVERY COLUMN A SEALED RUN ENCRYPTS, IN ONE PLACE.
 *
 * This manifest is the thing to change when a column is added, and
 * `seal.test.ts` checks it against the schema: a new free-text column on any of
 * these tables fails the test until it is listed or explicitly excused. A column
 * that quietly stays in the clear is exactly the failure this feature cannot
 * have, and it is invisible to every other kind of review.
 *
 * WHAT IS DELIBERATELY LEFT CLEAR, and why:
 *
 * - **Ids, ordinals, statuses, timestamps, offsets, confidence, relations.** The
 *   queue, the leases, the twelve structural checks and every index run on these.
 *   They carry no document text; encrypting them would break the feature to hide
 *   nothing.
 * - **`policy_stages.output`** — `{ artefactIds, contractVersion, rejected }`.
 *   Identifiers the pipeline mints, not words from the paper.
 * - **`policy_documents.sha256` and `.size`.** The digest is the run's own
 *   integrity check and never leaves the owner's session; the pack that a share
 *   link produces already withholds it, for the confirmation-oracle reason.
 * - **`policy_model_calls.input` / `.output`.** Not encrypted because a sealed run
 *   DOES NOT WRITE THEM AT ALL. See `provider.ts`.
 */
export const SEALED_FIELDS = {
  analysis: { text: ['title', 'jurisdiction', 'policyArea', 'context', 'error'], json: [] },
  // `content` is the uploaded file as base64 and is the largest thing here; the
  // cipher's hex output doubles it, so a 3 MB paper stores about 8 MB. Well
  // inside Postgres' limits, and the alternative is a second binary code path.
  document: { text: ['filename', 'content', 'extractedText'], json: ['metadata'] },
  artefact: { text: ['label', 'statement', 'sourceQuote', 'section', 'url'], json: ['data'] },
  stage: { text: ['error'], json: ['warnings'] },
  execution: { text: ['error'], json: [] },
} as const;

type Row = Record<string, unknown>;

function apply(seal: Seal, row: Row, spec: { text: readonly string[]; json: readonly string[] }, direction: 'write' | 'read'): Row {
  if (!seal.sealed) return row;
  const out: Row = { ...row };
  for (const field of spec.text) {
    if (!(field in out)) continue;
    const v = out[field];
    if (v === null || v === undefined) continue;
    out[field] = direction === 'write' ? seal.text(String(v)) : seal.readText(String(v));
  }
  for (const field of spec.json) {
    if (!(field in out)) continue;
    const v = out[field];
    if (v === null || v === undefined) continue;
    out[field] = direction === 'write' ? seal.json(v) : seal.readJson(v);
  }
  return out;
}

/** Encrypt a row on its way into the database. A no-op on an unsealed run. */
export function sealRow<T extends Row>(seal: Seal, kind: keyof typeof SEALED_FIELDS, row: T): T {
  return apply(seal, row, SEALED_FIELDS[kind], 'write') as T;
}

/** Decrypt a row on its way out. A no-op on an unsealed run, and on any value without the prefix. */
export function unsealRow<T extends Row>(seal: Seal, kind: keyof typeof SEALED_FIELDS, row: T): T {
  return apply(seal, row, SEALED_FIELDS[kind], 'read') as T;
}
