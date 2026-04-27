import { db } from '$lib/db';
import { sql } from 'drizzle-orm';
import { gmailHistoryCursors } from '$lib/db/schema';
import type { NewPulseEvent } from '$lib/db/schema';

export async function runHealthCheck(): Promise<NewPulseEvent[]> {
  const checks: Array<{ name: string; pass: boolean; detail?: string }> = [];

  try {
    await db.execute(sql`SELECT 1`);
    checks.push({ name: 'db', pass: true });
  } catch (e) {
    checks.push({ name: 'db', pass: false, detail: (e as Error).message });
  }

  try {
    const rows = await db.select().from(gmailHistoryCursors);
    const stale = rows.filter((r) => {
      const age = Date.now() - new Date(r.updatedAt).getTime();
      return age > 30 * 60 * 1000;
    });
    checks.push({
      name: 'gmail_watcher',
      pass: stale.length === 0,
      detail: stale.length === 0 ? undefined : `${stale.length} stale cursor(s)`,
    });
  } catch (e) {
    checks.push({ name: 'gmail_watcher', pass: false, detail: (e as Error).message });
  }

  const failing = checks.filter((c) => !c.pass);
  const summary =
    failing.length === 0
      ? `All ${checks.length} checks passed`
      : `${failing.length}/${checks.length} failing: ${failing.map((c) => c.name).join(', ')}`;

  return [
    {
      kind: 'health_check',
      severity: failing.length > 0 ? 'warn' : 'info',
      summary,
      details: { checks },
    } satisfies NewPulseEvent,
  ];
}
