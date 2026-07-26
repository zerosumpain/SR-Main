// The one-pager brief.
//
//   POST { entityId }                  brief on one entity
//   POST { entityIds: [...] }          brief across several
//   POST { dossierId }                 brief across everything pinned to a case file
//   POST { …, format: 'md' }           the same brief as a downloadable document
//   GET  ?entityId=…&format=md         so a page can offer a plain download link
//
// JSON responses carry `citations`, every one of which resolves to a real note
// id — assembling the evidence is the expensive half, and a brief nobody can
// trace back is not worth generating.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  assembleBriefContext,
  assembleDossierBriefContext,
  formatBriefDocument,
  generateBrief,
  type BriefContext,
} from '$lib/jkai/intel/brief';

interface BriefRequest {
  entityIds: string[];
  dossierId: string | null;
  format: 'json' | 'md';
}

function parseRequest(source: {
  entityId?: unknown;
  entityIds?: unknown;
  dossierId?: unknown;
  format?: unknown;
}): BriefRequest {
  const ids = [
    ...(Array.isArray(source.entityIds) ? source.entityIds.map(String) : []),
    ...(source.entityId ? [String(source.entityId)] : []),
  ]
    .map((id) => id.trim())
    .filter(Boolean);

  const dossierId = source.dossierId ? String(source.dossierId).trim() : null;
  if (!ids.length && !dossierId) throw error(400, 'entityId, entityIds or dossierId is required');

  const format = String(source.format ?? 'json').toLowerCase();
  if (format !== 'json' && format !== 'md') throw error(400, "format must be 'json' or 'md'");

  return { entityIds: [...new Set(ids)], dossierId, format };
}

async function contextFor(req: BriefRequest): Promise<BriefContext> {
  if (req.dossierId) {
    const context = await assembleDossierBriefContext(req.dossierId);
    if (!context) throw error(404, 'dossier not found');
    if (!context.subjects.length) {
      throw error(400, 'this dossier has no entities pinned to it yet');
    }
    return context;
  }

  const context = await assembleBriefContext(req.entityIds);
  if (!context.subjects.length) throw error(404, 'no such entity');
  return context;
}

function filename(context: BriefContext): string {
  const stem = context.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return `brief-${stem || 'intel'}-${context.generatedAt.slice(0, 10)}.md`;
}

async function respond(req: BriefRequest): Promise<Response> {
  const context = await contextFor(req);

  let result;
  try {
    result = await generateBrief(context);
  } catch (err) {
    // The assembly succeeded and the model did not — that is a 502, not a
    // mystery 500, and the message is the one worth showing the analyst.
    throw error(502, err instanceof Error ? err.message : 'brief generation failed');
  }

  if (req.format === 'md') {
    const doc = formatBriefDocument(result.markdown, context, result.citations);
    return new Response(doc, {
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
        'content-disposition': `attachment; filename="${filename(context)}"`,
      },
    });
  }

  return json({
    markdown: result.markdown,
    citations: result.citations,
    droppedMarkers: result.droppedMarkers,
    title: context.title,
    generatedAt: context.generatedAt,
    subjects: context.subjects.map((s) => ({
      id: s.id,
      name: s.name,
      typeName: s.typeName,
      icon: s.icon,
      degree: s.degree,
      noteCount: s.noteCount,
      confirmed: s.confirmed,
    })),
    sourceCount: context.sources.length,
    neighbourCount: context.neighbours.length,
  });
}

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return respond(parseRequest(body));
};

export const GET: RequestHandler = async ({ url }) => {
  return respond(
    parseRequest({
      entityId: url.searchParams.get('entityId') ?? undefined,
      entityIds: url.searchParams.getAll('entityIds'),
      dossierId: url.searchParams.get('dossierId') ?? undefined,
      format: url.searchParams.get('format') ?? undefined,
    }),
  );
};
