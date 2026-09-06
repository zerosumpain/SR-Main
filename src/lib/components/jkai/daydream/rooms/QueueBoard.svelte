<script lang="ts">
  // The queue, as work you can move.
  //
  // Two boards over one ledger: EPICS, where a card is a functional area, and
  // DELIVERABLES, where a card is the row `pickWork` ranks when it chooses what
  // to build tonight. The switch is the toolbar's first control because those
  // are different questions — "what are we doing about calendars" and "what
  // gets built tonight" — and the board that answered only the first could not
  // change the second.
  //
  // Every rule lives in `$lib/selfimprove/backlog-board.ts`, which is pure and
  // unit-tested: the two card shapes, the filter, the sort, and — the one that
  // matters — what a drop would write, decided before anything is sent. This
  // file is the surface. If a rule here needs a test, it is in the wrong file.
  import EpicDrill from './EpicDrill.svelte';
  import BacklogEditor from './BacklogEditor.svelte';
  import {
    BOARD_LEVELS,
    CARD_FLAGS,
    CARD_SORTS,
    FLAG_META,
    LEVEL_META,
    SORT_META,
    countCards,
    dropTargets,
    filterCards,
    planMove,
    prioritySlugs,
    sortCards,
    stepPriority,
    toCards,
    type BoardCard,
    type BoardLevel,
    type CardFlag,
    type CardSort,
  } from '$lib/selfimprove/backlog-board';
  import { BACKLOG_KINDS, KIND_META, STAGE_META, WORK_STAGES, kindLabel, type WorkStage } from '$lib/selfimprove/board';
  import type { BacklogEpic } from '$lib/selfimprove/epic-backlog';
  import { ago } from '$lib/daydream/format';

  interface Props {
    epics: BacklogEpic[];
    busy: string | null;
    act: (body: Record<string, unknown>, key: string) => Promise<boolean>;
    /**
     * Which epic is open, as a SLUG and never the object: `act()` awaits
     * `invalidateAll()`, which replaces every epic in the array, and a captured
     * one would keep rendering the values from before the write.
     *
     * Bindable because the review lane opens the panel too, and two components
     * each holding their own idea of "the open epic" is two places to forget to
     * close it.
     */
    openSlug?: string | null;
  }

  let { epics, busy, act, openSlug = $bindable(null) }: Props = $props();

  // ── Controls ────────────────────────────────────────────────────────────
  let level = $state<BoardLevel>('epic');
  let query = $state('');
  let sort = $state<CardSort>('queue');
  let kinds = $state<string[]>([]);
  let priorities = $state<number[]>([]);
  let flags = $state<CardFlag[]>([]);
  /** Three of six columns are usually empty, and an empty column still costs a
   *  sixth of the width. Folded away unless asked for. */
  let showEmpty = $state(false);
  /** Cells expanded past `COLUMN_CAP`, keyed by stage. */
  let expanded = $state<WorkStage[]>([]);
  let creating = $state(false);
  const open = $derived(openSlug ? (epics.find((e) => e.slug === openSlug) ?? null) : null);

  /** Cards drawn in one column before it stops. 300 in a column is a scroll
   *  nobody reads, and the counts above are over everything, so the numbers
   *  never describe a smaller set than they name. */
  const COLUMN_CAP = 40;
  const PRIORITIES = [1, 2, 3, 4, 5];

  /** Both boards, built once. The level switch prints the other one's size,
   *  and recomputing 486 cards inside the button's `{#each}` did that work on
   *  every keystroke in the search box. */
  const boards = $derived({ epic: toCards(epics, 'epic'), deliverable: toCards(epics, 'deliverable') });
  const all = $derived(boards[level]);
  const filter = $derived({ query: query.trim(), kinds, priorities, flags });
  const visible = $derived(sortCards(filterCards(all, filter), sort));
  const counts = $derived(countCards(all, visible));
  const stages = $derived(showEmpty ? [...WORK_STAGES] : WORK_STAGES.filter((s) => counts.all[s] > 0));
  const hidden = $derived(WORK_STAGES.length - stages.length);

  /** Every count on a chip is over the WHOLE board, never the filtered set — a
   *  chip whose number shrank as you pressed its neighbour would be describing
   *  a population it does not name. */
  function countBy(pick: (c: BoardCard) => boolean): number {
    return all.filter(pick).length;
  }
  const kindCounts = $derived(
    Object.fromEntries(BACKLOG_KINDS.map((k) => [k, countBy((c) => c.kinds.includes(k))])),
  );
  const priorityCounts = $derived(
    Object.fromEntries(PRIORITIES.map((p) => [p, countBy((c) => c.priority === p)])),
  );
  const flagCounts = $derived(
    Object.fromEntries(CARD_FLAGS.map((f) => [f, countBy((c) => c.flags.includes(f))])),
  );

  function toggle<T>(list: T[], v: T): T[] {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  }

  const activeFilters = $derived(kinds.length + priorities.length + flags.length + (query.trim() ? 1 : 0));

  function reset() {
    kinds = [];
    priorities = [];
    flags = [];
    query = '';
  }

  // ── Moves ───────────────────────────────────────────────────────────────
  /** What the last move did, in words. An epic move rewrites up to eleven rows
   *  across six columns at once; leaving the owner to infer that from counts
   *  that all changed together is how a board stops being trustworthy. */
  let report = $state<string | null>(null);
  let refused = $state<string | null>(null);

  async function move(card: BoardCard, to: WorkStage) {
    const plan = planMove(card, to);
    if (!plan.ok) {
      report = null;
      refused = plan.reason || null;
      return;
    }
    refused = null;
    const ok = await act(
      {
        action: 'backlog_park',
        slugs: plan.slugs,
        parked: plan.action === 'park',
        ...(plan.action === 'park' ? { reason: 'Parked from the backlog board' } : {}),
      },
      `move:${card.key}`,
    );
    report = ok ? plan.reason : null;
  }

  async function setPriority(card: BoardCard, priority: number) {
    const slugs = prioritySlugs(card);
    if (slugs.length === 0 || priority === card.priority) return;
    refused = null;
    const ok = await act({ action: 'backlog_priority', slugs, priority }, `pri:${card.key}`);
    if (ok) {
      report =
        card.level === 'epic' && slugs.length > 1
          ? `Set ${slugs.length} deliverables in “${card.title}” to P${priority}.`
          : `“${card.title}” is now P${priority}.`;
    }
  }

  // ── Drag and drop ───────────────────────────────────────────────────────
  // `dragged` is a plain `let`: it is the handle a handler both reads and
  // writes, which as `$state` is the documented effect-loop trap. Nothing in
  // the template may read it — everything the markup needs is derived into
  // `$state` alongside it: which columns will accept the card, which one is
  // under the pointer, and which card is in flight.
  let dragged: BoardCard | null = null;
  let legal = $state<WorkStage[]>([]);
  let hover = $state<WorkStage | null>(null);
  let liftedKey = $state<string | null>(null);

  function onDragStart(card: BoardCard, ev: DragEvent) {
    const targets = dropTargets(card);
    if (targets.length === 0) {
      ev.preventDefault();
      refused = planMove(card, card.stage === 'parked' ? 'accepted' : 'parked').reason || null;
      return;
    }
    dragged = card;
    legal = targets;
    liftedKey = card.key;
    if (ev.dataTransfer) {
      ev.dataTransfer.effectAllowed = 'move';
      // Firefox refuses to begin a drag with nothing on the transfer.
      ev.dataTransfer.setData('text/plain', card.key);
    }
  }

  function endDrag() {
    dragged = null;
    legal = [];
    hover = null;
    liftedKey = null;
  }

  function onDragOver(stage: WorkStage, ev: DragEvent) {
    if (!dragged || !legal.includes(stage)) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    hover = stage;
  }

  async function onDrop(stage: WorkStage, ev: DragEvent) {
    ev.preventDefault();
    const card = dragged;
    endDrag();
    if (card) await move(card, stage);
  }

  // ── Presentation ────────────────────────────────────────────────────────
  function cardTone(card: BoardCard): string {
    if (card.flags.includes('failed')) return 'urgent';
    if (card.priority === 1) return 'action';
    return STAGE_META[card.stage].tone;
  }

</script>

<div class="qb-bar">
  <div class="seg" role="group" aria-label="What a card on the board is">
    {#each BOARD_LEVELS as l (l)}
      <button
        type="button"
        class="seg-btn"
        class:on={level === l}
        aria-pressed={level === l}
        onclick={() => (level = l)}
      >{LEVEL_META[l].label}<span class="n">{boards[l].length}</span></button>
    {/each}
  </div>

  <input
    class="text-input qb-search"
    type="search"
    bind:value={query}
    placeholder="search titles and briefs…"
    aria-label="Search the backlog"
  />

  <label class="qb-sort">
    <span class="field-label">Order</span>
    <select class="text-input select" bind:value={sort} aria-label="Order the columns">
      {#each CARD_SORTS as m (m)}<option value={m}>{SORT_META[m]}</option>{/each}
    </select>
  </label>

  <span class="qb-spacer"></span>

  {#if hidden > 0 || showEmpty}
    <button
      type="button"
      class="chip"
      class:on={showEmpty}
      aria-pressed={showEmpty}
      onclick={() => (showEmpty = !showEmpty)}
    >empty columns<span class="n">{hidden}</span></button>
  {/if}
  <button type="button" class="btn sm" disabled={activeFilters === 0} onclick={reset}>
    Reset{#if activeFilters}&nbsp;({activeFilters}){/if}
  </button>
  <button type="button" class="cta sm" onclick={() => (creating = true)}>+ Add a deliverable</button>
</div>

<div class="facets">
  <div class="facet">
    <span class="field-label">Category</span>
    <div class="chips">
      {#each BACKLOG_KINDS as k (k)}
        <button
          type="button"
          class="chip"
          class:on={kinds.includes(k)}
          aria-pressed={kinds.includes(k)}
          title={KIND_META[k].cost}
          onclick={() => (kinds = toggle(kinds, k))}
        >{kindLabel(k)}<span class="n">{kindCounts[k]}</span></button>
      {/each}
    </div>
  </div>

  <div class="facet">
    <span class="field-label">Priority</span>
    <div class="chips">
      {#each PRIORITIES as p (p)}
        <button
          type="button"
          class="chip"
          class:on={priorities.includes(p)}
          aria-pressed={priorities.includes(p)}
          onclick={() => (priorities = toggle(priorities, p))}
        >P{p}<span class="n">{priorityCounts[p]}</span></button>
      {/each}
    </div>
  </div>

  <div class="facet">
    <span class="field-label">Flag</span>
    <div class="chips">
      {#each CARD_FLAGS as f (f)}
        <button
          type="button"
          class="chip"
          class:on={flags.includes(f)}
          aria-pressed={flags.includes(f)}
          onclick={() => (flags = toggle(flags, f))}
        >{FLAG_META[f]}<span class="n">{flagCounts[f]}</span></button>
      {/each}
    </div>
  </div>
</div>

<p class="note">
  Showing <b>{visible.length}</b> of {all.length}. {LEVEL_META[level].note}
  Drag a card to <b>Accepted</b> or <b>Parked</b> — those are the only two moves a person
  makes. In&nbsp;build, Verifying and Live are consequences of an attempt, and nothing may
  leave Live, because parking a shipped row would erase the fact that it shipped.
</p>

{#if report}<p class="note good" role="status">{report}</p>{/if}
{#if refused}<p class="note warn" role="status">{refused}</p>{/if}

{#if all.length === 0}
  <div class="card t-quiet">
    <p class="card-body">
      Nothing in the queue. Ideas arrive from the questions you ask, the faults daydreaming
      raises, measurements nothing writes, and the appetite scan.
    </p>
  </div>
{:else}
  <div class="qb-scroll">
    <div class="qb" style="--cols:{stages.length}">
      {#each stages as stage (stage)}
        {@const cards = visible.filter((c) => c.stage === stage)}
        {@const cap = expanded.includes(stage) ? cards.length : COLUMN_CAP}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <section
          class="col t-{STAGE_META[stage].tone}"
          class:target={legal.includes(stage)}
          class:over={hover === stage}
          class:dimmed={legal.length > 0 && !legal.includes(stage)}
          aria-label={STAGE_META[stage].label}
          ondragover={(ev) => onDragOver(stage, ev)}
          ondragleave={() => (hover = hover === stage ? null : hover)}
          ondrop={(ev) => void onDrop(stage, ev)}
        >
          <header class="col-hd">
            <span class="col-name">{STAGE_META[stage].label}</span>
            <span class="col-n">
              {counts.shown[stage]}{#if counts.shown[stage] !== counts.all[stage]}<span class="col-of"
                  >/{counts.all[stage]}</span
                >{/if}
            </span>
            <span class="col-q">{STAGE_META[stage].question}</span>
          </header>

          <div class="col-body">
            {#each cards.slice(0, cap) as card (card.key)}
              {@const moving = busy === `move:${card.key}` || busy === `pri:${card.key}`}
              {@const toAccept = planMove(card, 'accepted')}
              {@const toPark = planMove(card, 'parked')}
              {@const stuck = !toAccept.ok && !toPark.ok}
              {@const rankable = prioritySlugs(card).length > 0}
              <article
                class="wc t-{cardTone(card)}"
                class:busy={moving}
                class:lifted={liftedKey === card.key}
                draggable={card.actionable && !stuck}
                ondragstart={(ev) => onDragStart(card, ev)}
                ondragend={endDrag}
              >
                <div class="wc-top">
                  <span class="wc-pri" class:p1={card.priority === 1}>P{card.priority}</span>
                  <span class="mark">{card.kinds.map(kindLabel).join(' · ')}</span>
                </div>

                <button type="button" class="wc-title" onclick={() => (openSlug = card.epicSlug)}>
                  {card.title}
                </button>

                <p class="wc-counts">
                  {#if card.level === 'epic'}
                    <!-- The total first, because a shipped epic has neither
                         open nor live deliverables and "0 active · 0 live" is
                         then a card saying nothing about the four rows it
                         holds. Open and live are added only when there are
                         some. -->
                    {card.total} deliverable{card.total === 1 ? '' : 's'}{#if card.active}
                      · {card.active} open{/if}{#if card.live} · {card.live} live{/if}
                  {:else}
                    {STAGE_META[card.stage].label.toLowerCase()} · {ago(card.updatedAt)}
                  {/if}
                  {#if card.review}<span class="wc-review"> · {card.review} to review</span>{/if}
                </p>

                {#if card.note}<p class="wc-note">{card.note}</p>{/if}

                <div class="wc-acts">
                  <div class="step" role="group" aria-label="Priority for {card.title}">
                    <button
                      type="button"
                      class="step-btn"
                      disabled={moving || card.priority <= 1 || !rankable}
                      title="Raise one step. This is the field pickWork ranks on, so it is the only control here that changes what gets built tonight."
                      aria-label="Raise {card.title} to priority {card.priority - 1}"
                      onclick={() => setPriority(card, stepPriority(card.priority, -1))}
                    >▲</button>
                    <button
                      type="button"
                      class="step-btn"
                      disabled={moving || card.priority >= 5 || !rankable}
                      title="Lower one step"
                      aria-label="Lower {card.title} to priority {card.priority + 1}"
                      onclick={() => setPriority(card, stepPriority(card.priority, 1))}
                    >▼</button>
                  </div>
                  <span class="qb-spacer"></span>
                  <!-- Drag is the fast path; these are the same two moves for
                       anyone not using a mouse, decided by the same `planMove`,
                       so the keyboard can never assert a transition the drop
                       would refuse. -->
                  {#if toAccept.ok}
                    <button
                      type="button"
                      class="btn sm"
                      disabled={moving}
                      title={toAccept.reason}
                      onclick={() => move(card, 'accepted')}
                    >Accept</button>
                  {/if}
                  {#if toPark.ok}
                    <button
                      type="button"
                      class="btn sm"
                      disabled={moving}
                      title={toPark.reason}
                      onclick={() => move(card, 'parked')}
                    >Park</button>
                  {/if}
                  {#if stuck}
                    <span class="wc-fixed" title={(card.stage === 'live' || card.stage === 'verifying' ? toPark : toAccept).reason}>
                      {card.stage === 'live' || card.stage === 'verifying' ? 'shipped' : 'no move'}
                    </span>
                  {/if}
                </div>
              </article>
            {:else}
              <p class="col-empty">—</p>
            {/each}

            {#if cards.length > cap}
              <button type="button" class="col-more" onclick={() => (expanded = toggle(expanded, stage))}>
                Show {cards.length - cap} more
              </button>
            {:else if cards.length > COLUMN_CAP}
              <button type="button" class="col-more" onclick={() => (expanded = toggle(expanded, stage))}>
                Show fewer
              </button>
            {/if}
          </div>
        </section>
      {/each}
    </div>
  </div>
{/if}

{#if open}
  {#key open.slug}
    <EpicDrill epic={open} {busy} {act} onclose={() => (openSlug = null)} />
  {/key}
{/if}
{#if creating}
  <BacklogEditor item={null} onclose={() => (creating = false)} />
{/if}

<style>
  /* ── controls ─────────────────────────────────────────────────────────── */
  .qb-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 14px 0 12px;
    border-top: 1px solid var(--line-hair);
    border-bottom: 1px solid var(--line-hair);
    margin: clamp(16px, 2.2vw, 24px) 0 12px;
  }
  .qb-spacer {
    flex: 1 1 auto;
  }
  .qb-search {
    flex: 1 1 240px;
    min-width: 180px;
    width: auto;
  }
  .qb-sort {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .qb-sort select {
    width: auto;
  }

  .seg {
    display: inline-flex;
    border: 1px solid var(--line-strong);
  }
  .seg-btn {
    background: none;
    border: 0;
    padding: 7px 14px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
    cursor: pointer;
  }
  .seg-btn.on {
    background: var(--accent);
    color: var(--bg);
  }
  .seg-btn + .seg-btn {
    border-left: 1px solid var(--line-strong);
  }

  .chip {
    display: inline-flex;
    align-items: baseline;
    gap: 5px;
    padding: 5px 9px;
    border: 1px solid var(--line-hair);
    background: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .chip:hover {
    border-color: var(--line-strong);
  }
  .chip.on {
    border-color: var(--accent);
    background: var(--accent-tint-08);
    color: var(--accent);
  }
  .chip .n,
  .seg-btn .n {
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  .chip.on .n {
    color: var(--accent);
  }
  .seg-btn.on .n {
    color: var(--bg);
  }
  .seg-btn .n {
    margin-left: 6px;
  }

  .facets {
    display: flex;
    flex-wrap: wrap;
    gap: 10px clamp(20px, 3vw, 40px);
    padding-bottom: 14px;
    border-bottom: 1px solid var(--line-hair);
  }
  .facet {
    min-width: 0;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .facet .field-label {
    display: block;
    margin-bottom: 7px;
  }

  /* ── the board ────────────────────────────────────────────────────────── */
  .qb-scroll {
    overflow-x: auto;
    margin-top: 18px;
    padding-bottom: 12px;
  }
  .qb {
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(268px, 1fr));
    gap: 12px;
    align-items: start;
    min-width: min-content;
  }

  .col {
    min-width: 0;
    border: 1px solid var(--card-border);
    border-top: 3px solid var(--tone, var(--line-strong));
    background: var(--bg-section);
  }
  /* A column that will accept the card in flight, and one that will not. Both
     are said, because a board that only highlights the legal targets leaves
     "why did nothing happen" to be guessed at. */
  .col.target {
    border-color: var(--accent-tint-35);
    background: var(--accent-tint-04);
  }
  .col.over {
    border-color: var(--accent);
    background: var(--accent-tint-08);
  }
  .col.dimmed {
    opacity: 0.45;
  }

  .col-hd {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 2px 10px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--line-hair);
  }
  .col-name {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--tone, var(--text-secondary));
  }
  .col-n {
    font-family: var(--font-display);
    font-size: var(--fs-body-lg);
    line-height: 1;
    letter-spacing: -0.02em;
    text-align: right;
  }
  .col-of {
    font-size: var(--fs-label);
    color: var(--text-ghost);
  }
  .col-q {
    grid-column: 1 / -1;
    font-size: var(--fs-label);
    color: var(--text-muted);
  }

  .col-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    max-height: 68vh;
    overflow-y: auto;
  }
  .col-empty {
    margin: 6px 0;
    text-align: center;
    color: var(--text-ghost);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
  }
  .col-more {
    border: 1px dashed var(--line-strong);
    background: none;
    padding: 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-secondary);
    cursor: pointer;
  }

  /* ── a card ───────────────────────────────────────────────────────────── */
  .wc {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 11px 12px;
    border: 1px solid var(--card-border);
    border-left: 3px solid var(--tone, var(--line-strong));
    background: var(--surface-card);
    min-width: 0;
  }
  .wc[draggable='true'] {
    cursor: grab;
  }
  .wc.lifted {
    opacity: 0.4;
  }
  .wc.busy {
    opacity: 0.55;
  }

  .wc-top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }
  .wc-pri {
    font-family: var(--font-display);
    font-size: var(--fs-body-sm);
    line-height: 1;
    letter-spacing: -0.01em;
    color: var(--text-muted);
  }
  .wc-pri.p1 {
    color: var(--accent);
  }

  .wc-title {
    border: 0;
    background: none;
    padding: 0;
    text-align: left;
    font-family: inherit;
    font-size: var(--fs-body-sm);
    font-weight: 600;
    line-height: 1.3;
    color: var(--text-primary);
    cursor: pointer;
    overflow-wrap: anywhere;
  }
  .wc-title:hover {
    color: var(--accent);
  }
  .wc-title:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .wc-counts {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }
  .wc-review {
    color: var(--accent);
  }

  /* The sentence saying why the card is where it is, in BODY font and on its
     own line — /health's tripwire ledger sets the same sentence the same way.
     Squeezed into the mono meta row it competed with the title. */
  .wc-note {
    margin: 0;
    font-size: var(--fs-label);
    line-height: 1.45;
    color: var(--text-secondary);
    text-wrap: pretty;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .wc-acts {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-top: 8px;
    border-top: 1px solid var(--line-hair);
  }
  .step {
    display: inline-flex;
    border: 1px solid var(--line-hair);
  }
  .step-btn {
    border: 0;
    background: none;
    padding: 2px 7px;
    font-size: var(--fs-label-xs);
    line-height: 1.4;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .step-btn:hover:not(:disabled) {
    background: var(--accent-tint-08);
    color: var(--accent);
  }
  .step-btn:disabled {
    color: var(--text-ghost);
    cursor: not-allowed;
  }
  .step-btn + .step-btn {
    border-left: 1px solid var(--line-hair);
  }
  .wc-fixed {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }

  @media (max-width: 720px) {
    .qb {
      grid-template-columns: minmax(258px, 1fr);
    }
    .col-body {
      max-height: none;
    }
  }
</style>
