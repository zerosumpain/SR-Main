<script lang="ts">
  import { onMount } from 'svelte';
  import type {
    DependencyCard,
    DependencyOverview,
    DependencyState,
  } from '$lib/dependencies/catalog';

  let overview = $state<DependencyOverview | null>(null);
  let failed = $state(false);
  let refreshing = $state(false);
  let timer: ReturnType<typeof setInterval> | null = null;

  function pillState(state: DependencyState): string {
    if (state === 'green') return 'ok';
    if (state === 'amber') return 'warn';
    if (state === 'red') return 'error';
    return 'idle';
  }

  function percent(value: number | null): string {
    if (value == null) return '—';
    if (value === 100 || value === 0) return `${value}%`;
    return `${value.toFixed(value >= 99 ? 2 : 1)}%`;
  }

  function stamp(value: string | null): string {
    if (!value) return 'not yet';
    return new Date(value).toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function lastEvent(card: DependencyCard): string {
    if (!card.knownChecks) return 'No usable observations yet';
    if (!card.lastDegradedAt) return 'No degradation observed';
    return `Last degradation ${stamp(card.lastDegradedAt)}`;
  }

  async function load(force = false) {
    if (refreshing) return;
    refreshing = true;
    try {
      const response = await fetch('/api/admin/dependencies', { method: force ? 'POST' : 'GET' });
      if (!response.ok) throw new Error(String(response.status));
      overview = await response.json();
      failed = false;
    } catch {
      failed = true;
    } finally {
      refreshing = false;
    }
  }

  onMount(() => {
    void load();
    // The server samples every five minutes. A cheap history read each minute
    // lets an open console notice the completed sample without duplicating it.
    timer = setInterval(() => void load(), 60_000);
    return () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
  });
</script>

<section class="ds-panel" aria-label="Site dependency status">
  <div class="ds-heading">
    <div>
      <div class="ds-kicker">Site reliability</div>
      <h2>Dependencies</h2>
      <p>Five-minute checks · 30-day RAG history · grey means no observation</p>
    </div>
    <button class="nm-save-btn" onclick={() => load(true)} disabled={refreshing}>
      {refreshing ? 'Checking…' : 'Check now'}
    </button>
  </div>

  {#if !overview}
    <div class="ds-impact" data-rag="unknown">
      <span class="ds-rag-dot" aria-hidden="true"></span>
      <div>
        <strong>{failed ? 'Dependency history unavailable' : 'Loading dependency history…'}</strong>
        <span>{failed ? 'The dashboard could not read the latest samples.' : 'The first check may take a few seconds.'}</span>
      </div>
    </div>
  {:else}
    <div class="ds-impact" data-rag={overview.userImpact.state}>
      <span class="ds-rag-dot" aria-hidden="true"></span>
      <div class="ds-impact-copy">
        <div>
          <strong>{overview.userImpact.summary}</strong>
          {#if overview.userImpact.confirmed}
            <span class="nm-pill" data-state="warn">confirmed public impact in history</span>
          {/if}
          {#if overview.userImpact.evidenceGap}
            <span class="nm-pill" data-state="idle">monitoring gap</span>
          {/if}
        </div>
        <span>
          Tracking since {stamp(overview.observedFrom)} · latest completed pass {stamp(overview.checkedAt)}
          {#if failed} · refresh failed, showing last known{/if}
        </span>
      </div>
    </div>

    <div class="ds-grid">
      {#each overview.dependencies as dependency (dependency.id)}
        <article class="ds-card" data-rag={dependency.state}>
          <div class="ds-card-head">
            <div>
              <span class="ds-impact-type">{dependency.impact}</span>
              <h3>{dependency.label}</h3>
            </div>
            <span class="nm-pill" data-state={pillState(dependency.state)}>{dependency.state}</span>
          </div>

          <div class="ds-affects">{dependency.affects}</div>
          <div class="ds-detail">{dependency.detail}</div>

          <div
            class="ds-tape"
            role="img"
            aria-label={`${dependency.label} daily status over the last 30 days`}
          >
            {#each dependency.days as day (day.date)}
              <span
                class="ds-day"
                data-rag={day.state}
                title={`${day.date}: ${day.state}`}
              ></span>
            {/each}
          </div>
          <div class="ds-tape-labels"><span>30 days ago</span><span>today</span></div>

          <div class="ds-metrics">
            <div>
              <span>30d uptime</span>
              <strong>{percent(dependency.availablePct)}</strong>
            </div>
            <div>
              <span>fully healthy</span>
              <strong>{percent(dependency.healthyPct)}</strong>
            </div>
            <div>
              <span>degraded / down</span>
              <strong>{dependency.degradedChecks} / {dependency.downChecks}</strong>
            </div>
            <div>
              <span>monitoring coverage</span>
              <strong>{percent(dependency.coveragePct)}</strong>
            </div>
          </div>

          <p class="ds-summary">{dependency.summary}</p>
          <div class="ds-card-foot">
            <span>{lastEvent(dependency)}</span>
            <a href={dependency.statusUrl} target="_blank" rel="noreferrer">source ↗</a>
          </div>
        </article>
      {/each}
    </div>

    <div class="ds-legend" aria-label="RAG legend">
      <span><i data-rag="green"></i> green · normal</span>
      <span><i data-rag="amber"></i> amber · degraded / partial</span>
      <span><i data-rag="red"></i> red · unavailable</span>
      <span><i data-rag="unknown"></i> grey · not observed</span>
      <span class="ds-method">Uptime excludes unknown checks; amber counts as available but not fully healthy.</span>
    </div>
  {/if}
</section>

<style>
  .ds-panel {
    margin-bottom: 1.5rem;
    padding-top: 1rem;
    border-top: 1px solid var(--line-strong);
  }
  .ds-heading {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.75rem;
  }
  .ds-kicker,
  .ds-heading p,
  .ds-impact-type,
  .ds-tape-labels,
  .ds-metrics span,
  .ds-card-foot,
  .ds-legend {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
  }
  .ds-kicker,
  .ds-impact-type {
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-ghost);
  }
  h2,
  h3,
  p { margin: 0; }
  h2 {
    margin-top: 0.15rem;
    color: var(--text-primary);
    font-size: 1.3rem;
  }
  .ds-heading p {
    margin-top: 0.2rem;
    color: var(--text-muted);
  }

  .ds-impact {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-height: 3.4rem;
    margin-bottom: 0.75rem;
    padding: 0.65rem 0.8rem;
    border: 1px solid var(--line-strong);
    border-left-width: 3px;
    background: var(--surface-sunken);
  }
  .ds-impact[data-rag='green'] { border-left-color: var(--success); }
  .ds-impact[data-rag='amber'] { border-left-color: var(--warn); }
  .ds-impact[data-rag='red'] { border-left-color: var(--error); }
  .ds-rag-dot {
    width: 0.75rem;
    height: 0.75rem;
    flex: 0 0 auto;
    border-radius: var(--radius-pill);
    background: var(--text-ghost);
  }
  [data-rag='green'] > .ds-rag-dot { background: var(--success); }
  [data-rag='amber'] > .ds-rag-dot { background: var(--warn); }
  [data-rag='red'] > .ds-rag-dot { background: var(--error); }
  .ds-impact-copy,
  .ds-impact > div {
    display: flex;
    flex-direction: column;
    gap: 0.18rem;
    min-width: 0;
  }
  .ds-impact-copy > div {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .ds-impact strong { color: var(--text-primary); }
  .ds-impact span:not(.nm-pill):not(.ds-rag-dot) {
    font-size: 0.78rem;
    color: var(--text-muted);
  }

  .ds-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(310px, 100%), 1fr));
    gap: 0.75rem;
  }
  .ds-card {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    min-width: 0;
    padding: 0.8rem;
    border: 1px solid var(--line-strong);
    border-top-width: 3px;
    background: var(--surface-card);
  }
  .ds-card[data-rag='green'] { border-top-color: var(--success); }
  .ds-card[data-rag='amber'] { border-top-color: var(--warn); }
  .ds-card[data-rag='red'] { border-top-color: var(--error); }
  .ds-card-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
  }
  .ds-card h3 {
    margin-top: 0.1rem;
    color: var(--text-primary);
    font-family: var(--font-brand);
    font-size: 1.05rem;
    font-weight: 500;
  }
  .ds-affects {
    color: var(--text-secondary);
    font-size: 0.82rem;
    font-weight: 600;
  }
  .ds-detail,
  .ds-summary {
    color: var(--text-muted);
    font-size: 0.76rem;
    line-height: 1.4;
  }
  .ds-summary {
    min-height: 2.15em;
  }

  .ds-tape {
    display: grid;
    grid-template-columns: repeat(30, minmax(2px, 1fr));
    gap: 2px;
    height: 0.7rem;
    margin-top: 0.15rem;
  }
  .ds-day { background: var(--line-strong); }
  .ds-day[data-rag='green'] { background: var(--success); }
  .ds-day[data-rag='amber'] { background: var(--warn); }
  .ds-day[data-rag='red'] { background: var(--error); }
  .ds-tape-labels {
    display: flex;
    justify-content: space-between;
    color: var(--text-ghost);
  }

  .ds-metrics {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.45rem;
    padding: 0.5rem 0;
    border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
  }
  .ds-metrics > div {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .ds-metrics span {
    color: var(--text-ghost);
    white-space: nowrap;
  }
  .ds-metrics strong {
    color: var(--text-primary);
    font-family: var(--font-brand);
    font-size: 0.95rem;
    font-variant-numeric: tabular-nums;
  }
  .ds-card-foot {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    margin-top: auto;
    color: var(--text-ghost);
  }
  .ds-card-foot a { color: var(--text-muted); white-space: nowrap; }
  .ds-card-foot a:hover { color: var(--accent); }

  .ds-legend {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    margin-top: 0.75rem;
    color: var(--text-muted);
  }
  .ds-legend span { display: inline-flex; align-items: center; gap: 0.3rem; }
  .ds-legend i {
    width: 0.55rem;
    height: 0.55rem;
    background: var(--line-strong);
  }
  .ds-legend i[data-rag='green'] { background: var(--success); }
  .ds-legend i[data-rag='amber'] { background: var(--warn); }
  .ds-legend i[data-rag='red'] { background: var(--error); }
  .ds-method { margin-left: auto; }

  @media (max-width: 640px) {
    .ds-heading { align-items: flex-start; }
    .ds-metrics { grid-template-columns: 1fr 1fr; }
    .ds-method { width: 100%; margin-left: 0; }
  }
</style>
