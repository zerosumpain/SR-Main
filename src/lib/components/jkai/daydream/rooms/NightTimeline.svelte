<script lang="ts">
  // What ran while you were asleep.
  //
  // Six cells across, in the order they fired, each carrying the four facts
  // that decide whether the window is holding: when it started, how long it
  // took, what came of it, and what the thinking cost. The dearest pass is
  // tinted, because on most nights one activity is the budget and the other
  // five are rounding.
  //
  // Cash is in dollars, not the pounds the mock drew: the column is
  // `cost_usd`, the engine room already prints `$`, and converting here would
  // mean inventing an FX rate the ledger never recorded.
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
    <div class="nt-grid" style="--nt-n: {night.passes.length}">
      {#each night.passes as p (p.name)}
        <div class="nt-cell" class:dear={p.name === night.dearest} class:bad={p.outcome === 'error'}>
          <p class="nt-at">{clock(p.at)}</p>
          <p class="nt-name">{p.label}</p>
          <p class="nt-fact">
            {took(p.durationMs)} · {p.summary || p.outcome}{#if usd(p.costUsd)}{` · ${usd(p.costUsd)}`}{/if}
          </p>
        </div>
      {/each}
    </div>

    <p class="nt-cap">
      {#if started && finished}Ran {started}–{finished}{:else if started}Started {started}{/if}
      {#if spend}{` · ${spend}`}{#if budget}{` of ${budget}`}{/if} spent{/if}
      · kill switch <code>selfimprove.enabled</code>
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

  /* The rule above the row is the page's, so the cells hang off one line
     rather than each drawing its own box. */
  .nt-grid {
    display: grid;
    grid-template-columns: repeat(var(--nt-n), minmax(0, 1fr));
    border-top: 2px solid var(--text-primary);
    border-bottom: 1px solid var(--line-strong);
    padding: 20px 0 16px;
  }
  @media (max-width: 900px) {
    .nt-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px 0;
    }
  }

  .nt-cell {
    padding: 2px 14px;
    border-left: 1px solid var(--line-hair);
    min-width: 0;
  }
  .nt-cell:first-child {
    border-left: 0;
    padding-left: 0;
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
    font-size: 20px;
    line-height: 1;
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
  .nt-cap code {
    font-family: var(--font-code, var(--font-mono));
    color: var(--accent-ink);
  }
  .nt-empty {
    margin: 0;
    padding: 16px 0;
    border-top: 2px solid var(--text-primary);
    font-size: var(--fs-body-sm);
    color: var(--text-muted);
  }
</style>
