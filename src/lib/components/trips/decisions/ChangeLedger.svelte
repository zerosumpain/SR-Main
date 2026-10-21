<script lang="ts">
  /**
   * "What changed", as a tick-box ledger: per day, each stop that was added,
   * moved, retimed or left out, written before → after (with the solver's
   * reason for anything left out), the walking difference, and Undo. Shown
   * after every change — an answer, a proposal used, a direct edit, a chat
   * turn. The heading takes focus when a new card arrives, so a screen reader
   * hears what happened and the keyboard is never stranded.
   */
  import type { ChangeCard } from '$lib/trips/decisions-view';
  import type { DecisionDesk } from '$lib/trips/decisions-desk.svelte';

  let { card, desk, focusOnArrive = true }: { card: ChangeCard; desk: DecisionDesk; focusOnArrive?: boolean } = $props();

  let headEl = $state<HTMLElement | null>(null);
  let shownId = 0;
  $effect(() => {
    // Focus once per new card. Tracked: the card's id. Writes no state.
    const id = card.id;
    if (!focusOnArrive || id === shownId) return;
    shownId = id;
    headEl?.focus();
  });
  const empty = $derived(!card.days.length && !card.lines.length);
  const crossed = (kind: string) => kind === 'removed' || kind === 'dropped';
</script>

<section class="cl np-card np-card--plain" aria-labelledby="cl-h-{card.id}">
  <header class="cl-hd">
    <h3 id="cl-h-{card.id}" class="cl-h" tabindex="-1" bind:this={headEl}>What changed</h3>
    {#if card.planVersion}<span class="cl-v">version {card.planVersion}</span>{/if}
    <button class="dx-link cl-x" type="button" onclick={() => desk.dismissChange()} aria-label="Close what changed">Close</button>
  </header>
  <p class="cl-title">{card.title}</p>

  {#if empty}
    <p class="dx-aside">No change to the plan — it already worked that way.</p>
  {/if}
  {#each card.days as d (d.date ?? '~')}
    <p class="dx-k cl-day">{d.label}</p>
    <ul class="cl-rows" role="list">
      {#each d.rows as r, ri (ri)}
        <li class="cl-row">
          <span class="dx-box" aria-hidden="true">
            <svg viewBox="0 0 20 20">{#if crossed(r.kind)}<path class="cross" d="M5 5 L15 15 M15 5 L5 15" />{:else}<path class="tick" d="M4 10.5 L8.5 15 L16.5 4.5" />{/if}</svg>
          </span>
          <span class="cl-body">
            <span class="cl-verb">{r.verb}</span>
            <strong class="cl-what" class:struck={crossed(r.kind)}>{r.title}</strong>
            {#if r.before || r.after}
              <span class="cl-ba">
                {#if r.before}<span class="was"><span class="dx-vh">was </span>{r.before}</span>{/if}
                {#if r.before && r.after}<span class="arrow" aria-hidden="true">→</span>{/if}
                {#if r.after}<span class="now"><span class="dx-vh">{r.before ? 'now ' : ''}</span>{r.after}</span>{/if}
              </span>
            {/if}
            {#if r.reason}<span class="cl-why">{r.reason}</span>{/if}
          </span>
        </li>
      {/each}
    </ul>
  {/each}
  {#if card.lines.length}
    <ul class="cl-rows plain" role="list">
      {#each card.lines as l, li (li)}<li class="cl-row"><span class="dx-box" aria-hidden="true"><svg viewBox="0 0 20 20"><path class="tick" d="M4 10.5 L8.5 15 L16.5 4.5" /></svg></span><span class="cl-body">{l}</span></li>{/each}
    </ul>
  {/if}
  {#if card.walk}<p class="cl-walk">{card.walk}</p>{/if}

  {#if card.remember}
    <div class="cl-remember">
      <p class="dx-aside">Worth remembering for next time? “{card.remember}”</p>
      <button class="dx-link" type="button" onclick={() => desk.tell(`Remember for future trips: ${card.remember}`)}>Ask the planner to remember it</button>
    </div>
  {/if}

  <div class="cl-acts">
    {#if card.undoTo}
      <button class="dx-btn small ghost" type="button" disabled={!!desk.busy} onclick={() => desk.undo(card.undoTo!)}>{desk.busy === 'undo' ? 'Undoing…' : 'Undo'}</button>
    {:else if card.redoTo}
      <button class="dx-btn small ghost" type="button" disabled={!!desk.busy} onclick={() => desk.undo(card.redoTo!, `Put back — version ${card.redoTo} again`)}>{desk.busy === 'undo' ? 'Working…' : 'Put it back'}</button>
    {/if}
  </div>
  {#if desk.problem?.where === 'undo'}<p class="dx-err" role="alert">{desk.problem.text}</p>{/if}
</section>

<style>
  .cl {
    --np-tilt: 0deg;
    padding: 12px 14px;
    border-left: 4px solid var(--success);
  }
  .cl-hd {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--np-margin-a);
  }
  .cl-h {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 18px;
    letter-spacing: -0.01em;
  }
  .cl-h:focus-visible {
    outline: 2px solid var(--accent-ink);
    outline-offset: 2px;
  }
  .cl-h:focus:not(:focus-visible) {
    outline: none;
  }
  .cl-v {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--np-ink-soft);
  }
  .cl-x {
    margin-left: auto;
  }
  .cl-title {
    margin: 6px 0 2px;
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: 16px;
    color: var(--np-ink-soft);
  }
  .cl-day {
    margin-top: 8px;
  }
  .cl-rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .cl-row {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 5px 0;
    border-top: 1px dashed var(--line-strong);
    font-size: var(--fs-label);
    line-height: 1.45;
  }
  .cl-row:first-child {
    border-top: 0;
  }
  .cl-body {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 8px;
    min-width: 0;
  }
  .cl-verb {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--np-pen-ink);
  }
  .cl-what {
    overflow-wrap: anywhere;
  }
  .cl-what.struck {
    text-decoration: line-through;
    text-decoration-color: var(--accent);
  }
  .cl-ba {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--np-ink-soft);
  }
  .cl-ba .was {
    text-decoration: line-through;
    text-decoration-color: var(--text-ghost);
  }
  .cl-ba .now {
    color: var(--np-ink);
  }
  .cl-why {
    flex-basis: 100%;
    font-family: var(--fs-serif);
    font-style: italic;
    color: var(--np-ink-soft);
  }
  .cl-walk {
    margin: 6px 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent-ink);
  }
  .cl-remember {
    margin-top: 8px;
    padding: 6px 8px;
    border: 1px dashed var(--line-strong);
  }
  .cl-acts {
    display: flex;
    gap: 10px;
    margin-top: 8px;
  }
  .cl-acts:empty {
    display: none;
  }
</style>
