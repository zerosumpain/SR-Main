<script lang="ts">
  // Is the loop closing?
  //
  // The scoreboard for the merge. Two dashboards showed a great deal about the
  // self-improvement engine — runs, phases, budget, generated code — and
  // neither showed whether any of what it built was ever used. The number the
  // whole programme exists to move is "shipped, and called".
  //
  // Every figure is a row count. `null` means "could not tell", which renders
  // as a dash rather than a zero: "no tools have been called" and "we could not
  // read it" are different answers and only one is a reason to go and look.
  import type { LoopHealth } from '$lib/daydream/loop-health';

  let { health, verdict }: {
    health: LoopHealth;
    verdict: { state: 'closed' | 'opening' | 'open' | 'unknown'; line: string };
  } = $props();

  const t = $derived(health.tools);
  const s = $derived(health.toolSignals);

  /** A rate is withheld below this many builds — the same rule the feed uses
   *  for its useful-rate, and for the same reason: a percentage over three
   *  items is theatre. */
  const MIN_FOR_RATE = 5;
  const calledRate = $derived(
    t.shippedRecently >= MIN_FOR_RATE
      ? Math.round((t.shippedRecentlyCalled / t.shippedRecently) * 100)
      : null,
  );
</script>

<section class="nm-sec">
  <div class="nm-sec-hd">
    <span class="sr-label-tight">Is the loop closing?</span>
    <span class="nm-sec-meta">last {t.windowDays} days</span>
  </div>

  <div class="verdict v-{verdict.state}">
    <span class="v-dot" aria-hidden="true"></span>
    <p class="v-line">{verdict.line}</p>
  </div>

  <p class="sec-lede">
    The engine used to mine a question for an unmet need, author a tool, enable it,
    and then wait for a chat turn to ask the same thing again — which does not happen.
    A tool that becomes a daily measurement has a caller that never stops asking.
  </p>

  <div class="tiles">
    <div class="tile">
      <div class="tile-num mono">{t.shippedRecently}</div>
      <div class="tile-label">built</div>
      <div class="tile-sub">in {t.windowDays} days</div>
    </div>
    <div class="tile" class:bad={t.shippedRecently > 0 && t.shippedRecentlyCalled === 0}>
      <div class="tile-num mono">{t.shippedRecentlyCalled}</div>
      <div class="tile-label">of those, called</div>
      <div class="tile-sub">
        {#if calledRate !== null}{calledRate}%{:else}rate withheld under {MIN_FOR_RATE} builds{/if}
      </div>
    </div>
    <div class="tile">
      <div class="tile-num mono">{s ? s.registered : '—'}</div>
      <div class="tile-label">sampled as signals</div>
      <div class="tile-sub">{s ? `${s.observing} recording` : 'not measured'}</div>
    </div>
    <div class="tile">
      <div class="tile-num mono">{s ? s.sweepable : '—'}</div>
      <div class="tile-label">correlatable</div>
      <div class="tile-sub">
        {#if s}needs {s.minPairs} days each{:else}not measured{/if}
      </div>
    </div>
  </div>

  <div class="all-time">
    <span class="mono">{t.everCalled}</span> of <span class="mono">{t.total}</span> self-built
    tools have ever been called ({t.enabled} enabled).
    {#if s && s.registered > 0 && s.sweepable === 0}
      No tool signal has reached {s.minPairs} days yet — registering is not trusting, and
      nothing found this week is correlated for a fortnight.
    {/if}
  </div>

  {#if health.error}
    <p class="load-err">The loop’s state could not be read: {health.error}</p>
  {/if}

  <a class="row-link" href="/jkai/improvement">Open the full improvement ledger →</a>
</section>

<style>
  .verdict {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    padding: 0.75rem 0.9rem;
    border-left: 2px solid var(--text-muted);
    background: var(--bg-section);
    margin-bottom: 0.9rem;
  }
  .v-dot {
    width: 8px;
    height: 8px;
    border-radius: 100px;
    background: var(--text-muted);
    margin-top: 0.42rem;
    flex: none;
  }
  .v-closed { border-left-color: var(--success); }
  .v-closed .v-dot { background: var(--success); }
  .v-opening { border-left-color: var(--warn); }
  .v-opening .v-dot { background: var(--warn); }
  .v-open { border-left-color: var(--error); }
  .v-open .v-dot { background: var(--error); }

  .v-line {
    margin: 0;
    font-size: 0.95rem;
    line-height: 1.45;
    color: var(--text-primary);
  }

  .sec-lede {
    margin: 0 0 1rem;
    color: var(--text-secondary);
    font-size: 0.9rem;
    line-height: 1.5;
    max-width: 62ch;
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: 0.75rem;
    margin-bottom: 1rem;
  }
  .tile {
    border: 1px solid var(--border);
    padding: 0.75rem 0.85rem;
    background: var(--card-bg);
  }
  .tile.bad { border-color: var(--error); }
  .tile-num {
    font-size: 1.6rem;
    line-height: 1.1;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }
  .tile.bad .tile-num { color: var(--error); }
  .tile-label {
    font-size: 0.8rem;
    color: var(--text-secondary);
    margin-top: 0.25rem;
  }
  .tile-sub {
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-top: 0.15rem;
  }

  .all-time {
    font-size: 0.87rem;
    color: var(--text-secondary);
    line-height: 1.5;
    max-width: 62ch;
    margin-bottom: 0.85rem;
  }

  .load-err {
    font-size: 0.85rem;
    color: var(--error);
    margin: 0 0 0.85rem;
  }
</style>
