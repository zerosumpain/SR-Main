import type { Artefact } from './contracts';

/**
 * The pages of a real policy paper that are not policy.
 *
 * A government white paper opens with a cover, a command-paper imprint, a Crown
 * copyright notice and a contents list. Stage 1 asks every passage for claims,
 * mechanisms, assumptions and actors, and it insists on at least one mechanism
 * and one assumption with mandatory verbatim quotes. On a copyright notice there
 * is no honest answer to that, so a reasoning model deliberates and pads instead
 * of declining — MEASURED on 2026-09-10 against the Post-16 Education and Skills
 * white paper: 5,248 output tokens and 170 seconds for 742 characters of Open
 * Government Licence boilerplate, against 30 seconds for a page of actual prose.
 *
 * That is what killed the run. Pages 3, 4 and 5 of that paper are copyright,
 * contents and foreword — three in a row, which is exactly the number of
 * consecutive failures that ends a stage. The assessment died at page 5 of 72
 * without reading a single page of policy.
 *
 * So these pages are not sent. They are still INGESTED, still stored, still part
 * of the document record and still in the corpus that keeps the paper out of a
 * search engine — they are simply not handed to the model, and every one of them
 * is named in the assessment's warnings. A page that is skipped silently is a
 * page the reader cannot argue with.
 */

/** Below this, there is not enough text on the page to analyse. */
const MINIMUM_CHARACTERS = 120;
/** Above this, a page that mentions a licence is a page ABOUT a licence. */
const BOILERPLATE_CEILING = 2500;
/** Fewer survivors than this and the detection is wrong, not the document. */
const MINIMUM_SURVIVORS = 3;

const RIGHTS = /crown copyright|open government licence|nationalarchives\.gov\.uk\/doc\/open|\bisbn\b|stationery office/i;
const CONTENTS_HEADING = /\b(contents|table of contents|index)\b/i;

/** A line that ends in a page number — the shape of a contents entry. */
const ENTRY = /\s\d{1,4}$/;

/**
 * Why this passage carries no policy, or null if it does.
 *
 * Every rule is narrow and answers in words, because the reason is printed in
 * the assessment. A missed skip costs one slow call; a wrong skip costs a page
 * of somebody's policy, so where the rules are unsure they keep the page.
 */
export function boilerplateReason(passage: Artefact): string | null {
  const text = passage.statement ?? '';
  const trimmed = text.trim();
  if (trimmed.length < MINIMUM_CHARACTERS) return 'too little text on the page to analyse';
  if (trimmed.length <= BOILERPLATE_CEILING && RIGHTS.test(trimmed)) return 'copyright, licence and publication notice';

  const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
  const entries = lines.filter((l) => ENTRY.test(l)).length;
  // A contents page announces itself AND lists page numbers. Requiring both
  // keeps a policy page that happens to carry numbered lines.
  if (CONTENTS_HEADING.test(trimmed.slice(0, 200)) && entries >= 5 && entries * 2 >= lines.length) {
    return 'a contents list, not policy text';
  }
  return null;
}

export type SkippedPage = { id: string; page: number | null; label: string; reason: string };

/**
 * Split the passages into the ones worth a model call and the ones that are not.
 *
 * If almost nothing survives, the detector is wrong rather than the document —
 * an extractor that returns fragments for every page would otherwise delete the
 * whole assessment quietly. In that case nothing is skipped and the caller says
 * so.
 */
export function partitionFrontMatter(passages: Artefact[]): { analyse: Artefact[]; skipped: SkippedPage[]; distrusted: boolean } {
  const reasons = passages.map((passage) => ({ passage, reason: boilerplateReason(passage) }));
  const analyse = reasons.filter((r) => !r.reason).map((r) => r.passage);
  if (passages.length && analyse.length < MINIMUM_SURVIVORS) {
    return { analyse: passages, skipped: [], distrusted: true };
  }
  return {
    analyse,
    skipped: reasons.filter((r) => r.reason).map((r) => ({ id: r.passage.id, page: r.passage.page, label: r.passage.label, reason: r.reason! })),
    distrusted: false,
  };
}

/** What the assessment says about the pages it did not read. */
export function skippedNote(skipped: SkippedPage[], total: number): string {
  const named = skipped.slice(0, 8).map((s) => `${s.page ? `page ${s.page}` : s.label} (${s.reason})`).join(', ');
  return `${skipped.length} of ${total} pages carry no policy text and were not analysed: ${named}${skipped.length > 8 ? `, and ${skipped.length - 8} more` : ''}. They remain part of the document record.`;
}
