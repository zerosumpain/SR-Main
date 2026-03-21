import type { RequestHandler } from './$types';
import { generateReport } from '$lib/deepdive/docx-export';

export const GET: RequestHandler = async ({ params }) => {
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
