<script lang="ts">
  /**
   * The thread inspector's MEMORY mode.
   *
   * What jkai carries into this thread that the thread did not say — and,
   * the half that was missing everywhere, whether any of it was USED. Four
   * cells, each a different recorded fact rather than four views of one list:
   *
   *   GIVEN LAST TURN   the memories the last reply was handed at assembly,
   *                     read from the stamp the chat route writes
   *   RELEVANT NOW      what retrieval returns for the thread's recent words —
   *                     what the next turn would most likely be given
   *   THIS THREAD       what this thread wrote, recalled or forgot, from its
   *                     recorded tool chains and the memory rows' provenance
   *   RECENTLY CHANGED  what moved in the store, with the state vocabulary:
   *                     current / pinned / replaced / forgotten / expiring
   *
   * "Used" is never inferred. A thread from before the stamp existed says
   * "not recorded", and that is the honest reading.
   *
   * Same cell grammar as the rest of the column; same two gestures as the
   * context cards: click selects and offers "ask about this", double-click
   * drills. Actions live in the drill, not here — the column stays a reading.
   */
  import { untrack } from 'svelte';
  import { hub } from '$lib/jkai/hub-bus.svelte';
  import { threadMemoryPayloadSchema, type ThreadMemoryPayload, type ThreadMemoryRow } from '$lib/jkai/memory/thread';
  import { MEMORY_STATE_LABEL } from '$lib/jkai/memory/contracts';
  import { relativeStamp } from '$lib/jkai/context-panel/drill';

  let {
    conversationId,
    revision = 0,
    onDrill,
    onAsk,
  }: {
    conversationId: string | null;
    /** Bumped by the rail after a memory action in the drill. */
    revision?: number;
    onDrill: (target: string) => void;
    onAsk: (label: string, detail: string) => void;
  } = $props();

  let payload = $state<ThreadMemoryPayload | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let selected = $state<ThreadMemoryRow | null>(null);
  let loadedKey = '';
  let seq = 0;

  async function load(id: string): Promise<void> {
    const mine = ++seq;
    loading = true;
    error = null;
    try {
      const res = await fetch(`/api/jkai/conversations/${id}/memory`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `Memory returned ${res.status}`);
      const parsed = threadMemoryPayloadSchema.safeParse(body);
      if (!parsed.success) throw new Error('Memory returned an invalid payload');
      if (mine === seq) payload = parsed.data;
    } catch (cause) {
      if (mine === seq) error = cause instanceof Error ? cause.message : 'Memory unavailable';
    } finally {
      if (mine === seq) loading = false;
    }
  }

  // Reload on a thread switch, on every completed turn (the page bumps
  // graphRevision), and after a drill action (the rail bumps `revision`).
  $effect(() => {
    const id = conversationId;
    const key = `${id ?? ''}:${hub.graphRevision}:${revision}`;
    untrack(() => {
      if (key === loadedKey) return;
      loadedKey = key;
      selected = null;
      if (!id) {
        payload = null;
        return;
      }
      void load(id);
    });
  });

  // ── Review on demand ────────────────────────────────────────────────────
  let reviewing = $state(false);
  let reviewNote = $state<string | null>(null);

  async function reviewNow(): Promise<void> {
    if (!conversationId || reviewing) return;
    reviewing = true;
    reviewNote = null;
    try {
      const res = await fetch(`/api/jkai/conversations/${conversationId}/memory`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'review' }),
      });
      const body = (await res.json().catch(() => ({}))) as { saved?: number; error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? `${res.status}`);
      reviewNote = body.saved ? `${body.saved} new memor${body.saved === 1 ? 'y' : 'ies'}` : 'nothing new to remember';
      loadedKey = '';
      await load(conversationId);
    } catch (cause) {
      reviewNote = cause instanceof Error ? cause.message : 'review failed';
    } finally {
      reviewing = false;
    }
  }

  function pick(row: ThreadMemoryRow): void {
    selected = selected?.id === row.id ? null : row;
  }

  function stateTone(row: ThreadMemoryRow): string {
    if (row.state === 'forgotten' || row.state === 'replaced' || row.state === 'expired') return 'bad';
    if (row.state === 'expiring') return 'warn';
    if (row.state === 'pinned') return 'accent';
    return 'default';
  }

  const gaugePct = $derived(
    payload?.lastTurn ? Math.max(0, Math.min(100, Math.round((payload.lastTurn.chars / payload.lastTurn.budget) * 100))) : 0,
  );
  const gaugeTone = $derived(gaugePct >= 90 ? 'high' : gaugePct >= 65 ? 'mid' : 'low');
  const threadWritten = $derived(payload?.thread.events.filter((e) => e.verb === 'written').length ?? 0);
  const threadRecalled = $derived(payload?.thread.events.filter((e) => e.verb === 'recalled').length ?? 0);
  const threadForgotten = $derived(payload?.thread.events.filter((e) => e.verb === 'forgotten').length ?? 0);

  function compact(n: number): string {
    return n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}k`;
  }
</script>

{#if error}
  <div class="ins-alert">
    <span class="ins-eyebrow">Memory unavailable</span>
    <p class="ins-note">{error}</p>
    <button type="button" class="ins-more" onclick={() => conversationId && load(conversationId)}>retry →</button>
  </div>
{:else if !payload}
  <p class="ins-empty">{conversationId ? (loading ? 'Reading memory…' : 'No memory reading yet.') : 'Select a conversation.'}</p>
{:else}
  <!-- The figures. Four, ruled, mono tabular — the same tile the CONTEXT
       metrics card draws, so the two modes read as one instrument. -->
  <section class="ins-cell mm-head">
    <div class="ins-cell-hd">
      <span class="ins-eyebrow">Memory{loading ? ' · reading…' : ''}</span>
      <a class="ins-act" href="/jkai/intel/memory" title="Every personal memory, with its controls">memory page →</a>
    </div>
    <div class="mm-figs">
      <button type="button" class="mm-fig" onclick={() => onDrill('memories:changed')} title="Every live personal memory">
        <span class="mm-fig-label">Live</span>
        <strong class="mm-fig-val">{payload.figures.live}</strong>
      </button>
      <button type="button" class="mm-fig" data-tone={payload.figures.pinned ? 'accent' : 'default'} onclick={() => onDrill('memories:changed')} title="Pinned facts ride on every turn">
        <span class="mm-fig-label">Pinned</span>
        <strong class="mm-fig-val">{payload.figures.pinned}</strong>
      </button>
      <button type="button" class="mm-fig" data-tone={payload.figures.writtenHere ? 'good' : 'default'} onclick={() => onDrill('memories:thread')} title="Memories this thread wrote">
        <span class="mm-fig-label">From here</span>
        <strong class="mm-fig-val">{payload.figures.writtenHere}</strong>
      </button>
      <button type="button" class="mm-fig" data-tone={payload.figures.stale30d ? 'warn' : 'default'} onclick={() => onDrill('memories:changed')} title="Replaced, forgotten or expired in the last 30 days">
        <span class="mm-fig-label">Stale 30d</span>
        <strong class="mm-fig-val">{payload.figures.stale30d}</strong>
      </button>
    </div>
  </section>

  <!-- ── Given last turn ──────────────────────────────────────────────── -->
  <section class="ins-cell">
    <div class="ins-cell-hd">
      <span class="ins-eyebrow">Given last turn</span>
      {#if payload.lastTurn}
        <span class="ins-meta">{payload.lastTurn.served} of {payload.lastTurn.retrieved} · {relativeStamp(payload.lastTurn.at)}</span>
      {/if}
    </div>
    {#if !payload.lastTurn}
      <p class="ins-note">
        {payload.recorded
          ? 'The last turn recorded nothing.'
          : 'Not recorded. Turns before this reading existed carry no record of what they were given; the next reply will.'}
      </p>
    {:else if payload.lastTurn.unavailable}
      <p class="ins-note mm-warn">Memory retrieval failed on the last turn — the model was told so rather than given nothing.</p>
    {:else}
      <!-- A gauge, not a bar: the quarter ticks make it a reading. Same
           drawing as the LEDGER context-window gauge. -->
      <div class="mm-gauge" data-tone={gaugeTone} role="img" aria-label="{payload.lastTurn.chars} of {payload.lastTurn.budget} characters of memory budget used">
        <span class="mm-fill" style="width: {gaugePct}%"></span>
        <span class="mm-tick" style="left: 25%"></span>
        <span class="mm-tick" style="left: 50%"></span>
        <span class="mm-tick" style="left: 75%"></span>
      </div>
      <div class="mm-legend">
        <span>{compact(payload.lastTurn.chars)} of {compact(payload.lastTurn.budget)} chars</span>
        {#if payload.omittedLastTurn > 0}
          <span class="mm-trip" title="Retrieved as relevant, but the budget was spent before they were written">{payload.omittedLastTurn} left out</span>
        {/if}
      </div>
      {#if payload.served.length}
        <div class="ins-rows mm-rows">
          {#each payload.served.slice(0, 6) as row (row.id)}
            <button
              type="button"
              class="mm-row"
              class:on={selected?.id === row.id}
              data-tone={stateTone(row)}
              onclick={() => pick(row)}
              ondblclick={() => onDrill(`memory:${row.id}`)}
              title="Click to select · double-click for provenance and controls"
            >
              <span class="mm-row-text">{row.content}</span>
              <span class="mm-row-meta">{row.category}{row.recalledBecause ? ` · ${row.recalledBecause.toLowerCase()}` : ''}{row.pinned ? ' · pinned' : ''}</span>
            </button>
          {/each}
        </div>
        {#if payload.served.length > 6}
          <button type="button" class="ins-more" onclick={() => onDrill('memories:served')}>all {payload.served.length} →</button>
        {/if}
      {:else}
        <p class="ins-note">Nothing matched the last message closely enough to be written in.</p>
      {/if}
    {/if}
  </section>

  <!-- ── Relevant now ─────────────────────────────────────────────────── -->
  <section class="ins-cell">
    <div class="ins-cell-hd">
      <span class="ins-eyebrow">Relevant now</span>
      <span class="ins-meta">{payload.relevant.length}</span>
    </div>
    {#if payload.relevant.length === 0}
      <p class="ins-note">
        {payload.relevantQuery ? 'Retrieval finds nothing for this thread’s recent words.' : 'Nothing has been said yet to retrieve against.'}
      </p>
    {:else}
      <div class="ins-rows mm-rows">
        {#each payload.relevant.slice(0, 6) as row (row.id)}
          <button
            type="button"
            class="mm-row"
            class:on={selected?.id === row.id}
            data-tone={stateTone(row)}
            onclick={() => pick(row)}
            ondblclick={() => onDrill(`memory:${row.id}`)}
            title="Click to select · double-click for provenance and controls"
          >
            <span class="mm-row-text">{row.content}</span>
            <span class="mm-row-meta">
              {row.category}
              {#if row.use.servedTurns}· served {row.use.servedTurns}×{/if}
              {#if row.recalledBecause}· {row.recalledBecause.toLowerCase()}{/if}
            </span>
          </button>
        {/each}
      </div>
      <button type="button" class="ins-more" onclick={() => onDrill('memories:relevant')}>what retrieval sees →</button>
    {/if}
  </section>

  <!-- ── This thread ──────────────────────────────────────────────────── -->
  <section class="ins-cell">
    <div class="ins-cell-hd">
      <span class="ins-eyebrow">This thread</span>
      <span class="ins-meta">
        {#if threadWritten || threadRecalled || threadForgotten}
          {[threadWritten ? `wrote ${threadWritten}` : '', threadRecalled ? `recalled ${threadRecalled}` : '', threadForgotten ? `forgot ${threadForgotten}` : ''].filter(Boolean).join(' · ')}
        {:else}
          no tool calls
        {/if}
      </span>
    </div>
    {#if payload.thread.rows.length === 0 && payload.thread.events.length === 0}
      <p class="ins-note">This thread has neither written a memory nor reached for one on its own.</p>
    {:else}
      {#if payload.thread.rows.length}
        <div class="ins-rows mm-rows">
          {#each payload.thread.rows.slice(0, 5) as row (row.id)}
            <button
              type="button"
              class="mm-row"
              class:on={selected?.id === row.id}
              data-tone={stateTone(row)}
              onclick={() => pick(row)}
              ondblclick={() => onDrill(`memory:${row.id}`)}
              title="Click to select · double-click for provenance and controls"
            >
              <span class="mm-row-text">{row.content}</span>
              <span class="mm-row-meta">
                {row.fromThisThread ? 'written here' : 'touched here'} · {MEMORY_STATE_LABEL[row.state]}
                {#if row.replacedBy}· replaced{/if}
              </span>
            </button>
          {/each}
        </div>
      {/if}
      {#if payload.thread.events.length}
        <div class="mm-events">
          {#each payload.thread.events.slice(0, 5) as e (e.id)}
            <a class="mm-event" href="/jkai/trace/{e.traceId}" data-verb={e.verb} title={e.summary ?? e.tool}>
              <span class="mm-event-verb">{e.verb}</span>
              <span class="mm-event-text">{e.summary ?? e.tool}</span>
              <span class="mm-event-when">{relativeStamp(e.at)}</span>
            </a>
          {/each}
        </div>
      {/if}
      <button type="button" class="ins-more" onclick={() => onDrill('memories:thread')}>everything this thread touched →</button>
    {/if}
  </section>

  <!-- ── Recently changed ─────────────────────────────────────────────── -->
  <section class="ins-cell">
    <div class="ins-cell-hd">
      <span class="ins-eyebrow">Recently changed</span>
      <span class="ins-meta">store-wide</span>
    </div>
    <div class="ins-rows mm-rows">
      {#each payload.changed.slice(0, 6) as row (row.id)}
        <button
          type="button"
          class="mm-row"
          class:on={selected?.id === row.id}
          data-tone={stateTone(row)}
          onclick={() => pick(row)}
          ondblclick={() => onDrill(`memory:${row.id}`)}
          title="Click to select · double-click for provenance and controls"
        >
          <span class="mm-row-text">{row.content}</span>
          <span class="mm-row-meta">
            <span class="mm-state" data-tone={stateTone(row)}>{MEMORY_STATE_LABEL[row.state]}</span>
            · {relativeStamp(row.updatedAt)}
            {#if row.replacedBy?.content}· → {row.replacedBy.content}{/if}
          </span>
        </button>
      {/each}
    </div>
    <button type="button" class="ins-more" onclick={() => onDrill('memories:changed')}>the store →</button>
  </section>

  <!-- ── Review ───────────────────────────────────────────────────────── -->
  <section class="ins-cell mm-review">
    <div class="ins-cell-hd">
      <span class="ins-eyebrow">Extraction</span>
      <span class="ins-meta">{payload.lastReviewAt ? `last ${relativeStamp(payload.lastReviewAt)}` : 'never run here'}</span>
    </div>
    <p class="ins-note">
      Facts are pulled from a thread once it has been idle for half an hour. This runs that pass now, on this thread.
    </p>
    <div class="mm-review-row">
      <button type="button" class="ins-more mm-review-btn" disabled={reviewing || !conversationId} onclick={reviewNow}>
        {reviewing ? 'reviewing…' : 'review this thread now →'}
      </button>
      {#if reviewNote}<span class="ins-meta">{reviewNote}</span>{/if}
    </div>
  </section>

  {#if selected}
    <!-- The bridge back into the conversation — the reason the panel is
         worth reading. Sticky at the foot of the scroll, like the card's. -->
    <div class="mm-sel">
      <span class="mm-sel-text">{selected.content}</span>
      <button type="button" class="mm-sel-go" onclick={() => onAsk('Is this still right?', `Memory (${selected!.category}): ${selected!.content}`)}>
        ask about this →
      </button>
    </div>
  {/if}
{/if}

<style>
  /* Cell grammar is inherited from the rail by class name; the rail's styles
     are scoped, so the shared classes are redeclared here at the same
     values. Change them there and change them here. */
  .ins-eyebrow {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-ghost);
    line-height: 1.2;
  }
  .ins-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .ins-cell {
    flex: none;
    padding: 12px 15px 14px;
    border-bottom: 1px solid var(--line-hair);
  }
  .ins-cell-hd {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 10px;
  }
  .ins-rows {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .ins-note {
    margin: 0;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-muted);
  }
  .ins-empty {
    margin: 0;
    padding: 24px 18px;
    text-align: center;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    line-height: 1.55;
    color: var(--text-ghost);
  }
  .ins-more {
    display: block;
    margin-top: 8px;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    text-align: left;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .ins-more:hover:not(:disabled) {
    color: var(--accent-hover);
  }
  .ins-more:disabled {
    color: var(--text-ghost);
    cursor: default;
  }
  .ins-act {
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent);
    text-decoration: none;
  }
  .ins-act:hover {
    color: var(--accent-hover);
  }
  .ins-alert {
    margin: 14px 15px;
    padding: 12px 13px;
    border: 1px solid var(--line-strong);
    border-left: 3px solid var(--error);
    background: var(--bg);
  }
  .ins-alert .ins-note {
    margin-top: 5px;
    color: var(--error);
  }

  /* ── Figures ─────────────────────────────────────────────────────────── */
  .mm-head {
    background: var(--bg);
  }
  .mm-figs {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    margin: 0 -15px -14px;
    border-top: 1px solid var(--line-hair);
  }
  .mm-fig {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    padding: 9px 10px 11px;
    border: none;
    border-right: 1px solid var(--line-hair);
    background: none;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s ease-out;
  }
  .mm-fig:last-child {
    border-right: none;
  }
  .mm-fig:hover {
    background: var(--surface-sunken);
  }
  .mm-fig-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-ghost);
  }
  .mm-fig-val {
    font-family: var(--font-mono);
    font-weight: 500;
    font-size: var(--fs-num-md);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
    line-height: 1.1;
    color: var(--text-primary);
  }
  .mm-fig[data-tone='good'] .mm-fig-val { color: var(--success); }
  .mm-fig[data-tone='warn'] .mm-fig-val { color: var(--warn); }
  .mm-fig[data-tone='accent'] .mm-fig-val { color: var(--accent-ink); }

  /* ── Gauge ───────────────────────────────────────────────────────────── */
  .mm-gauge {
    position: relative;
    height: 8px;
    background: rgba(26, 16, 8, 0.08);
    overflow: hidden;
  }
  .mm-fill {
    display: block;
    height: 100%;
    background: var(--accent-ink);
    transition: width 0.3s ease-out;
  }
  .mm-gauge[data-tone='mid'] .mm-fill { background: var(--warn); }
  .mm-gauge[data-tone='high'] .mm-fill { background: var(--accent); }
  .mm-tick {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: var(--bg);
  }
  .mm-legend {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin: 5px 0 9px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .mm-trip {
    color: var(--warn);
  }
  .mm-warn {
    border-left: 3px solid var(--warn);
    padding-left: 10px;
    color: var(--warn);
  }

  /* ── Rows ────────────────────────────────────────────────────────────── */
  .mm-rows {
    margin: 0 -6px;
  }
  .mm-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    min-width: 0;
    padding: 6px 6px 7px 8px;
    border: none;
    border-left: 2px solid var(--line-hair);
    background: none;
    cursor: pointer;
    text-align: left;
    transition: border-color 0.15s ease-out, background 0.15s ease-out;
  }
  .mm-row[data-tone='good'] { border-left-color: var(--success); }
  .mm-row[data-tone='warn'] { border-left-color: var(--warn); }
  .mm-row[data-tone='bad'] { border-left-color: var(--error); }
  .mm-row[data-tone='accent'] { border-left-color: var(--accent-ink); }
  .mm-row:hover {
    background: var(--surface-sunken);
  }
  .mm-row.on {
    background: var(--accent-tint-08);
    border-left-color: var(--accent);
  }
  .mm-row-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    color: var(--text-secondary);
  }
  .mm-row:hover .mm-row-text,
  .mm-row.on .mm-row-text {
    color: var(--text-primary);
  }
  .mm-row[data-tone='bad'] .mm-row-text {
    text-decoration: line-through;
    text-decoration-color: var(--text-ghost);
  }
  .mm-row-meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }
  .mm-state {
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .mm-state[data-tone='bad'] { color: var(--error); }
  .mm-state[data-tone='warn'] { color: var(--warn); }
  .mm-state[data-tone='accent'] { color: var(--accent-ink); }

  /* ── Events ──────────────────────────────────────────────────────────── */
  .mm-events {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--line-hair);
  }
  .mm-event {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 8px;
    padding: 4px 0;
    text-decoration: none;
  }
  .mm-event:hover .mm-event-text {
    color: var(--accent);
  }
  .mm-event-verb {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent-ink);
  }
  .mm-event[data-verb='written'] .mm-event-verb { color: var(--accent); }
  .mm-event[data-verb='forgotten'] .mm-event-verb { color: var(--error); }
  .mm-event-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-body);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
  }
  .mm-event-when {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    white-space: nowrap;
  }

  /* ── Review ──────────────────────────────────────────────────────────── */
  .mm-review {
    background: var(--bg);
  }
  .mm-review-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }
  .mm-review-btn {
    margin-top: 6px;
  }

  /* ── Selection ───────────────────────────────────────────────────────── */
  .mm-sel {
    position: sticky;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 9px;
    padding: 8px 15px 9px;
    border-top: 1px solid var(--line-hair);
    background: var(--accent-tint-08);
    backdrop-filter: blur(2px);
  }
  .mm-sel-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-body);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
  }
  .mm-sel-go {
    flex: none;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .mm-sel-go:hover {
    color: var(--accent-hover);
  }
</style>
