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
  // Checked 2026-09-11 rather than asserted: OpenAI keeps API/Codex content for
  // up to 30 days of abuse monitoring and then deletes it, a conversation can be
  // deleted from that account sooner, and the order that once forced indefinite
  // preservation was lifted in October. The true claim is "not from here".
  const always = [
    'The copy OpenAI received in order to read the paper. They keep it for up to 30 days to check for abuse and then delete it, and it can be removed from that account sooner — but not from here. Whether it was also used to train future models depends on a setting on that account.',
  ];
  // THE BACKUP LINE THAT USED TO BE HERE IS GONE, and that is a fact about the
  // deployment rather than about this code: since 2026-09-11 the nightly
  // `pg_dump` excludes every policy table, and the backup script proves it by
  // reading its own output back before keeping the file. There is no copy of
  // this run in a backup to be reached or to stay unreadable.
  if (sealed) {
    return [
      ...always,
      `Nothing else. The key lived only in ${keyLocation} and is gone, so anything that did somehow hold this run's bytes could not read them — and a sealed run does no web searching, so no search provider holds a query derived from this document.`,
    ];
  }
  return [
    ...always,
    'This run was not sealed, so until the database tidies itself up its deleted rows remain in its own scratch space, readable to anyone who can already read the database. Seal a run at submission if that matters.',
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

The nightly backup does not copy these records at all, so nothing here outlives
the delete by sitting in a copy somewhere. The backup proves that to itself each
night by reading its own output back before keeping the file.

This receipt is not stored anywhere. It exists only as the file you are reading:
a record of the purge, kept in the database it emptied, would be a new trace of
the run it certifies the absence of.
`;
}
