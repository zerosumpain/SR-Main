<script lang="ts">
  import type { Overnight } from '$lib/daydream/rooms/overnight.server';
  import { usd } from './engine-format';

  let { night, budget = null }: { night: Overnight; budget?: string | null } = $props();

  const TIME = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
  });
  const DAY = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  const clock = (iso: string) => TIME.format(new Date(iso));

  /** A pass still running has no duration yet — that reads as `running`, never
   *  as `0m`, which would look like an activity that did nothing. */
  function took(ms: number | null): string {
    if (ms == null) return 'running';
    if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
    return `${Math.round(ms / 60_000)}m`;
  }

  const started = $derived(night.startedAt ? clock(night.startedAt) : null);
  const finished = $derived(night.finishedAt ? clock(night.finishedAt) : null);
  const dayName = $derived(night.startedAt ? DAY.format(new Date(night.startedAt)) : null);
  const spend = $derived(usd(night.costUsd));
</script>

<div class="nt">
  <!-- The section head already says "the overnight"; what this line adds is
       WHICH night, which is the fact that goes stale. -->
  {#if dayName}<p class="nt-kicker">{dayName}</p>{/if}

  {#if night.error}
    <p class="nt-empty">The pulse ledger could not be read: {night.error}</p>
  {:else if !night.passes.length}
    <p class="nt-empty">
      No daydream activity has pulsed yet. The Engine room says what each pass is waiting for.
    </p>
  {:else}
    <ol class="nt-grid" aria-label="Overnight activity timeline">
      {#each night.passes as p (p.name)}
        <li class="nt-cell" class:dear={p.name === night.dearest} class:bad={p.outcome === 'error'}>
          <time class="nt-at" datetime={p.at}>{clock(p.at)}</time>
          <p class="nt-name">{p.label}</p>
          <span class="nt-duration">{took(p.durationMs)}</span>
          <div class="nt-result"><span class="nt-outcome">{p.outcome}</span>
            {#if p.summary}<details><summary>Result</summary><p class="nt-fact">{p.summary}</p></details>{/if}
          </div>
          <span class="nt-cost">{usd(p.costUsd) || '$0.00'}</span>
        </li>
      {/each}
    </ol>

    <p class="nt-cap">
      {#if started && finished}Ran {started}–{finished}{:else if started}Started {started}{/if}
      {#if spend}{` · ${spend}`}{#if budget}{` of ${budget}`}{/if} spent{/if}
      · Times in London
    </p>
  {/if}
</div>

<style>
  .nt {
    margin-top: 18px;
  }
  .nt-kicker {
    margin: 0 0 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--accent);
  }

  .nt-grid { max-height: 28rem; overflow-y: auto; scrollbar-gutter: stable; list-style: none; margin: 0; padding: 0; border-top: 2px solid var(--text-primary); }
  .nt-cell { display: grid; grid-template-columns: 4rem minmax(0, 1fr) 4rem minmax(0, 1.4fr) 5rem; gap: 12px; align-items: start; padding: 12px 10px; border-bottom: 1px solid var(--line); min-width: 0; }
  .nt-result { min-width: 0; font-size: var(--fs-label); }
  .nt-result summary { cursor: pointer; color: var(--accent-ink); }
  .nt-result summary:focus-visible { outline: 2px solid var(--accent); }
  .nt-outcome { text-transform: uppercase; font-size: var(--fs-label-xs); color: var(--text-secondary); }
  .nt-duration, .nt-cost { font-family: var(--font-code); font-size: var(--fs-label-xs); color: var(--text-secondary); }
  .nt-cost { text-align: right; }
  @media (max-width: 640px) {
    .nt-cell { grid-template-columns: 3.5rem minmax(0, 1fr) 4rem; gap: 6px 10px; }
    .nt-result { grid-column: 2; }
    .nt-cost { grid-column: 3; }
  }
  /* One pass is usually the whole budget. Tint says which without a legend. */
  .nt-cell.dear {
    background: var(--accent-tint-08);
  }
  .nt-cell.dear .nt-name {
    color: var(--accent);
  }
  .nt-cell.bad .nt-name {
    color: var(--error);
  }

  .nt-at {
    margin: 0 0 4px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }
  .nt-name {
    margin: 0 0 5px;
    font-family: var(--font-display);
    font-size: var(--fs-body);
    line-height: 1.3;
    overflow-wrap: anywhere;
    letter-spacing: -0.02em;
    text-transform: uppercase;
    color: var(--text-primary);
  }
  .nt-fact {
    margin: 0;
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }

  .nt-cap {
    margin: 14px 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.6;
    color: var(--text-ghost);
  }
  .nt-empty {
    margin: 0;
    padding: 16px 0;
    border-top: 2px solid var(--text-primary);
    font-size: var(--fs-body-sm);
    color: var(--text-muted);
  }
</style>
