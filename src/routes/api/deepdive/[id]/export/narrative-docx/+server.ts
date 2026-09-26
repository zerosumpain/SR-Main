import type { RequestHandler } from './$types';
import { generateNarrativeReport } from '$lib/deepdive/docx-export';
import { requireResearchSession } from '$lib/deepdive/session-access.server';

export const GET: RequestHandler = async (event) => {
  const { params } = event;
  await requireResearchSession(event, params.id, 'read');
  const result = await generateNarrativeReport(params.id);

  if (!result) {
    return new Response('No narrative items found', { status: 404 });
  }

  return new Response(new Uint8Array(result.buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${result.filename}"`,
    },
  });
};
