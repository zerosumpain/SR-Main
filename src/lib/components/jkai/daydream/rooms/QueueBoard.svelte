<script lang="ts">
  // The queue, as work you can move.
  //
  // Before this, the 455-row `improvement_backlog` had exactly one surface in
  // the room: a rollup cell reading "Ideas queued". On 2026-09-04 that cell
  // said 352, of which 302 had never been attempted and **280 shared a single
  // priority** — the field `pickWork` ranks on. So the ordering that decided
  // what got built each night was, in practice, arbitrary, and nothing on the
  // page could change it.
  //
  // Everything derived lives in `$lib/selfimprove/board.ts`, which is pure and
  // unit-tested: stages, legal moves, lane mapping and the filter. This file is
  // the surface only — if a rule here needs a test, it is in the wrong file.
  import BacklogEditor from './BacklogEditor.svelte';
  import OpenCardStrip from './OpenCardStrip.svelte';
  import InflowStrip from './InflowStrip.svelte';
  import QueueList from './QueueList.svelte';
  import StatDeck from '$lib/components/jkai/daydream/hub/StatDeck.svelte';
  import type { DeckTile } from '$lib/components/jkai/daydream/hub/types';
  import {
    applyFilter,
    canMove,
    kindLabel,
    sortItems,
    BACKLOG_KINDS,
    KIND_META,
    SORT_META,
    SORT_MODES,
    STAGE_META,
    WORK_LANES,
    WORK_STAGES,
    type BacklogKind,
    type BoardFlag,
    type BoardTone,
    type BoardView,
    type IdeaSource,
    type SortMode,
    type WorkItem,
    type WorkLane,
    type WorkStage,
  } from '$lib/selfimprove/board';
  import { ago } from '$lib/daydream/format';

  interface Props {
    view: BoardView;
    /** Tonight's ceilings, read off WORK_CAPS/BUDGET_CAPS by the page. */
    caps: {
      tools: number;
      builds: number;
      watches: number;
      repairs: number;
      calls: number;
      minutes: number;
      window: string;
    };
    busy: string | null;
    act: (body: Record<string, unknown>, key: string) => Promise<boolean>;
  }

  let { view, caps, busy, act }: Props = $props();

  // ── Controls ────────────────────────────────────────────────────────────
  let lanes = $state<WorkLane[]>([]);
  let flags = $state<BoardFlag[]>([]);
  // The intake channel lives with every other filter rather than in the strip
  // that displays it: pressing a channel narrows the SAME board, and two
  // places holding filter state is two places to forget to reset.
  let sources = $state<IdeaSource[]>([]);
  /** The CATEGORY. Not the same question as the lane — `feature` and
   *  `news_source` share the `build` lane, so lane cannot ask for features. */
  let kinds = $state<BacklogKind[]>([]);
  /** The field `pickWork` ranks on, and the one 293 of 413 open items were
   *  tied on. Being able to filter TO a priority is what makes breaking that
   *  tie something a person can sit down and finish. */
  let priorities = $state<number[]>([]);
  let query = $state('');
  let sort = $state<SortMode>('queue');
  /** Board is the shape of the pipeline; list is the surface you groom from. */
  let view_ = $state<'board' | 'list'>('board');
  let grouped = $state(false);
  let dense = $state(false);
  /** Three of six stage columns are empty on a normal day, and an empty column
   *  still costs a sixth of the width. Folded away unless asked for. */
  let showEmptyStages = $state(false);
  let selected = $state<string[]>([]);
  let collapsed = $state<string[]>([]);
  /** Columns that have been expanded past `COLUMN_CAP`, by stage and lane. */
  let expandedCells = $state<string[]>([]);
  /** The drill holds an ID, never the object. `act()` awaits `invalidateAll()`,
   *  which replaces every item in `view.items` — a captured object would keep
   *  rendering the pre-action values, so "Raise to P1" would still read P2 and
   *  a second click would rewrite the same number. */
  let openId = $state<string | null>(null);
  const open = $derived(openId ? (view.items.find((i) => i.id === openId) ?? null) : null);
  let creating = $state(false);

  function closeEditor() {
    creating = false;
    openId = null;
  }

  function openCreate() {
    openId = null;
    creating = true;
  }

  function openItem(item: WorkItem) {
    creating = false;
    openId = item.id;
  }

  /** Cards rendered in one column before it stops. 302 in a column is a
   *  scroll nobody reads; the counts above are computed over everything, so
   *  the numbers never describe a smaller set than they name. */
  const COLUMN_CAP = 40;

  const LANE_MARK: Record<WorkLane, string> = {
    toolsmith: 'TOOLSMITH',
    build: 'BUILD',
    catalogue: 'CATALOGUE',
    monitor: 'MONITOR',
    engine: 'ENGINE',
  };

  const FLAGS: Array<{ id: BoardFlag; label: string }> = [
    { id: 'newdata', label: 'brings new data' },
    { id: 'served', label: 'already served' },
    { id: 'failed', label: 'has failed' },
    { id: 'untried', label: 'never tried' },
    { id: 'folded', label: 'has folds' },
    { id: 'groomed', label: 'has a brief' },
    { id: 'ungroomed', label: 'needs grooming' },
    { id: 'noted', label: 'discussed' },
  ];

  const filter = $derived({ lanes, flags, sources, kinds, priorities, query: query.trim() });
  const visible = $derived(sortItems(applyFilter(view.items, filter), sort));
  const totals = $derived(view.totals);

  function laneCount(l: WorkLane): number {
    return view.items.filter((i) => i.lane === l).length;
  }
  function kindCount(k: string): number {
    return view.items.filter((i) => i.kind === k).length;
  }
  function priorityCount(p: number): number {
    return view.items.filter((i) => i.priority === p).length;
  }
  /** Every count on a chip is over the WHOLE board, never the filtered set —
   *  a chip whose number shrank as you pressed its neighbour would be
   *  describing a population it does not name. */
  function flagCount(f: BoardFlag): number {
    return applyFilter(view.items, { flags: [f] }).length;
  }

  function toggle<T>(list: T[], v: T): T[] {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  }

  const activeCount = $derived(
    lanes.length + flags.length + sources.length + kinds.length + priorities.length + (query.trim() ? 1 : 0),
  );

  function reset() {
    lanes = [];
    flags = [];
    sources = [];
    kinds = [];
    priorities = [];
    query = '';
    selected = [];
  }

  const PRIORITIES = [1, 2, 3, 4, 5];

  /** Stages with nothing in them anywhere. Counted over the whole population
   *  rather than the filtered rows, so narrowing a filter never removes the
   *  column you were about to drag into. */
  const stages = $derived(
    showEmptyStages ? [...WORK_STAGES] : WORK_STAGES.filter((s) => view.counts[s] > 0),
  );
  const hiddenStages = $derived(WORK_STAGES.length - stages.length);

  // ── Grouping ────────────────────────────────────────────────────────────
  // Only where a link already exists: an owner-set `epicSlug`, or the
  // capability a lane recorded. Clustering by title similarity is a separate
  // piece of work and MUST reuse `findRelatedIdea` when it lands — a second
  // definition of "related" is the bug that left every driver unrecorded.
  interface Swimlane {
    slug: string;
    label: string;
    items: WorkItem[];
  }

  const swimlanes = $derived.by<Swimlane[]>(() => {
    if (!grouped) return [{ slug: '', label: 'Everything', items: visible }];
    const by = new Map<string, Swimlane>();
    for (const i of visible) {
      const slug = i.epicSlug ?? '';
      const found = by.get(slug);
      if (found) found.items.push(i);
      else by.set(slug, { slug, label: i.epicLabel, items: [i] });
    }
    return [...by.values()].sort(
      (a, b) => Number(a.slug === '') - Number(b.slug === '') || b.items.length - a.items.length,
    );
  });

  function inStage(items: WorkItem[], stage: WorkStage): WorkItem[] {
    return items.filter((i) => i.stage === stage);
  }

  // ── Selection and folding ───────────────────────────────────────────────
  const picked = $derived(view.items.filter((i) => selected.includes(i.id)));
  /** Folding writes `improvement_backlog`, so a capability lead — which lives
   *  in a different table and is ruled on the appetite board — cannot join
   *  one. Said out loud on the bar rather than silently dropped. */
  const foldable = $derived(picked.length >= 2 && picked.every((i) => i.actionable));

  async function fold() {
    if (!foldable) return;
    const ok = await act({ action: 'backlog_fold', slugs: picked.map((i) => i.slug) }, 'fold');
    if (ok) selected = [];
  }

  /** Both bulk buttons send ONE request. Doing an item at a time meant one
   *  `invalidateAll()` per item — a full re-run of the page load, re-paging the
   *  datastore and re-running the already-served sweep, twenty times over for
   *  twenty selected duplicates. */
  const bulkPriorityTargets = $derived(picked.filter((p) => p.actionable).map((p) => p.slug));
  const bulkParkTargets = $derived(
    picked.filter((p) => p.actionable && p.stage !== 'parked' && p.stage !== 'live').map((p) => p.slug),
  );

  async function bulkPriority() {
    if (bulkPriorityTargets.length === 0) return;
    const ok = await act({ action: 'backlog_priority', slugs: bulkPriorityTargets, priority: 1 }, 'bulk');
    if (ok) selected = [];
  }

  async function bulkPark() {
    if (bulkParkTargets.length === 0) return;
    const ok = await act(
      { action: 'backlog_park', slugs: bulkParkTargets, parked: true, reason: 'Parked from the queue board' },
      'bulk',
    );
    if (ok) selected = [];
  }

  // ── Single-item actions ─────────────────────────────────────────────────
  /** One step up the queue, stopping at 1. It used to wrap 1→5, which meant a
   *  second click on a button labelled "Raise" silently sent the item to the
   *  bottom — the exact ordering lever this board exists to fix. Lowering is an
   *  explicit choice, so it lives in the drill as its own control. */
  function nextPriority(p: number): number {
    return Math.max(1, p - 1);
  }

  async function setPriority(i: WorkItem, priority: number) {
    if (!i.actionable) return;
    await act({ action: 'backlog_priority', slug: i.slug, priority }, `pri:${i.id}`);
  }

  async function bumpPriority(i: WorkItem) {
    if (i.priority <= 1) return;
    await setPriority(i, nextPriority(i.priority));
  }

  async function setParked(i: WorkItem, parked: boolean, reason?: string) {
    if (!i.actionable) return false;
    return act({ action: 'backlog_park', slug: i.slug, parked, ...(reason ? { reason } : {}) }, `park:${i.id}`);
  }

  // ── Drag and drop ───────────────────────────────────────────────────────
  // A plain `let`, never `$state`: nothing reactive reads it, and a handle a
  // handler both reads and writes is the effect-loop trap.
  let dragging: WorkItem | null = null;
  let hoverCell = $state<string | null>(null);

  function onDragStart(i: WorkItem, ev: DragEvent) {
    if (!i.actionable) {
      ev.preventDefault();
      return;
    }
    dragging = i;
    if (ev.dataTransfer) {
      ev.dataTransfer.effectAllowed = 'move';
      // Firefox refuses to start a drag without data on the transfer.
      ev.dataTransfer.setData('text/plain', i.id);
    }
  }

  function onDragOver(stage: WorkStage, laneSlug: string, ev: DragEvent) {
    if (!dragging || !canMove(dragging.stage, stage)) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    hoverCell = `${laneSlug}:${stage}`;
  }

  async function onDrop(stage: WorkStage, ev: DragEvent) {
    ev.preventDefault();
    hoverCell = null;
    const item = dragging;
    dragging = null;
    if (!item || !canMove(item.stage, stage)) return;
    // The only two moves that exist as a write. Everything else the board
    // allows is a consequence of an attempt, not something a person asserts —
    // and a drag must never be what starts a build that can spend £2.
    if (stage === 'parked') await setParked(item, true, 'Parked from the queue board');
    else if (stage === 'accepted') await setParked(item, false);
  }

  // ── Presentation ────────────────────────────────────────────────────────
  function stageTone(stage: WorkStage): BoardTone {
    return STAGE_META[stage].tone;
  }

  function errRate(i: WorkItem): string | null {
    return i.errorRate == null ? null : `${Math.round(i.errorRate * 100)}% errors`;
  }

  const tiles = $derived<DeckTile[]>([
    {
      key: 'open',
      label: 'Open in the queue',
      value: String(totals.open),
      tone: totals.open ? 'action' : 'good',
      lit: totals.open > 0,
      sub: `${totals.untried} never once attempted`,
    },
    {
      key: 'tied',
      label: 'Tied on one priority',
      value: String(totals.tiedOnPriority),
      suffix: totals.open ? `/${totals.open}` : null,
      tone: totals.tiedOnPriority > totals.open / 2 ? 'watch' : 'steady',
      sub:
        totals.tiedPriority == null
          ? 'nothing open'
          : `all at P${totals.tiedPriority} — the field pickWork ranks on`,
    },
    {
      key: 'served',
      label: 'Already served',
      value: String(totals.alreadyServed),
      tone: totals.alreadyServed ? 'urgent' : 'good',
      sub: totals.alreadyServed ? 'a shipped sibling looks to cover these' : 'no duplicates found',
    },
    {
      key: 'uncalled',
      label: 'Shipped, never called',
      value: String(totals.neverCalled),
      tone: totals.neverCalled ? 'watch' : 'good',
      sub: 'live tools nothing has ever asked for',
    },
    {
      key: 'newdata',
      label: 'Bringing new data',
      value: String(totals.newData),
      tone: totals.newData ? 'good' : 'quiet',
      sub: 'sources, feeds and watches — the reserved slots',
    },
  ]);
</script>

<StatDeck {tiles} min={210} />

<div class="qb-manage">
  <p>
    Add a feature in your own words, or open any card to edit the brief and its place in the queue.
  </p>
  <button type="button" class="cta" disabled={Boolean(view.error)} onclick={openCreate}>+ Add feature</button>
</div>

{#if view.error}
  <div class="card t-urgent" style="margin-top:16px">
    <p class="card-body">The queue could not be read: {view.error}</p>
  </div>
{:else if view.items.length === 0}
  <div class="card t-quiet" style="margin-top:16px">
    <p class="card-body">
      Nothing in the queue. Ideas arrive from the questions you ask, the faults daydreaming
      raises, measurements nothing writes, and the appetite scan.
    </p>
  </div>
{:else}
  <!-- Inside the guard, never above it: a failed load returns EMPTY_BOARD, and
       a strip rendered over that would show a drain meter of measured zeros
       directly above "the queue could not be read".

       Folded shut by default. It is context, and it was pushing the surface a
       person actually works on two thousand pixels down the page. -->
  <details class="qb-fold">
    <summary>
      <span class="fold-lab">Where the work came from</span>
      <span class="fold-sub">
        {view.inflow.channels.length} channel{view.inflow.channels.length === 1 ? '' : 's'} ·
        {view.inflow.intake} in and {view.inflow.drained} out over {view.inflow.windowDays} days ·
        tonight's ceilings
      </span>
    </summary>
    <div class="fold-body">
      <InflowStrip flow={view.inflow} active={sources} {caps} ontoggle={(s) => (sources = toggle(sources, s))} />
    </div>
  </details>

  <!-- ── Controls ──────────────────────────────────────────────────────── -->
  <div class="qb-bar">
    <div class="seg" role="group" aria-label="How to show the queue">
      <button type="button" class="chip" class:on={view_ === 'board'} aria-pressed={view_ === 'board'} onclick={() => (view_ = 'board')}>Board</button>
      <button type="button" class="chip" class:on={view_ === 'list'} aria-pressed={view_ === 'list'} onclick={() => (view_ = 'list')}>List</button>
    </div>

    <input class="text-input qb-search" type="search" bind:value={query} placeholder="search titles and briefs…" aria-label="Search the queue" />

    <label class="qb-sort">
      <span class="qb-lab">Order</span>
      <select class="text-input select" bind:value={sort} aria-label="Order the queue">
        {#each SORT_MODES as m (m)}<option value={m}>{SORT_META[m]}</option>{/each}
      </select>
    </label>

    <span class="qb-spacer"></span>

    {#if view_ === 'board'}
      <button type="button" class="chip" class:on={grouped} aria-pressed={grouped} onclick={() => (grouped = !grouped)}>epics</button>
      <button type="button" class="chip" class:on={dense} aria-pressed={dense} onclick={() => (dense = !dense)}>compact</button>
      {#if hiddenStages > 0 || showEmptyStages}
        <button
          type="button"
          class="chip"
          class:on={showEmptyStages}
          aria-pressed={showEmptyStages}
          onclick={() => (showEmptyStages = !showEmptyStages)}
        >empty stages<span class="n">{hiddenStages}</span></button>
      {/if}
    {/if}
    <button type="button" class="btn sm" disabled={activeCount === 0} onclick={reset}>
      Reset{#if activeCount}&nbsp;({activeCount}){/if}
    </button>
  </div>

  <div class="facets">
    <div class="facet">
      <span class="qb-lab">Lane</span>
      <div class="chips">
        {#each WORK_LANES as l (l)}
          <button
            type="button"
            class="chip"
            class:on={lanes.includes(l)}
            aria-pressed={lanes.includes(l)}
            onclick={() => (lanes = toggle(lanes, l))}
          >{l}<span class="n">{laneCount(l)}</span></button>
        {/each}
      </div>
    </div>

    <div class="facet">
      <span class="qb-lab">Category</span>
      <div class="chips">
        {#each BACKLOG_KINDS as k (k)}
          <button
            type="button"
            class="chip"
            class:on={kinds.includes(k)}
            aria-pressed={kinds.includes(k)}
            title={KIND_META[k].cost}
            onclick={() => (kinds = toggle(kinds, k))}
          >{kindLabel(k)}<span class="n">{kindCount(k)}</span></button>
        {/each}
      </div>
    </div>

    <div class="facet">
      <span class="qb-lab">Priority</span>
      <div class="chips">
        {#each PRIORITIES as p (p)}
          <button
            type="button"
            class="chip"
            class:on={priorities.includes(p)}
            aria-pressed={priorities.includes(p)}
            onclick={() => (priorities = toggle(priorities, p))}
          >P{p}<span class="n">{priorityCount(p)}</span></button>
        {/each}
      </div>
    </div>

    <div class="facet">
      <span class="qb-lab">Flag</span>
      <div class="chips">
        {#each FLAGS as f (f.id)}
          <button
            type="button"
            class="chip"
            class:on={flags.includes(f.id)}
            aria-pressed={flags.includes(f.id)}
            onclick={() => (flags = toggle(flags, f.id))}
          >{f.label}<span class="n">{flagCount(f.id)}</span></button>
        {/each}
      </div>
    </div>
  </div>

  <p class="note">
    Showing <b>{visible.length}</b> of {view.items.length}.
    {#if view_ === 'board'}
      Drag a card to <b>Accepted</b> or <b>Parked</b>; nothing may be dragged into Live — a
      tool becomes live when jkai calls it — nor <em>out</em> of Live or Verifying, because
      parking a shipped row would erase the fact that it shipped.
    {:else}
      Every item is reachable here, page by page. The board caps a column at {COLUMN_CAP}
      cards, which is why a 347-item column could only ever be sampled.
    {/if}
    Change a priority to change what gets built tonight — it is the field
    <code>pickWork</code> ranks on. Select two or more with the square, then fold the
    restatements into one. Open any item to groom it, discuss it, or take it out.
  </p>

  <!-- ── The queue ─────────────────────────────────────────────────────── -->
  {#if view_ === 'list'}
    <QueueList
      items={visible}
      {selected}
      {busy}
      ontoggle={(id) => (selected = toggle(selected, id))}
      onopen={openItem}
      onpriority={setPriority}
      onpark={(i, parked) => setParked(i, parked, parked ? 'Parked from the backlog list' : undefined)}
    />
  {:else}
  <div class="qb-scroll">
    <div class="qb" class:dense style="--cols:{stages.length}">
      <div class="qb-head">
        {#each stages as s (s)}
          {@const shown = visible.filter((i) => i.stage === s).length}
          <div class="qb-col-hd t-{stageTone(s)}">
            <span class="hd-name">{STAGE_META[s].label}</span>
            <span class="hd-n">
              {shown}{#if shown !== view.counts[s]}<span class="hd-of">/{view.counts[s]}</span>{/if}
            </span>
            <span class="hd-q">{STAGE_META[s].question}</span>
          </div>
        {/each}
      </div>

      {#each swimlanes as lane (lane.slug)}
        {@const shut = collapsed.includes(lane.slug)}
        <div class="qb-lane">
          {#if grouped}
            <button
              type="button"
              class="lane-hd"
              aria-expanded={!shut}
              onclick={() => (collapsed = toggle(collapsed, lane.slug))}
            >
              <span class="tw" class:shut>▾</span>
              <span class="lane-name">{lane.label}</span>
              <span class="lane-meta">
                {lane.items.length} item{lane.items.length === 1 ? '' : 's'}
                {#if lane.items.some((i) => i.alreadyServed)}
                  · <span class="dupes">{lane.items.filter((i) => i.alreadyServed).length} already served</span>
                {/if}
              </span>
            </button>
          {/if}

          {#if !shut}
            <div class="qb-body">
              {#each stages as s (s)}
                {@const cell = inStage(lane.items, s)}
                {@const cellKey = `${lane.slug}:${s}`}
                {@const cap = expandedCells.includes(cellKey) ? cell.length : COLUMN_CAP}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  class="qb-cell"
                  class:over={hoverCell === `${lane.slug}:${s}`}
                  ondragover={(ev) => onDragOver(s, lane.slug, ev)}
                  ondragleave={() => (hoverCell = null)}
                  ondrop={(ev) => onDrop(s, ev)}
                >
                  {#each cell.slice(0, cap) as i (i.id)}
                    <article
                      class="wc t-{i.priority === 1 ? 'urgent' : i.newData ? 'action' : 'steady'}"
                      class:newdata={i.newData}
                      class:sel={selected.includes(i.id)}
                      class:busy={busy === `pri:${i.id}` || busy === `park:${i.id}`}
                      draggable={i.actionable}
                      ondragstart={(ev) => onDragStart(i, ev)}
                      ondragend={() => {
                        dragging = null;
                        hoverCell = null;
                      }}
                    >
                      <div class="wc-top">
                        <button
                          type="button"
                          class="wc-pick"
                          class:on={selected.includes(i.id)}
                          aria-pressed={selected.includes(i.id)}
                          aria-label={selected.includes(i.id) ? `Deselect ${i.title}` : `Select ${i.title}`}
                          onclick={() => (selected = toggle(selected, i.id))}
                        ></button>
                        <span class="mark">{LANE_MARK[i.lane]}</span>
                      </div>
                      <button type="button" class="wc-title" onclick={() => openItem(i)}>{i.title}</button>
                      <div class="wc-meta">
                        <span class="wc-pri-n" class:p1={i.priority === 1}>P{i.priority}</span>
                        <span>{ago(i.updatedAt)}</span>
                        {#if i.grooming}
                          <span class="wc-ready {i.grooming.readiness.status}">{i.grooming.readiness.score}% groomed</span>
                        {/if}
                        {#if i.noteCount}<span class="wc-notes">{i.noteCount} note{i.noteCount === 1 ? '' : 's'}</span>{/if}
                        {#if i.attempts}<span>{i.attempts}/{i.attemptCeiling} tries</span>{/if}
                        {#if i.calls != null}<span>{i.calls} calls</span>{/if}
                        {#if errRate(i)}<span class="warn">{errRate(i)}</span>{/if}
                      </div>
                      {#if !dense}
                        {#if i.alreadyServed}
                          <p class="wc-flag served">already served by “{i.servedBy}”</p>
                        {:else if i.lastError}
                          <p class="wc-flag failed">attempt {i.attempts} — {i.lastError}</p>
                        {:else if i.foldedCount}
                          <p class="wc-flag folded">{i.foldedCount} restatement{i.foldedCount === 1 ? '' : 's'} folded in</p>
                        {:else if i.parkedReason}
                          <p class="wc-flag">{i.parkedReason}</p>
                        {:else if i.evidence.length}
                          <p class="wc-ev">Because: {i.evidence.join(' · ')}</p>
                        {:else if i.artifact}
                          <p class="wc-ev">{i.artifact}</p>
                        {/if}
                      {/if}
                      <!-- Drag is the fast path; these are the same two moves for
                           anyone not using a mouse. `canMove` decides both, so the
                           keyboard can never assert a transition the drop refuses.
                           On a shipped row the controls do not grey out — they are
                           replaced, because "disabled Park" reads as "not yet" and
                           the truth is "never". -->
                      <div class="wc-acts">
                        {#if i.stage === 'live' || i.stage === 'verifying'}
                          <span class="wc-done" aria-hidden="true">—</span>
                          <span class="wc-done" title="A tool becomes live when jkai calls it, and parking it would erase the fact that it shipped.">shipped</span>
                        {:else}
                          <button
                            type="button"
                            class="btn sm"
                            disabled={!i.actionable || !canMove(i.stage, 'accepted') || busy === `park:${i.id}`}
                            title="Waiting for a slot. Nothing is spent until one opens."
                            onclick={() => void setParked(i, false)}
                          >Accept</button>
                          <button
                            type="button"
                            class="btn sm"
                            disabled={!i.actionable || !canMove(i.stage, 'parked') || busy === `park:${i.id}`}
                            title="Declined or folded. Kept, never deleted — it still counts against the appetite scan's evidence."
                            onclick={() => void setParked(i, true, 'Parked from the queue board')}
                          >Park</button>
                        {/if}
                        {#if i.actionable && i.priority > 1 && i.stage !== 'live' && i.stage !== 'verifying'}
                          <button
                            type="button"
                            class="wc-pri"
                            disabled={busy === `pri:${i.id}`}
                            title="Raise one step, stopping at P1. This is the field pickWork ranks on, so it is the only control here that changes what gets built tonight."
                            onclick={() => bumpPriority(i)}
                          >P▲</button>
                        {:else}
                          <span
                            class="wc-pri-off"
                            title={i.stage === 'live' || i.stage === 'verifying'
                              ? 'Priority ranks open work. On a row that already shipped it would change nothing, so it is a figure here rather than a control.'
                              : i.priority <= 1
                                ? 'Already top priority — lower it from the card detail.'
                                : 'Ruled on in Appetite, which carries its evidence.'}
                          >P{i.priority}</span>
                        {/if}
                      </div>
                    </article>
                  {/each}
                  {#if cell.length > cap}
                    <!-- It used to say "+307 more — narrow with a filter" and
                         stop there, for a pile no filter reached the bottom of.
                         Now it opens, and the list view exists for the rest. -->
                    <button type="button" class="qb-more" onclick={() => (expandedCells = toggle(expandedCells, cellKey))}>
                      Show {cell.length - cap} more
                    </button>
                  {:else if cell.length > COLUMN_CAP}
                    <button type="button" class="qb-more" onclick={() => (expandedCells = toggle(expandedCells, cellKey))}>
                      Show fewer
                    </button>
                  {:else if cell.length === 0}
                    <p class="qb-empty">—</p>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
  {/if}

  {#if picked.length}
    <div class="qb-sel">
      <span class="sel-msg">
        <b>{picked.length}</b> selected{#if picked.length > 1 && !foldable}
          · a capability lead cannot be folded — rule on it in Appetite{/if}
      </span>
      <span class="qb-spacer"></span>
      <button type="button" class="cta sm" disabled={!foldable || busy === 'fold'} onclick={fold}>
        {busy === 'fold' ? 'Folding…' : 'Fold into one'}
      </button>
      <button
        type="button"
        class="btn sm"
        disabled={bulkPriorityTargets.length === 0 || busy === 'bulk'}
        onclick={bulkPriority}
      >Raise {bulkPriorityTargets.length} to P1</button>
      <button
        type="button"
        class="btn sm danger"
        disabled={bulkParkTargets.length === 0 || busy === 'bulk'}
        onclick={bulkPark}
      >Park {bulkParkTargets.length}</button>
      <button type="button" class="btn sm" onclick={() => (selected = [])}>Clear</button>
    </div>
  {/if}
{/if}

{#if creating || open}
  {#key creating ? 'create' : (open?.id ?? 'editor')}
    <!-- Only for an existing row: a card being created has no history to be
         read-only about, and an empty strip would imply one. -->
    {#if open}<OpenCardStrip item={open} />{/if}
    <BacklogEditor item={open} onclose={closeEditor} />
  {/key}
{/if}
<style>
  .qb-manage {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    margin-top: 16px;
    padding: 12px 0;
    border-top: 1px solid var(--line-hair);
    border-bottom: 1px solid var(--line-hair);
  }
  .qb-manage p {
    flex: 1 1 420px;
    margin: 0;
    color: var(--text-secondary);
    line-height: 1.5;
  }
  .if-head {
    margin-top: clamp(18px, 2.4vw, 26px);
  }

  /* ── controls ─────────────────────────────────────────────────────────── */
  .qb-bar {
    display: flex;
    align-items: center;
    gap: 7px;
    flex-wrap: wrap;
    padding: 14px 0 12px;
    border-top: 1px solid var(--line-hair);
    border-bottom: 1px solid var(--line-hair);
    margin: clamp(18px, 2.4vw, 28px) 0 12px;
  }
  .qb-lab {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin-left: 4px;
  }
  .qb-lab:first-child {
    margin-left: 0;
  }
  .qb-spacer {
    flex: 1 1 auto;
  }
  .chip {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    padding: 5px 10px;
    border: 1px solid var(--card-border);
    border-radius: 0;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    white-space: nowrap;
    transition:
      background-color var(--t-fast) var(--ease-out),
      border-color var(--t-fast) var(--ease-out),
      color var(--t-fast) var(--ease-out);
  }
  .chip:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .chip.on {
    background: var(--text-primary);
    border-color: var(--text-primary);
    color: var(--bg);
  }
  .chip:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .chip .n {
    opacity: 0.6;
    margin-left: 6px;
  }
  .qb-search {
    flex: 1 1 240px;
    max-width: 380px;
    font-family: var(--font-mono);
  }
  .seg {
    display: inline-flex;
  }
  .seg .chip + .chip {
    margin-left: -1px;
  }
  .qb-sort {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .qb-sort .text-input {
    padding: 5px 8px;
    font-size: var(--fs-label-xs);
  }

  /* ── the facet grid ───────────────────────────────────────────────────
     Twenty-three chips in one wrapping row is a wall. Four labelled rows on a
     two-column grid is the same information, scannable. */
  .facets {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 8px 14px;
    align-items: baseline;
    padding: 0 0 14px;
    border-bottom: 1px solid var(--line-hair);
    margin-bottom: 14px;
  }
  .facet {
    display: contents;
  }
  .chips {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  @media (max-width: 720px) {
    .facets {
      grid-template-columns: 1fr;
      gap: 4px;
    }
    .facet {
      display: block;
      margin-bottom: 8px;
    }
  }

  /* ── the folded context strip ─────────────────────────────────────────── */
  .qb-fold {
    border-bottom: 1px solid var(--line-hair);
    margin-top: 14px;
  }
  .qb-fold > summary {
    display: flex;
    align-items: baseline;
    gap: 12px;
    flex-wrap: wrap;
    padding: 11px 0;
    cursor: pointer;
    list-style: none;
  }
  .qb-fold > summary::-webkit-details-marker {
    display: none;
  }
  .qb-fold > summary::before {
    content: '▸';
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  .qb-fold[open] > summary::before {
    content: '▾';
  }
  .qb-fold > summary:hover .fold-lab {
    color: var(--accent);
  }
  .fold-lab {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .fold-sub {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
    color: var(--text-ghost);
  }
  .fold-body {
    padding-bottom: 18px;
  }

  /* ── the grid ─────────────────────────────────────────────────────────── */
  /* `overflow-x` on its own clips the OTHER axis too, so the drill panel is
     portalled to <body> rather than living inside this box. */
  .qb-scroll {
    overflow-x: auto;
    padding-bottom: 4px;
  }
  .qb {
    min-width: calc(var(--cols, 6) * 186px);
  }
  .qb-head,
  .qb-body {
    display: grid;
    /* Follows how many stages are actually shown. Three of the six are empty
       on a normal day and an empty column still costs a sixth of the width. */
    grid-template-columns: repeat(var(--cols, 6), minmax(180px, 1fr));
  }
  .qb-head {
    border-top: 1px solid var(--line-strong);
    border-bottom: 1px solid var(--line-hair);
  }
  /* An ink band, so the column heads read as the board's chrome rather than as
     another row of cards. The tones move with it: the paper accent and olive go
     muddy on #1a1008, so every one of them takes its on-dark value — the same
     deviation `StatDeck.dark` records, and the same two literals. */
  .qb-col-hd {
    --tone: rgba(237, 228, 212, 0.35);
    padding: 10px 11px 11px;
    background: var(--text-primary);
    border-right: 1px solid rgba(237, 228, 212, 0.14);
    border-top: 3px solid var(--tone);
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 8px;
  }
  .qb-col-hd:last-child {
    border-right: 0;
  }
  .qb-col-hd.t-urgent { --tone: #e08b8b; }
  .qb-col-hd.t-action { --tone: var(--accent-on-dark); }
  .qb-col-hd.t-watch { --tone: #d8b45e; }
  .qb-col-hd.t-good { --tone: var(--good-on-dark); }
  .qb-col-hd.t-steady { --tone: var(--accent-ink-on-dark); }
  .qb-col-hd.t-quiet { --tone: rgba(237, 228, 212, 0.35); }
  .hd-name {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 700;
    letter-spacing: 0.13em;
    text-transform: uppercase;
    color: var(--tone);
  }
  .hd-n {
    font-family: var(--font-display);
    font-size: 16px;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    color: var(--bg);
    margin-left: auto;
  }
  .hd-of {
    color: rgba(237, 228, 212, 0.45);
  }
  .hd-q {
    flex: 1 0 100%;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: rgba(237, 228, 212, 0.45);
  }

  .qb-lane {
    border-bottom: 1px solid var(--line-hair);
  }
  .lane-hd {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 11px;
    background: var(--bg-section);
    border: 0;
    border-left: 3px solid var(--accent-tint-35);
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .lane-hd:hover {
    background: var(--accent-tint-04);
  }
  .lane-hd:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .tw {
    font-size: var(--fs-label-xs);
    line-height: 1;
    color: var(--text-ghost);
    transition: transform var(--t-fast) var(--ease-out);
  }
  .tw.shut {
    transform: rotate(-90deg);
  }
  .lane-name {
    font-family: var(--font-display);
    font-size: var(--fs-nav);
  }
  .lane-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
  .dupes {
    color: var(--error);
  }

  .qb-cell {
    border-right: 1px solid var(--line-hair);
    padding: 6px 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-height: 40px;
  }
  .qb-cell:last-child {
    border-right: 0;
  }
  .qb-cell.over {
    background: var(--accent-tint-08);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .qb-empty,
  .qb-more {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    margin: 2px;
  }
  .qb-more {
    background: none;
    border: 1px dashed var(--card-border);
    padding: 6px 8px;
    text-align: left;
    cursor: pointer;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .qb-more:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .qb-more:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  /* ── the card ─────────────────────────────────────────────────────────── */
  .wc {
    --tone: var(--accent-ink);
    border: 1px solid var(--card-border);
    border-left: 3px solid var(--tone);
    background: var(--surface-overlay);
    padding: 7px 8px 8px;
    min-width: 0;
    cursor: grab;
    transition:
      border-color var(--t-fast) var(--ease-out),
      background-color var(--t-fast) var(--ease-out);
  }
  .wc.t-urgent { --tone: var(--error); }
  .wc.t-action { --tone: var(--accent); }
  .wc.t-steady { --tone: var(--accent-ink); }
  .wc:hover {
    border-color: var(--line-strong);
  }
  .wc.sel {
    border-color: var(--accent);
    background: var(--accent-tint-08);
  }
  .wc.busy {
    opacity: 0.55;
  }
  .wc-top {
    display: flex;
    align-items: flex-start;
    gap: 6px;
  }
  .wc-pick {
    flex: 0 0 auto;
    width: 11px;
    height: 11px;
    margin-top: 3px;
    padding: 0;
    border: 1px solid var(--line-strong);
    border-radius: 0;
    background: transparent;
    cursor: pointer;
  }
  .wc-pick.on {
    background: var(--accent);
    border-color: var(--accent);
  }
  .wc-pick:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .wc-title {
    display: block;
    width: 100%;
    margin-top: 4px;
    font-family: var(--font-display);
    font-size: 14px;
    line-height: 1.25;
    letter-spacing: -0.01em;
    text-align: left;
    color: var(--text-primary);
    background: none;
    border: 0;
    padding: 0;
    margin: 0;
    cursor: pointer;
    min-width: 0;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    overflow: hidden;
  }
  .wc-title:hover {
    color: var(--accent);
  }
  .wc-title:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .wc-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 3px 7px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    margin-top: 6px;
  }
  .wc-top .mark {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--tone);
    font-weight: 500;
    letter-spacing: 0.09em;
    text-transform: uppercase;
  }
  .wc-meta .warn {
    color: var(--error);
  }
  .wc-ready {
    color: var(--accent-ink);
  }
  .wc-ready.ready {
    color: var(--good);
  }
  .wc-ready.needs_input {
    color: var(--warn);
  }
  .wc-notes {
    color: var(--accent-ink);
  }
  .wc-pri-n {
    font-variant-numeric: tabular-nums;
  }
  .wc-pri-n.p1 {
    color: var(--error);
  }

  /* The two moves a person may assert, plus the one field pickWork ranks on. */
  .wc-acts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    margin-top: 7px;
  }
  .wc-done,
  .wc-pri-off {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: rgba(26, 16, 8, 0.3);
  }
  .wc-pri-off {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
  }
  .wc-pri {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    padding: 0 4px;
    border: 1px solid var(--card-border);
    border-radius: 0;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }
  .wc-pri:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .wc-pri:disabled {
    cursor: default;
    opacity: 0.6;
  }
  .wc-pri.p1 {
    color: var(--error);
    border-color: var(--error-border);
  }
  .wc-flag,
  .wc-ev {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.4;
    color: var(--text-ghost);
    margin: 6px 0 0;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }
  .wc-flag.served {
    color: var(--error);
    background: var(--error-bg);
    padding: 2px 5px;
  }
  .wc-flag.failed {
    color: var(--warn);
    background: var(--warn-bg);
    padding: 2px 5px;
  }
  .wc-flag.folded {
    color: var(--accent-ink);
  }

  /* compact: the wall-of-352 view */
  .qb.dense .wc {
    padding: 4px 7px 5px;
  }
  .qb.dense .wc-title {
    -webkit-line-clamp: 1;
    line-clamp: 1;
  }
  .qb.dense .wc-meta {
    margin-top: 3px;
  }
  .qb.dense .qb-cell {
    gap: 3px;
  }

  /* ── selection bar ────────────────────────────────────────────────────── */
  .qb-sel {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    position: sticky;
    bottom: 0;
    z-index: 5;
    margin-top: 12px;
    padding: 10px 12px;
    background: var(--surface-elevated);
    border: 1px solid var(--line-strong);
    border-top: 3px solid var(--accent);
  }
  .sel-msg {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.05em;
    color: var(--text-secondary);
  }
  .sel-msg b {
    color: var(--accent);
  }
  .hd-of {
    color: var(--text-ghost);
  }
  @media (max-width: 700px) {
    .qb-search {
      flex: 1 1 100%;
    }
  }
</style>
