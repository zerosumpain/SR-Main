<svelte:head><title>Research — JKAI</title></svelte:head>
<script lang="ts">
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  type Mode = 'quick' | 'deep';
  type Run = typeof data.runs[number];

  let mode = $state<Mode>('deep');
  let topic = $state('');
  let starting = $state(false);
  let error = $state<string | null>(null);
  let runs = $state<Run[]>(data.runs);
  // Per-row: id -> 'confirming' | 'deleting'
  let deleteState = $state<Record<string, 'confirming' | 'deleting'>>({});

  async function start() {
    const t = topic.trim();
    if (!t) { error = 'Enter a topic first.'; return; }
    error = null;
    starting = true;
    try {
      if (mode === 'quick') {
        const fd = new FormData();
        fd.append('topic', t);
        fd.append('goals', '');
        const res = await fetch('/quickanswer', { method: 'POST', body: fd });
        if (res.redirected) { await goto(res.url); return; }
        if (!res.ok) { error = `Quick answer failed (${res.status})`; return; }
        await goto('/quickanswer');
      } else {
        const res = await fetch('/api/deepdive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic: t, goals: [] }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          error = body.error ?? `Deep dive failed (${res.status})`;
          return;
        }
        const session = await res.json();
        await goto(`/deepdive/${session.id}`);
      }
    } catch (e: any) {
      error = e?.message ?? 'Network error';
    } finally {
      starting = false;
    }
  }

  function startConfirm(e: MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    deleteState = { ...deleteState, [id]: 'confirming' };
  }

  function cancelConfirm(e: MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    const next = { ...deleteState };
    delete next[id];
    deleteState = next;
  }

  async function confirmDelete(e: MouseEvent, run: Run) {
    e.preventDefault();
    e.stopPropagation();
    const { id, mode: runMode } = run;
    deleteState = { ...deleteState, [id]: 'deleting' };

    // Optimistic removal
    const prev = runs;
    runs = runs.filter((r) => r.id !== id);

    const endpoint = runMode === 'quick' ? `/api/quickanswer/${id}` : `/api/deepdive/${id}`;
    try {
      const res = await fetch(endpoint, { method: 'DELETE' });
      if (!res.ok) {
        // Revert
        runs = prev;
        error = `Delete failed (${res.status})`;
      }
    } catch (err: any) {
      runs = prev;
      error = err?.message ?? 'Network error during delete';
    } finally {
      const next = { ...deleteState };
      delete next[id];
      deleteState = next;
    }
  }

  function statusColor(status: string): string {
    if (status === 'complete') return 'var(--success)';
    if (status === 'failed') return 'var(--error)';
    if (status === 'draft') return 'var(--text-ghost)';
    return 'var(--accent)';
  }
  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function formatDuration(ms: number | null): string {
    if (!ms) return '';
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  }
</script>

<div class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">JKAI · Research</div>
      <h1>The Desk</h1>
      <p class="sub">
        Ask a question. Watch the desk fill with sources, facts and entities in realtime,
        then flip <strong>GATHER ⇄ SYNTHESIZE</strong> to fold the pile into clusters.
      </p>
    </div>
    <a class="back-link" href="/jkai">← JKAI</a>
  </header>

  <section class="launch">
    <div class="prompt-row">
      <input
        type="text"
        bind:value={topic}
        class="prompt-input"
        placeholder="Research anything…"
        onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !starting) { e.preventDefault(); start(); } }}
      />
      <div class="seg" role="group" aria-label="Research depth">
        <button type="button" class="seg-btn" class:on={mode === 'quick'} aria-pressed={mode === 'quick'} onclick={() => (mode = 'quick')}>Quick</button>
        <button type="button" class="seg-btn" class:on={mode === 'deep'} aria-pressed={mode === 'deep'} onclick={() => (mode = 'deep')}>Deep</button>
      </div>
      <button type="button" class="go-btn" disabled={starting || !topic.trim()} onclick={start}>
        {starting ? 'Starting…' : 'Open desk →'}
      </button>
    </div>
    <p class="mode-hint">
      {#if mode === 'quick'}
        <strong>Quick</strong> — a single pass with citations, a small desk in under two minutes.
      {:else}
        <strong>Deep</strong> — the multi-phase agent: sources, facts, entities, red-team — the full desk.
        <a class="row-link" href="/deepdive">Advanced options →</a>
      {/if}
    </p>
    {#if error}<div class="err-line">{error}</div>{/if}
  </section>

  <section class="recent">
    <div class="recent-hd">
      <span class="sr-label-tight">Recent runs</span>
      <span class="recent-meta">{runs.length} {runs.length === 1 ? 'run' : 'runs'}</span>
    </div>

    {#if runs.length === 0}
      <div class="empty">No research runs yet. Ask something above.</div>
    {:else}
      <div class="run-grid">
        {#each runs as r (r.mode + ':' + r.id)}
          {@const ds = deleteState[r.id]}
          <a class="run-card" href={r.href}>
            <div class="run-card-top">
              <span class="run-mode {r.mode}">{r.mode}</span>
              {#if ds === 'confirming'}
                <span class="del-confirm-row" role="group" aria-label="Confirm delete">
                  <button
                    type="button"
                    class="del-btn del-confirm"
                    onclick={(e) => confirmDelete(e, r)}
                    aria-label="Confirm delete"
                  >✓ delete</button>
                  <button
                    type="button"
                    class="del-btn del-cancel"
                    onclick={(e) => cancelConfirm(e, r.id)}
                    aria-label="Cancel delete"
                  >✗</button>
                </span>
              {:else if ds === 'deleting'}
                <span class="del-spinner" aria-label="Deleting…">…</span>
              {:else}
                <button
                  type="button"
                  class="del-btn del-trash"
                  onclick={(e) => startConfirm(e, r.id)}
                  aria-label="Delete this run"
                  title="Delete run"
                >✕</button>
              {/if}
            </div>
            <div class="run-topic">{r.topic}</div>
            <div class="run-meta">
              <span style:color={statusColor(r.status)}>{r.status}</span>
              {#if r.durationMs}<span class="dot">·</span><span>{formatDuration(r.durationMs)}</span>{/if}
              <span class="dot">·</span><span>{formatDate(r.createdAt)}</span>
            </div>
          </a>
        {/each}
      </div>
    {/if}
  </section>
</div>

<style>
  .wrap { max-width: 980px; margin: 2rem auto 4rem; padding: 0 1.5rem; color: var(--text-primary); font-family: var(--font-body); }
  .page-hdr { display: flex; justify-content: space-between; align-items: flex-end; gap: 1.5rem; margin-bottom: 1.75rem; padding-bottom: 1rem; border-bottom: 2px solid var(--text-primary); }
  .kicker { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.18em; color: var(--accent); margin-bottom: 0.35rem; }
  .page-hdr h1 { margin: 0; font-family: var(--font-display); font-size: 2.2rem; font-weight: 900; line-height: 1.05; }
  .sub { margin: 0.6rem 0 0; font-size: 0.95rem; line-height: 1.5; color: var(--text-secondary); max-width: 64ch; }
  .sub strong { color: var(--text-primary); font-weight: 700; }
  .back-link { font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--accent); text-decoration: none; flex-shrink: 0; }
  .back-link:hover { text-decoration: underline; }

  .launch { margin-bottom: 2.25rem; }
  .prompt-row { display: flex; gap: 0.5rem; align-items: stretch; flex-wrap: wrap; }
  .prompt-input {
    flex: 1 1 320px; min-width: 0;
    font-family: var(--font-body); font-size: 1.05rem;
    padding: 0.85rem 1rem;
    background: var(--surface-elevated, #e8dece);
    border: 1.5px solid rgba(26, 16, 8, 0.18);
    color: var(--text-primary);
    outline: none;
  }
  .prompt-input:focus { border-color: var(--accent); }
  .seg { display: inline-flex; border: 1.5px solid rgba(26, 16, 8, 0.18); }
  .seg-btn {
    font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em;
    padding: 0 1rem; background: var(--surface-elevated, #faf6ee); color: var(--text-muted); border: none; cursor: pointer;
  }
  .seg-btn + .seg-btn { border-left: 1.5px solid rgba(26, 16, 8, 0.18); }
  .seg-btn.on { background: var(--accent); color: #fff; }
  .go-btn {
    font-family: var(--font-mono); font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em;
    padding: 0 1.25rem; background: var(--text-primary); color: var(--bg); border: 1.5px solid var(--text-primary);
    cursor: pointer; white-space: nowrap;
  }
  .go-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .mode-hint { margin: 0.7rem 0 0; font-size: 0.85rem; color: var(--text-secondary); }
  .mode-hint strong { color: var(--text-primary); }
  .err-line { font-family: var(--font-mono); font-size: 11px; color: var(--error); padding: 6px 8px; background: var(--error-bg); border-left: 2px solid var(--error); margin-top: 0.6rem; }

  .recent-hd { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.75rem; }
  .sr-label-tight { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.16em; color: var(--text-muted); }
  .recent-meta { font-family: var(--font-mono); font-size: 10px; color: var(--text-ghost); }
  .empty { padding: 1.5rem; text-align: center; font-family: var(--font-mono); font-size: 11px; color: var(--text-ghost); font-style: italic; border: 1px dashed rgba(26, 16, 8, 0.18); }
  .run-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 0.6rem; }
  .run-card {
    display: block; padding: 0.8rem 0.95rem;
    background: var(--surface-elevated, #faf6ee); border: 1px solid rgba(26, 16, 8, 0.18);
    color: var(--text-primary); text-decoration: none; transition: border-color 80ms ease;
  }
  .run-card:hover { border-color: var(--accent); }
  .run-card-top { display: flex; justify-content: space-between; align-items: center; gap: 0.4rem; }
  .run-mode { font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.16em; padding: 2px 6px; border: 1px solid rgba(26, 16, 8, 0.18); color: var(--text-muted); }
  .run-mode.quick { color: var(--accent); border-color: var(--accent); }
  .run-mode.deep { color: var(--bg); background: var(--text-primary); border-color: var(--text-primary); }
  .del-btn {
    font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em;
    border: none; background: transparent; cursor: pointer; padding: 2px 4px; line-height: 1;
  }
  .del-trash { color: var(--text-ghost); opacity: 0; transition: opacity 100ms; }
  .run-card:hover .del-trash { opacity: 1; }
  .del-trash:hover { color: var(--error, #c44); }
  .del-confirm-row { display: flex; align-items: center; gap: 2px; }
  .del-confirm { color: var(--error, #c44); border: 1px solid var(--error, #c44); padding: 2px 6px; }
  .del-confirm:hover { background: var(--error, #c44); color: #fff; }
  .del-cancel { color: var(--text-muted); border: 1px solid rgba(26, 16, 8, 0.18); padding: 2px 5px; }
  .del-cancel:hover { color: var(--text-primary); }
  .del-spinner { font-family: var(--font-mono); font-size: 10px; color: var(--text-ghost); }
  .run-topic { font-size: 13px; font-weight: 500; margin: 0.55rem 0 0.35rem; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .run-meta { display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: center; font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; }
  .run-meta .dot { color: var(--text-ghost); }
  .row-link { color: var(--accent); text-decoration: none; font-family: var(--font-mono); font-size: 11px; }
  .row-link:hover { text-decoration: underline; }
</style>
