<script lang="ts">
  import type { MonitorStatus } from '$lib/monitors/monitors.server';
  import { invalidateAll } from '$app/navigation';

  let { data, embedded = false }: { data: { monitors: MonitorStatus[] }; embedded?: boolean } = $props();
  const monitors = $derived(data.monitors ?? []);

  let desc = $state('');
  let cron = $state('');
  let creating = $state(false);
  let createErr = $state<string | null>(null);
  let createMsg = $state<string | null>(null);

  async function create() {
    if (!desc.trim() || creating) return;
    creating = true; createErr = null; createMsg = null;
    try {
      const res = await fetch('/api/jkai/monitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: desc.trim(), cron: cron.trim() || undefined }),
      });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b.error || `HTTP ${res.status}`);
      createMsg = `Monitor created (${b.monitor?.cron}).`;
      desc = ''; cron = '';
      await invalidateAll();
    } catch (e) {
      createErr = e instanceof Error ? e.message : 'Create failed';
    } finally {
      creating = false;
    }
  }

  async function toggle(m: MonitorStatus) {
    await fetch('/api/jkai/monitors', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflowId: m.workflowId, enabled: !m.enabled }),
    });
    await invalidateAll();
  }

  async function snooze(m: MonitorStatus, hours: number) {
    await fetch('/api/jkai/monitors', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflowId: m.workflowId, snoozeHours: hours }),
    });
    await invalidateAll();
  }

  function snoozedUntil(m: MonitorStatus): string | null {
    if (!m.snoozeUntil) return null;
    const t = new Date(m.snoozeUntil).getTime();
    if (t <= Date.now()) return null;
    return new Date(m.snoozeUntil).toLocaleString();
  }

  async function remove(m: MonitorStatus) {
    if (!confirm(`Delete monitor "${m.description}"?`)) return;
    await fetch(`/api/jkai/monitors?workflowId=${encodeURIComponent(m.workflowId)}`, { method: 'DELETE' });
    await invalidateAll();
  }

  function fmt(iso: string | null): string {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  }
</script>

<svelte:head><title>{embedded ? 'Daydreams · JKAI' : 'Monitors · JKAI'}</title></svelte:head>

<main class="mo" class:embedded>
  {#if !embedded}<header class="mo-hdr">
    <div class="mo-kicker">JKAI · Watch</div>
    <h1>Monitors</h1>
    <p class="mo-sub">"Watch X, tell me when Y." Each monitor is a scheduled workflow that checks a source, keeps only new items, and messages you.</p>
    <a class="mo-back" href="/jkai">← back to jkai</a>
  </header>{/if}

  <section class="mo-sec">
    <div class="mo-sec-hd"><span class="sr-label-tight">New monitor</span></div>
    <textarea class="mo-in" rows="2" placeholder="tell me when a new SW1 flat under £2k is listed each morning" bind:value={desc}></textarea>
    <div class="mo-row">
      <input class="mo-cron" placeholder="cron (optional, e.g. 0 8 * * *)" bind:value={cron} />
      <button class="mo-go" onclick={create} disabled={creating || !desc.trim()}>{creating ? 'Building…' : 'Create monitor'}</button>
    </div>
    {#if creating}<p class="mo-hint">Generating the watch workflow — this can take up to a minute.</p>{/if}
    {#if createErr}<p class="mo-err">⚠ {createErr}</p>{/if}
    {#if createMsg}<p class="mo-ok">{createMsg}</p>{/if}
  </section>

  <section class="mo-sec">
    <div class="mo-sec-hd"><span class="sr-label-tight">Active monitors ({monitors.length})</span></div>
    {#if monitors.length === 0}
      <p class="mo-empty">No monitors yet. Describe something to watch above.</p>
    {:else}
      <ul class="mo-list">
        {#each monitors as m (m.workflowId)}
          <li class="mo-card" class:off={!m.enabled}>
            <div class="mo-card-hd">
              <label class="mo-toggle">
                <input type="checkbox" checked={m.enabled} onchange={() => toggle(m)} />
                <span>{m.enabled ? 'on' : 'off'}</span>
              </label>
              <span class="mo-desc">{m.description}</span>
              <span class="mo-actions">
                {#if snoozedUntil(m)}
                  <button class="mo-link" onclick={() => snooze(m, 0)} title="Clear the snooze and re-enable now">wake</button>
                {:else}
                  <button class="mo-link" onclick={() => snooze(m, 24)} title="Pause for 24h (auto re-enables)">snooze 24h</button>
                {/if}
                <a class="mo-link" href={`/jkai/canvas/${m.slug}`}>open</a>
                <button class="mo-link mo-danger" onclick={() => remove(m)}>delete</button>
              </span>
            </div>
            <div class="mo-meta">
              {#if snoozedUntil(m)}<span class="mo-chip mo-chip-snooze">snoozed until {snoozedUntil(m)}</span>{/if}
              <span class="mo-chip">cron {m.cron}</span>
              <span class="mo-chip">last {fmt(m.lastRunAt)}</span>
              <span class="mo-chip">next {fmt(m.nextRunAt)}</span>
              {#if m.lastStatus}<span class="mo-chip mo-status-{m.lastStatus}">{m.lastStatus}</span>{/if}
              {#if m.hits.length}<span class="mo-chip mo-chip-hit">{m.hits.reduce((s, h) => s + h.newCount, 0)} found</span>{/if}
            </div>
            {#if m.hits.length}
              <details class="mo-hits">
                <summary><span class="sr-label-tight">Recent finds ({m.hits.length})</span></summary>
                <ul class="mo-hit-list">
                  {#each m.hits as h, i (i)}
                    <li class="mo-hit">
                      <span class="mo-hit-hd">{fmt(h.at)} · {h.newCount} new</span>
                      {#if h.preview}<span class="mo-hit-prev">{h.preview}</span>{/if}
                    </li>
                  {/each}
                </ul>
              </details>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</main>

<style>
  .mo { max-width: 820px; margin: 0 auto; padding: 32px 20px 80px; color: var(--text-primary); }
  .mo.embedded { max-width: none; padding: 0; }
  .mo-hdr { border-bottom: 2px solid var(--line-strong); padding-bottom: 16px; margin-bottom: 20px; }
  .mo-kicker { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.16em; color: var(--text-muted); }
  .mo-hdr h1 { font-family: var(--font-display, var(--font-sans)); font-size: 2.125rem; margin: 4px 0 2px; }
  .mo-sub { margin: 0; color: var(--text-muted); font-size: var(--fs-nav); }
  .mo-back { display: inline-block; margin-top: 10px; font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-muted); text-decoration: none; }
  .mo-back:hover { color: var(--text-primary); }

  .mo-sec { margin-bottom: 24px; }
  .mo-sec-hd { border-bottom: 1px dashed var(--line-strong); padding-bottom: 6px; margin-bottom: 12px; }
  .sr-label-tight { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.16em; color: var(--text-muted); }

  .mo-in { width: 100%; background: var(--bg); border: 1px solid var(--line-strong); color: var(--text-primary); font-size: var(--fs-body); padding: 8px 10px; outline: none; box-sizing: border-box; resize: vertical; }
  .mo-in:focus, .mo-cron:focus { border-color: var(--text-muted); }
  .mo-row { display: flex; gap: 8px; margin-top: 8px; }
  .mo-cron { flex: 1; background: var(--bg); border: 1px solid var(--line-strong); color: var(--text-primary); font-family: var(--font-mono); font-size: var(--fs-body); padding: 8px 10px; outline: none; box-sizing: border-box; }
  .mo-go { padding: 0 18px; background: var(--accent-ink, var(--accent, #c4570a)); color: var(--bg, #fff); border: none; font-family: var(--font-mono); font-size: var(--fs-label); cursor: pointer; }
  .mo-go:disabled { opacity: 0.5; cursor: default; }

  .mo-hint { font-size: var(--fs-label); color: var(--text-ghost); margin: 8px 0 0; }
  .mo-err { color: var(--status-error, #c0392b); font-size: var(--fs-label); margin: 6px 0 0; }
  .mo-ok { color: var(--status-success, #2a9d4a); font-size: var(--fs-label); margin: 6px 0 0; }
  .mo-empty { color: var(--text-ghost); font-size: var(--fs-nav); }

  .mo-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .mo-card { border: 1px solid var(--line-strong); padding: 12px; }
  .mo-card.off { opacity: 0.6; }
  .mo-card-hd { display: flex; align-items: baseline; gap: 10px; }
  .mo-toggle { display: flex; align-items: center; gap: 5px; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); cursor: pointer; flex-shrink: 0; }
  .mo-toggle input { width: auto; }
  .mo-desc { font-size: var(--fs-nav); color: var(--text-primary); flex: 1; }
  .mo-actions { display: flex; gap: 10px; flex-shrink: 0; }
  .mo-link { background: transparent; border: none; color: var(--text-muted); font-family: var(--font-mono); font-size: var(--fs-label); cursor: pointer; padding: 0; text-decoration: none; }
  .mo-link:hover { color: var(--text-primary); }
  .mo-danger:hover { color: var(--status-error, #c0392b); }
  .mo-meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .mo-chip { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); background: color-mix(in srgb, var(--card-border) 18%, transparent); padding: 1px 6px; }
  .mo-status-completed { color: var(--status-success, #2a9d4a); }
  .mo-status-failed { color: var(--status-error, #c0392b); }
  .mo-chip-hit { color: var(--accent-ink, var(--accent, #c4570a)); border: 1px solid currentColor; }
  .mo-chip-snooze { color: var(--warn, #b0892a); border: 1px solid currentColor; }

  .mo-hits { margin-top: 8px; }
  .mo-hits summary { cursor: pointer; }
  .mo-hit-list { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .mo-hit { display: flex; flex-direction: column; gap: 2px; border-left: 2px solid var(--line-strong); padding-left: 8px; }
  .mo-hit-hd { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .mo-hit-prev { font-size: var(--fs-label); color: var(--text-muted); word-break: break-word; }
  .sr-label-tight { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.16em; color: var(--text-muted); }
</style>
