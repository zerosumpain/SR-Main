/**
 * The assessment as a downloadable Word document.
 *
 * The dashboard is a dashboard — hover cards, a drill, filters — and none of
 * that survives being emailed to somebody who has to read it on a train or mark
 * it up before a meeting. Printing to PDF answers half of that and is already
 * wired; a `.docx` answers the other half, which is the copy somebody edits and
 * sends back.
 *
 * Two callers, one document. The owner exports their own assessment; the holder
 * of a share link exports the REDACTED one. They differ only in the artefact
 * list they are handed, because `assessmentMarkdown` is pure — so the two can
 * never drift into different reports, which is the failure this feature's own
 * audit found the first time round.
 *
 * The rendering goes through `synthesize()`, the repo's existing markdown → docx
 * path (`$lib/jkai/extract`), which is how `/projects/dfe-data-strategy` already
 * produces its Word brief. Building OOXML here would be a second one of those.
 */
import { synthesize } from '$lib/jkai/extract';
import { assessmentMarkdown, documentSlug, type DocMeta } from '../report-doc';
import type { Artefact } from '../contracts';

export type ExportFormat = 'docx' | 'md';

export const EXPORT_FORMATS: ExportFormat[] = ['docx', 'md'];

export function isExportFormat(value: string | null): value is ExportFormat {
  return EXPORT_FORMATS.includes(value as ExportFormat);
}

/**
 * Render and wrap in the response the browser will actually save.
 *
 * `content-disposition` uses the RFC 5987 form because a policy title is prose —
 * it carries quotes, em dashes and non-ASCII, none of which survive the plain
 * `filename=` parameter.
 */
export async function assessmentDocument(
  artefacts: Artefact[],
  meta: DocMeta,
  format: ExportFormat,
): Promise<Response> {
  const markdown = assessmentMarkdown(artefacts, meta);
  const slug = documentSlug(meta.title);

  if (format === 'md') {
    return new Response(markdown, {
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${slug}.md`)}`,
        'x-content-type-options': 'nosniff',
        'cache-control': 'private, no-store',
      },
    });
  }

  // NO `title` — the markdown already opens with `# <title>`, and passing it
  // here would put the name in twice, as a Word Title paragraph and again as
  // Heading 1. The markdown has to carry it because the `.md` export is the
  // same string.
  const rendered = await synthesize({ format: 'docx', source: 'markdown', content: markdown });
  return new Response(new Uint8Array(rendered.buffer), {
    headers: {
      'content-type': rendered.mimeType,
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${slug}.docx`)}`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
    },
  });
}
