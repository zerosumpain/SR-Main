<script lang="ts">
  // What the nightly sweep actually did last night.
  //
  // Before this, a sweep reported itself as one journal line carrying the
  // NUMBER of errors and not the errors. The Gmail stage had therefore been
  // failing on the same SQL fault every night since it shipped, and the only
  // visible symptom was that no email ever appeared in the graph — which looks
  // exactly like an empty mailbox.
  //
  // So the point of this panel is the error TEXT, and it is never behind a
  // click: a failed stage shows its message immediately. History is collapsed
  // because the last run is the one you want 95% of the time.
  import { onMount } from 'svelte';

  interface Stage {
    stage: string;
    ok: boolean;
    counts?: Record<string, number>;
    error?: string;
    ms: number;
  }

  interface Run {
    startedAt: string;
    finishedAt?: string;
    day: string;
    trigger: 'scheduled' | 'manual';
    status: 'running' | 'ok' | 'partial' | 'failed';
    stages: Stage[];
    totalMs?: number;
  }

  let runs = $state<Run[]>([]);
  let error = $state<string | null>(null);
  let loading = $state(false);
  let showAll = $state(false);
  let gmailEnabled = $state(true);

  const latest = $derived(runs[0] ?? null);
  const older = $derived(runs.slice(1));

  export async function refresh() {
    if (loading) return;
    loading = true;
    error = null;
    try {
      const res = await fetch('/api/jkai/intel/runs');
      const body = await res.json();
      if (!res.ok) {
        error = body?.error ?? `Could not read run history (${res.status})`;
      } else {
        runs = body.runs ?? [];
        gmailEnabled = body.gmailEnabled !== false;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not read run history';
    } finally {
      loading = false;
    }
  }

  onMount(refresh);

  /** "3 hours ago" beats a timestamp for the only question being asked: is this recent? */
  function ago(iso: string): string {
    const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (secs < 90) return 'just now';
    const mins = Math.round(secs / 60);
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 36) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    return `${Math.round(hours / 24)} days ago`;
  }

  function duration(ms?: number): string {
    if (!ms) return '';
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  }

  /** Counts as a readable clause: `412 threads, 150 extracted`. */
  function countsText(stage: Stage): string {
    const entries = Object.entries(stage.counts ?? {}).filter(([, v]) => v > 0);
    if (!entries.length) return 'nothing to do';
    return entries.map(([k, v]) => `${v} ${k}`).join(', ');
  }

  const STATUS_LABEL: Record<Run['status'], string> = {
    running: 'running',
    ok: 'ok',
    partial: 'partly failed',
    failed: 'failed',
  };
</script>

<div class="ctl">
  <span class="ctl-title">Nightly sweep</span>

  {#if loading && !runs.length}
    <p class="hint">Reading history…</p>
  {:else if error}
    <p class="hint err">{error}</p>
    <button type="button" class="link" onclick={refresh}>Try again</button>
  {:else if !latest}
    <p class="hint">
      No sweep recorded yet. The nightly pass runs at 04:15; a manual sweep above is recorded
      here too.
    </p>
  {:else}
    <p class="hint">
      <span class="chip {latest.status}">{STATUS_LABEL[latest.status]}</span>
      {ago(latest.startedAt)}
      {#if latest.trigger === 'manual'}· by hand{/if}
      {#if latest.totalMs}· {duration(latest.totalMs)}{/if}
    </p>

    <ul class="stages">
      {#each latest.stages as stage (stage.stage)}
        <li class:bad={!stage.ok}>
          <span class="name">{stage.stage}</span>
          {#if stage.ok}
            <span class="detail">{countsText(stage)}</span>
          {:else}
            <span class="detail err">{stage.error ?? 'failed'}</span>
          {/if}
        </li>
      {/each}
    </ul>

    {#if !gmailEnabled}
      <p class="hint">Mail ingestion is off (<code>INTEL_GMAIL_ROLLING=0</code>).</p>
    {/if}

    {#if older.length}
      <button type="button" class="link" onclick={() => (showAll = !showAll)}>
        {showAll ? 'Hide' : `Earlier runs (${older.length})`}
      </button>
    {/if}

    {#if showAll}
      <ul class="history">
        {#each older as run (run.startedAt + run.trigger)}
          <li>
            <span class="chip {run.status}">{STATUS_LABEL[run.status]}</span>
            <span class="detail">{run.day}{run.trigger === 'manual' ? ' · by hand' : ''}</span>
            {#each run.stages.filter((s) => !s.ok) as bad (bad.stage)}
              <span class="detail err">{bad.stage}: {bad.error}</span>
            {/each}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>

<style>
  .ctl {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .ctl-title {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--text-ghost);
  }

  .hint {
    margin: 0;
    font-size: var(--fs-label-xs);
    line-height: 1.45;
    color: var(--text-ghost);
  }
  .hint.err {
    color: var(--accent-ink);
  }

  .chip {
    display: inline-block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 1px 5px;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    color: var(--text-secondary);
    margin-right: 4px;
  }
  /* Only failure is coloured. A green "ok" on every healthy night trains the
     eye to skip the row, which is the opposite of what this panel is for. */
  .chip.failed,
  .chip.partial {
    border-color: var(--accent-ink);
    color: var(--accent-ink);
  }

  .stages,
  .history {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .stages li,
  .history li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px;
    font-size: var(--fs-label-xs);
    line-height: 1.45;
  }
  .history li {
    padding-top: 3px;
    border-top: 1px solid var(--card-border);
  }

  .name {
    font-family: var(--font-mono);
    color: var(--text-secondary);
    min-width: 68px;
  }
  .detail {
    color: var(--text-ghost);
    /* A stack trace must wrap rather than stretch the rail. */
    overflow-wrap: anywhere;
  }
  .detail.err {
    color: var(--accent-ink);
  }

  code {
    font-family: var(--font-mono);
  }

  .link {
    align-self: flex-start;
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    font-size: var(--fs-label-xs);
    color: var(--accent);
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }
</style>
