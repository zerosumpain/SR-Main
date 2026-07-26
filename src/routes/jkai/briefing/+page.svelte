<script lang="ts">
  import type { BriefingData } from '$lib/briefing/types';
  import { invalidateAll } from '$app/navigation';
  import ChatMarkdown from '$lib/canvas/ChatMarkdown.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';

  let { data }: {
    data: { briefings: BriefingData[]; enabled: boolean; topics: string[]; running: boolean; schedule: { display: string } };
  } = $props();

  const briefings = $derived(data.briefings ?? []);
  const latest = $derived(briefings[0] ?? null);
  const past = $derived(briefings.slice(1));

  let enabled = $state(data.enabled);
  let topicsText = $state((data.topics ?? []).join(', '));
  let running = $state(false);
  let msg = $state<string | null>(null);
  let err = $state<string | null>(null);

  async function runNow() {
    if (running) return;
    running = true; msg = null; err = null;
    try {
      const res = await fetch('/api/admin/briefing/run', { method: 'POST' });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b.error || `HTTP ${res.status}`);
      msg = 'Briefing generated.';
      await invalidateAll();
    } catch (e) {
      err = e instanceof Error ? e.message : 'Run failed';
    } finally {
      running = false;
    }
  }

  async function saveConfig() {
    err = null; msg = null;
    const topics = topicsText.split(',').map((t) => t.trim()).filter(Boolean);
    const res = await fetch('/api/admin/briefing/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, topics }),
    });
    if (res.ok) msg = 'Saved.'; else err = 'Save failed';
  }

  function fmt(iso?: string): string {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  }

  // 👍/👎 feedback → engagement weighting in future briefings. Voting on the
  // whole briefing sends what=''; naming a topic scopes the vote to it.
  // Config is collapsed by default — the digest is the reason to be here, and
  // topics get edited once a quarter. Opens automatically when nothing has run
  // yet, since then setup IS the task.
  let showConfig = $state(false);

  let voted = $state<'up' | 'down' | null>(null);
  let voteWhat = $state('');
  async function vote(v: 'up' | 'down') {
    if (!latest) return;
    voted = v;
    try {
      await fetch('/api/admin/briefing/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ briefingId: latest.id, vote: v, what: voteWhat.trim() }),
      });
    } catch {
      voted = null;
    }
  }
</script>

<svelte:head><title>Briefing · JKAI</title></svelte:head>

<PageHeader title="BRIEFING" />

<main class="br">
  <div class="br-bar">
    <p class="br-sub">
      Learned from your questions, research and signals · delivered {data.schedule.display} + WhatsApp
      {#if !enabled}<span class="br-off">paused</span>{/if}
    </p>
    <div class="br-bar-actions">
      <button class="br-run" onclick={runNow} disabled={running}>{running ? 'Generating…' : 'Run now'}</button>
      <button class="br-cfg-toggle" onclick={() => (showConfig = !showConfig)} aria-expanded={showConfig}>
        {showConfig ? 'Hide settings' : 'Settings'}
      </button>
    </div>
  </div>

  {#if msg || err}
    <p class="br-flash">{#if msg}<span class="br-ok">{msg}</span>{/if}{#if err}<span class="br-err">⚠ {err}</span>{/if}</p>
  {/if}

  {#if showConfig || !latest}
    <section class="br-sec br-config">
      <label class="br-toggle">
        <input type="checkbox" bind:checked={enabled} />
        <span>{enabled ? 'Enabled — runs daily' : 'Disabled — no scheduled runs'}</span>
      </label>
      <label class="br-field">
        <span class="sr-label-tight">Topics you care about (comma-separated)</span>
        <input class="br-in" bind:value={topicsText} placeholder="DfE data policy, brass & rails, home security, LLM costs" />
      </label>
      <div class="br-config-foot">
        <button class="br-save" onclick={saveConfig}>Save config</button>
      </div>
    </section>
  {/if}

  {#if latest}
    <section class="br-sec">
      <div class="br-sec-hd"><span class="sr-label-tight">{latest.title}</span><span class="br-when">{fmt(latest.startedAt)} · {latest.status}</span></div>
      {#if latest.status === 'complete'}
        <div class="br-body"><ChatMarkdown content={latest.markdown} /></div>
        <div class="br-meta">{latest.sources.join(' · ') || 'no signals'} · {latest.llmCalls} call · ${latest.costUsd.toFixed(3)}</div>
        <div class="br-vote">
          {#if voted}
            <span class="br-vote-done">✓ noted — {voted === 'up' ? 'more like this' : 'less of this'}</span>
          {:else}
            <span class="sr-label-tight">Rate it</span>
            <input class="br-vote-what" placeholder="topic (optional — blank = whole briefing)" bind:value={voteWhat} />
            <button class="br-vote-btn" onclick={() => vote('up')} title="Weight future briefings toward this">More like this</button>
            <button class="br-vote-btn br-vote-down" onclick={() => vote('down')} title="Weight future briefings away from this">Less of this</button>
          {/if}
        </div>
      {:else}
        <p class="br-empty">{latest.status === 'failed' ? `Failed: ${latest.error ?? 'unknown'}` : latest.status}</p>
      {/if}
    </section>
  {:else}
    <p class="br-empty">No briefings yet. Hit “Run now” to generate one, or wait for the {data.schedule.display} run.</p>
  {/if}

  {#if past.length}
    <section class="br-sec">
      <div class="br-sec-hd"><span class="sr-label-tight">Earlier ({past.length})</span></div>
      <ul class="br-past">
        {#each past as b (b.id)}
          <li class="br-past-item">
            <details>
              <summary><span class="br-past-title">{b.title}</span><span class="br-when">{fmt(b.startedAt)} · {b.status}</span></summary>
              {#if b.status === 'complete'}<div class="br-body br-body-sm"><ChatMarkdown content={b.markdown} /></div>{:else}<p class="br-empty">{b.error ?? b.status}</p>{/if}
            </details>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</main>

<style>
  .br { max-width: 820px; margin: 0 auto; padding: 24px 20px 80px; color: var(--text-primary); }
  .br-bar { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
  .br-bar-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .br-sub { margin: 0; color: var(--text-muted); font-size: 13px; }
  .br-off { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--warn, #b0892a); border: 1px solid currentColor; padding: 1px 5px; margin-left: 8px; }
  .br-cfg-toggle { font-family: var(--font-mono); font-size: 11px; padding: 7px 12px; background: transparent; border: 1px solid var(--card-border); color: var(--text-muted); cursor: pointer; }
  .br-cfg-toggle:hover { color: var(--text-primary); border-color: var(--text-muted); }
  .br-flash { margin: 0 0 12px; }

  .br-sec { margin-bottom: 24px; }
  .br-sec-hd { display: flex; align-items: baseline; justify-content: space-between; border-bottom: 1px dashed var(--card-border); padding-bottom: 6px; margin-bottom: 12px; }
  .sr-label-tight { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.16em; color: var(--text-muted); }
  .br-when { font-family: var(--font-mono); font-size: 10px; color: var(--text-ghost); }

  .br-config { border: 1px solid var(--card-border); padding: 14px; display: flex; flex-direction: column; gap: 12px; }
  .br-toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
  .br-toggle input { width: auto; }
  .br-run, .br-save { font-family: var(--font-mono); font-size: 12px; padding: 7px 16px; background: var(--accent-ink, var(--accent, #c4570a)); color: var(--bg, #fff); border: none; cursor: pointer; }
  .br-run:disabled { opacity: 0.5; cursor: default; }
  .br-field { display: flex; flex-direction: column; gap: 4px; }
  .br-in { background: var(--bg); border: 1px solid var(--card-border); color: var(--text-primary); font-size: 13px; padding: 8px 10px; outline: none; box-sizing: border-box; }
  .br-in:focus { border-color: var(--text-muted); }
  .br-config-foot { display: flex; align-items: center; gap: 12px; }
  .br-ok { color: var(--status-success, #2a9d4a); font-size: 12px; }
  .br-err { color: var(--status-error, #c0392b); font-size: 12px; }

  .br-body { color: var(--text-primary); }
  .br-body-sm { margin-top: 8px; }
  .br-meta { margin-top: 12px; font-family: var(--font-mono); font-size: 10px; color: var(--text-ghost); }
  .br-vote { display: flex; align-items: center; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--divider); }
  .br-vote-what { flex: 1; max-width: 320px; font-family: var(--font-mono); font-size: 11px; padding: 4px 8px; border: 1px solid var(--card-border); background: var(--bg); color: var(--text-primary); outline: none; }
  .br-vote-what:focus { border-color: var(--accent); }
  .br-vote-btn { background: var(--bg); border: 1px solid var(--accent-ink, var(--accent)); color: var(--accent-ink, var(--accent)); padding: 4px 10px; cursor: pointer; font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; }
  .br-vote-btn:hover { background: var(--accent-ink, var(--accent)); color: var(--bg); }
  .br-vote-down { border-color: var(--warn, #b0892a); color: var(--warn, #b0892a); }
  .br-vote-down:hover { background: var(--warn, #b0892a); color: var(--bg); }
  .br-vote-done { font-family: var(--font-mono); font-size: 11px; color: var(--success, #2d7a3a); }
  .br-empty { color: var(--text-ghost); font-size: 13px; }

  .br-past { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .br-past-item summary { cursor: pointer; display: flex; justify-content: space-between; gap: 8px; padding: 6px 0; }
  .br-past-title { font-size: 13px; color: var(--text-primary); }
</style>
