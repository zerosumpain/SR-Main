<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import { onMount, onDestroy } from 'svelte';

  let {
    config,
    onChange,
    definition,
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
    definition?: NodeDefinition;
  } = $props();

  void definition;

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  const buildId = $derived(String(config.buildId ?? ''));
  const showThinking = $derived(config.showThinking !== false);
  const showTools = $derived(config.showTools !== false);
  const showLint = $derived(config.showLint !== false);
  const autoScroll = $derived(config.autoScroll !== false);

  let showRawJson = $state(false);

  // ─── Live builds list ────────────────────────────────────────────────
  // Polls /api/jkai/builds every 5s, filters to non-terminal builds, and
  // renders a control panel inline so the user can pause/resume/stop/cancel
  // any in-flight build without opening /jkai/builds.
  type Build = {
    id: string;
    title: string | null;
    prompt: string;
    status: string;
    iterationsCompleted: number;
    createdAt: string;
    queuedAt: string | null;
  };
  const NON_TERMINAL = new Set([
    'pending', 'queued', 'running', 'paused',
    'awaiting_plan_approval', 'awaiting_iter_approval',
  ]);

  let builds = $state<Build[]>([]);
  let lastError = $state<string | null>(null);
  let acting = $state<Record<string, string | null>>({}); // buildId → action in flight
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  async function refreshBuilds(): Promise<void> {
    try {
      const r = await fetch('/api/jkai/builds');
      if (!r.ok) { lastError = `HTTP ${r.status}`; return; }
      const all = await r.json() as Build[];
      builds = all.filter((b) => NON_TERMINAL.has(b.status));
      lastError = null;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  async function postAction(id: string, action: 'pause' | 'resume' | 'stop' | 'restart' | 'cancel-queue'): Promise<void> {
    acting = { ...acting, [id]: action };
    try {
      const r = await fetch(`/api/jkai/builds/${id}/${action}`, { method: 'POST' });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        lastError = String(body?.error ?? `HTTP ${r.status}`);
      } else {
        lastError = null;
      }
      await refreshBuilds();
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    } finally {
      acting = { ...acting, [id]: null };
    }
  }

  function attach(id: string): void { set('buildId', id); }

  function fmtRelative(iso: string | null): string {
    if (!iso) return '—';
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 0) return 'just now';
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  onMount(() => {
    void refreshBuilds();
    pollTimer = setInterval(refreshBuilds, 5000);
  });
  onDestroy(() => { if (pollTimer) clearInterval(pollTimer); });
</script>

<div class="bpp">
  <!-- Active builds — live list of non-terminal jobs the builder is processing -->
  <section class="bpp-sec">
    <header class="bpp-sec-hdr">
      <span class="sr-label-tight">Active builds</span>
      <span class="bpp-sec-meta">{builds.length} live · refresh ~5s{#if lastError} · <span class="bpp-err">{lastError}</span>{/if}</span>
    </header>
    {#if builds.length === 0}
      <p class="bpp-empty">No running, queued, paused, or awaiting-approval builds.</p>
    {:else}
      <ul class="bpp-builds">
        {#each builds as b (b.id)}
          {@const active = acting[b.id] ?? null}
          {@const attached = buildId === b.id}
          <li class="bpp-build" class:attached>
            <header class="bpp-build-hdr">
              <span class="bpp-pill" data-status={b.status}>{b.status.replace(/_/g, ' ')}</span>
              <code class="bpp-build-id" title={b.id}>{b.id.slice(0, 8)}</code>
              <span class="bpp-build-iter">iter {b.iterationsCompleted}</span>
              <span class="bpp-build-when">{fmtRelative(b.queuedAt ?? b.createdAt)}</span>
              {#if attached}<span class="bpp-attached">● attached</span>{/if}
            </header>
            <div class="bpp-build-title">{b.title ?? b.prompt.slice(0, 70)}</div>
            <div class="bpp-build-acts">
              {#if !attached}
                <button type="button" class="bpp-bbtn" onclick={() => attach(b.id)}>attach</button>
              {/if}
              {#if b.status === 'running'}
                <button type="button" class="bpp-bbtn" disabled={active !== null} onclick={() => postAction(b.id, 'pause')}>pause</button>
                <button type="button" class="bpp-bbtn bpp-bbtn-danger" disabled={active !== null} onclick={() => postAction(b.id, 'stop')}>stop</button>
              {:else if b.status === 'paused'}
                <button type="button" class="bpp-bbtn bpp-bbtn-primary" disabled={active !== null} onclick={() => postAction(b.id, 'resume')}>resume</button>
                <button type="button" class="bpp-bbtn bpp-bbtn-danger" disabled={active !== null} onclick={() => postAction(b.id, 'stop')}>stop</button>
              {:else if b.status === 'queued'}
                <button type="button" class="bpp-bbtn bpp-bbtn-danger" disabled={active !== null} onclick={() => postAction(b.id, 'cancel-queue')}>cancel</button>
              {:else if b.status === 'awaiting_plan_approval' || b.status === 'awaiting_iter_approval'}
                <button type="button" class="bpp-bbtn bpp-bbtn-danger" disabled={active !== null} onclick={() => postAction(b.id, 'stop')}>stop</button>
              {/if}
              {#if active}<span class="bpp-build-spinner">{active}…</span>{/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
    <p class="bpp-hint">
      Pause / Stop are graceful — the builder finishes the current tool call before parking, mid-write file edits are not destroyed.
      Cancel is for queued builds that haven't started.
    </p>
  </section>

  <!-- Build target -->
  <section class="bpp-sec">
    <header class="bpp-sec-hdr">
      <span class="sr-label-tight">Build target</span>
      <span class="bpp-sec-meta">auto-resolved from upstream Builder Chat if connected</span>
    </header>
    <label class="bpp-field">
      <span class="bpp-label">Build ID <span class="bpp-opt">optional override</span></span>
      <input
        type="text"
        spellcheck="false"
        placeholder={'(inherits from upstream chat — leave blank)'}
        value={buildId}
        oninput={(e) => set('buildId', (e.currentTarget as HTMLInputElement).value)}
      />
      <span class="bpp-hint">Set explicitly to attach this Pi to an existing build (skips the upstream chat).</span>
    </label>
  </section>

  <!-- Stream filters -->
  <section class="bpp-sec">
    <header class="bpp-sec-hdr"><span class="sr-label-tight">Stream filters</span></header>
    <label class="bpp-checkbox">
      <input
        type="checkbox"
        checked={showThinking}
        onchange={(e) => set('showThinking', (e.currentTarget as HTMLInputElement).checked)}
      />
      <span>Show <code>[thinks]</code> reasoning</span>
    </label>
    <label class="bpp-checkbox">
      <input
        type="checkbox"
        checked={showTools}
        onchange={(e) => set('showTools', (e.currentTarget as HTMLInputElement).checked)}
      />
      <span>Show <code>[tool]</code> / <code>[bash]</code> activity</span>
    </label>
    <label class="bpp-checkbox">
      <input
        type="checkbox"
        checked={showLint}
        onchange={(e) => set('showLint', (e.currentTarget as HTMLInputElement).checked)}
      />
      <span>Show <code>[lint]</code> design warnings</span>
    </label>
    <label class="bpp-checkbox">
      <input
        type="checkbox"
        checked={autoScroll}
        onchange={(e) => set('autoScroll', (e.currentTarget as HTMLInputElement).checked)}
      />
      <span>Auto-scroll to follow the stream</span>
    </label>
  </section>

  <!-- Notes -->
  <section class="bpp-sec bpp-sec-quiet">
    <header class="bpp-sec-hdr"><span class="sr-label-tight">Behaviour</span></header>
    <p class="bpp-empty">
      Pi exposes a live elapsed timer and an iteration ETA based on past iteration durations.
      The Pause / Stop buttons in the node body are graceful — work-in-progress is preserved (the builder finishes its current tool call before stopping).
      Output handle <code>preview</code> exposes <code>{`{ buildId, status, serveConfig, iterationCount, elapsedMs }`}</code> for downstream Build View nodes or workflow nodes.
    </p>
  </section>

  <!-- Advanced raw JSON -->
  <details class="bpp-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
    <textarea
      class="bpp-code"
      rows="10"
      spellcheck="false"
      value={JSON.stringify(config, null, 2)}
      oninput={(e) => {
        try {
          const next = JSON.parse((e.currentTarget as HTMLTextAreaElement).value);
          if (next && typeof next === 'object') onChange(next as Record<string, unknown>);
        } catch { /* keep typing */ }
      }}
    ></textarea>
  </details>
</div>

<style>
  .bpp { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }
  .bpp-sec { display: flex; flex-direction: column; gap: 8px; }
  .bpp-sec-quiet { opacity: 0.85; }
  .bpp-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .bpp-sec-meta { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); }

  .bpp-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .bpp-label {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
    display: inline-flex; gap: 6px; align-items: baseline;
  }
  .bpp-opt { color: var(--text-ghost); font-size: 9px; }
  .bpp-hint { font-size: 11px; color: var(--text-ghost); }
  .bpp-empty { margin: 0; font-size: 12px; color: var(--text-ghost); }
  .bpp-empty code, .bpp-checkbox code { font-size: 11px; color: var(--text-muted); }

  .bpp-checkbox {
    display: inline-flex; gap: 8px; align-items: center;
    font-size: 12px; color: var(--text-primary);
  }
  .bpp-checkbox input { accent-color: var(--accent); width: 14px; height: 14px; }

  .bpp-code {
    width: 100%;
    padding: 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: 11px;
    box-sizing: border-box;
    outline: none;
    resize: vertical;
  }
  .bpp-code:focus { border-color: var(--text-muted); }

  input[type='text'], select, textarea {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    box-sizing: border-box;
    outline: none;
  }
  input[type='text']:focus, select:focus, textarea:focus { border-color: var(--text-muted); }

  .bpp-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .bpp-raw summary { cursor: pointer; }

  /* Active-builds list */
  .bpp-err { color: var(--status-error, #c0392b); }
  .bpp-builds {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .bpp-build {
    border: 1px solid var(--card-border);
    background: var(--bg);
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .bpp-build.attached {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 6%, transparent);
  }
  .bpp-build-hdr {
    display: flex;
    align-items: baseline;
    gap: 6px;
    flex-wrap: wrap;
  }
  .bpp-pill {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    padding: 1px 6px;
    border: 1px solid currentColor;
    color: var(--text-muted);
  }
  .bpp-pill[data-status='running'] { color: var(--accent); }
  .bpp-pill[data-status='queued'] { color: var(--text-ghost); }
  .bpp-pill[data-status='paused'] { color: var(--text-muted); }
  .bpp-pill[data-status='awaiting_plan_approval'],
  .bpp-pill[data-status='awaiting_iter_approval'] { color: #d28a3a; }
  .bpp-build-id {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-muted);
  }
  .bpp-build-iter,
  .bpp-build-when {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-ghost);
    font-variant-numeric: tabular-nums;
  }
  .bpp-attached {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--accent);
    margin-left: auto;
  }
  .bpp-build-title {
    font-size: 12px;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bpp-build-acts {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  .bpp-bbtn {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 3px 8px;
    border: 1px solid var(--card-border);
    background: var(--bg);
    color: var(--text-primary);
    cursor: pointer;
  }
  .bpp-bbtn:hover { border-color: var(--accent); color: var(--accent); }
  .bpp-bbtn:disabled { opacity: 0.4; cursor: not-allowed; }
  .bpp-bbtn-primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--bg);
  }
  .bpp-bbtn-primary:hover { color: var(--bg); }
  .bpp-bbtn-danger { border-color: var(--status-error, #c0392b); color: var(--status-error, #c0392b); }
  .bpp-bbtn-danger:hover {
    background: var(--status-error, #c0392b);
    color: var(--bg);
  }
  .bpp-build-spinner {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-muted);
    align-self: center;
    margin-left: auto;
  }
</style>
