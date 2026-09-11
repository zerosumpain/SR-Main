import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requirePolicyOwner } from '$lib/policy-analysis/server/access';
import { detail } from '$lib/policy-analysis/server/store';
import { assessmentDocument, isExportFormat } from '$lib/policy-analysis/server/export';

/**
 * Download the assessment as a Word document, or as the markdown behind it.
 *
 * A GET rather than a POST because it is a download of something that already
 * exists: it changes nothing, so a reader can bookmark it, and the browser's own
 * save dialog does the rest. `?format=md` is there because the markdown is what
 * the .docx is rendered from, and handing it over costs nothing — somebody
 * pasting the assessment into their own template wants that and not a Word file
 * they have to strip.
 */
export const GET: RequestHandler = async (event) => {
  const owner = await requirePolicyOwner(event);
  const result = await detail(owner, event.params.id);
  if (!result) error(404, 'Analysis not found.');

  const format = event.url.searchParams.get('format') ?? 'docx';
  if (!isExportFormat(format)) error(400, 'Unknown export format.');

  return assessmentDocument(result.artefacts, {
    title: result.analysis.title,
    jurisdiction: result.analysis.jurisdiction,
    policyArea: result.analysis.policyArea,
    depth: result.analysis.depth,
    status: result.analysis.status,
    completedAt: result.analysis.completedAt,
    warnings: result.stages.flatMap((s) => s.warnings.map((text) => ({ stage: s.name, text }))),
  }, format);
};
