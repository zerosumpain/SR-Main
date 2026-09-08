<script lang="ts">
  // The development portfolio, wearing the /health editorial system.
  //
  // The chrome is `DaydreamShell`, NOT `HealthShell`. This page renders inside
  // the /jkai layout, which already mounts `HubHeader` above the scroll
  // container and `JkaiTabBar` below it; `HealthShell` would add a second site
  // bar and a fixed, full-viewport grain layer inside an `overflow: hidden`
  // flex shell. `/jkai/agents` is the precedent — same shell, same in-page
  // `ontab` tabs, page-local scoped styles for the dense content.
  //
  // Three of the system's shapes carry the page: the ink cover with a tile
  // deck, the sticky lane rail, and the ranked row — a numeral, a column
  // saying what the thing IS, then the content, with the hairline between rows
  // drawn as the container's own ground through a 1px gap.
  import DevelopmentModelSelect from '$lib/components/builds/DevelopmentModelSelect.svelte';
  let modelId = $state('');
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import DaydreamShell from '$lib/components/jkai/daydream/hub/DaydreamShell.svelte';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import StatDeck from '$lib/components/jkai/daydream/hub/StatDeck.svelte';
  import FacetBar from '$lib/components/jkai/daydream/hub/FacetBar.svelte';
  import type { DeckTile, Facet, ShellTab } from '$lib/components/jkai/daydream/hub/types';
  import { developmentLane, developmentTone, type DevelopmentLane } from '$lib/builds/development-progress';
  import { criterionResult, PRODUCT_AREAS, visibleDevelopmentStage, type DeliveryState } from '$lib/jkai/development';

  type Row = { buildId: string; title: string; status: string; outcome?: string | null; state: DeliveryState };

  let rows = $state<Row[]>([]);
  let outcome = $state('');
  let area = $state('Platform');
  let filter = $state('all');
  let lane = $state<'all' | DevelopmentLane>('all');
  let error = $state('');
  let busy = $state(false);
  let loaded = $state(false);

  onMount(() => {
    void fetch('/api/jkai/development')
      .then(async (r) => {
        if (!r.ok) throw new Error('Could not load development work');
        rows = await r.json();
      })
      .catch((e) => (error = e.message))
      .finally(() => (loaded = true));
  });

  async function create() {
    busy = true;
    error = '';
    try {
      const response = await fetch('/api/jkai/development', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ outcome, area, modelId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      await goto(`/jkai/develop/${result.buildId}?refine=1`);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not save the brief';
    } finally {
      busy = false;
    }
  }

  const stageOf = (row: Row) => visibleDevelopmentStage(row.state, row.status, row.outcome);
  // The API derives a build's title FROM its outcome, so on an ungroomed brief
  // the two say the same thing and the row printed it twice. The middle column
  // is for what the title does NOT already say — constraints first, because
  // that is the part a reader cannot guess.
  const norm = (s: string) => s.trim().toLowerCase().replace(/[.\s]+$/, '');
  const detailOf = (row: Row) => {
    const constraints = row.state.brief.constraints?.trim();
    if (constraints) return constraints;
    const routes = row.state.brief.routes.filter(Boolean);
    if (routes.length) return `Target routes: ${routes.join(', ')}`;
    const outcome = row.state.brief.outcome?.trim() ?? '';
    if (outcome && norm(outcome) !== norm(row.title)) return outcome;
    return `Brief revision ${row.state.brief.revision}${row.state.brief.acceptedAt ? ', accepted' : ', not yet groomed'}`;
  };
  const evidenced = (row: Row) =>
    row.state.criteria.filter(
      (c) => criterionResult(c, row.state.candidate).verdict === 'passed',
    ).length;

  const laneOf = $derived(new Map(rows.map((r) => [r.buildId, developmentLane(r.state)])));
  const countIn = (id: DevelopmentLane) => rows.filter((r) => laneOf.get(r.buildId) === id).length;

  // The lane rail. Counts render as pills; only the lane that is waiting on the
  // owner is allowed to shout, which is the deck's rule too.
  const LANES: Array<{ id: DevelopmentLane; label: string }> = [
    { id: 'brief', label: 'In brief' },
    { id: 'building', label: 'Building' },
    { id: 'input', label: 'Needs you' },
    { id: 'review', label: 'In review' },
    { id: 'accepted', label: 'Accepted' },
  ];
  const tabs = $derived<ShellTab[]>([
    { id: 'all', label: 'Everything', count: rows.length, tone: 'quiet' },
    ...LANES.map((l) => ({
      id: l.id,
      label: l.label,
      count: countIn(l.id),
      tone: (l.id === 'input' ? 'action' : 'quiet') as ShellTab['tone'],
    })),
  ]);

  const areaFacets = $derived<Facet[]>([
    { id: 'all', label: 'All areas', count: rows.length },
    ...PRODUCT_AREAS.map((value) => ({
      id: value,
      label: value,
      count: rows.filter((r) => r.state.area === value).length,
    })),
  ]);

  const visible = $derived(
    rows.filter(
      (r) =>
        (filter === 'all' || r.state.area === filter) &&
        (lane === 'all' || laneOf.get(r.buildId) === lane),
    ),
  );

  const needsYou = $derived(countIn('input'));
  const inFlight = $derived(countIn('building') + countIn('review'));

  const tiles = $derived<DeckTile[]>([
    {
      key: 'input',
      label: 'Waiting on you',
      value: String(needsYou),
      tone: needsYou ? 'action' : 'good',
      lit: needsYou > 0,
      sub: needsYou ? 'a decision is blocking the worker' : 'nothing is blocked on an answer',
    },
    {
      key: 'flight',
      label: 'In flight',
      value: String(inFlight),
      tone: inFlight ? 'steady' : 'quiet',
      sub: `${countIn('building')} building · ${countIn('review')} in review`,
    },
    {
      key: 'brief',
      label: 'Still in brief',
      value: String(countIn('brief')),
      tone: 'quiet',
      sub: 'drafted, not yet commissioned',
    },
    {
      key: 'accepted',
      label: 'Accepted',
      value: String(countIn('accepted')),
      tone: 'good',
      sub: 'merged into the cumulative batch',
    },
  ]);
</script>

<svelte:head><title>Site development — Strange Ramblings</title></svelte:head>

<DaydreamShell
  path="/jkai/develop"
  kicker="JKAI · Pi site development"
  title={['What should the', 'site do next?']}
  standfirst="Describe an outcome and the model proposes acceptance criteria, dependencies and the questions it still has. You review the brief, guide the build, and try the result in an isolated preview before any of it joins the batch."
  readout={[
    { label: 'Portfolio', value: `${rows.length} features` },
    { label: 'In flight', value: String(inFlight) },
    { label: 'Waiting on you', value: String(needsYou) },
  ]}
  {tabs}
  active={lane}
  ontab={(id) => (lane = id as 'all' | DevelopmentLane)}
  footer={[
    'strangeramblings.com/jkai/develop · site development',
    '01 brief → 02 build → 03 checks → 04 preview → 05 accept',
    'nothing here publishes a PR or deploys production',
  ]}
>
  {#snippet masthead()}
    <StatDeck {tiles} dark min={210} />
  {/snippet}

  <section class="dv-sec">
    <div class="dv-inner">
      <SectionHead
        kicker="01 / Commission"
        title={['Start with', 'an outcome']}
        strap="One sentence about what the site should do. The model turns it into a brief you can argue with; nothing is built until you accept one."
      />

      <form class="dv-form" onsubmit={(e) => { e.preventDefault(); void create(); }}>
        <DevelopmentModelSelect bind:value={modelId} disabled={busy} />
        <label class="dv-field dv-area">
          <span class="dv-label">Product area</span>
          <select aria-label="Product area" bind:value={area}>
            {#each PRODUCT_AREAS as value (value)}<option>{value}</option>{/each}
          </select>
        </label>
        <label class="dv-field dv-outcome">
          <span class="dv-label">Intended outcome</span>
          <textarea
            required
            maxlength="20000"
            bind:value={outcome}
            placeholder="For example: compare two weeks of health data and save the comparison."
          ></textarea>
        </label>
        <button class="dv-go" disabled={busy}>{busy ? 'Opening your draft…' : 'Refine this brief'}</button>
      </form>

      {#if error}<p role="alert" class="dv-error">{error}</p>{/if}

      <p class="dv-aside">
        Bigger pieces of work live in the epic backlog.
        <a href="/jkai/daydreams/backlog">Open the epic backlog →</a>
      </p>
    </div>
  </section>

  <section class="dv-sec dv-sec-last">
    <div class="dv-inner">
      <SectionHead
        kicker="02 / The portfolio"
        title={['Every feature', 'commissioned']}
        strap="Newest first. The stage is the product's, not the worker's — a running process with no candidate is still Building."
      />

      <div class="dv-facets">
        <FacetBar label="Area" facets={areaFacets} active={filter} onpick={(id) => (filter = id)} />
      </div>

      {#if !loaded}
        <p class="dv-empty" role="status">Loading development work…</p>
      {:else if !rows.length}
        <p class="dv-empty">
          No features commissioned yet. Start with an outcome above, or refine an existing epic in
          the backlog.
        </p>
      {:else if !visible.length}
        <p class="dv-empty">Nothing in this lane. The counts in the rail say where the work is.</p>
      {:else}
        <div class="dv-rows">
          {#each visible as row, i (row.buildId)}
            {@const stage = stageOf(row)}
            <a class="dv-row" href={`/jkai/develop/${row.buildId}`}>
              <p class="dv-rank">{String(i + 1).padStart(2, '0')}</p>
              <div class="dv-cell">
                <p class="dv-area-mark">{row.state.area}</p>
                <p class="dv-title">{row.title}</p>
              </div>
              <div class="dv-cell dv-outcome-cell">
                <p class="dv-blurb">{detailOf(row)}</p>
              </div>
              <div class="dv-cell dv-status">
                <span class="dv-pill tone-{developmentTone(stage)}">{stage}</span>
                <p class="dv-meta">
                  {evidenced(row)}/{row.state.criteria.length} criteria assessed as met
                </p>
              </div>
            </a>
          {/each}
        </div>
      {/if}
    </div>
  </section>
</DaydreamShell>

<style>
  /* Paper sections under the ink cover, on the section rhythm /health uses.
     The last one drops its rule: a bottom border there draws a stray line
     across the gap above the footer. */
  .dv-sec {
    padding: clamp(34px, 4vw, 64px) clamp(18px, 3vw, 44px);
    border-bottom: 2px solid rgba(26, 16, 8, 0.12);
  }
  .dv-sec-last {
    border-bottom: none;
    background: var(--bg-section);
  }
  .dv-inner {
    max-width: 1500px;
    margin: 0 auto;
  }

  /* ——— commission ——— */
  .dv-form {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 180px minmax(0, 2fr) auto;
    gap: 18px;
    align-items: end;
  }
  .dv-field {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .dv-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .dv-form select,
  .dv-form textarea {
    font: inherit;
    font-size: var(--fs-body);
    color: var(--text-primary);
    background: var(--surface-elevated);
    border: 1px solid var(--line-strong);
    border-radius: 0;
    padding: 11px 12px;
    width: 100%;
    box-sizing: border-box;
  }
  .dv-form textarea {
    min-height: 84px;
    resize: vertical;
    line-height: 1.5;
  }

  /* The page's one primary control, in the system's button shape: hairline
     box, mono label, fills accent on hover. */
  .dv-go {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 13px 22px;
    white-space: nowrap;
    color: var(--bg);
    background: var(--accent);
    border: 1px solid var(--accent);
    border-radius: 0;
    cursor: pointer;
    transition:
      background-color var(--t-fast) var(--ease-out),
      border-color var(--t-fast) var(--ease-out);
  }
  .dv-go:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }
  .dv-go:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .dv-error {
    color: var(--error);
    font-size: var(--fs-nav);
    margin: 16px 0 0;
  }
  .dv-aside {
    font-size: var(--fs-nav);
    color: var(--text-secondary);
    margin: 20px 0 0;
  }
  .dv-aside a {
    color: var(--accent-ink);
  }

  /* ——— the portfolio ——— */
  .dv-facets {
    margin-bottom: 22px;
  }

  /* One hairline between rows, drawn as the container's own ground showing
     through a 1px gap. Safe here — a fixed single column, not an `auto-fit`
     grid where unfilled tracks would paint as blocks. */
  .dv-rows {
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: var(--card-border);
    border: 1px solid var(--card-border);
  }
  .dv-row {
    background: var(--bg);
    display: grid;
    grid-template-columns: 56px minmax(0, 1.2fr) minmax(0, 1.6fr) 190px;
    gap: clamp(14px, 1.8vw, 28px);
    padding: 22px 24px;
    align-items: start;
    text-decoration: none;
    color: inherit;
    transition: background-color var(--t-fast) var(--ease-out);
  }
  .dv-row:hover {
    background: var(--surface-card);
  }
  .dv-rank {
    font-family: var(--font-display);
    font-size: 34px;
    line-height: 0.8;
    letter-spacing: -0.03em;
    color: rgba(26, 16, 8, 0.28);
    margin: 0;
  }
  .dv-cell {
    min-width: 0;
  }
  .dv-area-mark {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0 0 9px;
  }
  .dv-title {
    font-family: var(--font-display);
    font-size: 19px;
    line-height: 1.08;
    letter-spacing: -0.01em;
    text-transform: uppercase;
    margin: 0;
    overflow-wrap: anywhere;
  }
  .dv-blurb {
    font-size: var(--fs-nav);
    line-height: 1.5;
    color: var(--text-secondary);
    margin: 0;
    text-wrap: pretty;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .dv-status {
    text-align: right;
  }
  .dv-pill {
    display: inline-block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    white-space: nowrap;
    padding: 4px 11px;
    border: 1px solid currentcolor;
    border-radius: var(--radius-pill);
    color: var(--text-muted);
  }
  .dv-pill.tone-urgent { color: var(--error); }
  .dv-pill.tone-action { color: var(--accent); background: var(--accent-tint-08); }
  .dv-pill.tone-watch { color: var(--warn); }
  .dv-pill.tone-good { color: var(--good); }
  .dv-pill.tone-steady { color: var(--accent-ink); }
  .dv-pill.tone-quiet { color: var(--text-ghost); }
  .dv-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    color: var(--text-muted);
    margin: 10px 0 0;
  }

  .dv-empty {
    font-size: var(--fs-body-sm);
    color: var(--text-secondary);
    margin: 0;
  }

  a:focus-visible,
  button:focus-visible,
  select:focus-visible,
  textarea:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }

  @media (max-width: 900px) {
    .dv-form {
      grid-template-columns: 1fr;
      align-items: stretch;
    }
    .dv-row {
      grid-template-columns: 40px minmax(0, 1fr);
      gap: 12px 16px;
      padding: 18px;
    }
    .dv-outcome-cell,
    .dv-status {
      grid-column: 2;
      text-align: left;
    }
  }
</style>
