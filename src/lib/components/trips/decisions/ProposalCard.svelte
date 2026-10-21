<script lang="ts">
  /**
   * One proposal as an index card: what it is and why, its photo (with the
   * Commons credit), the trade-offs as chips, the evidence, and the choices —
   * Use this, Preview (the ghost on the map), Compare, Not this (with a
   * reason), and "Like this, but…" nudges. A trip shape is the same card drawn
   * bigger, with a line per day and what it leaves out. A legacy option (the
   * planner's v7 `options`) wears the same card with only Use this / Not this.
   *
   * When the plan has moved on since it was made (`409 stale`), the card shows
   * the re-checked difference and asks again ("Use this now").
   */
  import { tick } from 'svelte';
  import { NUDGES, NUDGE_LABEL, REJECT_REASONS, REJECT_REASON_LABEL, type Proposal, type ProposalKind } from '$lib/trips/decisions';
  import { dayLabel } from '$lib/trips/changes';
  import { ghostDays, hostOf, isOptionCard, listText, tradeoffChips } from '$lib/trips/decisions-view';
  import type { DecisionDesk } from '$lib/trips/decisions-desk.svelte';
  import PlacePhoto from './PlacePhoto.svelte';

  let {
    p,
    desk,
    previewing = false,
    onPreview,
    comparing = false,
    onCompare,
    onSettled,
    headingLevel = 4,
  }: {
    p: Proposal;
    desk: DecisionDesk;
    previewing?: boolean;
    /** Show (or, with null, stop showing) this proposal on the map. */
    onPreview?: (p: Proposal | null) => void;
    comparing?: boolean;
    onCompare?: (p: Proposal) => void;
    /** After it leaves the screen (turned down), so the group can move focus on. */
    onSettled?: () => void;
    headingLevel?: 3 | 4;
  } = $props();

  const KIND: Record<ProposalKind, string> = {
    shape: 'One way to do it',
    day: 'Another way',
    swap: 'Swap',
    fill: 'Idea',
    fix: 'To sort out',
    change: 'To approve',
    replan: 'On the day',
  };

  const key = $derived(`p:${p.id}`);
  const legacy = $derived(isOptionCard(p));
  const shape = $derived(p.kind === 'shape');
  const stale = $derived(!!desk.stale[p.id]);
  const working = $derived(desk.busy === key);
  const chips = $derived(tradeoffChips(p.tradeoffs));
  const canPreview = $derived(!!onPreview && (ghostDays(p).length > 0 || p.diff.dates.length > 0 || !!p.scope.date));
  const canNudge = $derived(!legacy && (p.kind === 'swap' || p.kind === 'fill'));
  const lines = $derived(p.diff.lines.filter((l) => l && l !== 'First plan.'));
  const tag = $derived(`h${headingLevel}`);

  let rejecting = $state(false);
  let reasonsEl = $state<HTMLDivElement | null>(null);
  function openReasons() {
    rejecting = !rejecting;
    if (rejecting) void tick().then(() => reasonsEl?.querySelector('button')?.focus());
  }
  async function reject(reason: (typeof REJECT_REASONS)[number]) {
    if (await desk.reject(p, reason)) {
      if (previewing) onPreview?.(null);
      onSettled?.();
    }
  }
  async function use() {
    if (await desk.accept(p)) {
      if (previewing) onPreview?.(null);
    }
  }
</script>

<article class="pc np-card np-card--plain" class:shape class:previewing class:stale aria-labelledby="pc-{p.id}" aria-busy={working}>
  <header class="pc-hd">
    <p class="dx-k">{legacy ? 'Option' : KIND[p.kind]}{#if p.scope.date && !shape}{` · ${dayLabel(p.scope.date)}`}{/if}</p>
    <svelte:element this={tag} id="pc-{p.id}" class="pc-title">{p.shape?.headline || p.title}</svelte:element>
  </header>

  {#if p.image}<PlacePhoto image={p.image} alt={p.place?.name ?? p.title} compact={!shape} />{/if}
  {#if p.why}<p class="pc-why">{p.why}</p>{/if}

  {#if chips.length}
    <ul class="dx-chips" aria-label="What it means">
      {#each chips as c (c.key)}<li class="dx-chip {c.tone}">{c.label}</li>{/each}
    </ul>
  {/if}

  {#if p.shape}
    <ol class="pc-days" aria-label="The days">
      {#each p.shape.days as d (d.date)}<li><span class="pc-date">{dayLabel(d.date)}</span><span class="pc-line">{d.line}</span></li>{/each}
    </ol>
    {#if p.shape.leavesOut.length}<p class="pc-out"><span class="dx-k">Leaves out</span> {listText(p.shape.leavesOut)}</p>{/if}
  {/if}

  {#if stale}
    <div class="pc-stale" role="status">
      <p class="dx-k">The plan has moved on</p>
      <p class="dx-aside">Since this was suggested the plan changed. Checked again, it would now:</p>
      {#if lines.length}<ul class="pc-lines">{#each lines as l, li (li)}<li>{l}</li>{/each}</ul>{:else}<p class="dx-aside">change nothing else.</p>{/if}
    </div>
  {:else if lines.length && !shape}
    <details class="pc-diff">
      <summary>What it changes ({lines.length})</summary>
      <ul class="pc-lines">{#each lines as l, li (li)}<li>{l}</li>{/each}</ul>
    </details>
  {/if}

  {#if p.evidence.length}
    <p class="pc-src">
      <span class="dx-vh">{'Sources: '}</span>{#each p.evidence as s, si (s.url)}{si ? ' · ' : ''}<a href={s.url} target="_blank" rel="noopener noreferrer">{s.title ?? hostOf(s.url)}</a>{/each}
    </p>
  {/if}

  <div class="pc-acts">
    <button class="dx-btn small" type="button" disabled={!!desk.busy} onclick={use}>{working ? 'Working…' : stale ? 'Use this now' : 'Use this'}</button>
    {#if canPreview}
      <button class="dx-pen" type="button" aria-pressed={previewing} onclick={() => onPreview?.(previewing ? null : p)}>{previewing ? 'Stop preview' : 'Preview'}</button>
    {/if}
    {#if onCompare && !legacy}
      <button class="dx-pen" type="button" aria-pressed={comparing} onclick={() => onCompare?.(p)}>Compare</button>
    {/if}
    <button class="dx-link" type="button" aria-expanded={rejecting} disabled={!!desk.busy} onclick={() => (legacy ? reject('not-for-us') : openReasons())}>Not this</button>
  </div>

  {#if rejecting && !legacy}
    <div class="pc-row" role="group" aria-label="Why not {p.title}?" bind:this={reasonsEl}>
      <span class="dx-aside">Why not?</span>
      {#each REJECT_REASONS as r (r)}<button class="dx-pen" type="button" disabled={!!desk.busy} onclick={() => reject(r)}>{REJECT_REASON_LABEL[r]}</button>{/each}
    </div>
  {/if}

  {#if canNudge}
    <div class="pc-row" role="group" aria-label="Like {p.title}, but…">
      <span class="dx-aside">Like this, but:</span>
      {#each NUDGES as n (n)}<button class="dx-pen" type="button" disabled={!!desk.busy} onclick={() => desk.nudge(p, n)}>{NUDGE_LABEL[n]}</button>{/each}
    </div>
  {/if}

  {#if working}<p class="dx-note" role="status"><span class="dx-pulse" aria-hidden="true"></span> Checking it against the plan…</p>{/if}
  {#if desk.problem?.where === key}<p class="dx-err" role="alert">{desk.problem.text}</p>{/if}
  {#if desk.note?.where === key}<p class="dx-note" role="status">{desk.note.text}</p>{/if}
</article>

<style>
  .pc {
    --np-tilt: 0deg;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px 12px;
    min-width: 0;
  }
  .pc.previewing {
    border-color: var(--accent-ink);
    box-shadow: inset 4px 0 0 var(--accent-ink);
  }
  .pc.stale {
    border-color: var(--accent);
  }
  .pc-hd {
    padding-bottom: 6px;
    border-bottom: 1px solid var(--np-margin-a);
  }
  .pc-title {
    margin: 2px 0 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 18px;
    line-height: 1.25;
    letter-spacing: -0.01em;
    overflow-wrap: anywhere;
  }
  .shape .pc-title {
    font-size: clamp(20px, 2.2vw, 24px);
  }
  .pc-why {
    margin: 0;
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: 16px;
    line-height: 24px;
    color: var(--np-ink-soft);
  }
  .pc-days {
    list-style: none;
    margin: 0;
    padding: 0;
    background-image: repeating-linear-gradient(to bottom, transparent 0 23px, var(--np-rule) 23px 24px);
  }
  .pc-days li {
    display: grid;
    grid-template-columns: 6.5rem minmax(0, 1fr);
    gap: 8px;
    line-height: 24px;
  }
  .pc-date {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--np-pen-text);
    white-space: nowrap;
  }
  .pc-line {
    font-size: var(--fs-label);
  }
  .pc-out {
    margin: 0;
    font-size: var(--fs-label);
  }
  .pc-stale {
    padding: 8px 10px;
    border: 1px dashed var(--accent);
    background: var(--accent-tint-08);
  }
  .pc-diff summary {
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent-ink);
  }
  .pc-lines {
    margin: 4px 0 0;
    padding-left: 18px;
    font-size: var(--fs-label);
    line-height: 1.5;
  }
  .pc-lines li::marker {
    color: var(--accent);
  }
  .pc-src {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .pc-src a {
    color: var(--accent-ink);
  }
  .pc-acts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 10px;
  }
  .pc-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .pc-row .dx-aside {
    font-size: 15px;
    margin-right: 2px;
  }
  @media (max-width: 420px) {
    .pc-days li {
      grid-template-columns: minmax(0, 1fr);
      gap: 0;
    }
  }
</style>
