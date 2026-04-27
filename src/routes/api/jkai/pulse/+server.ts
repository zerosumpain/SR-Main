import { db } from '$lib/db';
import { pulseEvents } from '$lib/db/schema';
import { desc } from 'drizzle-orm';
import { subscribePulse } from '$lib/workflows/chat/pulse-bus';

export async function GET({ url }: { url: URL }) {
  if (url.searchParams.get('mode') === 'list') {
    const rows = await db.select().from(pulseEvents).orderBy(desc(pulseEvents.at)).limit(50);
    return Response.json({ events: rows });
  }

  let unsub: (() => void) | null = null;
  let ka: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (e: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));

      void db.select().from(pulseEvents).orderBy(desc(pulseEvents.at)).limit(20).then((rows) => {
        for (const row of rows.slice().reverse()) send(row);
      });

      unsub = subscribePulse(send);
      ka = setInterval(() => controller.enqueue(enc.encode(': keepalive\n\n')), 25_000);
    },
    cancel() {
      if (unsub) { unsub(); unsub = null; }
      if (ka) { clearInterval(ka); ka = null; }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
