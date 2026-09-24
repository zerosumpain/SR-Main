import { describe, it, expect } from 'vitest';
import { inArray } from 'drizzle-orm';
import { TransactionRollbackError } from 'drizzle-orm/errors';
import { db } from '$lib/db';
import { intelNotes } from '$lib/db/schema';
import { relabelKeptNews } from './relabel';

// Runs inside a transaction that is always rolled back. The relabel is
// table-wide by design, so outside one it would also move the dev database's
// real 'web' rows; `relabelKeptNews` takes an executor for exactly this.
describe.skipIf(!process.env.DATABASE_URL)('relabelKeptNews', () => {
  it("moves only 'web' notes carrying a newsKey, and a second run finds nothing", async () => {
    let seen: { first: number; second: number; rows: Record<string, string> } | null = null;
    try {
      await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(intelNotes)
          .values([
            {
              title: 'relabel test — kept story',
              rawContent: 'A story kept from /news.',
              source: 'web',
              metadata: { newsKey: 'relabel-test:kept' },
            },
            {
              title: 'relabel test — remember that',
              rawContent: 'A chat capture with no news key.',
              source: 'web',
              metadata: { note: 'no key here' },
            },
          ])
          .returning({ id: intelNotes.id, title: intelNotes.title });

        const first = await relabelKeptNews(tx);
        const after = await tx
          .select({ id: intelNotes.id, source: intelNotes.source })
          .from(intelNotes)
          .where(inArray(intelNotes.id, inserted.map((r) => r.id)));
        const second = await relabelKeptNews(tx);

        const byTitle: Record<string, string> = {};
        for (const row of inserted) byTitle[row.title ?? ''] = after.find((a) => a.id === row.id)?.source ?? '';
        seen = { first, second, rows: byTitle };
        tx.rollback();
      });
    } catch (err) {
      if (!(err instanceof TransactionRollbackError)) throw err;
    }

    expect(seen).not.toBeNull();
    const { first, second, rows } = seen!;
    // At least the synthetic story; the dev database may hold older kept ones.
    expect(first).toBeGreaterThanOrEqual(1);
    expect(rows['relabel test — kept story']).toBe('news');
    expect(rows['relabel test — remember that']).toBe('web');
    expect(second).toBe(0);

    // The rollback left nothing behind.
    const leftover = await db
      .select({ id: intelNotes.id })
      .from(intelNotes)
      .where(inArray(intelNotes.title, ['relabel test — kept story', 'relabel test — remember that']));
    expect(leftover).toHaveLength(0);
  });
});
