<svelte:head><title>Research — JKAI</title></svelte:head>
<script lang="ts">
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';
  import ScopeEditor from '$lib/components/research/ScopeEditor.svelte';
  import type { ScopeDraft } from '$lib/components/research/ScopeEditor.svelte';
  import { GROUNDING_OPTIONS, groundingOption, type Grounding } from '$lib/deepdive/grounding';

  let { data }: { data: PageData } = $props();

  type Run = (typeof data.runs)[number];

  let topic = $state('');
  let depth = $state<string>('brief');
  /**
   * Whether an `instant` answer may look things up, and at what price. The
   * default stays 'off' so the cheap tier stays cheap unless asked otherwise —
   * see $lib/deepdive/grounding for the measured trade-off.
   */
  let grounding = $state<Grounding>('off');
  let goals = $state('');
  let showDefinition = $state(false);
  let scope = $state<ScopeDraft>({
    mode: 'open',
    includeDomains: '',
    excludeDomains: '',
    seedUrls: '',
    recencyDays: '',
  });

  let starting = $state(false);
  let error = $state<string | null>(null);
  let runs = $state<Run[]>(data.runs);
  let deleteState = $state<Record<string, 'confirming' | 'deleting'>>({});

  const tier = $derived(data.tiers.find((t) => t.depth === depth) ?? data.tiers[0]);
  // The definition stage only earns its space on tiers that actually search.
  const canScope = $derived(!!tier?.searches);

  function splitList(s: string): string[] {
    return s
      .split(/[\n,]/)
      .map((x) => x.trim())
      .filter(Boolean);
  }

  function fmtMs(ms: number | null | undefined): string {
    if (ms == null) return '—';
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
  }

  /**
   * What the picker prints under each tier. A measured p50 from this machine's
   * own completed runs beats a number in a blurb — but with no history yet,
   * saying "typically 50s" would be an invention, so an unmeasured tier shows
   * its ceiling instead and says which it is.
   */
  function timingLabel(d: string, budgetMs: number | null): string {
    const t = data.timings[d];
    if (t?.p50Ms != null && t.n > 0) return `~${fmtMs(t.p50Ms)} measured · ${t.n} run${t.n === 1 ? '' : 's'}`;
    if (budgetMs != null) return `under ${fmtMs(budgetMs)}`;
    return 'no fixed limit';
  }

  async function start() {
    const t = topic.trim();
    if (!t) {
      error = 'Enter a topic first.';
      return;
    }
    error = null;
    starting = true;
    try {
      const res = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: t,
          depth,
          grounding,
          goals: splitList(goals),
          scope: canScope
            ? {
                mode: scope.mode,
                includeDomains: splitList(scope.includeDomains),
                excludeDomains: splitList(scope.excludeDomains),
                seedUrls: splitList(scope.seedUrls),
                recency: scope.recencyDays ? { days: Number(scope.recencyDays) } : null,
              }
            : null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        error = body.error ?? `Could not start research (${res.status})`;
        return;
      }
      const session = await res.json();
      await goto(`/research/${session.id}`);
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
  async function confirmDelete(e: MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    deleteState = { ...deleteState, [id]: 'deleting' };
    const prev = runs;
    runs = runs.filter((r) => r.id !== id);
    try {
      const res = await fetch('/api/research', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id] }),
      });
      if (!res.ok) {
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
    // Paused is a state somebody chose, not a problem — the counter-accent
    // separates it from the orange of a run that is genuinely working.
    if (status === 'paused') return 'var(--accent-ink)';
    return 'var(--accent)';
  }
  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }
</script>

<div class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">JKAI · Research</div>
      <h1>Research</h1>
      <p class="sub">
        Pick how much digging you want. Everything from the model's own knowledge
        to a full investigation with sources, facts and a red team.
      </p>
    </div>
    <a class="back-link" href="/jkai">JKAI</a>
  </header>

  <section class="launch">
    <input
      type="text"
      bind:value={topic}
      class="prompt-input"
      placeholder="Research anything…"
      onkeydown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey && !starting) {
          e.preventDefault();
          start();
        }
      }}
    />

    <div class="tiers" role="radiogroup" aria-label="Research depth">
      {#each data.tiers as t (t.depth)}
        <button
          type="button"
          class="tier"
          class:on={depth === t.depth}
          role="radio"
          aria-checked={depth === t.depth}
          onclick={() => (depth = t.depth)}
        >
          <span class="tier-name">{t.label}</span>
          <span class="tier-time">{timingLabel(t.depth, t.budgetMs)}</span>
          <span class="tier-blurb">{t.blurb}</span>
        </button>
      {/each}
    </div>

    <!-- Only for `instant`. Every other tier searches with Tavily as part of
         what it is; offering a second search here would be an unasked bill on
         top of the one the tier already runs. -->
    {#if depth === 'instant'}
      <div class="grounding" role="radiogroup" aria-label="Web search">
        <span class="sr-label-tight">Web search</span>
        {#each GROUNDING_OPTIONS as g (g.mode)}
          <button
            type="button"
            class="gnd"
            class:on={grounding === g.mode}
            role="radio"
            aria-checked={grounding === g.mode}
            onclick={() => (grounding = g.mode)}
          >
            <span class="gnd-name">{g.label}</span>
            <span class="gnd-cost">
              ~{g.seconds}s · {g.costUsd === 0 ? 'no cash cost' : `~$${g.costUsd.toFixed(2)}`}
            </span>
          </button>
        {/each}
      </div>
      <p class="gnd-why">{groundingOption(grounding).blurb}</p>
    {/if}

    <div class="define-row">
      <button
        type="button"
        class="define-toggle"
        aria-expanded={showDefinition}
        onclick={() => (showDefinition = !showDefinition)}
      >
        {showDefinition ? '−' : '+'} Define scope &amp; goals
      </button>
      <button type="button" class="go-btn" disabled={starting || !topic.trim()} onclick={start}>
        {starting ? 'Starting…' : 'Start →'}
      </button>
    </div>

    {#if showDefinition}
      <div class="definition">
        <label class="fld">
          <span class="fld-label">Goals — one per line</span>
          <textarea bind:value={goals} rows="3" placeholder="What should this answer?"></textarea>
        </label>

        {#if canScope}
          <ScopeEditor bind:scope />
        {:else}
          <p class="note">
            <strong>{tier?.label}</strong> doesn't search the web, so source scoping doesn't apply.
          </p>
        {/if}
      </div>
    {/if}

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
        {#each runs as r (r.id)}
          {@const ds = deleteState[r.id]}
          <a class="run-card" href="/research/{r.id}">
            <div class="run-card-top">
              <span class="run-depth">{r.depth}</span>
              {#if ds === 'confirming'}
                <span class="del-confirm-row" role="group" aria-label="Confirm delete">
                  <button type="button" class="del-btn del-confirm" onclick={(e) => confirmDelete(e, r.id)}>✓ delete</button>
                  <button type="button" class="del-btn del-cancel" onclick={(e) => cancelConfirm(e, r.id)} aria-label="Cancel delete">✗</button>
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
              <!-- Named, not colour-coded: a run that says `phase2` while nothing
                   is working on it looks healthy, and one sat like that for four
                   months before anybody spotted it. -->
              {#if r.stalled}<span class="dot">·</span><span class="stalled">stalled — open to resume</span>{/if}
              {#if r.durationMs}<span class="dot">·</span><span>{fmtMs(r.durationMs)}</span>{/if}
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
  .kicker { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.18em; color: var(--accent); margin-bottom: 0.35rem; }
  .page-hdr h1 { margin: 0; font-family: var(--font-display); font-size: 2.2rem; font-weight: 900; line-height: 1.05; }
  .sub { margin: 0.6rem 0 0; font-size: 0.95rem; line-height: 1.5; color: var(--text-secondary); max-width: 64ch; }
  .back-link { font-family: var(--font-mono); font-size: var(--fs-label); text-transform: uppercase; letter-spacing: 0.12em; color: var(--accent); text-decoration: none; flex-shrink: 0; }
  .back-link:hover { text-decoration: underline; }

  .launch { margin-bottom: 2.25rem; }
  .prompt-input {
    width: 100%; font-family: var(--font-body); font-size: 1.05rem; padding: 0.85rem 1rem;
    background: var(--surface-elevated, #e8dece); border: 1.5px solid rgba(26, 16, 8, 0.18);
    color: var(--text-primary); outline: none;
  }
  .prompt-input:focus { border-color: var(--accent); }

  /* One row of small choices under the tier cards, not a second card grid: it
     is a qualifier on one tier, not a peer of the tiers themselves. */
  .grounding { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; margin-top: 0.7rem; }
  .gnd {
    display: grid; gap: 1px; text-align: left; cursor: pointer;
    background: none; border: 1px solid var(--card-border); padding: 4px 9px;
  }
  .gnd:hover { border-color: var(--accent); }
  .gnd.on { border-color: var(--accent); background: var(--card-bg); }
  .gnd-name { font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-primary); }
  .gnd.on .gnd-name { color: var(--accent); }
  .gnd-cost { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .gnd-why { margin: 0.4rem 0 0; font-size: 0.82rem; line-height: 1.45; color: var(--text-muted); max-width: 68ch; }

  .tiers { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.5rem; margin-top: 0.6rem; }
  .tier {
    display: flex; flex-direction: column; gap: 0.25rem; text-align: left; cursor: pointer;
    padding: 0.7rem 0.8rem; background: var(--surface-elevated, #faf6ee);
    border: 1.5px solid rgba(26, 16, 8, 0.18); color: var(--text-primary);
    transition: border-color 80ms ease;
  }
  .tier:hover { border-color: var(--accent); }
  .tier.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
  .tier-name { font-family: var(--font-mono); font-size: var(--fs-label); text-transform: uppercase; letter-spacing: 0.12em; }
  .tier-time { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent); }
  .tier-blurb { font-size: 0.8rem; line-height: 1.35; color: var(--text-secondary); }

  .define-row { display: flex; justify-content: space-between; align-items: center; gap: 0.6rem; margin-top: 0.7rem; }
  .define-toggle {
    font-family: var(--font-mono); font-size: var(--fs-label); text-transform: uppercase; letter-spacing: 0.1em;
    background: none; border: none; color: var(--accent); cursor: pointer; padding: 0.4rem 0;
  }
  .define-toggle:hover { text-decoration: underline; }
  .go-btn {
    font-family: var(--font-mono); font-size: var(--fs-label); text-transform: uppercase; letter-spacing: 0.12em;
    padding: 0.6rem 1.25rem; background: var(--text-primary); color: var(--bg);
    border: 1.5px solid var(--text-primary); cursor: pointer; white-space: nowrap;
  }
  .go-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .definition { border: 1px solid rgba(26, 16, 8, 0.18); padding: 0.9rem; background: var(--surface-elevated, #faf6ee); display: grid; gap: 0.9rem; }
  .fld { display: block; }
  .fld-label { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.14em; color: var(--text-muted); margin-bottom: 0.3rem; }
  .definition textarea {
    width: 100%; font-family: var(--font-body); font-size: 1rem; padding: 0.5rem 0.6rem;
    background: var(--bg); border: 1px solid rgba(26, 16, 8, 0.18); color: var(--text-primary); resize: vertical;
  }
  .note { margin: 0; font-size: 0.85rem; color: var(--text-secondary); }
  .err-line { font-family: var(--font-mono); font-size: var(--fs-label); color: var(--error); padding: 6px 8px; background: var(--error-bg); border-left: 2px solid var(--error); margin-top: 0.6rem; }

  .recent-hd { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.75rem; }
  .sr-label-tight { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.16em; color: var(--text-muted); }
  .recent-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .empty { padding: 1.5rem; text-align: center; font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-ghost); font-style: italic; border: 1px dashed rgba(26, 16, 8, 0.18); }
  .run-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 0.6rem; }
  .run-card { display: block; padding: 0.8rem 0.95rem; background: var(--surface-elevated, #faf6ee); border: 1px solid rgba(26, 16, 8, 0.18); color: var(--text-primary); text-decoration: none; transition: border-color 80ms ease; }
  .run-card:hover { border-color: var(--accent); }
  .run-card-top { display: flex; justify-content: space-between; align-items: center; gap: 0.4rem; }
  .run-depth { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.16em; padding: 2px 6px; border: 1px solid rgba(26, 16, 8, 0.18); color: var(--text-muted); }
  .del-btn { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; border: none; background: transparent; cursor: pointer; padding: 2px 4px; line-height: 1; }
  .del-trash { color: var(--text-ghost); opacity: 0; transition: opacity 100ms; }
  .run-card:hover .del-trash { opacity: 1; }
  .del-trash:hover { color: var(--error, #c44); }
  .del-confirm-row { display: flex; align-items: center; gap: 2px; }
  .del-confirm { color: var(--error, #c44); border: 1px solid var(--error, #c44); padding: 2px 6px; }
  .del-confirm:hover { background: var(--error, #c44); color: #fff; }
  .del-cancel { color: var(--text-muted); border: 1px solid rgba(26, 16, 8, 0.18); padding: 2px 5px; }
  .del-spinner { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .run-topic { font-size: var(--fs-nav); font-weight: 500; margin: 0.55rem 0 0.35rem; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .run-meta { display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: center; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; }
  .run-meta .dot { color: var(--text-ghost); }
  .run-meta .stalled { color: var(--warn); }
</style>
