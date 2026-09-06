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
  const suggestions = suggestBacklogGrooming(board.items, tools, new Set(saved.flatMap((e) => e.groomingOverrides ?? [])));
  const kept = new Set(saved.flatMap((e) => e.groomingKept ?? []));
  for (const epic of epics) {
    const ids = new Set(epic.deliverables.map((i) => i.id));
    epic.suggestions = suggestions.filter((s) => ids.has(s.itemId) && !kept.has(s.id));
    epic.groomingHistory = saved.flatMap((e) => e.groomingHistory ?? []).filter((a) => ids.has(a.itemId));
    epic.groomingOverrides = saved.flatMap((e) => e.groomingOverrides ?? []).filter((id) => ids.has(id));
  }
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
export async function decideBacklogGrooming(id: string, decision: 'apply' | 'keep', by: 'owner' | 'engine' = 'owner', prepared?: BacklogEpic[]): Promise<void> {
  const epics = prepared ?? await loadEpicBacklog();
  const epic = epics.find((e) => e.suggestions?.some((s) => s.id === id));
  const suggestion = epic?.suggestions?.find((s) => s.id === id);
  if (!epic || !suggestion) throw new Error('Suggestion changed or was already handled; reload the backlog');
  if (decision === 'keep') {
    const record = await getRecordByKey(COLLECTIONS.epics, epic.slug, SYSTEM_ACTOR);
    const old = record!.data as unknown as EpicData;
    await upsertRecord(COLLECTIONS.epics, { key: epic.slug, data: asData({ ...old,
      groomingOverrides: [...new Set([...(old.groomingOverrides ?? []), suggestion.itemId])],
      groomingKept: [...new Set([...(old.groomingKept ?? []), id])], updatedAt: new Date().toISOString(),
    }) }, SYSTEM_ACTOR);
    return;
  }
  const item = epic.deliverables.find((i) => i.id === suggestion.itemId)!;
  const audit = async (state: 'pending' | 'applied') => {
    const record = await getRecordByKey(COLLECTIONS.epics, epic.slug, SYSTEM_ACTOR);
    const old = record!.data as unknown as EpicData;
    const entry = { id, itemId: item.id, itemTitle: item.title, targetId: suggestion.targetId,
      targetTitle: suggestion.targetTitle, kind: suggestion.kind, at: new Date().toISOString(), by, state };
    await upsertRecord(COLLECTIONS.epics, { key: epic.slug, data: asData({ ...old,
      groomingHistory: [...(old.groomingHistory ?? []).filter((a) => a.id !== id), entry],
    }) }, SYSTEM_ACTOR);
  };
  await audit('pending');
  const { setParked, getBacklogItem, foldItems } = await import('./backlog');
  if (suggestion.kind === 'covered') {
    const reason = `Covered by ${suggestion.targetTitle} (${suggestion.targetId}); ${by === 'engine' ? 'automatically consolidated' : 'reviewed by owner'}`;
    if (item.source === 'backlog') {
      const source = await getBacklogItem(item.slug);
      if (!source || source.status !== 'open' || source.attempts || source.title !== item.title || source.detail !== item.detail || JSON.stringify(source.grooming ?? null) !== JSON.stringify(item.grooming)) throw new Error('Suggestion changed; delivery or requirements changed');
      await setParked(item.slug, true, reason);
    }
    else {
      const { getCapability, setCapabilityStatus } = await import('$lib/daydream/appetite/store');
      const current = await getCapability(item.slug);
      if (!current || current.status !== 'proposed' || current.need !== item.detail) throw new Error('Suggestion changed; capability changed');
      if (!await setCapabilityStatus(item.slug, 'declined', { by, outcome: reason, outcomeRef: suggestion.targetId })) {
        throw new Error('Capability could not be retired; reload and try again');
      }
    }
    await audit('applied');
    return;
  }
  if (item.source === 'capability') {
    const { getCapability, setCapabilityStatus, setMergedCapabilityRequirements } = await import('$lib/daydream/appetite/store');
    const source = await getCapability(item.slug);
    if (!source || source.status !== 'proposed') throw new Error('Suggestion changed; capability started building');
    const brief = `${source.title}\n${source.need}\nValue: ${source.value}\nConsumer: ${source.consumer}\nIntegration: ${source.integrationHint ?? ''}\nEvidence: ${source.cites.join('\n')}`;
    if (suggestion.targetId.startsWith('backlog:')) {
      const target = await getBacklogItem(suggestion.targetId.slice(8));
      if (!target || target.status !== 'open' || target.attempts) throw new Error('Suggestion changed; matching deliverable started');
      await upsertRecord(COLLECTIONS.backlog, { key: target.slug, data: asData({ ...target,
        absorbedRequirements: { ...target.absorbedRequirements, [item.id]: brief }, updatedAt: new Date().toISOString(),
      }) }, SYSTEM_ACTOR);
    } else await setMergedCapabilityRequirements(suggestion.targetId.slice(11), source.slug, brief);
    if (!await setCapabilityStatus(source.slug, 'declined', { by, outcome: `Merged into ${suggestion.targetTitle}`, outcomeRef: suggestion.targetId })) throw new Error('Could not retire merged capability');
    await audit('applied');
    return;
  }
  const targetSlug = suggestion.targetId.replace(/^backlog:/, '');
  const [source, target] = await Promise.all([getBacklogItem(item.slug), getBacklogItem(targetSlug)]);
  if (!source || !target || source.status !== 'open' || target.status !== 'open' || source.attempts || target.attempts) {
    throw new Error('Suggestion changed; delivery started building');
  }
  const { renderBacklogBrief } = await import('./grooming');
  // Save the complete source brief before folding. Retrying overwrites the same
  // key, and every builder consumes these requirements through renderBacklogBrief.
  await upsertRecord(COLLECTIONS.backlog, { key: target.slug, data: asData({ ...target,
    absorbedRequirements: { ...target.absorbedRequirements, [source.slug]: renderBacklogBrief(source) },
    updatedAt: new Date().toISOString(),
  }) }, SYSTEM_ACTOR);
  await foldItems([source.slug, target.slug], target.slug);
  await audit('applied');
}

/** Restoring also pins the source apart so the next intake cannot undo the override. */
export async function overrideBacklogGrooming(itemId: string, keepSeparate: boolean): Promise<void> {
  const epics = await loadEpicBacklog();
  const epic = epics.find((e) => e.deliverables.some((i) => i.id === itemId));
  if (!epic) throw new Error('Deliverable no longer exists');
  const item = epic.deliverables.find((i) => i.id === itemId)!;
  const saved = await listEpics();
  const actions = saved.flatMap((e) => e.groomingHistory ?? []).filter((a) => a.itemId === itemId && a.state !== 'undone');
  // Persist the override first, so a failed restoration remains protected.
  for (const meta of saved.filter((e) => e.slug === epic.slug || e.groomingOverrides?.includes(itemId) || e.groomingHistory?.some((a) => a.itemId === itemId))) {
    await upsertRecord(COLLECTIONS.epics, { key: meta.slug, data: asData({ ...meta,
      groomingOverrides: [...new Set([...(meta.groomingOverrides ?? []).filter((id) => id !== itemId), ...(keepSeparate ? [itemId] : [])])],
      groomingKept: keepSeparate ? meta.groomingKept : [],
    }) }, SYSTEM_ACTOR);
  }
  if (!keepSeparate || !actions.length) return;
  if (item.source === 'backlog') {
    const { setParked, getBacklogItem } = await import('./backlog');
    const source = await getBacklogItem(item.slug);
    if (!source || source.status === 'shipped' || source.attempts > 0) throw new Error('This delivery has already started; it cannot be restored automatically');
    await setParked(item.slug, false);
    for (const action of actions.filter((a) => a.kind === 'merge' && a.targetId.startsWith('backlog:'))) {
      const target = await getBacklogItem(action.targetId.slice(8));
      if (target?.status === 'open' && target.attempts === 0 && target.absorbedRequirements?.[item.slug]) {
        const requirements = { ...target.absorbedRequirements }; delete requirements[item.slug];
        await upsertRecord(COLLECTIONS.backlog, { key: target.slug, data: asData({ ...target, absorbedRequirements: requirements }) }, SYSTEM_ACTOR);
      }
    }
  } else {
    const { setCapabilityStatus, getCapability, setMergedCapabilityRequirements } = await import('$lib/daydream/appetite/store');
    if (!await setCapabilityStatus(item.slug, 'proposed', { by: 'owner', outcome: 'Restored separately by owner' })) throw new Error('Could not restore capability');
    for (const action of actions.filter((a) => a.kind === 'merge')) {
      if (action.targetId.startsWith('capability:')) {
        const target = await getCapability(action.targetId.slice(11));
        if (target?.status === 'proposed') await setMergedCapabilityRequirements(target.slug, item.slug, null);
      } else {
        const { getBacklogItem } = await import('./backlog');
        const target = await getBacklogItem(action.targetId.slice(8));
        if (target?.status === 'open' && target.attempts === 0) {
          const requirements = { ...target.absorbedRequirements }; delete requirements[item.id];
          await upsertRecord(COLLECTIONS.backlog, { key: target.slug, data: asData({ ...target, absorbedRequirements: requirements }) }, SYSTEM_ACTOR);
        }
      }
    }
  }
  // Mark history only after restoration succeeds. A failed call is safe to retry.
  for (const meta of await listEpics()) if (meta.groomingHistory?.some((a) => a.itemId === itemId && a.state !== 'undone')) {
    await upsertRecord(COLLECTIONS.epics, { key: meta.slug, data: asData({ ...meta,
      groomingHistory: meta.groomingHistory.map((a) => a.itemId === itemId ? { ...a, state: 'undone' } : a),
    }) }, SYSTEM_ACTOR);
  }
}
