<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { postThought } from '$lib/daydream/feed-client';
  import DrillPanel from '$lib/components/jkai/daydream/hub/DrillPanel.svelte';
  import BacklogEditor from './BacklogEditor.svelte';
  import { STAGE_META, WORK_STAGES, kindLabel, type WorkItem } from '$lib/selfimprove/board';
  import type { BacklogEpic } from '$lib/selfimprove/epic-backlog';

  let { epics, error }: { epics: BacklogEpic[]; error: string | null } = $props();
  let query = $state('');
  let groomingOnly = $state(false);
  let showHistory = $state(false);
  let category = $state('all');
  let status = $state('all');
  let laneLimit = $state(20);
  let openId = $state<string | null>(null);
  let editing = $state<string | null>(null);
  let creating = $state(false);
  let adding = $state(false);
  let busy = $state(false);
  let actionError = $state<string | null>(null);
  let deliverableQuery = $state('');
  let deliverableCategory = $state('all');
  let title = $state('');
  let summary = $state('');
  const open = $derived(epics.find((e) => e.slug === openId));
  const deliverables = $derived((open?.deliverables ?? []).filter((i) =>
    (showHistory || i.stage !== 'parked') &&
    (deliverableCategory === 'all' || i.kind === deliverableCategory) &&
    [i.title, i.detail].join(' ').toLowerCase().includes(deliverableQuery.toLowerCase())));
  const edited = $derived([...(open?.deliverables ?? []), ...(open?.combinedDeliveries ?? [])].find((i) => i.id === editing) ?? null);
  const filtered = $derived(epics.filter((e) =>
    (!groomingOnly || (e.suggestions?.length ?? 0) > 0) &&
    (status === 'all' || (status === 'active' ? !['live', 'parked'].includes(e.stage) : e.stage === status)) &&
    (category === 'all' || e.categories.includes(category)) &&
    [e.title, e.summary, ...e.deliverables.flatMap((i) => [i.title, i.detail, i.kind])].join(' ').toLowerCase().includes(query.trim().toLowerCase())));
  $effect(() => { query; status; category; groomingOnly; laneLimit = 20; });

  function show(epic: BacklogEpic) {
    showHistory = false; deliverableQuery = ''; deliverableCategory = 'all';
    openId = epic.slug; title = epic.title; summary = epic.summary; editing = null; adding = false; actionError = null;
  }
  function close() { openId = null; editing = null; adding = false; }
  async function act(body: Record<string, unknown>) {
    busy = true; actionError = null;
    try {
      const result = await postThought(body);
      if (!result.ok || result.out.ok === false) actionError = result.error ?? 'The update was not completed.';
      await invalidateAll();
    } finally { busy = false; }
  }
  function savedDeliverable() { editing = null; adding = false; }
  function changePriority(item: WorkItem, priority: number) {
    return act({ action: 'backlog_priority', slug: item.slug, priority });
  }
</script>

<div class="epic-toolbar">
  <input class="nm-text-input" aria-label="Search epics and deliverables" placeholder="Search epics and deliverables…" bind:value={query} />
  <select class="nm-text-input" aria-label="Filter epics by status" bind:value={status}>
    <option value="active">Active epics</option><option value="all">All epics</option>
    {#each Object.entries(STAGE_META) as [value, meta]}<option {value}>{meta.label}</option>{/each}
  </select>
  <select class="nm-text-input" aria-label="Filter epics by category" bind:value={category}>
    <option value="all">All categories</option>
    {#each [...new Set(epics.flatMap((e) => e.categories))].sort() as value}<option {value}>{kindLabel(value)}</option>{/each}
  </select>
  <button class="nm-btn-ghost" aria-pressed={groomingOnly} onclick={() => groomingOnly = !groomingOnly}>Needs review ({epics.reduce((n, e) => n + (e.suggestions?.length ?? 0), 0)})</button>
  <button class="nm-save-btn" onclick={() => creating = true}>Add epic</button>
</div>
<p class="ledger-count" role="status">{filtered.length} epics · automatic grouping and de-duplication on intake · {epics.reduce((n, e) => n + (e.groomingHistory?.filter((a) => a.state === 'applied').length ?? 0), 0)} consolidated · {epics.reduce((n, e) => n + (e.groomingOverrides?.length ?? 0), 0)} kept separate</p>
{#if error}<p class="err" role="alert">The epic backlog could not be loaded: {error}</p>{/if}
{#if actionError && !open}<p class="err" role="alert">{actionError}</p>{/if}
<div class="kanban" role="region" aria-label="Epic kanban board" tabindex="0">
  {#each WORK_STAGES.filter((stage) => status === 'all' || (status === 'active' ? !['live', 'parked'].includes(stage) : status === stage)) as stage}
    {@const lane = filtered.filter((e) => e.stage === stage)}
    <section class="kanban-lane" aria-label={STAGE_META[stage].label}>
      <header class="lane-heading"><h2>{STAGE_META[stage].label}</h2><span>{lane.length}</span></header>
      <div class="lane-cards">
        {#each lane.slice(0, laneLimit) as epic (epic.slug)}
          <button class="epic-row" onclick={() => show(epic)}>
            <span class="card-meta"><span class="priority">P{epic.priority}</span><span>{epic.categories.map(kindLabel).join(' · ')}</span></span>
            <strong>{epic.title}</strong>
            <span class="epic-progress">{epic.deliverables.filter((i) => i.stage !== 'parked').length} active deliverables · {epic.completed} live</span>
            {#if epic.suggestions?.length}<span class="card-review">{epic.suggestions.length} to review</span>{/if}
            {#if epic.groomingHistory?.some((a) => a.state === 'applied')}<span class="card-history">{epic.groomingHistory.filter((a) => a.state === 'applied').length} consolidated · Review / undo →</span>{/if}
          </button>
        {:else}<p class="lane-empty">No epics</p>{/each}
        {#if lane.length > laneLimit}<button class="nm-btn-ghost" onclick={() => laneLimit += 20}>Show more ({lane.length - laneLimit})</button>{/if}
      </div>
    </section>
  {/each}
</div>

{#if open}
  <DrillPanel label={open.title} kicker="Epic / Deliverables" onclose={close} wide>
    <div class="epic-modal">
      <header class="epic-modal-head"><h2>{open.title}</h2><span class="pill t-{STAGE_META[open.stage].tone}">{STAGE_META[open.stage].label}</span></header>
      {#if actionError}<p class="err" role="alert">{actionError}</p>{/if}
      {#if open.groomingHistory?.length}
        <details class="automation-history">
          <summary>Automatic consolidation / overrides ({open.groomingHistory.length})</summary>
          {#each [...open.groomingHistory].reverse() as entry (entry.id)}
            <div class="automation-entry">
              <strong>{entry.itemTitle}</strong>
              <p>{entry.state === 'undone' ? 'Restored separately' : entry.state === 'pending' ? 'Consolidation pending' : entry.kind === 'merge' ? 'Requirements merged' : 'Already covered'} · {entry.targetTitle}</p>
              {#if entry.state !== 'undone'}<button class="nm-btn-ghost" disabled={busy} onclick={() => act({ action: 'backlog_grooming_override', itemId: entry.itemId, keepSeparate: true })}>Restore separately</button>{/if}
            </div>
          {/each}
        </details>
      {/if}
      {#if editing || adding}
        <button class="nm-btn-ghost" onclick={savedDeliverable}>← All deliverables</button>
        {#key editing ?? 'new'}<BacklogEditor item={edited} embedded epicSlug={open.slug} onclose={savedDeliverable} />{/key}
      {:else}
        <div class="epic-toolbar modal-toolbar">
          <span class="sr-label-tight">{open.deliverables.length} deliverables</span>
          <button class="nm-save-btn" onclick={() => adding = true}>Add deliverable</button>
          <fieldset class="priority-controls"><legend>Set priority for open deliverables</legend>
            {#each [1, 2, 3, 4, 5] as priority}<button class="nm-btn-ghost" disabled={busy} onclick={() => act({ action: 'epic_update', slug: open.slug, title, summary, priority })}>P{priority}</button>{/each}
          </fieldset>
        </div>
        <div class="epic-toolbar">
          <input class="nm-text-input" aria-label="Search deliverables in epic" placeholder="Find a deliverable…" bind:value={deliverableQuery} />
          <select class="nm-text-input" aria-label="Filter deliverable category" bind:value={deliverableCategory}>
            <option value="all">All deliverable categories</option>{#each open.categories as value}<option {value}>{kindLabel(value)}</option>{/each}
          </select>
        </div>
        <label class="history-toggle"><input type="checkbox" bind:checked={showHistory} /> Show parked and merged history</label>
        <details class="epic-definition"><summary>Edit epic definition</summary>
          <label>Epic title<input class="nm-text-input" bind:value={title} maxlength="200" /></label>
          <label>Outcome<textarea class="nm-text-input" bind:value={summary} rows="2" maxlength="2000"></textarea></label>
          <button class="nm-save-btn" disabled={busy || !title.trim()} onclick={() => act({ action: 'epic_update', slug: open.slug, title, summary })}>Save definition</button>
        </details>
        {#if open.summary}<p class="epic-summary">{open.summary}</p>{/if}
        <div class="deliverables">
          {#each deliverables as item (item.id)}
            <article class="deliverable">
              <header><span class="sr-label-tight">{kindLabel(item.kind)}</span><strong>{item.title.replace(/^Epic:\s*/i, '')}</strong>
                <span class="pill t-{STAGE_META[item.stage].tone}">{STAGE_META[item.stage].label}{item.foldedInto ? ' · combined delivery' : ''}</span>
              </header>
              {#if item.detail}<p>{item.detail}</p>{/if}
              {#each (open.suggestions ?? []).filter((s) => s.itemId === item.id) as suggestion (suggestion.id)}
                <div class="grooming-review">
                  <strong>{suggestion.kind === 'covered' ? 'Possibly already covered' : 'Suggested merge'} · {suggestion.targetTitle}</strong>
                  <p>{suggestion.reason}</p>
                  <div class="deliverable-actions">
                    {#if suggestion.targetHref}<a class="nm-btn-ghost" href={suggestion.targetHref}>Inspect existing feature →</a>{/if}
                    {#if epics.some((e) => e.deliverables.some((d) => d.id === suggestion.targetId))}
                      <button class="nm-btn-ghost" onclick={() => { const target = epics.find((e) => e.deliverables.some((d) => d.id === suggestion.targetId)); if (target) { show(target); deliverableQuery = suggestion.targetTitle; } }}>Inspect matching deliverable</button>
                    {/if}
                    <button class="nm-save-btn" disabled={busy} onclick={() => act({ action: 'backlog_grooming_decide', id: suggestion.id, decision: 'apply' })}>{suggestion.kind === 'covered' ? 'Remove from active backlog' : 'Merge requirements'}</button>
                    <button class="nm-btn-ghost" disabled={busy} onclick={() => act({ action: 'backlog_grooming_decide', id: suggestion.id, decision: 'keep' })}>Keep separate</button>
                  </div>
                </div>
              {/each}
              <div class="deliverable-actions">
                {#if item.stage === 'accepted' || item.stage === 'proposed'}
                  <button class="nm-btn-ghost" aria-pressed={open.groomingOverrides?.includes(item.id) ?? false} disabled={busy} onclick={() => act({ action: 'backlog_grooming_override', itemId: item.id, keepSeparate: !open.groomingOverrides?.includes(item.id) })}>{open.groomingOverrides?.includes(item.id) ? 'Allow automatic merging' : 'Keep separate'}</button>
                {/if}
                {#if item.source === 'backlog' && !item.foldedInto}
                  <button class="nm-btn-ghost" onclick={() => editing = item.id}>Define deliverable</button>
                  {#each [1, 2, 3, 4, 5] as priority}<button class="nm-btn-ghost" data-active={item.priority === priority} aria-pressed={item.priority === priority} disabled={busy} onclick={() => changePriority(item, priority)}>P{priority}</button>{/each}
                  {#if item.backlogStatus !== 'shipped'}<button class="nm-btn-ghost" disabled={busy} onclick={() => act({ action: 'backlog_park', slug: item.slug, parked: item.backlogStatus !== 'abandoned', reason: 'Parked from epic deliverables' })}>{item.backlogStatus === 'abandoned' ? 'Restore' : 'Park'}</button>{/if}
                {:else if item.foldedInto && open.combinedDeliveries.some((d) => d.slug === item.foldedInto)}
                  <button class="nm-btn-ghost" onclick={() => editing = `backlog:${item.foldedInto}`}>Define combined delivery</button>
                {:else if item.source === 'capability' && item.stage === 'proposed'}
                  <button class="nm-save-btn" disabled={busy} onclick={() => act({ action: 'capability_decide', slug: item.slug, decision: 'accept' })}>Accept deliverable</button>
                  <button class="nm-btn-ghost" disabled={busy} onclick={() => act({ action: 'capability_decide', slug: item.slug, decision: 'decline' })}>Decline</button>
                {/if}
                {#if item.artifactHref}<a class="nm-btn-ghost" href={item.artifactHref}>Open result →</a>{/if}
              </div>
              {#if item.parkedReason}<p>{item.parkedReason}</p>{/if}
              {#if item.absorbedRequirements}<details><summary>Merged requirements</summary>{#each Object.values(item.absorbedRequirements) as brief}<pre>{brief}</pre>{/each}</details>{/if}
              {#if item.lastError}<p class="err">{item.lastError}</p>{/if}
              {#if item.grooming?.acceptanceCriteria.length}<details><summary>Acceptance criteria ({item.grooming.acceptanceCriteria.length})</summary><ul>{#each item.grooming.acceptanceCriteria as criterion}<li>{criterion}</li>{/each}</ul></details>{/if}
              {#if item.mergedBrief}<details><summary>Included requirements</summary><pre>{item.mergedBrief}</pre></details>{/if}
            </article>
          {:else}<p class="note">No deliverables match these filters.</p>{/each}
        </div>
      {/if}
    </div>
  </DrillPanel>
{/if}
{#if creating}<BacklogEditor item={null} onclose={() => creating = false} />{/if}

<style>
  .grooming-review { border-left: 3px solid var(--accent-ink); background: var(--surface-sunken); padding: 10px 12px; margin: 10px 0; font-size: var(--fs-nav); }
  .history-toggle { display: flex; gap: 8px; align-items: center; font-size: var(--fs-label); margin-bottom: 10px; }
  .pill { font: var(--fs-label-xs) var(--font-mono); text-transform: uppercase; border: 1px solid var(--line-strong); padding: 3px 7px; color: var(--text-secondary); }
  .pill.t-good { color: var(--good); border-color: var(--good); }
  .pill.t-watch { color: var(--warn); border-color: var(--warn); }
  .pill.t-action { color: var(--accent); border-color: var(--accent); }
  .err { color: var(--error); background: var(--error-bg); padding: 8px; }
  :is(.nm-save-btn, .nm-btn-ghost):focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .epic-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
  .epic-toolbar input { flex: 1 1 260px; width: auto; }
  .epic-toolbar select { width: auto; max-width: 100%; }
  .ledger-count { font-size: var(--fs-label-xs); color: var(--text-muted); }
  .kanban { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(250px, 1fr); gap: 12px; overflow-x: auto; padding-bottom: 14px; min-width: 0; align-items: start; }
  .kanban:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .kanban-lane { min-width: 0; border: 1px solid var(--line); background: var(--surface-sunken); }
  .lane-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; border-bottom: 2px solid var(--line-strong); padding: 12px; }
  .lane-heading h2 { font: var(--fs-nav) var(--font-display); margin: 0; }
  .lane-heading > span { font: var(--fs-label) var(--font-code); color: var(--text-muted); }
  .lane-cards { display: grid; gap: 8px; padding: 8px; max-height: 65vh; overflow-y: auto; }
  .epic-row { display: grid; width: 100%; gap: 10px; padding: 12px; border: 1px solid var(--line); border-left: 3px solid var(--accent-ink); text-align: left; background: var(--surface-card); color: var(--text-primary); cursor: pointer; font: inherit; }
  .epic-row:hover { background: var(--accent-tint-04); }
  .epic-row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .epic-row strong { font-size: var(--fs-nav); overflow-wrap: anywhere; }
  .card-meta { display: flex; justify-content: space-between; gap: 8px; font-size: var(--fs-label-xs); color: var(--text-secondary); }
  .epic-progress, .card-history, .card-review, .lane-empty { font-size: var(--fs-label-xs); color: var(--text-muted); }
  .card-review { color: var(--accent); }
  .card-history { color: var(--accent-ink); border-top: 1px solid var(--line); padding-top: 8px; }
  .automation-history { border-block: 1px solid var(--line); padding: 12px 0; margin-top: 12px; }
  .automation-entry { border-bottom: 1px solid var(--line); padding: 12px 0; font-size: var(--fs-nav); overflow-wrap: anywhere; }
  .automation-entry p { font-size: var(--fs-label); color: var(--text-secondary); }
  .epic-modal { min-width: 0; }
  .epic-modal-head, .deliverable header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; }
  .epic-modal-head h2 { font: 1.5rem var(--font-display); margin: 0; flex: 1; overflow-wrap: anywhere; }
  .priority-controls { border: 0; padding: 0; margin: 0 0 0 auto; display: flex; gap: 4px; }
  .priority-controls legend { font-size: var(--fs-label-xs); color: var(--text-muted); margin-bottom: 4px; }
  .epic-definition { border-block: 1px solid var(--line); padding: 10px 0; }
  summary { cursor: pointer; color: var(--accent-ink); font-size: var(--fs-label); }
  summary:focus-visible { outline: 2px solid var(--accent); }
  .epic-definition label { display: grid; gap: 4px; margin: 10px 0; font-size: var(--fs-label); }
  .deliverable { padding: 14px 0; border-bottom: 1px solid var(--line); }
  .deliverable header strong { flex: 1 1 240px; font-size: var(--fs-body); overflow-wrap: anywhere; }
  .deliverable p, .epic-summary { font-size: var(--fs-nav); line-height: 1.5; color: var(--text-secondary); margin: 8px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .deliverable-actions { display: flex; flex-wrap: wrap; gap: 5px; margin: 8px 0; }
  .deliverable pre { white-space: pre-wrap; overflow-wrap: anywhere; font: var(--fs-label) var(--font-code); max-height: 240px; overflow: auto; }
  @media (max-width: 640px) {
    .priority-controls { margin-left: 0; }
  }
</style>
