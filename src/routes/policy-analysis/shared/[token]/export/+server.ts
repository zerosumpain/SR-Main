import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveShare } from '$lib/policy-analysis/server/shares';
import { assessmentDocument, isDownloadFormat } from '$lib/policy-analysis/server/export';
import { assessmentBundle } from '$lib/policy-analysis/server/bundle';
import { sharedPayload } from '$lib/policy-analysis/offline/payload';

/**
 * The shared copy, downloadable — as Word, as markdown, or as the offline pack.
 *
 * Same documents, same modules, REDACTED artefacts — `resolveShare` has already
 * run `shareableReport` over them, so the policy paper and the owner's other
 * assessments are gone before this sees the list, and the pack is built from
 * that same list rather than redacting a second time. The cover and the pack's
 * README both name what is withheld rather than letting the file look complete.
 *
 * It lives under `/policy-analysis/shared/[token]/` rather than under `/api`
 * because `PUBLIC_PATHS` admits that prefix and nothing else here; putting an
 * anonymous download behind the owner-gated API prefix would be a second,
 * differently-guarded door to the same capability.
 */
export const GET: RequestHandler = async (event) => {
  event.setHeaders({ 'cache-control': 'private, no-store' });
  const shared = await resolveShare(event.params.token);
  if (!shared) error(404, 'This link is not valid. It may have been revoked, or it may have expired.');

  const format = event.url.searchParams.get('format') ?? 'docx';
  if (!isDownloadFormat(format)) error(400, 'Unknown export format.');

  const meta = {
    title: shared.title,
    jurisdiction: shared.jurisdiction,
    policyArea: shared.policyArea,
    status: shared.status,
    completedAt: shared.completedAt,
    withheld: shared.withheld.map((w) => (w.kind === 'passage' ? 'the policy document itself' : 'cross-policy exposures naming other assessments')),
    warnings: shared.warnings,
  };

  if (format === 'bundle') {
    return assessmentBundle({ payload: sharedPayload(shared), meta });
  }

  return assessmentDocument(shared.artefacts, meta, format);
};
