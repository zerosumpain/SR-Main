<script lang="ts">
  import type { BriefingData } from '$lib/briefing/types';
  import { invalidateAll } from '$app/navigation';
  import ChatMarkdown from '$lib/canvas/ChatMarkdown.svelte';

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
</script>

<svelte:head><title>Briefing · JKAI</title></svelte:head>

<main class="br">
  <header class="br-hdr">
    <div class="br-kicker">JKAI · Daily</div>
    <h1>Briefing</h1>
    <p class="br-sub">A daily digest of what you care about — learned from your questions, research, and signals. Delivered {data.schedule.display} + WhatsApp.</p>
    <a class="br-back" href="/jkai">← back to jkai</a>
  </header>

  <section class="br-sec br-config">
    <div class="br-config-row">
      <label class="br-toggle">
        <input type="checkbox" bind:checked={enabled} />
        <span>{enabled ? 'Enabled' : 'Disabled'}</span>
      </label>
      <button class="br-run" onclick={runNow} disabled={running}>{running ? 'Generating…' : 'Run now'}</button>
    </div>
    <label class="br-field">
      <span class="sr-label-tight">Topics you care about (comma-separated)</span>
      <input class="br-in" bind:value={topicsText} placeholder="DfE data policy, brass & rails, home security, LLM costs" />
    </label>
    <div class="br-config-foot">
      <button class="br-save" onclick={saveConfig}>Save config</button>
      {#if msg}<span class="br-ok">{msg}</span>{/if}
      {#if err}<span class="br-err">⚠ {err}</span>{/if}
    </div>
  </section>

  {#if latest}
    <section class="br-sec">
      <div class="br-sec-hd"><span class="sr-label-tight">{latest.title}</span><span class="br-when">{fmt(latest.startedAt)} · {latest.status}</span></div>
      {#if latest.status === 'complete'}
        <div class="br-body"><ChatMarkdown content={latest.markdown} /></div>
        <div class="br-meta">{latest.sources.join(' · ') || 'no signals'} · {latest.llmCalls} call · ${latest.costUsd.toFixed(3)}</div>
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
  .br { max-width: 820px; margin: 0 auto; padding: 32px 20px 80px; color: var(--text-primary); }
  .br-hdr { border-bottom: 2px solid var(--card-border); padding-bottom: 16px; margin-bottom: 20px; }
  .br-kicker { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.16em; color: var(--text-muted); }
  .br-hdr h1 { font-family: var(--font-display, var(--font-sans)); font-size: 34px; margin: 4px 0 2px; }
  .br-sub { margin: 0; color: var(--text-muted); font-size: 13px; }
  .br-back { display: inline-block; margin-top: 10px; font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); text-decoration: none; }
  .br-back:hover { color: var(--text-primary); }

  .br-sec { margin-bottom: 24px; }
  .br-sec-hd { display: flex; align-items: baseline; justify-content: space-between; border-bottom: 1px dashed var(--card-border); padding-bottom: 6px; margin-bottom: 12px; }
  .sr-label-tight { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.16em; color: var(--text-muted); }
  .br-when { font-family: var(--font-mono); font-size: 10px; color: var(--text-ghost); }

  .br-config { border: 1px solid var(--card-border); padding: 14px; display: flex; flex-direction: column; gap: 12px; }
  .br-config-row { display: flex; align-items: center; justify-content: space-between; }
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
  .br-empty { color: var(--text-ghost); font-size: 13px; }

  .br-past { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .br-past-item summary { cursor: pointer; display: flex; justify-content: space-between; gap: 8px; padding: 6px 0; }
  .br-past-title { font-size: 13px; color: var(--text-primary); }
</style>
