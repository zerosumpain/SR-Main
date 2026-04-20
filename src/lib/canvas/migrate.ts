import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges } from '$lib/db/schema';
import { and, eq, ne, or } from 'drizzle-orm';
import { slugify } from './slug';

/**
 * Idempotent migration: brings every row in `workflows` into the canvas
 * format.
 *
 *  1. Rename `name` to `canvas:<slug>` (slug derived from the old name,
 *     with a collision suffix). The original name is preserved in
 *     `description` so the canvas index still shows a readable title.
 *  2. Convert any legacy `manual-trigger` node to the new `trigger`
 *     node type (same id, same position, same edges; config merged
 *     with kind=manual).
 *  3. For workflows with no trigger at all, synthesise one at (20,20)
 *     and wire it to whichever node was previously acting as the first
 *     root.
 *
 * Safe to run on every boot — each step short-circuits when already
 * done. Logs a summary.
 */
export async function migrateWorkflowsToCanvas(): Promise<void> {
  const all = await db.select().from(workflows);
  let renamed = 0;
  let convertedTriggers = 0;
  let synthesisedTriggers = 0;

  for (const wf of all) {
    // --- 1. Canvas naming ---------------------------------------------
    if (!wf.name.startsWith('canvas:')) {
      const originalName = wf.name;
      const baseSlug = slugify(originalName) || `wf-${wf.id.slice(0, 8)}`;
      let slug = baseSlug;
      let attempt = 1;
      while (attempt < 60) {
        const clash = await db
          .select({ id: workflows.id })
          .from(workflows)
          .where(and(eq(workflows.name, `canvas:${slug}`), ne(workflows.id, wf.id)));
        if (clash.length === 0) break;
        attempt += 1;
        slug = `${baseSlug}-${attempt}`;
      }
      await db
        .update(workflows)
        .set({
          name: `canvas:${slug}`,
          description: wf.description || originalName,
          updatedAt: new Date(),
        })
        .where(eq(workflows.id, wf.id));
      renamed += 1;
    }

    // --- 2. + 3. Trigger node -----------------------------------------
    const nodes = await db
      .select()
      .from(workflowNodes)
      .where(
        and(
          eq(workflowNodes.workflowId, wf.id),
          or(
            eq(workflowNodes.type, 'trigger'),
            eq(workflowNodes.type, 'manual-trigger'),
          ),
        ),
      );
    const hasNewTrigger = nodes.some((n) => n.type === 'trigger');
    const legacyTriggers = nodes.filter((n) => n.type === 'manual-trigger');

    if (!hasNewTrigger && legacyTriggers.length > 0) {
      // Convert each manual-trigger in place. Preserve id, position,
      // edges; extend config with kind=manual.
      for (const t of legacyTriggers) {
        const cfg = (t.config as Record<string, unknown> | null) ?? {};
        await db
          .update(workflowNodes)
          .set({
            type: 'trigger',
            label: t.label || 'Trigger',
            config: { ...cfg, kind: 'manual' },
          })
          .where(eq(workflowNodes.id, t.id));
        convertedTriggers += 1;
      }
    } else if (!hasNewTrigger && legacyTriggers.length === 0) {
      // Synthesise a trigger and wire it to the existing root(s).
      const [triggerNode] = await db
        .insert(workflowNodes)
        .values({
          workflowId: wf.id,
          type: 'trigger',
          label: 'Trigger',
          position: { x: 20, y: 20 },
          config: { kind: 'manual' },
        })
        .returning();

      const allNodes = await db
        .select()
        .from(workflowNodes)
        .where(eq(workflowNodes.workflowId, wf.id));
      const allEdges = await db
        .select()
        .from(workflowEdges)
        .where(eq(workflowEdges.workflowId, wf.id));
      const roots = allNodes
        .filter((n) => n.id !== triggerNode.id)
        .filter((n) => !allEdges.some((e) => e.targetNodeId === n.id));
      // Wire the trigger to the single topmost-leftmost root. If there
      // are multiple roots we only wire one — the others become
      // orphaned entry points the user can re-organise later.
      const firstRoot = roots.sort((a, b) => {
        const ap = (a.position as { x?: number; y?: number } | null) ?? {};
        const bp = (b.position as { x?: number; y?: number } | null) ?? {};
        const ay = typeof ap.y === 'number' ? ap.y : 0;
        const by = typeof bp.y === 'number' ? bp.y : 0;
        if (ay !== by) return ay - by;
        const ax = typeof ap.x === 'number' ? ap.x : 0;
        const bx = typeof bp.x === 'number' ? bp.x : 0;
        return ax - bx;
      })[0];
      if (firstRoot) {
        await db.insert(workflowEdges).values({
          workflowId: wf.id,
          sourceNodeId: triggerNode.id,
          targetNodeId: firstRoot.id,
        });
      }
      synthesisedTriggers += 1;
    }
  }

  if (renamed > 0 || convertedTriggers > 0 || synthesisedTriggers > 0) {
    console.log(
      `[canvas-migrate] renamed=${renamed} converted=${convertedTriggers} synthesised=${synthesisedTriggers} (of ${all.length} workflows)`,
    );
  }
}
