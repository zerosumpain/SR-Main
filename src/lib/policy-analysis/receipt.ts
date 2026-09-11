/**
 * THE PURGE RECEIPT — what "I deleted it" is worth without one.
 *
 * A purge that reports success tells you the code ran. It does not tell you that
 * nothing is left, and this feature's own history is the argument: `remove()`
 * looked complete for two months while orphaning queue envelopes, leaving
 * cross-policy prose about the deleted paper on a neighbouring assessment, and
 * leaving that paper's artefacts inside other runs' stored prompts.
 *
 * So the purge ASKS — eleven probes, one per place a reference can live, each
 * returning a count that must be zero — and says plainly what it cannot reach,
 * because a receipt that quietly omits the model provider would be worse than no
 * receipt at all.
 *
 * THIS MODULE IS PURE AND THE PAGE IMPORTS IT. The probes themselves are SQL and
 * live in `server/census.ts`; they were in here until the dashboard needed
 * `receiptText` to offer the file, at which point importing this would have
 * pulled drizzle and a database connection into the browser bundle. Nothing under
 * `$lib/policy-analysis/server` carries a `$lib/server` prefix, so SvelteKit
 * would not have stopped it.
 */

export type Probe = {
  /** The table, as it is named in Postgres — a receipt is read by somebody checking, not by this code. */
  table: string;
  /** What was looked for, in words. */
  what: string;
  rows: number;
};

export type PurgeReceipt = {
  kind: 'policy-analysis-purge-receipt';
  version: 1;
  analysisId: string;
  sealed: boolean;
  keyDestroyed: boolean;
  purgedAt: string;
  probes: Probe[];
  /** True only when every probe returned zero. */
  clean: boolean;
  /** Named rather than implied. A receipt that omits these is a false comfort. */
  unreachable: string[];
};

/** What a purge cannot reach, stated plainly. `keyLocation` is passed in because this module may not read the filesystem. */
export function unreachable(sealed: boolean, keyLocation = 'the application host'): string[] {
  const always = [
    'The model provider received the document while the assessment ran. Nothing here can delete its copy; that is an account-level retention setting on the provider.',
  ];
  if (sealed) {
    return [
      ...always,
      `Ciphertext of this run may remain in database backups taken while it existed. It is unreadable: its key is gone, and the key was never in a backup — it lived only in ${keyLocation}, which nothing copies off.`,
      'No external research was carried out, so no search provider holds a query derived from this document.',
    ];
  }
  return [
    ...always,
    'This run was NOT sealed, so readable copies of its rows may remain in database backups taken while it existed, and in Postgres heap pages and write-ahead log until the next vacuum and checkpoint. Deleting the rows does not reach those. Seal a run at submission if that matters.',
    'If external research ran, the search provider received queries derived from this document.',
  ];
}

export function buildReceipt(input: { analysisId: string; sealed: boolean; keyDestroyed: boolean; probes: Probe[]; keyLocation?: string; at?: Date }): PurgeReceipt {
  return {
    kind: 'policy-analysis-purge-receipt',
    version: 1,
    analysisId: input.analysisId,
    sealed: input.sealed,
    keyDestroyed: input.keyDestroyed,
    purgedAt: (input.at ?? new Date()).toISOString(),
    probes: input.probes,
    clean: input.probes.every((p) => p.rows === 0),
    unreachable: unreachable(input.sealed, input.keyLocation),
  };
}

/**
 * The receipt as something a person reads.
 *
 * Deliberately NOT the assessment's title — the receipt outlives the run, and a
 * file called "purge receipt" carrying the name of an unpublished paper would
 * re-create the disclosure it is certifying the end of. The id is enough to tie
 * it to whatever record of the submission the owner keeps themselves.
 */
export function receiptText(r: PurgeReceipt): string {
  const width = Math.max(...r.probes.map((p) => p.table.length));
  return `POLICY ASSESSMENT — PURGE RECEIPT
${r.clean ? 'CLEAN — every probe returned zero.' : 'INCOMPLETE — see the counts below. Nothing has been left in a half-state; re-run the purge.'}

  Assessment   ${r.analysisId}
  Sealed       ${r.sealed ? 'yes' : 'no'}
  Key          ${r.sealed ? (r.keyDestroyed ? 'destroyed' : 'was already gone') : 'not applicable — this run was not sealed'}
  Purged at    ${r.purgedAt}

WHAT WAS CHECKED
${r.probes.map((p) => `  ${p.rows === 0 ? 'none' : String(p.rows).padStart(4)}  ${p.table.padEnd(width)}  ${p.what}`).join('\n')}

WHAT THIS CANNOT REACH
${r.unreachable.map((u) => `  - ${u}`).join('\n')}

This receipt is not stored anywhere. It exists only as the file you are reading:
a record of the purge, kept in the database it emptied, would be a new trace of
the run it certifies the absence of.
`;
}
