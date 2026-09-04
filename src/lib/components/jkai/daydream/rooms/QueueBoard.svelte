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
  import DrillPanel from '$lib/components/jkai/daydream/hub/DrillPanel.svelte';
  import StatDeck from '$lib/components/jkai/daydream/hub/StatDeck.svelte';
  import type { DeckTile } from '$lib/components/jkai/daydream/hub/types';
  import {
    applyFilter,
    canMove,
    sortForBoard,
    STAGE_META,
    WORK_LANES,
    WORK_STAGES,
    type BoardFlag,
    type BoardTone,
    type BoardView,
    type WorkItem,
    type WorkLane,
    type WorkStage,
  } from '$lib/selfimprove/board';
  import { ago } from '$lib/daydream/format';

  interface Props {
    view: BoardView;
    busy: string | null;
    act: (body: Record<string, unknown>, key: string) => Promise<boolean>;
  }

  let { view, busy, act }: Props = $props();

  // ── Controls ────────────────────────────────────────────────────────────
  let lanes = $state<WorkLane[]>([]);
  let flags = $state<BoardFlag[]>([]);
  let query = $state('');
  let grouped = $state(false);
  let dense = $state(false);
  let selected = $state<string[]>([]);
  let collapsed = $state<string[]>([]);
  /** The drill holds an ID, never the object. `act()` awaits `invalidateAll()`,
   *  which replaces every item in `view.items` — a captured object would keep
   *  rendering the pre-action values, so "Raise to P1" would still read P2 and
   *  a second click would rewrite the same number. */
  let openId = $state<string | null>(null);
  const open = $derived(openId ? (view.items.find((i) => i.id === openId) ?? null) : null);

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
  ];

  const filter = $derived({ lanes, flags, query: query.trim() });
  const visible = $derived(sortForBoard(applyFilter(view.items, filter)));
  const totals = $derived(view.totals);

  function laneCount(l: WorkLane): number {
    return view.items.filter((i) => i.lane === l).length;
  }
  function flagCount(f: BoardFlag): number {
    return applyFilter(view.items, { lanes: [], flags: [f], query: '' }).length;
  }

  function toggle<T>(list: T[], v: T): T[] {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  }

  function reset() {
    lanes = [];
    flags = [];
    query = '';
    selected = [];
  }

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
  <!-- ── Controls ──────────────────────────────────────────────────────── -->
  <div class="qb-bar">
    <span class="qb-lab">Lane</span>
    {#each WORK_LANES as l (l)}
      <button
        type="button"
        class="chip"
        class:on={lanes.includes(l)}
        aria-pressed={lanes.includes(l)}
        onclick={() => (lanes = toggle(lanes, l))}
      >
        {l}<span class="n">{laneCount(l)}</span>
      </button>
    {/each}

    <span class="qb-lab">Flag</span>
    {#each FLAGS as f (f.id)}
      <button
        type="button"
        class="chip"
        class:on={flags.includes(f.id)}
        aria-pressed={flags.includes(f.id)}
        onclick={() => (flags = toggle(flags, f.id))}
      >
        {f.label}<span class="n">{flagCount(f.id)}</span>
      </button>
    {/each}

    <span class="qb-spacer"></span>

    <input class="text-input qb-search" type="search" bind:value={query} placeholder="filter titles…" aria-label="Filter the queue by title" />
    <button type="button" class="chip" class:on={grouped} aria-pressed={grouped} onclick={() => (grouped = !grouped)}>epics</button>
    <button type="button" class="chip" class:on={dense} aria-pressed={dense} onclick={() => (dense = !dense)}>compact</button>
    <button type="button" class="btn sm" onclick={reset}>Reset</button>
  </div>

  <p class="note">
    Showing <b>{visible.length}</b> of {view.items.length}. Drag a card to <b>Accepted</b> or
    <b>Parked</b>. Nothing may be dragged into Live — a tool becomes live when jkai calls it —
    and nothing may be dragged <em>out</em> of Live or Verifying, because parking a shipped
    row would erase the fact that it shipped. Click a priority to raise it one step; that
    writes the field <code>pickWork</code> ranks on. Select two or more with the square, then
    fold the restatements into one.
  </p>

  <!-- ── The board ─────────────────────────────────────────────────────── -->
  <div class="qb-scroll">
    <div class="qb" class:dense>
      <div class="qb-head">
        {#each WORK_STAGES as s (s)}
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
              {#each WORK_STAGES as s (s)}
                {@const cell = inStage(lane.items, s)}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  class="qb-cell"
                  class:over={hoverCell === `${lane.slug}:${s}`}
                  ondragover={(ev) => onDragOver(s, lane.slug, ev)}
                  ondragleave={() => (hoverCell = null)}
                  ondrop={(ev) => onDrop(s, ev)}
                >
                  {#each cell.slice(0, COLUMN_CAP) as i (i.id)}
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
                        <button type="button" class="wc-title" onclick={() => (openId = i.id)}>{i.title}</button>
                      </div>
                      <div class="wc-meta">
                        <span class="mark">{LANE_MARK[i.lane]}</span>
                        <button
                          type="button"
                          class="wc-pri"
                          class:p1={i.priority === 1}
                          disabled={!i.actionable || i.priority <= 1 || busy === `pri:${i.id}`}
                          title={i.priority <= 1
                            ? 'Already top priority — lower it from the card detail'
                            : 'Raise one step. This is the field pickWork ranks on.'}
                          onclick={() => bumpPriority(i)}
                        >P{i.priority}</button>
                        <span>{ago(i.updatedAt)}</span>
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
                    </article>
                  {/each}
                  {#if cell.length > COLUMN_CAP}
                    <p class="qb-more">+{cell.length - COLUMN_CAP} more — narrow with a filter</p>
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

{#if open}
  {@const o = open}
  <DrillPanel label={o.title} kicker={`${LANE_MARK[o.lane]} · ${STAGE_META[o.stage].label}`} tone={stageTone(o.stage)} onclose={() => (openId = null)}>
    {#snippet head()}
      <span class="pill t-{stageTone(o.stage)}">{STAGE_META[o.stage].question}</span>
    {/snippet}

    <div class="detail">
      <div class="detail-block">
        <p class="field-label">What it asks for</p>
        <p class="detail-line">{o.detail || 'No detail was recorded.'}</p>
      </div>

      <div class="detail-block">
        <p class="field-label">Record</p>
        <div class="tbl-wrap">
          <table class="tbl compact">
            <tbody>
              <tr><td>kind</td><td class="cell-lead">{o.kind} → {o.lane} lane</td></tr>
              <tr><td>priority</td><td class="cell-lead">P{o.priority}</td></tr>
              <tr><td>attempts</td><td class="cell-lead">{o.attempts} of {o.attemptCeiling}</td></tr>
              <tr><td>queued</td><td class="cell-lead">{ago(o.createdAt)}</td></tr>
              <tr><td>last touched</td><td class="cell-lead">{ago(o.updatedAt)}</td></tr>
              {#if o.artifact}
                <tr>
                  <td>artifact</td>
                  <td class="cell-lead">
                    {#if o.artifactHref}<a class="link" href={o.artifactHref}>{o.artifact}</a>{:else}{o.artifact}{/if}
                    {#if o.calls != null}· {o.calls} call{o.calls === 1 ? '' : 's'}{/if}
                    {#if errRate(o)}· {errRate(o)}{/if}
                  </td>
                </tr>
              {/if}
              {#if o.score != null}<tr><td>score</td><td class="cell-lead">{o.score.toFixed(3)}</td></tr>{/if}
              {#if o.foldedCount}<tr><td>folded in</td><td class="cell-lead">{o.foldedCount}</td></tr>{/if}
              {#if o.foldedInto}<tr><td>folded into</td><td class="cell-lead">{o.foldedInto}</td></tr>{/if}
            </tbody>
          </table>
        </div>
      </div>

      {#if o.evidence.length}
        <div class="detail-block">
          <p class="field-label">Where the pressure came from</p>
          <p class="detail-line">{o.evidence.join(' · ')}</p>
        </div>
      {/if}

      {#if o.alreadyServed}
        <div class="detail-block">
          <p class="field-label">Looks already served</p>
          <p class="detail-line said">
            “{o.servedBy}” has shipped and appears to cover this, but the engine never recorded
            the link — so it may build the same thing twice. Folding them closes that out.
          </p>
        </div>
      {/if}

      {#if o.lastError}
        <div class="detail-block">
          <p class="field-label">Last failure</p>
          <p class="detail-line said">{o.lastError}</p>
          <p class="note">Fed back into the next authoring call — this is what the retry budget is for.</p>
        </div>
      {/if}

      {#if !o.actionable}
        <p class="note">
          This is a capability lead, not a queued idea. It is ruled on in <b>Appetite</b> above,
          which carries its citations and how its score was arrived at.
        </p>
      {/if}
    </div>

    {#snippet foot()}
      <div class="actions">
        {#if o.actionable}
          <!-- Explicit, not a cycling stepper: lowering an item has to be a
               thing you chose, and "Raise" must never wrap round to P5. -->
          <span class="pri-set">
            <span class="pri-lab">Priority</span>
            {#each [1, 2, 3, 4, 5] as p (p)}
              <button
                type="button"
                class="btn sm pri-btn"
                class:picked={o.priority === p}
                disabled={busy === `pri:${o.id}`}
                onclick={() => setPriority(o, p)}
              >P{p}</button>
            {/each}
          </span>
          {#if o.stage === 'parked'}
            <button type="button" class="btn sm" disabled={busy === `park:${o.id}`} onclick={async () => { if (await setParked(o, false)) openId = null; }}>
              Put it back
            </button>
          {:else if o.stage !== 'live' && o.stage !== 'verifying'}
            <button type="button" class="btn sm danger" disabled={busy === `park:${o.id}`} onclick={async () => { if (await setParked(o, true, 'Parked from the queue board')) openId = null; }}>
              Park it
            </button>
          {/if}
        {/if}
        <button type="button" class="btn sm" onclick={() => (openId = null)}>Close</button>
      </div>
    {/snippet}
  </DrillPanel>
{/if}

<style>
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
    flex: 0 1 190px;
    font-family: var(--font-mono);
  }

  /* ── the grid ─────────────────────────────────────────────────────────── */
  /* `overflow-x` on its own clips the OTHER axis too, so the drill panel is
     portalled to <body> rather than living inside this box. */
  .qb-scroll {
    overflow-x: auto;
    padding-bottom: 4px;
  }
  .qb {
    min-width: 1120px;
  }
  .qb-head,
  .qb-body {
    display: grid;
    grid-template-columns: repeat(6, minmax(180px, 1fr));
  }
  .qb-head {
    border-top: 1px solid var(--line-strong);
    border-bottom: 1px solid var(--line-hair);
  }
  .qb-col-hd {
    --tone: var(--text-ghost);
    padding: 10px 11px 11px;
    border-right: 1px solid var(--line-hair);
    border-top: 3px solid var(--tone);
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 8px;
  }
  .qb-col-hd:last-child {
    border-right: 0;
  }
  .qb-col-hd.t-urgent { --tone: var(--error); }
  .qb-col-hd.t-action { --tone: var(--accent); }
  .qb-col-hd.t-watch { --tone: var(--warn); }
  .qb-col-hd.t-good { --tone: var(--good); }
  .qb-col-hd.t-steady { --tone: var(--accent-ink); }
  .qb-col-hd.t-quiet { --tone: var(--text-ghost); }
  .hd-name {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 700;
    letter-spacing: 0.13em;
    text-transform: uppercase;
    color: var(--tone);
  }
  .hd-n {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
    margin-left: auto;
  }
  .hd-q {
    flex: 1 0 100%;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
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
    font-family: var(--font-body);
    font-size: var(--fs-nav);
    line-height: 1.3;
    font-weight: 500;
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
  .wc-meta .mark {
    color: var(--tone);
    font-weight: 500;
    letter-spacing: 0.09em;
  }
  .wc-meta .warn {
    color: var(--error);
  }
  .wc-pri {
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
  .pri-set {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }
  .pri-lab {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin-right: 4px;
  }
  .pri-btn {
    padding: 5px 8px;
  }

  @media (max-width: 700px) {
    .qb-search {
      flex: 1 1 100%;
    }
  }
</style>
