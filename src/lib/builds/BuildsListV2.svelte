<script lang="ts">
  let { builds: initialBuilds }: { builds: any[] } = $props();
  let builds = $state(initialBuilds);
  let deleting = $state<string | null>(null);

  function statusFor(s: string): 'running' | 'completed' | 'failed' | 'pending' {
    if (s === 'running') return 'running';
    if (s === 'completed') return 'completed';
    if (s === 'failed') return 'failed';
    return 'pending';
  }

  function summary(config: any): string {
    const parts: string[] = [];
    if (config?.maxIterations) parts.push(`${config.maxIterations} iter cap`);
    if (config?.maxTotalMinutes) parts.push(`${config.maxTotalMinutes}m total`);
    return parts.join(' · ');
  }

  async function deleteBuild(buildId: string, label: string, e: Event) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete "${label}"?\nAll iterations and logs will be removed.`)) return;
    deleting = buildId;
    try {
      const res = await fetch(`/api/jkai/builds/${buildId}`, { method: 'DELETE' });
      if (res.ok) builds = builds.filter((b) => b.id !== buildId);
    } finally {
      deleting = null;
    }
  }
</script>

<svelte:head>
  <title>Builds — JKAI</title>
</svelte:head>

<div class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">JKAI</div>
      <h1>Builds</h1>
      <p class="sub">Autonomous AI development. Plan-first, design-system-locked, fully observable.</p>
    </div>
    <a class="nm-save-btn" href="/jkai/builds/new">+ New build</a>
  </header>

  {#if builds.length === 0}
    <section class="nm-sec">
      <p class="dim">No builds yet — <a class="row-link" href="/jkai/builds/new">+ start one</a>.</p>
    </section>
  {:else}
    <div class="grid">
      {#each builds as b (b.id)}
        <article class="card">
          <a class="card-link" href={`/jkai/builds/${b.id}`} aria-label="Open build">
            <header>
              <span class="status-dot" data-status={statusFor(b.status)}></span>
              <span class="title">{b.title ?? b.prompt.slice(0, 60)}</span>
            </header>
            <p class="prompt">{b.prompt.slice(0, 180)}{b.prompt.length > 180 ? '…' : ''}</p>
            <footer>
              <span class="dim">iter {b.iterationsCompleted ?? 0}</span>
              <span class="dim">tok {(b.tokensUsed ?? 0).toLocaleString()}</span>
              {#if summary(b.budgetConfig)}<span class="dim">{summary(b.budgetConfig)}</span>{/if}
              {#if b.publishedSlug}<span class="dim live">live</span>{/if}
              {#if b.planStatus === 'pending' || b.status === 'awaiting_plan_approval'}<span class="dim plan">plan</span>{/if}
            </footer>
          </a>
          <button
            class="row-link danger del"
            disabled={deleting === b.id}
            onclick={(e) => deleteBuild(b.id, b.title ?? b.prompt.slice(0, 60), e)}
            type="button"
          >
            {deleting === b.id ? '…' : 'Delete'}
          </button>
        </article>
      {/each}
    </div>
  {/if}
</div>

<style>
  .wrap {
    max-width: 980px;
    margin: 2rem auto 4rem;
    padding: 0 1.5rem;
    color: var(--text-primary);
    font-family: var(--font-body);
  }
  .page-hdr {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 1.5rem;
    margin-bottom: 1.75rem;
    padding-bottom: 1rem;
    border-bottom: 2px solid var(--text-primary);
  }
  .kicker {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--accent);
    margin-bottom: 0.35rem;
  }
  h1 {
    font-family: var(--font-display);
    font-size: 2rem;
    font-weight: 900;
    line-height: 1.05;
    margin: 0;
    color: var(--text-primary);
  }
  .sub {
    margin: 0.4rem 0 0;
    font-size: 12px;
    color: var(--text-muted);
    font-family: var(--font-body);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 0.6rem;
  }
  .card {
    position: relative;
    background: var(--bg);
    border: 1px solid var(--card-border);
    transition: border-color 80ms ease;
  }
  .card:hover {
    border-color: var(--text-primary);
  }
  .card-link {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 0.9rem 1rem 0.7rem;
    text-decoration: none;
    color: inherit;
    min-height: 140px;
  }
  .card header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .title {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 0.95rem;
    line-height: 1.2;
    color: var(--text-primary);
  }
  .prompt {
    margin: 0;
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 1.4;
  }
  footer {
    margin-top: auto;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    padding-top: 8px;
  }
  .dim {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .dim.live {
    color: var(--status-success);
  }
  .dim.plan {
    color: var(--accent);
  }
  .del {
    position: absolute;
    top: 6px;
    right: 8px;
    opacity: 0;
    transition: opacity 80ms ease;
  }
  .card:hover .del {
    opacity: 1;
  }
</style>
