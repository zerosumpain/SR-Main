import { describe, it, expect } from 'vitest';
import { db } from '$lib/db';
import { intelNotes, intelAlerts } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { loadDailyAlerts } from './daily-alerts.server';

describe.skipIf(process.env.JKAI_LOCAL_TESTS !== '1')('daily alerts local database', () => {
  it('filters the daily window and dismissals, prioritises significance, and counts beyond the preview limit', async () => {
    const noteId = randomUUID();
    const now = new Date('2040-01-02T12:00:00Z');
    await db.insert(intelNotes).values({ id: noteId, rawContent: 'Synthetic daily alerts regression', source: 'test' });
    try {
      await db.insert(intelAlerts).values([
        ...Array.from({ length: 6 }, (_, i) => ({ noteId, type: 'connection', title: `Synthetic ${i}`, content: 'Sample evidence', significance: i === 0 ? 'high' : 'low', createdAt: new Date(now.getTime() - (i + 1) * 1000), delivered: true })),
        { noteId, type: 'connection', title: 'Boundary', content: 'Sample', significance: 'medium', createdAt: new Date(now.getTime() - 24 * 3_600_000) },
        { noteId, type: 'connection', title: 'Too old', content: 'Sample', createdAt: new Date(now.getTime() - 24 * 3_600_000 - 1) },
        { noteId, type: 'connection', title: 'Dismissed', content: 'Sample', dismissed: true, createdAt: now },
        { noteId, type: 'connection', title: 'Future', content: 'Sample', createdAt: new Date(now.getTime() + 1) },
      ]);
      const summary = await loadDailyAlerts(now);
      expect(summary).toMatchObject({ status: 'ok', total: 7, high: 1 });
      expect(summary.items).toHaveLength(6);
      expect(summary.items[0].title).toBe('Synthetic 0');
      expect(summary.items[1].title).toBe('Boundary');
      expect(summary.items.some((a) => ['Too old', 'Dismissed', 'Future'].includes(a.title))).toBe(false);
      expect((await loadDailyAlerts(new Date('2040-01-05T12:00:00Z'))).status).toBe('empty');
    } finally {
      await db.delete(intelNotes).where(eq(intelNotes.id, noteId));
    }
  });
});
