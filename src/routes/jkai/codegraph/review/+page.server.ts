// Review + forget, on one surface deliberately: you decide to retire something
// while you are looking at it, not on a separate screen you have to go find.
//
// "Forget" here means RETIRE — a tombstone with a reason, filtered out by the
// one loader in retrieve.ts. Never a delete: the provenance of why a rule was
// once believed is worth keeping, and a hard delete makes the decision
// unreviewable. The sibling intel graph learned the same thing with merges.
import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/db';
import { codegraphEpisodes, codegraphLessons } from '$lib/db/schema';
import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';

export const load: PageServerLoad = async ({ url }) => {
  const tab = url.searchParams.get('tab') === 'episodes' ? 'episodes' : 'lessons';
  const showRetired = url.searchParams.get('retired') === '1';

  if (tab === 'episodes') {
    const rows = await db.select().from(codegraphEpisodes)
      .where(showRetired ? isNotNull(codegraphEpisodes.retiredAt) : isNull(codegraphEpisodes.retiredAt))
      .orderBy(desc(codegraphEpisodes.servedCount), desc(codegraphEpisodes.occurredAt))
      .limit(60);
    return { tab, showRetired, episodes: rows, lessons: [] };
  }

  // Ordered by how often each has been SERVED, not by age: the thing the
  // builder actually reads is the thing worth checking is still true.
  const rows = await db.select().from(codegraphLessons)
    .where(showRetired ? isNotNull(codegraphLessons.retiredAt) : isNull(codegraphLessons.retiredAt))
    .orderBy(desc(codegraphLessons.servedCount), desc(codegraphLessons.staleAt), desc(codegraphLessons.observedAt))
    .limit(60);
  return { tab, showRetired, lessons: rows, episodes: [] };
};

export const actions: Actions = {
  retire: async ({ request }) => {
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    const kind = String(form.get('kind') ?? '');
    const reason = String(form.get('reason') ?? '').trim();
    if (!id) return fail(400, { message: 'missing id' });
    // A reason is REQUIRED. "Why did we stop believing this" is the only part
    // of a retirement that is useful six months later, and an optional field
    // here would be empty on every row.
    if (!reason) return fail(400, { message: 'a reason is required — say why it no longer applies' });

    if (kind === 'episode') {
      await db.update(codegraphEpisodes)
        .set({ retiredAt: new Date(), retiredReason: reason })
        .where(eq(codegraphEpisodes.id, id));
    } else {
      await db.update(codegraphLessons)
        .set({ retiredAt: new Date(), retiredReason: reason, updatedAt: new Date() })
        .where(eq(codegraphLessons.id, id));
    }
    return { ok: true };
  },

  restore: async ({ request }) => {
    // Retiring is reversible precisely because it is a tombstone and not a
    // delete. Without this, "forget" is a one-way door and nobody uses it.
    const form = await request.formData();
    const id = String(form.get('id') ?? '');
    const kind = String(form.get('kind') ?? '');
    if (!id) return fail(400, { message: 'missing id' });
    if (kind === 'episode') {
      await db.update(codegraphEpisodes).set({ retiredAt: null, retiredReason: null })
        .where(eq(codegraphEpisodes.id, id));
    } else {
      await db.update(codegraphLessons).set({ retiredAt: null, retiredReason: null, updatedAt: new Date() })
        .where(eq(codegraphLessons.id, id));
    }
    return { ok: true };
  },

  refreshStale: async () => {
    // Staleness = every repo path this lesson cites is gone from that repo.
    //
    // SENTINEL FIRST. If a path we know exists reads as missing, the check is
    // broken (wrong tree, no node table populated) and marking everything stale
    // would quarantine the whole corpus in one click. Refuse instead.
    const [{ live }] = await db.execute<{ live: number }>(sql`
      SELECT count(*)::int AS live FROM codegraph_nodes WHERE exists_on_head = true
    `).then((r) => r.rows as Array<{ live: number }>);
    if (!Number(live)) {
      return fail(409, { message: 'refusing: no node is marked as existing at HEAD, so the liveness data is not trustworthy. Run the backfill first.' });
    }

    await db.execute(sql`
      UPDATE codegraph_lessons l SET stale_at = now()
      WHERE l.retired_at IS NULL
        AND jsonb_array_length(l.cited_paths) > 0
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(l.cited_paths) AS p(path)
          JOIN codegraph_nodes n ON n.canonical_path = p.path AND n.repo = l.repo
          WHERE n.exists_on_head = true
        )
    `);
    // And un-stale anything whose files came back — a moved file that returns
    // must not stay quarantined forever.
    await db.execute(sql`
      UPDATE codegraph_lessons l SET stale_at = NULL
      WHERE l.stale_at IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(l.cited_paths) AS p(path)
          JOIN codegraph_nodes n ON n.canonical_path = p.path AND n.repo = l.repo
          WHERE n.exists_on_head = true
        )
    `);
    return { ok: true };
  },
};
