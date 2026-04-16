import { db } from '$lib/db';
import { jkaiLogs } from '$lib/db/schema';
import { EventEmitter } from 'events';

// --- Event Emitter for SSE ---

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

export function onBuildLog(
  buildId: string,
  handler: (log: { id: number; type: string; content: string; iterationId: string | null }) => void,
): () => void {
  const key = `log:${buildId}`;
  emitter.on(key, handler);
  return () => emitter.off(key, handler);
}

// Strip null bytes and other control chars that break Postgres text columns
function sanitize(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

export async function emitLog(
  buildId: string,
  type: string,
  content: string,
  iterationId: string | null = null,
): Promise<void> {
  const safeContent = sanitize(content);
  const [log] = await db
    .insert(jkaiLogs)
    .values({ buildId, iterationId, type, content: safeContent })
    .returning();
  emitter.emit(`log:${buildId}`, {
    id: log.id,
    type: log.type,
    content: log.content,
    iterationId: log.iterationId,
  });
}
