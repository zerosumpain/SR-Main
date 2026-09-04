<script lang="ts">
  // The queue as a list you can work through.
  //
  // The board answers "what shape is the pipeline in". It cannot answer "let
  // me groom the backlog for half an hour", because 347 of the 413 open items
  // land in one column, that column stops at 40 cards, and the note under it
  // says `+307 more — narrow with a filter` for a pile no filter reaches the
  // bottom of.
  //
  // So this is the same items, the same actions and the same pure filter, in
  // the form the task actually has: one row each, paged, with every lever a
  // grooming pass needs in reach — the priority the picker ranks on, the
  // readiness of the brief, whether anybody has said anything about it, and
  // the way out of the queue.
  import {
    STAGE_META,
    kindLabel,
    type WorkItem,
  } from '$lib/selfimprove/board';
  import { ago } from '$lib/daydream/format';

  interface Props {
    items: WorkItem[];
    selected: string[];
    busy: string | null;
    ontoggle: (id: string) => void;
    onopen: (item: WorkItem) => void;
    onpriority: (item: WorkItem, priority: number) => void;
    onpark: (item: WorkItem, parked: boolean) => void;
  }

  let { items, selected, busy, ontoggle, onopen, onpriority, onpark }: Props = $props();

  /** A page is a screenful of work, not a technical limit. Everything is
   *  reachable — which is the whole difference from the board's column cap. */
  const PER_PAGE = 100;
  let page = $state(0);

  const pages = $derived(Math.max(1, Math.ceil(items.length / PER_PAGE)));
  // Clamped on READ rather than corrected in an effect: an effect that writes
  // `page` while a `$derived` reads it is the read-own-write loop, and
  // narrowing a filter changes `items.length` on every keystroke.
  const current = $derived(Math.min(page, pages - 1));
  const shown = $derived(items.slice(current * PER_PAGE, current * PER_PAGE + PER_PAGE));

  function flag(i: WorkItem): { text: string; tone: string } | null {
    if (i.alreadyServed) return { text: `already served by “${i.servedBy}”`, tone: 'urgent' };
    if (i.lastError) return { text: `attempt ${i.attempts} — ${i.lastError}`, tone: 'watch' };
    if (i.foldedCount) return { text: `${i.foldedCount} restatement${i.foldedCount === 1 ? '' : 's'} folded in`, tone: 'quiet' };
    if (i.parkedReason) return { text: i.parkedReason, tone: 'quiet' };
    return null;
  }

  function readiness(i: WorkItem): { text: string; tone: string } {
    if (!i.grooming) return { text: 'no brief', tone: 'quiet' };
    const { score, status } = i.grooming.readiness;
    return { text: `${score}%`, tone: status === 'ready' ? 'good' : status === 'needs_input' ? 'watch' : 'quiet' };
  }

  /** Parking is the only exit a person may assert, and never off a shipped
   *  row — the same rule `LEGAL_MOVES` encodes for the board's drags. */
  function canPark(i: WorkItem): boolean {
    return i.actionable && i.stage !== 'live' && i.stage !== 'verifying';
  }
</script>

<div class="ql-wrap">
  <table class="ql">
    <colgroup>
      <col style="width:34px" />
      <col style="width:120px" />
      <col />
      <col style="width:96px" />
      <col style="width:82px" />
      <col style="width:70px" />
      <col style="width:34%" />
      <col style="width:132px" />
    </colgroup>
    <thead>
      <tr>
        <th><span class="sr-only">Select</span></th>
        <th>Stage</th>
        <th>Feature</th>
        <th class="c">Priority</th>
        <th class="c">Groomed</th>
        <th class="c">Notes</th>
        <th>Why it is still here</th>
        <th class="r">Touched</th>
      </tr>
    </thead>
    <tbody>
      {#each shown as i (i.id)}
        {@const f = flag(i)}
        {@const r = readiness(i)}
        {@const busyRow = busy === `pri:${i.id}` || busy === `park:${i.id}`}
        <tr class:sel={selected.includes(i.id)} class:busy={busyRow}>
          <td>
            <button
              type="button"
              class="pick"
              class:on={selected.includes(i.id)}
              aria-pressed={selected.includes(i.id)}
              aria-label={selected.includes(i.id) ? `Deselect ${i.title}` : `Select ${i.title}`}
              onclick={() => ontoggle(i.id)}
            ></button>
          </td>
          <td><span class="pill t-{STAGE_META[i.stage].tone}">{STAGE_META[i.stage].label}</span></td>
          <td class="lead">
            <button type="button" class="ql-title" onclick={() => onopen(i)}>{i.title}</button>
            <span class="ql-sub">
              {kindLabel(i.kind).toUpperCase()}
              {#if i.attempts}· {i.attempts}/{i.attemptCeiling} tries{/if}
            </span>
          </td>
          <td class="c">
            <div class="pri">
              <button
                type="button"
                class="step"
                disabled={!i.actionable || i.priority <= 1 || busyRow}
                title="Raise one step — the field pickWork ranks on"
                aria-label="Raise {i.title} to priority {i.priority - 1}"
                onclick={() => onpriority(i, i.priority - 1)}
              >▲</button>
              <span class="p" class:p1={i.priority === 1}>P{i.priority}</span>
              <button
                type="button"
                class="step"
                disabled={!i.actionable || i.priority >= 5 || busyRow}
                title="Lower one step"
                aria-label="Lower {i.title} to priority {i.priority + 1}"
                onclick={() => onpriority(i, i.priority + 1)}
              >▼</button>
            </div>
          </td>
          <td class="c"><span class="t-{r.tone} ready">{r.text}</span></td>
          <td class="c">
            <button type="button" class="notes" class:has={i.noteCount > 0} onclick={() => onopen(i)}>
              {i.noteCount || '—'}
            </button>
          </td>
          <!-- The reason a row is still in the queue, in BODY font and given a
               column of its own. /health's tripwire ledger sets the same
               sentence the same way; squeezed under the title in 12px mono it
               was competing with the title rather than explaining it. -->
          <td class="why t-{f?.tone ?? 'none'}">{f ? f.text : '—'}</td>
          <td class="r">
            <span class="when">{ago(i.updatedAt)}</span>
            {#if canPark(i)}
              <button
                type="button"
                class="row-act"
                disabled={busyRow}
                onclick={() => onpark(i, i.stage !== 'parked')}
              >{i.stage === 'parked' ? 'Put back' : 'Park'}</button>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>

  {#if items.length === 0}
    <p class="ql-empty">Nothing matches these filters.</p>
  {/if}

  {#if pages > 1}
    <div class="ql-pager">
      <button type="button" class="btn sm" disabled={current === 0} onclick={() => (page = current - 1)}>
        ← Previous
      </button>
      <span class="ql-count">
        {current * PER_PAGE + 1}–{Math.min(items.length, (current + 1) * PER_PAGE)} of {items.length}
        · page {current + 1} of {pages}
      </span>
      <button type="button" class="btn sm" disabled={current >= pages - 1} onclick={() => (page = current + 1)}>
        Next →
      </button>
    </div>
  {/if}
</div>

<style>
  .ql-wrap {
    overflow-x: auto;
    border-top: 1px solid var(--line-hair);
  }
  .ql {
    width: 100%;
    min-width: 1120px;
    border-collapse: collapse;
    table-layout: fixed;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
  }
  .ql thead tr {
    border-bottom: 2px solid var(--line-strong);
  }
  .ql th {
    padding: 0 12px 12px 0;
    text-align: left;
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .ql th:first-child,
  .ql td:first-child {
    padding-left: 0;
  }
  .ql th:last-child,
  .ql td:last-child {
    padding-right: 0;
  }
  .ql th.c,
  .ql td.c {
    text-align: center;
  }
  .ql th.r,
  .ql td.r {
    text-align: right;
  }
  .ql tbody tr {
    border-bottom: 1px solid var(--line-hair);
    transition: background-color var(--t-fast) var(--ease-out);
  }
  .ql tbody tr:hover {
    background: var(--accent-tint-04);
  }
  .ql tbody tr.sel {
    background: var(--accent-tint-08);
  }
  .ql tbody tr.busy {
    opacity: 0.55;
  }
  /* 14px rows, top-aligned — the tripwire ledger's rhythm. A two-line title
     beside a one-line badge centres badly and reads as two unrelated things. */
  .ql td {
    padding: 14px 12px 14px 0;
    vertical-align: top;
    color: var(--text-secondary);
  }
  .ql td.lead {
    min-width: 0;
  }

  .ql-title {
    display: block;
    font-family: var(--font-body);
    font-size: var(--fs-nav);
    line-height: 1.35;
    text-align: left;
    color: var(--text-primary);
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
    text-wrap: pretty;
  }
  .ql-title:hover {
    color: var(--accent);
  }
  .ql-title:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .ql-sub {
    display: block;
    margin-top: 5px;
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    color: var(--text-ghost);
  }
  .why {
    font-family: var(--font-body);
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-muted);
    min-width: 30ch;
    text-wrap: pretty;
    overflow-wrap: anywhere;
  }
  .why.t-urgent {
    color: var(--error);
  }
  .why.t-watch {
    color: var(--warn);
  }
  .why.t-none {
    color: var(--text-ghost);
  }

  .pick {
    width: 15px;
    height: 15px;
    border: 1px solid var(--line-strong);
    background: transparent;
    cursor: pointer;
    padding: 0;
    margin-top: 2px;
  }
  .pick.on {
    background: var(--accent);
    border-color: var(--accent);
  }
  .pick:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .pri {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  .step {
    font-size: var(--fs-label-xs);
    line-height: 1;
    padding: 1px 4px;
    border: 1px solid var(--card-border);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }
  .step:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .step:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  .p {
    display: inline-block;
    min-width: 24px;
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
  }
  .p.p1 {
    color: var(--error);
    font-weight: 700;
  }

  .ready.t-good {
    color: var(--good);
  }
  .ready.t-watch {
    color: var(--warn);
  }
  .ready.t-quiet {
    color: var(--text-ghost);
  }

  .notes {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    background: none;
    border: 0;
    padding: 2px 6px;
    color: var(--text-ghost);
    cursor: pointer;
  }
  .notes.has {
    color: var(--accent-ink);
    border: 1px solid var(--accent-ink-tint-35);
  }
  .notes:hover {
    color: var(--accent);
  }

  .when {
    display: block;
    color: var(--text-muted);
    white-space: nowrap;
  }
  /* Revealed on the row rather than drawn on all hundred of them: an exit
     printed against every line reads as a column of work to do. Keyboard
     focus reveals it too, so it is not a mouse-only control. */
  .row-act {
    margin-top: 4px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    background: none;
    border: 0;
    padding: 0;
    color: var(--text-ghost);
    cursor: pointer;
    opacity: 0;
    transition: opacity var(--t-fast) var(--ease-out);
  }
  tr:hover .row-act,
  .row-act:focus-visible {
    opacity: 1;
  }
  .row-act:hover:not(:disabled) {
    color: var(--error);
  }
  .row-act:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .ql-empty {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    padding: 24px 10px;
    margin: 0;
  }
  .ql-pager {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
    padding: 14px 0 2px;
    border-top: 1px solid var(--line-hair);
  }
  .ql-count {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.05em;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
