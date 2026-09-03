<svelte:head><title>Research — JKAI</title></svelte:head>
<script lang="ts">
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';
  import HealthShell from '$lib/components/health/hub/HealthShell.svelte';
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
  const activeRuns = $derived(
    runs.filter((run) => !['complete', 'failed'].includes(run.status)),
  );
  const archivedRuns = $derived(
    runs.filter((run) => ['complete', 'failed'].includes(run.status)),
  );
  const completedRuns = $derived(runs.filter((run) => run.status === 'complete').length);
  const runGroups = $derived([
    {
      key: 'active',
      eyebrow: 'Live work',
      title: 'On the desk',
      note: 'Running, paused and drafted investigations',
      runs: activeRuns,
    },
    {
      key: 'archive',
      eyebrow: 'Archive',
      title: 'Past enquiries',
      note: 'Completed and stopped research',
      runs: archivedRuns,
    },
  ]);
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

<HealthShell
  path="/research"
  unifiedNav
  footer={[
    'strangeramblings.com/research · evidence desk',
    `${completedRuns} completed investigations`,
    `${data.tiers.length} research depths`,
  ]}
>
  <div class="research-page">
    <section class="research-lede">
      <div class="lede-inner">
        <div class="lede-copy">
          <p class="eyebrow">JKAI · source-aware enquiry</p>
          <h1>ASK WIDER.<br /><span>KNOW WHAT HOLDS.</span></h1>
          <p class="standfirst">
            Fast answers through full investigations, with traceable sources, extracted facts and
            deliberate challenge.
          </p>
        </div>

        <dl class="desk-summary" aria-label="Research desk summary">
          <div>
            <dt>On the desk</dt>
            <dd>{String(activeRuns.length).padStart(2, '0')}</dd>
            <small>Running, paused or drafted</small>
          </div>
          <div>
            <dt>Completed</dt>
            <dd>{String(completedRuns).padStart(2, '0')}</dd>
            <small>Reports ready to reopen</small>
          </div>
          <div>
            <dt>Depths</dt>
            <dd>{String(data.tiers.length).padStart(2, '0')}</dd>
            <small>From instant to investigation</small>
          </div>
        </dl>
      </div>
    </section>

    <main class="research-body">
      <section class="commission" aria-labelledby="commission-title">
        <header class="section-head">
          <div>
            <p class="section-no">01 / Commission</p>
            <h2 id="commission-title">START AN ENQUIRY</h2>
          </div>
          <p>Ask the question, then choose how hard the desk should work.</p>
        </header>

        <div class="launch">
          <div class="launch-block question-block">
            <div class="block-label">
              <span class="step-no">01</span>
              <label for="research-topic">The question</label>
            </div>
            <input
              id="research-topic"
              type="text"
              bind:value={topic}
              class="prompt-input"
              placeholder="What do you need to know?"
              onkeydown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !starting) {
                  e.preventDefault();
                  start();
                }
              }}
            />
          </div>

          <div class="launch-block depth-block">
            <div class="block-label">
              <span class="step-no">02</span>
              <span>Depth of enquiry</span>
            </div>
            <div class="tiers" role="radiogroup" aria-label="Research depth">
              {#each data.tiers as t, i (t.depth)}
                <button
                  type="button"
                  class="tier"
                  class:on={depth === t.depth}
                  role="radio"
                  aria-checked={depth === t.depth}
                  onclick={() => (depth = t.depth)}
                >
                  <span class="tier-index">0{i + 1}</span>
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
          </div>

          <div class="launch-block scope-block">
            <div class="define-row">
              <div class="block-label">
                <span class="step-no">03</span>
                <button
                  type="button"
                  class="define-toggle"
                  aria-expanded={showDefinition}
                  onclick={() => (showDefinition = !showDefinition)}
                >
                  {showDefinition ? '−' : '+'} Define scope &amp; goals
                </button>
              </div>
              <button type="button" class="go-btn" disabled={starting || !topic.trim()} onclick={start}>
                {starting ? 'Starting…' : 'Start research →'}
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
          </div>

          {#if error}<div class="err-line">{error}</div>{/if}
        </div>
      </section>

      <section class="recent" aria-labelledby="recent-title">
        <header class="section-head archive-head">
          <div>
            <p class="section-no">02 / Library</p>
            <h2 id="recent-title">RESEARCH RECORD</h2>
          </div>
          <p>{runs.length} {runs.length === 1 ? 'run' : 'runs'}, grouped by working state.</p>
        </header>

        {#if runs.length === 0}
          <div class="empty">No research runs yet. Commission the first enquiry above.</div>
        {:else}
          <div class="run-groups">
            {#each runGroups as group (group.key)}
              {#if group.runs.length}
                <section class="run-group" aria-labelledby="group-{group.key}">
                  <header class="group-head">
                    <div>
                      <p>{group.eyebrow}</p>
                      <h3 id="group-{group.key}">{group.title}</h3>
                    </div>
                    <span>{group.runs.length} · {group.note}</span>
                  </header>
                  <div class="run-list">
                    {#each group.runs as r, i (r.id)}
                      {@const ds = deleteState[r.id]}
                      <article class="run-row">
                        <a class="run-link" href="/research/{r.id}">
                          <span class="run-index">{String(i + 1).padStart(2, '0')}</span>
                          <span class="run-depth">{r.depth}</span>
                          <span class="run-main">
                            <strong>{r.topic}</strong>
                            <span class="run-meta">
                              <span style:color={statusColor(r.status)}>{r.status}</span>
                              <!-- Named, not colour-coded: a run that says `phase2` while nothing
                                   is working on it looks healthy, and one sat like that for four
                                   months before anybody spotted it. -->
                              {#if r.stalled}<span class="dot">·</span><span class="stalled">stalled — open to resume</span>{/if}
                              {#if r.durationMs}<span class="dot">·</span><span>{fmtMs(r.durationMs)}</span>{/if}
                              <span class="dot">·</span><span>{formatDate(r.createdAt)}</span>
                            </span>
                          </span>
                          <span class="run-arrow" aria-hidden="true">→</span>
                        </a>
                        <div class="run-actions">
                          {#if ds === 'confirming'}
                            <span class="del-confirm-row" role="group" aria-label="Confirm delete">
                              <button type="button" class="del-btn del-confirm" onclick={(e) => confirmDelete(e, r.id)}>Delete</button>
                              <button type="button" class="del-btn del-cancel" onclick={(e) => cancelConfirm(e, r.id)} aria-label="Cancel delete">Cancel</button>
                            </span>
                          {:else if ds === 'deleting'}
                            <span class="del-spinner" aria-label="Deleting…">Deleting…</span>
                          {:else}
                            <button
                              type="button"
                              class="del-btn del-trash"
                              onclick={(e) => startConfirm(e, r.id)}
                              aria-label="Delete this run"
                              title="Delete run"
                            >Remove</button>
                          {/if}
                        </div>
                      </article>
                    {/each}
                  </div>
                </section>
              {/if}
            {/each}
          </div>
        {/if}
      </section>
    </main>
  </div>
</HealthShell>

<style>
  .research-page { min-height: 100vh; background: var(--bg); color: var(--text-primary); font-family: var(--font-body); }
  .research-lede { padding: clamp(28px, 3.5vw, 48px) clamp(20px, 3vw, 44px); background: var(--text-primary); color: var(--bg); border-bottom: 1px solid rgba(237, 228, 212, 0.16); }
  .lede-inner { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(420px, 0.85fr); align-items: end; gap: clamp(32px, 5vw, 72px); width: min(1400px, 100%); margin: 0 auto; }
  .lede-copy { min-width: 0; }
  .eyebrow, .section-no { margin: 0 0 12px; font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 500; letter-spacing: var(--tracking-label-wide); text-transform: uppercase; color: var(--accent); }
  .research-lede .eyebrow { color: var(--accent-on-dark); }
  h1 { margin: 0; max-width: none; font-family: var(--font-display); font-size: clamp(2.7rem, 4.8vw, 4.5rem); font-weight: 900; line-height: 0.88; letter-spacing: -0.04em; color: var(--bg); text-wrap: balance; }
  h1 span { color: transparent; white-space: nowrap; -webkit-text-stroke: 1.5px var(--bg); }
  .standfirst { max-width: 56ch; margin: 18px 0 0; font-size: var(--fs-body); line-height: 1.5; color: rgba(237, 228, 212, 0.7); }
  .desk-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0; margin: 0; border-top: 1px solid rgba(237, 228, 212, 0.16); border-left: 1px solid rgba(237, 228, 212, 0.16); }
  .desk-summary > div { min-width: 0; padding: 14px; border-right: 1px solid rgba(237, 228, 212, 0.16); border-bottom: 1px solid rgba(237, 228, 212, 0.16); background: rgba(237, 228, 212, 0.04); }
  .desk-summary dt { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 500; letter-spacing: var(--tracking-label-wide); text-transform: uppercase; color: rgba(237, 228, 212, 0.55); }
  .desk-summary dd { margin: 8px 0 5px; font-family: var(--font-display); font-size: clamp(1.65rem, 2.4vw, 2.4rem); font-weight: 900; line-height: 0.9; letter-spacing: -0.03em; color: var(--bg); font-variant-numeric: tabular-nums; }
  .desk-summary small { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); line-height: 1.3; letter-spacing: 0.06em; text-transform: uppercase; color: var(--accent-on-dark); }

  .research-body { width: min(1280px, 100%); margin: 0 auto; padding: 44px clamp(20px, 4vw, 52px) 72px; }
  .commission { margin-bottom: 60px; }
  .section-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; padding-bottom: 14px; border-bottom: 2px solid var(--text-primary); }
  .section-head .section-no { margin-bottom: 6px; }
  .section-head h2 { margin: 0; font-family: var(--font-display); font-size: clamp(2rem, 3.4vw, 3.25rem); line-height: 0.92; letter-spacing: -0.03em; }
  .section-head > p { max-width: 38ch; margin: 0 0 3px; font-size: var(--fs-body-sm); line-height: 1.5; color: var(--text-muted); text-align: right; }

  .launch { border-bottom: 1px solid var(--line-strong); }
  .launch-block { display: grid; grid-template-columns: 160px minmax(0, 1fr); gap: 22px; padding: 18px 0; border-bottom: 1px solid var(--line-strong); }
  .launch-block:last-of-type { border-bottom: 0; }
  .block-label { display: flex; align-items: baseline; gap: 12px; font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 500; letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--text-muted); }
  .step-no { color: var(--accent); font-variant-numeric: tabular-nums; }
  .prompt-input { width: 100%; padding: 0 0 8px; border: 0; border-bottom: 2px solid var(--text-primary); outline: 0; background: transparent; color: var(--text-primary); font-family: var(--font-display); font-size: clamp(1.55rem, 2.8vw, 2.65rem); font-weight: 900; line-height: 1.05; letter-spacing: -0.025em; }
  .prompt-input::placeholder { color: var(--text-ghost); }
  .prompt-input:focus { border-bottom-color: var(--accent); }

  .depth-block { align-items: start; }
  .tiers { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border-top: 1px solid var(--line-strong); border-left: 1px solid var(--line-strong); }
  .tier { position: relative; display: grid; grid-template-rows: auto auto auto 1fr; gap: 5px; min-height: 150px; padding: 14px; border: 0; border-right: 1px solid var(--line-strong); border-bottom: 1px solid var(--line-strong); background: transparent; color: var(--text-primary); text-align: left; cursor: pointer; transition: background var(--t-fast) var(--ease-out), color var(--t-fast) var(--ease-out); }
  .tier:hover { background: var(--accent-tint-08); }
  .tier.on { background: var(--text-primary); color: var(--bg); }
  .tier-index { justify-self: end; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .tier.on .tier-index { color: rgba(237, 228, 212, 0.45); }
  .tier-name { font-family: var(--font-display); font-size: clamp(1.1rem, 1.7vw, 1.45rem); line-height: 1; text-transform: uppercase; }
  .tier-time { font-family: var(--font-mono); font-size: var(--fs-label-xs); line-height: 1.35; color: var(--accent); }
  .tier.on .tier-time { color: var(--accent-on-dark); }
  .tier-blurb { align-self: end; font-size: var(--fs-label); line-height: 1.45; color: var(--text-muted); }
  .tier.on .tier-blurb { color: rgba(237, 228, 212, 0.68); }

  .grounding { grid-column: 2; display: flex; flex-wrap: wrap; align-items: stretch; gap: 0; margin-top: 10px; }
  .grounding > .sr-label-tight { display: flex; align-items: center; padding: 0 12px; border: 1px solid var(--line-strong); border-right: 0; }
  .gnd { display: grid; gap: 2px; min-width: 142px; padding: 8px 12px; border: 1px solid var(--line-strong); border-right: 0; background: transparent; text-align: left; cursor: pointer; }
  .gnd:last-child { border-right: 1px solid var(--line-strong); }
  .gnd:hover, .gnd.on { background: var(--accent-tint-08); }
  .gnd.on { box-shadow: inset 0 -2px var(--accent); }
  .gnd-name { font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-primary); }
  .gnd.on .gnd-name { color: var(--accent); }
  .gnd-cost { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .gnd-why { grid-column: 2; margin: 7px 0 0; font-size: var(--fs-label); line-height: 1.45; color: var(--text-muted); }

  .scope-block { display: block; }
  .define-row { display: flex; justify-content: space-between; align-items: center; gap: 24px; }
  .define-toggle { padding: 0; border: 0; background: transparent; color: var(--text-primary); font: inherit; letter-spacing: inherit; text-transform: inherit; cursor: pointer; }
  .define-toggle:hover { color: var(--accent); }
  .go-btn { padding: 13px 22px; border: 1px solid var(--text-primary); background: var(--text-primary); color: var(--bg); font-family: var(--font-mono); font-size: var(--fs-label); font-weight: 600; letter-spacing: var(--tracking-label); text-transform: uppercase; white-space: nowrap; cursor: pointer; transition: background var(--t-fast) var(--ease-out), border-color var(--t-fast) var(--ease-out); }
  .go-btn:hover:not(:disabled) { border-color: var(--accent); background: var(--accent); }
  .go-btn:disabled { opacity: 0.42; cursor: not-allowed; }
  .definition { display: grid; gap: 16px; margin-top: 18px; padding: 18px; border: 1px solid var(--line-strong); background: var(--surface-sunken); }
  .fld { display: block; }
  .fld-label { display: block; margin-bottom: 8px; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--text-muted); }
  .definition textarea { width: 100%; padding: 10px 12px; border: 1px solid var(--line-strong); background: var(--bg); color: var(--text-primary); font-family: var(--font-body); font-size: var(--fs-body); resize: vertical; }
  .definition textarea:focus { border-color: var(--accent); outline: 0; }
  .note { margin: 0; font-size: var(--fs-nav); color: var(--text-secondary); }
  .err-line { padding: 10px 12px; border-left: 3px solid var(--error); background: var(--error-bg); color: var(--error); font-family: var(--font-mono); font-size: var(--fs-label); }

  .archive-head { margin-bottom: 20px; }
  .run-groups { display: grid; gap: 30px; }
  .group-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; padding-bottom: 9px; border-bottom: 1px solid var(--line-strong); }
  .group-head p { margin: 0 0 5px; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--accent); }
  .group-head h3 { margin: 0; font-family: var(--font-display); font-size: var(--fs-display-xs); line-height: 1; text-transform: uppercase; }
  .group-head > span { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); text-align: right; }
  .run-list { border-bottom: 1px solid var(--line-strong); }
  .run-row { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: stretch; border-bottom: 1px solid var(--line-hair); }
  .run-row:last-child { border-bottom: 0; }
  .run-link { display: grid; grid-template-columns: 34px 86px minmax(0, 1fr) 18px; align-items: center; gap: 14px; min-width: 0; padding: 12px 10px 12px 0; color: var(--text-primary); text-decoration: none; transition: padding-left var(--t-base) var(--ease-out), background var(--t-base) var(--ease-out); }
  .run-link:hover { padding-left: 12px; background: var(--accent-tint-04); }
  .run-index { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); font-variant-numeric: tabular-nums; }
  .run-depth { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--accent); }
  .run-main { display: grid; gap: 4px; min-width: 0; }
  .run-main strong { overflow: hidden; font-size: var(--fs-body); font-weight: 600; line-height: 1.25; text-overflow: ellipsis; white-space: nowrap; }
  .run-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted); }
  .run-meta .dot { color: var(--text-ghost); }
  .run-meta .stalled { color: var(--warn); }
  .run-arrow { font-family: var(--font-mono); color: var(--text-ghost); transition: color var(--t-fast) var(--ease-out), transform var(--t-fast) var(--ease-out); }
  .run-link:hover .run-arrow { color: var(--accent); transform: translateX(3px); }
  .run-actions { display: flex; align-items: center; justify-content: flex-end; min-width: 72px; border-left: 1px solid var(--line-hair); }
  .del-confirm-row { display: flex; align-items: stretch; height: 100%; }
  .del-btn { padding: 0 12px; border: 0; background: transparent; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; }
  .del-trash { color: var(--text-ghost); opacity: 0; transition: opacity var(--t-fast) var(--ease-out), color var(--t-fast) var(--ease-out); }
  .run-row:hover .del-trash, .del-trash:focus-visible { opacity: 1; }
  .del-trash:hover { color: var(--error); }
  .del-confirm { color: var(--error); }
  .del-confirm:hover { background: var(--error); color: var(--bg); }
  .del-cancel { border-left: 1px solid var(--line-hair); color: var(--text-muted); }
  .del-cancel:hover { background: var(--surface-sunken); color: var(--text-primary); }
  .del-spinner { padding: 0 12px; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .empty { padding: 32px 20px; border: 1px dashed var(--line-strong); color: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label); text-align: center; }

  @media (max-width: 900px) {
    .lede-inner { grid-template-columns: 1fr; gap: 28px; }
    .tiers { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .tier { min-height: 138px; }
  }
  @media (max-width: 720px) {
    .research-lede { padding: 24px 20px; }
    .lede-inner { gap: 20px; }
    h1 { font-size: clamp(2.55rem, 12vw, 3.6rem); }
    h1 span { white-space: normal; }
    .desk-summary > div { padding: 10px; }
    .desk-summary dd { margin: 6px 0 0; }
    .desk-summary small { display: none; }
    .research-body { padding-top: 32px; }
    .commission { margin-bottom: 48px; }
    .section-head { align-items: flex-start; flex-direction: column; gap: 14px; }
    .section-head > p { max-width: none; text-align: left; }
    .launch-block { grid-template-columns: 1fr; gap: 12px; padding: 16px 0; }
    .grounding, .gnd-why { grid-column: 1; }
    .define-row { align-items: stretch; flex-direction: column; }
    .go-btn { width: 100%; }
    .group-head { align-items: flex-start; flex-direction: column; gap: 8px; }
    .group-head > span { text-align: left; }
    .run-link { grid-template-columns: 30px minmax(0, 1fr) 18px; gap: 10px; padding: 16px 8px 16px 0; }
    .run-depth { grid-column: 2; grid-row: 1; }
    .run-main { grid-column: 2; grid-row: 2; }
    .run-index { grid-row: 1 / span 2; }
    .run-arrow { grid-column: 3; grid-row: 1 / span 2; }
    .run-main strong { display: -webkit-box; white-space: normal; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .run-actions { min-width: 56px; }
    .del-btn { padding: 0 8px; }
    .del-confirm-row { flex-direction: column; }
    .del-cancel { border-top: 1px solid var(--line-hair); border-left: 0; }
  }
  @media (max-width: 480px) {
    .tier { min-height: 132px; padding: 12px; }
    .grounding { display: grid; grid-template-columns: 1fr 1fr; }
    .grounding > .sr-label-tight { grid-column: 1 / -1; padding: 9px 12px; border-right: 1px solid var(--line-strong); border-bottom: 0; }
    .gnd { min-width: 0; border-right: 0; }
    .gnd:nth-child(3) { border-right: 1px solid var(--line-strong); }
    .run-meta .dot, .run-meta .dot + span { display: none; }
    .del-trash { opacity: 1; }
  }
  @media (max-width: 360px) {
    .tiers { grid-template-columns: 1fr; }
    .tier { min-height: 118px; }
  }
</style>
