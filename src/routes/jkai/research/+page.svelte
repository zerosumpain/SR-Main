<svelte:head><title>Research — JKAI</title></svelte:head>
<script lang="ts">
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  type Mode = 'quick' | 'deep';
  let mode = $state<Mode>('quick');
  let topic = $state('');
  let goals = $state<string[]>([]);
  let starting = $state(false);
  let error = $state<string | null>(null);

  function addGoal() { goals = [...goals, '']; }
  function removeGoal(i: number) { goals = goals.filter((_, idx) => idx !== i); }

  async function start() {
    const t = topic.trim();
    if (!t) { error = 'Enter a topic first.'; return; }
    error = null;
    starting = true;
    try {
      const cleanedGoals = goals.map((g) => g.trim()).filter(Boolean);
      if (mode === 'quick') {
        const fd = new FormData();
        fd.append('topic', t);
        fd.append('goals', cleanedGoals.join('\n'));
        const res = await fetch('/quickanswer', { method: 'POST', body: fd });
        if (res.redirected) {
          await goto(res.url);
          return;
        }
        if (!res.ok) {
          error = `Quick answer failed (${res.status})`;
          return;
        }
        await goto('/quickanswer');
      } else {
        const res = await fetch('/api/deepdive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic: t, goals: cleanedGoals }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          error = body.error ?? `Deep dive failed (${res.status})`;
          return;
        }
        const session = await res.json();
        await goto(`/deepdive/${session.id}/progress`);
      }
    } catch (e: any) {
      error = e?.message ?? 'Network error';
    } finally {
      starting = false;
    }
  }

  function statusColor(status: string): string {
    if (status === 'complete') return '#2d7d46';
    if (status === 'failed') return '#8b3a1a';
    if (status === 'draft') return 'var(--text-ghost)';
    return 'var(--accent)';
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  }

  function formatDuration(ms: number | null): string {
    if (!ms) return '';
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  function modeLabel(m: Mode) { return m === 'quick' ? 'Quick' : 'Deep'; }
</script>

<div class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">JKAI · Research</div>
      <h1>Quick or deep — your call</h1>
      <p class="sub">
        One topic, two depths. <strong>Quick</strong> returns a synthesised answer with citations
        in under two minutes. <strong>Deep</strong> spins up the multi-phase research agent —
        sources, facts, entities, red-teaming — and parks the run on a live dashboard.
      </p>
    </div>
    <a class="back-link" href="/jkai">← JKAI</a>
  </header>

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Topic</span>
    </div>
    <div class="form">
      <label class="field">
        <span class="sr-label-tight">What do you want to know?</span>
        <input
          type="text"
          bind:value={topic}
          class="nm-text-input"
          placeholder="e.g. UK civil-service AI hiring trends 2024-26"
          onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !starting) { e.preventDefault(); start(); } }}
        />
      </label>

      <div class="field">
        <span class="sr-label-tight">Goals <em>— optional, narrows scope</em></span>
        <div class="goals">
          {#each goals as goal, i (i)}
            <div class="goal-row">
              <input type="text" bind:value={goals[i]} class="nm-text-input" placeholder="e.g. focus on Whitehall departments" />
              <button type="button" class="btn-ghost" onclick={() => removeGoal(i)} aria-label="Remove goal">×</button>
            </div>
          {/each}
          <button type="button" class="row-link" onclick={addGoal}>+ Add goal</button>
        </div>
      </div>
    </div>
  </section>

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Mode</span>
      <span class="nm-sec-meta">{modeLabel(mode)} selected</span>
    </div>

    <div class="mode-grid">
      <button
        type="button"
        class="mode-card"
        class:on={mode === 'quick'}
        onclick={() => (mode = 'quick')}
        aria-pressed={mode === 'quick'}
      >
        <div class="mode-hd">
          <span class="mode-tag">Quick</span>
          <span class="mode-time">&lt; 2 min</span>
        </div>
        <h2>Synthesised answer</h2>
        <p class="mode-desc">
          A single LLM pass with web search and citations. Best for one-shot questions
          where you just need the gist.
        </p>
        <ul class="mode-list">
          <li>Single answer page with citations</li>
          <li>~5-15 sources</li>
          <li>No live dashboard — just the answer</li>
        </ul>
      </button>

      <button
        type="button"
        class="mode-card"
        class:on={mode === 'deep'}
        onclick={() => (mode = 'deep')}
        aria-pressed={mode === 'deep'}
      >
        <div class="mode-hd">
          <span class="mode-tag">Deep</span>
          <span class="mode-time">5-30 min</span>
        </div>
        <h2>Research agent</h2>
        <p class="mode-desc">
          Multi-phase agent: source discovery, fact extraction, entity graph, red-team review.
          Outputs a structured dashboard you can revisit.
        </p>
        <ul class="mode-list">
          <li>Live progress page + final dashboard</li>
          <li>25+ sources, fact &amp; entity extraction</li>
          <li>Tunable depth, diversity, aggression on <a class="row-link" href="/deepdive">/deepdive</a></li>
        </ul>
      </button>
    </div>

    {#if error}
      <div class="err-line">{error}</div>
    {/if}

    <div class="form-actions">
      <button type="button" class="nm-save-btn" disabled={starting || !topic.trim()} onclick={start}>
        {starting ? 'Starting…' : `Start ${modeLabel(mode).toLowerCase()} research`}
      </button>
      {#if mode === 'deep'}
        <a class="btn-ghost" href="/deepdive">Advanced options →</a>
      {/if}
    </div>
  </section>

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Recent runs</span>
      <span class="nm-sec-meta">{data.runs.length} {data.runs.length === 1 ? 'run' : 'runs'}</span>
    </div>

    {#if data.runs.length === 0}
      <div class="empty">No research runs yet. Pick a mode and start one above.</div>
    {:else}
      <div class="run-list">
        {#each data.runs as r (r.mode + ':' + r.id)}
          <a class="run-card" href={r.href}>
            <span class="run-mode {r.mode}">{r.mode}</span>
            <div class="run-main">
              <div class="run-topic">{r.topic}</div>
              <div class="run-meta">
                <span style:color={statusColor(r.status)}>{r.status}</span>
                {#if r.durationMs}
                  <span class="dot">·</span>
                  <span>{formatDuration(r.durationMs)}</span>
                {/if}
                <span class="dot">·</span>
                <span>{formatDate(r.createdAt)}</span>
              </div>
            </div>
            <span class="run-arrow">→</span>
          </a>
        {/each}
      </div>
    {/if}
  </section>
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
  .page-hdr h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 2rem;
    font-weight: 900;
    line-height: 1.05;
    color: var(--text-primary);
  }
  .sub {
    margin: 0.6rem 0 0;
    font-size: 0.95rem;
    line-height: 1.5;
    color: var(--text-secondary);
    max-width: 64ch;
  }
  .sub strong { color: var(--text-primary); font-weight: 700; }
  .back-link {
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--accent);
    text-decoration: none;
    flex-shrink: 0;
  }
  .back-link:hover { text-decoration: underline; }

  .form { display: grid; gap: 0.9rem; }
  .field { display: grid; gap: 0.35rem; min-width: 0; }
  .field em { color: var(--text-ghost); font-style: normal; font-weight: 400; }

  .goals { display: grid; gap: 0.5rem; }
  .goal-row { display: flex; gap: 0.4rem; align-items: stretch; }
  .goal-row .nm-text-input { flex: 1; }

  .mode-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
    margin-bottom: 0.9rem;
  }
  @media (max-width: 720px) {
    .mode-grid { grid-template-columns: 1fr; }
  }
  .mode-card {
    display: block;
    text-align: left;
    padding: 1.05rem 1.1rem 1.15rem;
    background: var(--bg);
    border: 1px solid var(--card-border);
    color: var(--text-primary);
    cursor: pointer;
    font-family: var(--font-body);
    transition: border-color 80ms ease, background 80ms ease, transform 120ms ease;
  }
  .mode-card:hover { border-color: var(--text-primary); }
  .mode-card.on {
    border-color: var(--accent);
    background: var(--bg-section);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .mode-hd {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }
  .mode-tag {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--accent);
  }
  .mode-time {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
  }
  .mode-card h2 {
    margin: 0 0 0.4rem;
    font-family: var(--font-display);
    font-size: 1.15rem;
    font-weight: 800;
    line-height: 1.15;
  }
  .mode-desc {
    margin: 0 0 0.55rem;
    font-size: 0.88rem;
    line-height: 1.45;
    color: var(--text-secondary);
  }
  .mode-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 0.25rem;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
  }
  .mode-list li {
    padding-left: 0.85rem;
    position: relative;
  }
  .mode-list li::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0.55em;
    width: 4px;
    height: 4px;
    background: var(--accent);
  }

  .err-line {
    font-family: var(--font-mono);
    font-size: 11px;
    color: #c44;
    padding: 6px 8px;
    background: rgba(196, 68, 68, 0.08);
    border-left: 2px solid #c44;
    margin-bottom: 0.75rem;
  }
  .form-actions {
    display: flex;
    gap: 0.6rem;
    align-items: center;
  }
  .btn-ghost {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    padding: 8px 14px;
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--card-border);
    cursor: pointer;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
  }
  .btn-ghost:hover { border-color: var(--text-primary); color: var(--text-primary); }

  .empty {
    padding: 1.5rem;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-ghost);
    font-style: italic;
    border: 1px dashed var(--card-border);
  }
  .run-list { display: grid; gap: 0.5rem; }
  .run-card {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 0.85rem;
    padding: 0.7rem 0.95rem;
    background: var(--bg);
    border: 1px solid var(--card-border);
    color: var(--text-primary);
    text-decoration: none;
    transition: border-color 80ms ease;
  }
  .run-card:hover { border-color: var(--text-primary); }
  .run-mode {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    padding: 3px 7px;
    border: 1px solid var(--card-border);
    color: var(--text-muted);
    background: rgba(26, 16, 8, 0.04);
  }
  .run-mode.quick { color: var(--accent); border-color: var(--accent); }
  .run-mode.deep {
    color: var(--bg);
    background: var(--text-primary);
    border-color: var(--text-primary);
  }
  .run-topic {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .run-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: center;
    margin-top: 0.2rem;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .run-meta .dot { color: var(--text-ghost); }
  .run-arrow {
    font-family: var(--font-mono);
    color: var(--text-ghost);
    font-size: 14px;
  }
  .run-card:hover .run-arrow { color: var(--accent); }
</style>
