import { getRecordByKey, upsertRecord } from '$lib/datastore';
import { buildBoard } from './board';
import { listBacklog, MAX_ATTEMPTS, setPriority } from './backlog';
import { listEpics } from './epics';
import { buildEpicBacklog, type BacklogEpic } from './epic-backlog';
import { COLLECTIONS, SYSTEM_ACTOR, asData, type EpicData } from './types';
import { listCapabilities } from '$lib/daydream/appetite/store';
import { ensureSystemCollections } from './seed-apis';
import { suggestBacklogGrooming } from './backlog-grooming';
import { loadCustomToolHealth } from './context';

/** Reconcile from both intake ledgers. Every arrival is assigned automatically;
 * grouping never abandons deliverables, changes their status or starts a build.
 */
export async function loadEpicBacklog(): Promise<BacklogEpic[]> {
  await ensureSystemCollections();
  const [backlog, capabilities, tools, saved] = await Promise.all([
    listBacklog(undefined, { strict: true }), listCapabilities({ limit: null }), loadCustomToolHealth(), listEpics(),
  ]);
  const board = buildBoard({ backlog, capabilities: capabilities.map((c) => ({ ...c, evidence: c.cites })),
    tools, attemptCeiling: MAX_ATTEMPTS, settledLimit: null });
  const epics = buildEpicBacklog(board.items, saved);
  const now = new Date().toISOString();
  for (const epic of epics) {
    const old = saved.find((e) => e.slug === epic.slug);
    const ids = epic.deliverables.map((i) => i.id).sort();
    if (old?.automatic && JSON.stringify(old.deliverableIds) === JSON.stringify(ids) && old.label === epic.title) continue;
    const row: EpicData = { ...old, slug: epic.slug, label: epic.title, keywords: old?.keywords ?? [],
      memberSlugs: epic.deliverables.filter((i) => i.source === 'backlog').map((i) => i.slug),
      openSlugs: epic.deliverables.filter((i) => i.backlogStatus === 'open').map((i) => i.slug),
      shippedSlugs: epic.deliverables.filter((i) => i.backlogStatus === 'shipped').map((i) => i.slug),
      score: old?.score ?? 0, components: old?.components ?? {}, servedCount: old?.servedCount ?? 0,
      status: 'accepted', automatic: true, deliverableIds: ids, decidedBy: 'engine',
      createdAt: old?.createdAt ?? now, updatedAt: now };
    await upsertRecord(COLLECTIONS.epics, { key: epic.slug, data: asData(row) }, SYSTEM_ACTOR);
  }
  const suggestions = suggestBacklogGrooming(board.items, tools);
  const kept = new Set(saved.flatMap((e) => e.groomingKept ?? []));
  for (const epic of epics) epic.suggestions = suggestions.filter((s) =>
    epic.deliverables.some((i) => i.id === s.itemId) && !kept.has(s.id));
  return epics;
}

export async function updateEpic(slug: string, title: string, summary: string, priority?: number): Promise<void> {
  const current = (await loadEpicBacklog()).find((e) => e.slug === slug);
  if (!current) throw new Error('Epic no longer exists; reload the backlog');
  if (!title.trim()) throw new Error('An epic needs a title');
  if (priority != null && (!Number.isInteger(priority) || priority < 1 || priority > 5)) throw new Error('Priority must be P1–P5');
  const record = await getRecordByKey(COLLECTIONS.epics, slug, SYSTEM_ACTOR);
  const old = record!.data as unknown as EpicData;
  await upsertRecord(COLLECTIONS.epics, { key: slug, data: asData({ ...old,
    ownerTitle: title.trim().slice(0, 200), summary: summary.trim().slice(0, 2000), updatedAt: new Date().toISOString(),
  }) }, SYSTEM_ACTOR);
  if (priority != null) for (const item of [...current.deliverables, ...current.combinedDeliveries]) {
    if (item.source === 'backlog' && item.backlogStatus === 'open' && !item.foldedInto) await setPriority(item.slug, priority);
  }
}

/** Recompute before every decision so stale browser suggestions cannot retire changed work. */
export async function decideBacklogGrooming(id: string, decision: 'apply' | 'keep'): Promise<void> {
  const epics = await loadEpicBacklog();
  const epic = epics.find((e) => e.suggestions?.some((s) => s.id === id));
  const suggestion = epic?.suggestions?.find((s) => s.id === id);
  if (!epic || !suggestion) throw new Error('Suggestion changed or was already handled; reload the backlog');
  if (decision === 'keep') {
    const record = await getRecordByKey(COLLECTIONS.epics, epic.slug, SYSTEM_ACTOR);
    const old = record!.data as unknown as EpicData;
    await upsertRecord(COLLECTIONS.epics, { key: epic.slug, data: asData({ ...old,
      groomingKept: [...new Set([...(old.groomingKept ?? []), id])], updatedAt: new Date().toISOString(),
    }) }, SYSTEM_ACTOR);
    return;
  }
  const item = epic.deliverables.find((i) => i.id === suggestion.itemId)!;
  const { setParked, getBacklogItem, foldItems } = await import('./backlog');
  if (suggestion.kind === 'covered') {
    const reason = `Covered by ${suggestion.targetTitle} (${suggestion.targetId}); reviewed by owner`;
    if (item.source === 'backlog') await setParked(item.slug, true, reason);
    else {
      const { setCapabilityStatus } = await import('$lib/daydream/appetite/store');
      if (!await setCapabilityStatus(item.slug, 'declined', { by: 'owner', outcome: reason, outcomeRef: suggestion.targetId })) {
        throw new Error('Capability could not be retired; reload and try again');
      }
    }
    return;
  }
  const targetSlug = suggestion.targetId.replace(/^backlog:/, '');
  const [source, target] = await Promise.all([getBacklogItem(item.slug), getBacklogItem(targetSlug)]);
  if (!source || !target || source.status !== 'open' || target.status !== 'open' || source.attempts || target.attempts) {
    throw new Error('Work has changed or started building; reload before merging');
  }
  const { renderBacklogBrief } = await import('./grooming');
  // Save the complete source brief before folding. Retrying overwrites the same
  // key, and every builder consumes these requirements through renderBacklogBrief.
  await upsertRecord(COLLECTIONS.backlog, { key: target.slug, data: asData({ ...target,
    absorbedRequirements: { ...target.absorbedRequirements, [source.slug]: renderBacklogBrief(source) },
    updatedAt: new Date().toISOString(),
  }) }, SYSTEM_ACTOR);
  await foldItems([source.slug, target.slug], target.slug);
}
