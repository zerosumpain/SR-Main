import type { RequestHandler } from './$types';
import { generateReport } from '$lib/deepdive/docx-export';
import { requireResearchSession } from '$lib/deepdive/session-access.server';

export const GET: RequestHandler = async (event) => {
  const { params } = event;
  // Outside the try: the guard's 404 must not be caught and reported as a 500.
  await requireResearchSession(event, params.id, 'read');
  try {
    const { buffer, filename } = await generateReport(params.id);

    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
