// The checklist vocabulary, mirrored from `blogChecklistItems` in
// $lib/db/schema.ts. These are the string unions the table's plain `text`
// columns actually hold — Drizzle cannot enforce them, so this file is the only
// place the set is written down. Change one here and the DB comment there in
// the same commit, or the two drift silently and nothing fails until a panel
// filter quietly matches nothing.

/** Which lane raised the item. 'claim' and 'voice' are the model's lanes; the
 *  rest are deterministic. See the severity rule at the top of checks.ts. */
export type CheckKind = 'claim' | 'link' | 'readability' | 'meta' | 'alt-text' | 'voice' | 'consistency';

/** 'blocker' is the only value that stops the publish gate. */
export type CheckSeverity = 'blocker' | 'review' | 'nit';

/** 'dismissed' is distinct from 'resolved': the author judged the item wrong,
 *  rather than acting on it. A re-run must not resurrect either. */
export type CheckStatus = 'open' | 'resolved' | 'dismissed';

/** One source a claim check consulted. `stance` is about the CLAIM, not about
 *  the source's quality — 'unclear' means the page was fetched and read and
 *  simply did not settle it, which is a different thing from no evidence. */
export type Evidence = {
  url: string;
  title: string;
  snippet: string;
  stance: 'supports' | 'contradicts' | 'unclear';
};

/** A finding as produced by a check, before it is persisted. No id, postId,
 *  status or runId: those belong to whoever writes the row. `anchorHash` is the
 *  idempotency key — (postId, anchorHash, kind) is unique in the table, so a
 *  re-run over unchanged text must produce the identical hash or the same
 *  finding lands twice under two identities. */
export type Finding = {
  kind: CheckKind;
  severity: CheckSeverity;
  title: string;
  detail: string;
  /** The offending snippet verbatim, so the editor can scroll to it. Null when
   *  the finding is about the whole post (a readability score, a missing tag)
   *  and there is nothing to point at. */
  anchorText: string | null;
  anchorHash: string;
  evidence?: Evidence[];
};

/**
 * A persisted checklist item — a `Finding` plus its row identity and lifecycle.
 *
 * Declared HERE rather than beside the queries in `store.server.ts` so the
 * editor panel can name the shape it renders. A Svelte component importing a
 * type from a `*.server.ts` module is a module-graph rule this repo does not
 * otherwise bend anywhere, and "it is only a type, the import is erased"
 * is exactly the assumption that stops being true at the first build tweak.
 */
export type ChecklistItem = Omit<Finding, 'evidence'> & {
  id: number;
  postId: number;
  evidence: Evidence[] | null;
  status: CheckStatus;
  runId: string | null;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
};
