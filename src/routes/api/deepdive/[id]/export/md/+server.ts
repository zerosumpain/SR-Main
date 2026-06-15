import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { researchSessions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { generateReportMarkdown } from '$lib/deepdive/docx-export';

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

/**
 * GET /api/deepdive/[id]/export/md
 * Serves the auto research report as a markdown download.
 */
export const GET: RequestHandler = async ({ params }) => {
  const [session] = await db
    .select({ topic: researchSessions.topic })
    .from(researchSessions)
    .where(eq(researchSessions.id, params.id))
    .limit(1);

  if (!session) return new Response('Session not found', { status: 404 });

  let md: string;
  try {
    md = await generateReportMarkdown(params.id);
  } catch (err: any) {
    // e.g. "Report not yet generated"
    return new Response(err?.message ?? 'Report unavailable', { status: 409 });
  }

  const filename = `deepdive-${slugify(session.topic)}-${new Date().toISOString().slice(0, 10)}.md`;

  return new Response(md, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
};
