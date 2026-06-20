<!-- src/lib/canvas/intelligence/desk/LeftFeed.svelte -->
<script lang="ts">
  import { tickerLine, type TickerLog } from './tickerText';
  import { credibilityBadge } from '$lib/deepdive/display';

  interface FeedSource {
    id: string;
    url: string;
    title: string | null;
    domain: string;
    credibilityType?: string | null;
    credibilityScore?: number | null;
  }
  interface SynthRun {
    runId: string;
    status: string;
    summary?: string | null;
    createdAt?: string | null;
  }

  let {
    logs,
    sources,
    filters,
    synthesisRuns,
    collapsed = $bindable(false),
    onfilter,
    onselectrun,
  }: {
    logs: readonly TickerLog[];
    sources: FeedSource[];
    filters: { source: boolean; fact: boolean; entity: boolean; counterfactual: boolean };
    synthesisRuns: SynthRun[];
    collapsed?: boolean;
    onfilter: (key: 'source' | 'fact' | 'entity' | 'counterfactual', value: boolean) => void;
    onselectrun: (runId: string) => void;
  } = $props();

  // Newest-first log view, lightly cleaned via the shared narration helper.
  let logView = $derived(
    [...logs].slice(-60).reverse().map((l) => ({
      text: tickerLine([l]),
      timestamp: l.timestamp,
    })),
  );

  const filterDefs: { key: 'source' | 'fact' | 'entity' | 'counterfactual'; label: string; swatch: string }[] = [
    { key: 'source', label: 'Sources', swatch: 'src' },
    { key: 'fact', label: 'Facts', swatch: 'fact' },
    { key: 'entity', label: 'Entities', swatch: 'ent' },
    { key: 'counterfactual', label: 'Challenges', swatch: 'chal' },
  ];

  function fmtTime(ts: number): string {
    return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
</script>

<aside class="left-feed" class:collapsed>
  <button
    type="button"
    class="spine-toggle"
    title={collapsed ? 'Expand feed' : 'Collapse feed'}
    aria-expanded={!collapsed}
    onclick={() => (collapsed = !collapsed)}
  >
    {collapsed ? '›' : '‹'}
  </button>

  {#if collapsed}
    <div class="spine">
      <span class="spine-label">FEED</span>
    </div>
  {:else}
    <div class="feed-body">
      <!-- Type filters -->
      <section class="feed-sec">
        <h3>FILTERS</h3>
        <div class="filters">
          {#each filterDefs as f (f.key)}
            <label class="filter-row">
              <input
                type="checkbox"
                checked={filters[f.key]}
                onchange={(e) => onfilter(f.key, (e.currentTarget as HTMLInputElement).checked)}
              />
              <span class="swatch swatch-{f.swatch}"></span>
              {f.label}
            </label>
          {/each}
        </div>
      </section>

      <!-- Legend -->
      <section class="feed-sec">
        <h3>LEGEND</h3>
        <ul class="legend">
          <li><span class="lg-card"></span> paper card = source / fact</li>
          <li><span class="lg-chip"></span> black chip = entity</li>
          <li><span class="lg-unfiled"></span> dashed = unfiled</li>
          <li><span class="lg-edge"></span> line = relationship</li>
        </ul>
      </section>

      <!-- Synthesis history -->
      {#if synthesisRuns.length > 0}
        <section class="feed-sec">
          <h3>SYNTHESIS RUNS</h3>
          <ul class="runs">
            {#each synthesisRuns as r (r.runId)}
              <li>
                <button type="button" class="run" onclick={() => onselectrun(r.runId)}>
                  <span class="run-status run-{r.status}">{r.status}</span>
                  <span class="run-summary">{r.summary ?? r.runId.slice(0, 8)}</span>
                  {#if r.createdAt}<span class="run-time">{fmtTime(new Date(r.createdAt).getTime())}</span>{/if}
                </button>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      <!-- Source list -->
      <section class="feed-sec">
        <h3>SOURCES <span class="count">{sources.length}</span></h3>
        <ul class="sources">
          {#each sources as s (s.id)}
            <li>
              <a href={s.url} target="_blank" rel="noopener noreferrer" class="source" title={s.url}>
                <span class="src-domain">{s.domain}</span>
                <span class="src-title">{s.title ?? s.url}</span>
                {#if s.credibilityType}
                  {@const cb = credibilityBadge(s.credibilityType)}
                  <span class="src-cred" style:color={cb.color} style:border-color={cb.color}>{cb.label}</span>
                {/if}
              </a>
            </li>
          {/each}
        </ul>
      </section>

      <!-- Activity log -->
      <section class="feed-sec">
        <h3>ACTIVITY</h3>
        <ul class="log">
          {#each logView as l (l.timestamp)}
            <li><span class="log-time">{fmtTime(l.timestamp)}</span> {l.text}</li>
          {/each}
        </ul>
      </section>
    </div>
  {/if}
</aside>

<style>
  .left-feed {
    position: relative;
    width: 300px;
    flex-shrink: 0;
    background: var(--surface-elevated);
    border-right: 1px solid var(--card-border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transition: width 0.18s ease;
    z-index: 25;
  }
  .left-feed.collapsed { width: 32px; }

  .spine-toggle {
    position: absolute;
    top: 8px;
    right: 6px;
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    background: var(--card-bg);
    color: var(--text-muted);
    cursor: pointer;
    font-size: 13px;
    z-index: 2;
  }
  .spine-toggle:hover { color: var(--accent); border-color: var(--accent); }

  .spine {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
  }
  .spine-label {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    color: var(--text-ghost);
  }

  .feed-body { overflow-y: auto; padding: 12px 12px 24px; }
  .feed-sec { margin-bottom: 18px; }
  .feed-sec h3 {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.12em;
    color: var(--text-ghost);
    margin: 0 0 8px;
    text-transform: uppercase;
  }
  .feed-sec h3 .count { color: var(--text-muted); }

  .filters { display: flex; flex-direction: column; gap: 6px; }
  .filter-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-primary);
    cursor: pointer;
  }
  .swatch { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; }
  .swatch-src { background: #faf6ee; border: 1px solid var(--card-border); }
  .swatch-fact { background: var(--accent-tint-25); border: 1px solid var(--accent); }
  .swatch-ent { background: #1a1008; }
  .swatch-chal { background: var(--error-bg); border: 1px solid var(--error); }

  .legend { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .legend li {
    display: flex; align-items: center; gap: 8px;
    font-family: var(--font-mono); font-size: 11px; color: var(--text-muted);
  }
  .lg-card { width: 14px; height: 10px; background: #faf6ee; border: 1px solid var(--card-border); }
  .lg-chip { width: 14px; height: 10px; background: #1a1008; }
  .lg-unfiled { width: 14px; height: 10px; border: 1.5px dashed var(--accent); }
  .lg-edge { width: 14px; height: 0; border-top: 1.5px solid var(--text-muted); }

  .runs, .sources, .log { list-style: none; margin: 0; padding: 0; }
  .run {
    display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left;
    background: var(--card-bg); border: 1px solid var(--card-border); border-radius: var(--radius-sharp);
    padding: 6px 8px; margin-bottom: 6px; cursor: pointer;
  }
  .run:hover { border-color: var(--accent); }
  .run-status {
    font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase;
    align-self: flex-start; padding: 1px 5px; border-radius: var(--radius-sharp);
  }
  .run-running { color: var(--accent); background: var(--accent-tint-08); }
  .run-complete { color: var(--success); background: var(--success-bg); }
  .run-failed, .run-cancelled { color: var(--error); background: var(--error-bg); }
  .run-summary { font-family: var(--font-body); font-size: 12px; color: var(--text-primary); }
  .run-time { font-family: var(--font-mono); font-size: 10px; color: var(--text-ghost); }

  .source { display: flex; flex-direction: column; gap: 1px; padding: 5px 0; text-decoration: none; border-bottom: 1px solid var(--bg-section); }
  .src-domain { font-family: var(--font-mono); font-size: 10px; color: var(--accent); }
  .src-title { font-family: var(--font-body); font-size: 12px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .src-cred {
    align-self: flex-start;
    font-family: var(--font-mono);
    font-size: 8px;
    letter-spacing: 0.08em;
    padding: 1px 5px;
    border: 1px solid currentColor;
    border-radius: 2px;
    margin-top: 2px;
  }
  .source:hover .src-title { color: var(--accent); }

  .log li { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); padding: 3px 0; line-height: 1.4; }
  .log-time { color: var(--text-ghost); margin-right: 6px; }
</style>
