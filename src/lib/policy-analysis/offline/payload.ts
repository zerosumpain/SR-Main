/**
 * WHAT AN OFFLINE COPY OF AN ASSESSMENT CONTAINS.
 *
 * The dashboard is already a pure function of its artefacts — every component
 * under `$lib/components/policy-analysis` takes props and makes no request of
 * its own — so an offline copy is the same page with its data inlined rather
 * than loaded. This module decides what goes in, and it is pure so the rule can
 * be tested rather than trusted, exactly as `share.ts` is.
 *
 * TWO SCOPES, ONE BUILDER:
 *
 * - **owner** — the reader's own copy of their own assessment. It carries the
 *   `passage` artefacts, which are the extracted policy document itself. That is
 *   the point: an offline pack is what you take into a room with no network, and
 *   a report you cannot check against its source is half a report.
 * - **shared** — the copy a share link produces. Its artefacts have already
 *   been through `shareableReport` by the time they reach here, so the document
 *   and the reader's other assessments are gone on exactly the same rules as
 *   the shared page. There is no second redaction, deliberately: two
 *   implementations of "what may leave this account" is how a chapter goes
 *   missing from one of them.
 *
 * The payload is versioned because a bundle outlives the code that wrote it. A
 * pack opened in two years should be able to say what it is.
 */
import type { Artefact } from '../contracts';

export const PAYLOAD_VERSION = 1;

export type OfflineScope = 'owner' | 'shared';

export type OfflinePayload = {
  version: number;
  scope: OfflineScope;
  title: string;
  jurisdiction: string | null;
  policyArea: string | null;
  status: string;
  completedAt: string | null;
  /** When the pack was made — not when the assessment ran. */
  generatedAt: string;
  /** The source paper's digest, so a pack can be tied back to the document it read. */
  documentSha256: string | null;
  artefacts: Artefact[];
  warnings: { stage: string; text: string }[];
  withheld: { kind: string; count: number }[];
};

export type PayloadInput = {
  title: string;
  jurisdiction: string | null;
  policyArea: string | null;
  status: string;
  completedAt: Date | string | null;
  documentSha256?: string | null;
  artefacts: Artefact[];
  stages: { ordinal: number; name: string; warnings: string[] }[];
};

const iso = (v: Date | string | null | undefined): string | null =>
  v ? (v instanceof Date ? v.toISOString() : v) : null;

/**
 * The owner's own pack: everything the dashboard holds, nothing withheld.
 *
 * `withheld` is still present and empty rather than absent, because the offline
 * page renders the same "what this leaves out" note as the shared page and a
 * missing field and an empty one should not be two code paths.
 */
export function ownerPayload(input: PayloadInput, now = new Date()): OfflinePayload {
  return {
    version: PAYLOAD_VERSION,
    scope: 'owner',
    title: input.title,
    jurisdiction: input.jurisdiction,
    policyArea: input.policyArea,
    status: input.status,
    completedAt: iso(input.completedAt),
    generatedAt: now.toISOString(),
    documentSha256: input.documentSha256 ?? null,
    artefacts: input.artefacts,
    warnings: input.stages.flatMap((s) => s.warnings.map((text) => ({ stage: s.name, text }))),
    withheld: [],
  };
}

/**
 * The pack a share link produces.
 *
 * It takes a report that has ALREADY been through `shareableReport` — which is
 * what `resolveShare` hands its callers — rather than redacting again here.
 * There is one redactor in this feature and it is `share.ts`; a second
 * implementation of "what may leave this account" is how the two of them
 * eventually disagree. `offline.test.ts` asserts the property that matters
 * (no passages, no cross-policy) on the output, whoever produced it.
 *
 * No `documentSha256`: the digest of an unpublished paper is a confirmation
 * oracle. Anyone holding a candidate draft could check whether this assessment
 * read that exact file, which is precisely what withholding the passages is for.
 */
export function sharedPayload(
  input: {
    title: string;
    jurisdiction: string | null;
    policyArea: string | null;
    status: string;
    completedAt: Date | string | null;
    artefacts: Artefact[];
    warnings: { stage: string; text: string }[];
    withheld: { kind: string; count: number }[];
  },
  now = new Date(),
): OfflinePayload {
  return {
    version: PAYLOAD_VERSION,
    scope: 'shared',
    title: input.title,
    jurisdiction: input.jurisdiction,
    policyArea: input.policyArea,
    status: input.status,
    completedAt: iso(input.completedAt),
    generatedAt: now.toISOString(),
    documentSha256: null,
    artefacts: input.artefacts,
    warnings: input.warnings,
    withheld: input.withheld,
  };
}
