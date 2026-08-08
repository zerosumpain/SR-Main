<script lang="ts">
  /**
   * Build cockpit — the instrument panel above the build stream.
   *
   * Every number here is DERIVED in `cockpit-metrics.ts`; this file only
   * renders. Where the data cannot answer a question the metric is null and
   * the panel says so rather than guessing.
   *
   * Charts are deliberately single-hue. The design system is a two-accent
   * warm-brutalist palette, so a categorical ramp would have to be invented —
   * ranked bars in one accent with direct labels carry the same information
   * and stay on-system.
   */
  import type { CockpitMetrics, Meter, IterationPoint } from './cockpit-metrics';

  let { metrics, compact = false }: { metrics: CockpitMetrics; compact?: boolean } = $props();

  const fmtInt = new Intl.NumberFormat('en-GB');

  function fmtTokens(n: number): string {
    if (n < 1000) return String(n);
    if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
    return `${(n / 1_000_000).toFixed(2)}M`;
  }
  function fmtDuration(ms: number | null): string {
    if (ms === null || !Number.isFinite(ms)) return '—';
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }
  function fmtCost(v: number | null): string {
    if (v === null) return '—';
    if (v < 0.01) return `$${v.toFixed(4)}`;
    return `$${v.toFixed(2)}`;
  }
  function meterValue(m: Meter): string {
    const used = m.unit === 'tokens' ? fmtTokens(m.used) : fmtInt.format(Math.round(m.used));
    if (m.limit === null) return `${used} · no cap`;
    const lim = m.unit === 'tokens' ? fmtTokens(m.limit) : fmtInt.format(m.limit);
    return `${used} / ${lim}`;
  }
  /** Bar width as a percentage, clamped so an over-budget bar still reads full. */
  function pct(fraction: number | null): number {
    if (fraction === null) return 0;
    return Math.max(0, Math.min(1, fraction)) * 100;
  }

  const its = $derived(metrics.iterations);
  const maxTokens = $derived(Math.max(1, ...its.map((i) => i.tokens)));
  const maxDuration = $derived(Math.max(1, ...its.map((i) => i.durationMs)));
  const maxCommand = $derived(Math.max(1, ...metrics.commands.map((c) => c.count)));
  const totalActions = $derived(metrics.commands.reduce((s, c) => s + c.count, 0));
  const totalErrors = $derived(metrics.commands.reduce((s, c) => s + c.errors, 0));

  function iterTitle(p: IterationPoint): string {
    const bits = [
      `Iteration ${p.number}`,
      `${fmtTokens(p.tokens)} tokens`,
      fmtDuration(p.durationMs),
      `${p.actionCount} actions`,
    ];
    if (p.errorCount) bits.push(`${p.errorCount} failed`);
    if (p.failureKind) bits.push(p.failureKind);
    return bits.join(' · ');
  }
</script>

<section class="cockpit" class:compact aria-label="Build instrumentation">
  <!-- Headline numbers. A stat tile, not a chart — these are single values. -->
  <div class="tiles">
    <div class="tile">
      <span class="tile-k">Tokens</span>
      <span class="tile-v">{fmtTokens(metrics.headline.tokens)}</span>
      <span class="tile-s">
        {metrics.headline.tokensPerIteration !== null
          ? `${fmtTokens(metrics.headline.tokensPerIteration)} per iteration`
          : 'no iterations yet'}
      </span>
    </div>
    <div class="tile">
      <span class="tile-k">Cost</span>
      <span class="tile-v">{fmtCost(metrics.headline.costUsd)}</span>
      <span class="tile-s">{metrics.model.id ?? 'model unknown'}</span>
    </div>
    <div class="tile">
      <span class="tile-k">Elapsed</span>
      <span class="tile-v">{fmtDuration(metrics.headline.elapsedMs)}</span>
      <span class="tile-s">
        {metrics.headline.activeMinutes !== null
          ? `${metrics.headline.activeMinutes.toFixed(0)}m working`
          : '—'}
      </span>
    </div>
    <div class="tile">
      <span class="tile-k">Iterations</span>
      <span class="tile-v">{metrics.headline.iterations}</span>
      <span class="tile-s">
        {totalActions} action{totalActions === 1 ? '' : 's'}{totalErrors
          ? `, ${totalErrors} failed`
          : ''}
      </span>
    </div>
  </div>

  <!-- Signals: what a human should actually look at. Status colour + label,
       never colour alone. -->
  {#if metrics.signals.length}
    <ul class="signals">
      {#each metrics.signals as s (s.text)}
        <li class="signal {s.level}">
          <span class="signal-tag">{s.level === 'critical' ? 'Critical' : s.level === 'warn' ? 'Watch' : 'Note'}</span>
          <span class="signal-text">{s.text}</span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if !compact}
    <div class="grid">
      <!-- Budget meters -->
      <div class="panel">
        <h3 class="sr-label-tight">Budget</h3>
        <div class="meters">
          {#each metrics.meters as m (m.label)}
            <div class="meter">
              <div class="meter-hd">
                <span class="meter-k">{m.label}</span>
                <span class="meter-v" class:over={m.state === 'over'} class:near={m.state === 'near'}>
                  {meterValue(m)}
                </span>
              </div>
              <div
                class="track"
                role="meter"
                aria-valuenow={Math.round(pct(m.fraction))}
                aria-valuemin="0"
                aria-valuemax="100"
                aria-label={m.label}
              >
                <div class="fill {m.state}" style="width:{pct(m.fraction)}%"></div>
              </div>
            </div>
          {/each}
        </div>
      </div>

      <!-- Per-iteration tokens. One measure, one axis, one hue. -->
      <div class="panel">
        <h3 class="sr-label-tight">Tokens per iteration</h3>
        {#if its.length}
          <div class="bars" role="img" aria-label="Tokens used by each iteration">
            {#each its as p (p.number)}
              <div class="bar-col" title={iterTitle(p)}>
                <div class="bar-wrap">
                  <div
                    class="bar"
                    class:failed={p.status === 'failed'}
                    style="height:{Math.max(2, (p.tokens / maxTokens) * 100)}%"
                  ></div>
                </div>
                <span class="bar-x">{p.number}</span>
              </div>
            {/each}
          </div>
          <p class="axis-note">Tallest: {fmtTokens(maxTokens)} tokens</p>
        {:else}
          <p class="empty">No iterations yet.</p>
        {/if}
      </div>

      <!-- Per-iteration runtime. Separate chart, never a second y-axis. -->
      <div class="panel">
        <h3 class="sr-label-tight">Runtime per iteration</h3>
        {#if its.length}
          <div class="bars" role="img" aria-label="Wall-clock duration of each iteration">
            {#each its as p (p.number)}
              <div class="bar-col" title={iterTitle(p)}>
                <div class="bar-wrap">
                  <div
                    class="bar ink"
                    class:failed={p.status === 'failed'}
                    style="height:{Math.max(2, (p.durationMs / maxDuration) * 100)}%"
                  ></div>
                </div>
                <span class="bar-x">{p.number}</span>
              </div>
            {/each}
          </div>
          <p class="axis-note">Longest: {fmtDuration(maxDuration)}</p>
        {:else}
          <p class="empty">No iterations yet.</p>
        {/if}
      </div>

      <!-- Command mix: ranked, direct-labelled, single hue. -->
      <div class="panel">
        <h3 class="sr-label-tight">Commands used</h3>
        {#if metrics.commands.length}
          <ul class="rank">
            {#each metrics.commands as c (c.name)}
              <li>
                <span class="rank-k">{c.name}</span>
                <span class="rank-bar-wrap">
                  <span class="rank-bar" style="width:{(c.count / maxCommand) * 100}%"></span>
                </span>
                <span class="rank-v">{c.count}</span>
                <span class="rank-err" class:none={!c.errors}>
                  {c.errors ? `${c.errors} failed` : ''}
                </span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="empty">No actions recorded.</p>
        {/if}
      </div>

      <!-- Environment: model, tooling, gate, libraries -->
      <div class="panel wide">
        <h3 class="sr-label-tight">Environment</h3>
        <dl class="facts">
          <dt>Model</dt>
          <dd>
            {metrics.model.id ?? '—'}
            {#if metrics.model.provider}<span class="dim">via {metrics.model.provider}</span>{/if}
            {#if metrics.model.unresolvableAlias}<span class="flag warn">unresolved alias</span>{/if}
          </dd>

          <dt>Thinking</dt>
          <dd>{metrics.model.thinkingLevel ?? '—'}</dd>

          <dt>Site tools</dt>
          <dd>
            {#if metrics.tooling.healthy === true}
              {metrics.tooling.siteTools} available
            {:else if metrics.tooling.healthy === false}
              <span class="flag error">bridge down</span>
              {#if metrics.tooling.detail}<span class="dim">{metrics.tooling.detail}</span>{/if}
            {:else}
              <span class="dim">not reported</span>
            {/if}
          </dd>

          <dt>Gate</dt>
          <dd>
            {#if !metrics.gate.ran}
              <span class="dim">not run yet</span>
            {:else if metrics.gate.passed}
              <span class="flag ok">passing</span>
            {:else}
              <span class="flag error">failing</span>
              {#if metrics.gate.failingTests.length}
                <span class="dim">{metrics.gate.failingTests.join(', ')}</span>
              {/if}
            {/if}
          </dd>

          <dt>Packages installed</dt>
          <dd>
            {#if metrics.libraries.length}
              {metrics.libraries.join(', ')}
            {:else}
              <span class="dim">none</span>
            {/if}
          </dd>
        </dl>
      </div>
    </div>
  {/if}
</section>

<style>
  .cockpit {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-bottom: 1.25rem;
  }

  /* --- Stat tiles --- */
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 1px;
    background: var(--card-border);
    border: 2px solid var(--text-primary);
  }
  .tile {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.75rem 0.9rem;
    background: var(--bg);
  }
  .tile-k {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs, 12px);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .tile-v {
    font-family: var(--font-display);
    font-size: 1.6rem;
    line-height: 1.1;
    color: var(--text-primary);
  }
  .tile-s {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs, 12px);
    color: var(--text-ghost);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* --- Signals --- */
  .signals {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .signal {
    display: flex;
    gap: 0.6rem;
    align-items: baseline;
    padding: 0.5rem 0.7rem;
    border-left: 4px solid var(--card-border);
    background: var(--bg-section);
    font-size: var(--fs-body-sm, 15px);
  }
  .signal.critical {
    border-left-color: var(--error);
    background: var(--error-bg);
  }
  .signal.warn {
    border-left-color: var(--warn);
    background: var(--warn-bg);
  }
  .signal-tag {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs, 12px);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-secondary);
    flex-shrink: 0;
  }
  .signal-text {
    color: var(--text-primary);
  }

  /* --- Panels --- */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 1px;
    background: var(--card-border);
    border: 2px solid var(--text-primary);
  }
  .panel {
    background: var(--bg);
    padding: 0.85rem 0.9rem 1rem;
    min-width: 0;
  }
  .panel.wide {
    grid-column: 1 / -1;
  }
  .panel h3 {
    margin: 0 0 0.7rem;
    color: var(--text-secondary);
  }

  /* --- Meters --- */
  .meters {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }
  .meter-hd {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }
  .meter-k,
  .meter-v {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs, 12px);
  }
  .meter-k {
    color: var(--text-secondary);
  }
  .meter-v {
    color: var(--text-muted);
  }
  .meter-v.near {
    color: var(--warn);
  }
  .meter-v.over {
    color: var(--error);
  }
  .track {
    height: 6px;
    background: var(--surface-overlay);
    border: 1px solid var(--card-border);
  }
  .fill {
    height: 100%;
    background: var(--accent);
  }
  .fill.near {
    background: var(--warn);
  }
  .fill.over {
    background: var(--error);
  }

  /* --- Column charts --- */
  .bars {
    display: flex;
    align-items: flex-end;
    gap: 3px;
    height: 110px;
    overflow-x: auto;
  }
  .bar-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    min-width: 14px;
    flex: 1 1 0;
    height: 100%;
  }
  .bar-wrap {
    flex: 1;
    width: 100%;
    display: flex;
    align-items: flex-end;
  }
  .bar {
    width: 100%;
    background: var(--accent);
    border-radius: 2px 2px 0 0;
  }
  .bar.ink {
    background: var(--accent-ink);
  }
  /* A failed iteration is state, not a series — hatched so it reads without
     relying on colour alone. */
  .bar.failed {
    background-image: repeating-linear-gradient(
      45deg,
      transparent,
      transparent 5px,
      var(--bg) 5px,
      var(--bg) 6px
    );
  }
  .bar-x {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs, 12px);
    color: var(--text-ghost);
  }
  .axis-note {
    margin: 0.5rem 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs, 12px);
    color: var(--text-ghost);
  }

  /* --- Ranked bars --- */
  .rank {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .rank li {
    display: grid;
    grid-template-columns: 4.5rem 1fr 2rem 4.5rem;
    align-items: center;
    gap: 0.5rem;
  }
  .rank-k,
  .rank-v {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs, 12px);
    color: var(--text-secondary);
  }
  .rank-k {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rank-v {
    color: var(--text-muted);
    text-align: right;
  }
  .rank-err {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs, 12px);
    color: var(--error);
    text-align: right;
  }
  .rank-err.none {
    color: transparent;
  }
  .rank-bar-wrap {
    height: 8px;
    background: var(--surface-overlay);
  }
  .rank-bar {
    display: block;
    height: 100%;
    background: var(--accent);
    border-radius: 0 2px 2px 0;
  }

  /* --- Facts --- */
  .facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.35rem 1rem;
    margin: 0;
    font-size: var(--fs-body-sm, 15px);
  }
  .facts dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs, 12px);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    padding-top: 0.15rem;
  }
  .facts dd {
    margin: 0;
    color: var(--text-primary);
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .dim {
    color: var(--text-ghost);
    margin-left: 0.4rem;
  }
  .flag {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs, 12px);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.05rem 0.35rem;
    border: 1px solid currentColor;
    border-radius: 2px;
  }
  .flag.ok {
    color: var(--success);
  }
  .flag.warn {
    color: var(--warn);
  }
  .flag.error {
    color: var(--error);
  }
  .empty {
    margin: 0;
    font-size: var(--fs-body-sm, 15px);
    color: var(--text-ghost);
  }

  @media (max-width: 640px) {
    .tile-v {
      font-size: 1.3rem;
    }
    .rank li {
      grid-template-columns: 4rem 1fr 2rem 4rem;
    }
  }
</style>
