import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requirePolicyOwner } from '$lib/policy-analysis/server/access';
import { detail } from '$lib/policy-analysis/server/store';
import { assessmentDocument, isDownloadFormat } from '$lib/policy-analysis/server/export';
import { assessmentBundle } from '$lib/policy-analysis/server/bundle';
import { ownerPayload } from '$lib/policy-analysis/offline/payload';

/**
 * Download the assessment: as a Word document, as the markdown behind it, or as
 * the OFFLINE PACK — a zip whose `index.html` is the whole dashboard, standalone.
 *
 * A GET rather than a POST because it is a download of something that already
 * exists: it changes nothing, so a reader can bookmark it, and the browser's own
 * save dialog does the rest. `?format=md` is there because the markdown is what
 * the .docx is rendered from, and handing it over costs nothing — somebody
 * pasting the assessment into their own template wants that and not a Word file
 * they have to strip.
 *
 * The owner's pack carries EVERYTHING, the extracted policy document included.
 * That is the difference from the shared pack and it is deliberate: an offline
 * copy is what you take into a room with no network, and a report you cannot
 * check against its own source is half a report. A pack made here should be
 * handled like the paper it contains.
 */
export const GET: RequestHandler = async (event) => {
  const owner = await requirePolicyOwner(event);
  const result = await detail(owner, event.params.id);
  if (!result) error(404, 'Analysis not found.');

  const format = event.url.searchParams.get('format') ?? 'docx';
  if (!isDownloadFormat(format)) error(400, 'Unknown export format.');

  const meta = {
    title: result.analysis.title,
    jurisdiction: result.analysis.jurisdiction,
    policyArea: result.analysis.policyArea,
    depth: result.analysis.depth,
    sealed: result.analysis.sealed,
    status: result.analysis.status,
    completedAt: result.analysis.completedAt,
    warnings: result.stages.flatMap((s) => s.warnings.map((text) => ({ stage: s.name, text }))),
  };

  if (format === 'bundle') {
    return assessmentBundle({
      payload: ownerPayload({
        title: result.analysis.title,
        sealed: result.analysis.sealed,
        jurisdiction: result.analysis.jurisdiction,
        policyArea: result.analysis.policyArea,
        status: result.analysis.status,
        completedAt: result.analysis.completedAt,
        // One document per analysis — `policy_documents_analysis_idx` is unique.
        documentSha256: result.documents[0]?.sha256 ?? null,
        artefacts: result.artefacts,
        stages: result.stages,
      }),
      meta,
    });
  }

  return assessmentDocument(result.artefacts, meta, format);
};
