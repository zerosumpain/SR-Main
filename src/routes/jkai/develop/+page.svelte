<script lang="ts">
  // The development portfolio AND the build archive, wearing the /health
  // editorial system.
  //
  // The chrome is `DaydreamShell`, NOT `HealthShell`. This page renders inside
  // the /jkai layout, which already mounts `HubHeader` above the scroll
  // container and `JkaiTabBar` below it; `HealthShell` would add a second site
  // bar and a fixed, full-viewport grain layer inside an `overflow: hidden`
  // flex shell. `/jkai/agents` is the precedent — same shell, same in-page
  // `ontab` tabs, page-local scoped styles for the dense content.
  //
  // Two registers on one page, because they answer different questions. The
  // PORTFOLIO is every feature the site is currently growing: its rows are
  // ranked, its stage words come from the delivery state, and it is what the
  // rail's lanes filter. The ARCHIVE is every build that is not one of those —
  // sandbox apps, studio explainers, forge runs, change requests, apps filed
  // from chat — and it exists for two things that must not be lost: the record
  // of what the builder has actually managed, and the route from a finished
  // build to a card on /projects.
  //
  // Three of the system's shapes carry the page: the ink cover with a tile
  // deck, the sticky lane rail, and the ranked row — a numeral, a column
  // saying what the thing IS, then the content, with the hairline between rows
  // drawn as the container's own ground through a 1px gap.
  import DevelopmentModelSelect from '$lib/components/builds/DevelopmentModelSelect.svelte';
  let modelId = $state('');
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto, invalidateAll, replaceState } from '$app/navigation';
  import DaydreamShell from '$lib/components/jkai/daydream/hub/DaydreamShell.svelte';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import StatDeck from '$lib/components/jkai/daydream/hub/StatDeck.svelte';
  import FacetBar from '$lib/components/jkai/daydream/hub/FacetBar.svelte';
  import PromoteModal from '$lib/builds/PromoteModal.svelte';
  import type { DeckTile, Facet, ShellTab } from '$lib/components/jkai/daydream/hub/types';
  import { developmentLane, developmentTone, type DevelopmentLane } from '$lib/builds/development-progress';
  import { bucketOf, bucketLabel, outcomeNote, type BuildBucket } from '$lib/builds/build-status';
  import { publishedLink } from '$lib/builds/published-link';
  import { laneOf, type LaneStat } from '$lib/builds/lane-stats';
  import { criterionResult, PRODUCT_AREAS, RELEASE_POLICIES, AUTOPILOT_ROUNDS, visibleDevelopmentStage, type DeliveryState, type ReleasePolicy } from '$lib/jkai/development';
  import { RELEASE_POLICY_LABELS } from '$lib/constants/development';

  type Row = { buildId: string; title: string; status: string; outcome?: string | null; state: DeliveryState };
  type ArchiveRow = {
    id: string; title: string | null; prompt: string; status: string; outcome: string | null;
    planStatus: string | null; origin: string | null; gitTargetConfig: unknown;
    publishedSlug: string | null; projectSlug: string | null; serveConfig: unknown;
    cardTitle: string | null; cardBlurb: string | null; cardTag: string | null;
    iterationCount: number; tokensUsed: number | null; createdAt: string | Date;
  };

  let { data } = $props();

  let rows = $state<Row[]>([]);
  let outcome = $state('');
  let area = $state('Platform');
  let filter = $state('all');
  // The rail's lane is in the URL, not only in memory: the archive console
  // links back here and has to be able to name the tab it came from.
  const LANE_IDS = ['all', 'brief', 'building', 'input', 'review', 'accepted', 'shipped', 'archive'] as const;
  type LaneTab = (typeof LANE_IDS)[number];
  const requested = page.url.searchParams.get('tab');
  let lane = $state<LaneTab>((LANE_IDS as readonly string[]).includes(requested ?? '') ? (requested as LaneTab) : 'all');
  function setLane(next: LaneTab) {
    lane = next;
    const url = new URL(page.url);
    if (next === 'all') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    replaceState(url, {});
  }
  let error = $state('');
  let busy = $state(false);
  let loaded = $state(false);
  let advanced = $state(false);
  let releasePolicy = $state<ReleasePolicy>('preview_only');
  let autopilot = $state(false);
  let maxRounds = $state<number>(AUTOPILOT_ROUNDS.default);

  // ── the archive ─────────────────────────────────────────────────────────
  const archive = $derived<ArchiveRow[]>((data?.archive ?? []) as ArchiveRow[]);
  const lanes = $derived<LaneStat[]>((data?.lanes ?? []) as LaneStat[]);
  let archiveFilter = $state('all');
  let promoting = $state<ArchiveRow | null>(null);
  let removing = $state<string | null>(null);
  let notice = $state('');

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
        body: JSON.stringify({ outcome, area, modelId, releasePolicy, autopilot, maxRounds }),
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

  const laneMap = $derived(new Map(rows.map((r) => [r.buildId, developmentLane(r.state)])));
  const countIn = (id: DevelopmentLane) => rows.filter((r) => laneMap.get(r.buildId) === id).length;

  // The lane rail. Counts render as pills; only the lane that is waiting on the
  // owner is allowed to shout, which is the deck's rule too.
  const LANES: Array<{ id: DevelopmentLane; label: string }> = [
    { id: 'brief', label: 'In brief' },
    { id: 'building', label: 'Building' },
    { id: 'input', label: 'Needs you' },
    { id: 'review', label: 'In review' },
    { id: 'accepted', label: 'Accepted' },
    { id: 'shipped', label: 'Shipped' },
  ];
  const tabs = $derived<ShellTab[]>([
    { id: 'all', label: 'Everything', count: rows.length, tone: 'quiet' },
    ...LANES.map((l) => ({
      id: l.id,
      label: l.label,
      count: countIn(l.id),
      // The rail renders exactly three tones — action, watch, quiet — and `action`
      // is the only one that shouts. Shipped is good news, not something to
      // chase, so it stays quiet; only the lane blocked on the owner shouts.
      tone: (l.id === 'input' ? 'action' : 'quiet') as ShellTab['tone'],
    })),
    { id: 'archive', label: 'Archive', count: archive.length, tone: 'quiet' },
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
        (lane === 'all' || lane === 'archive' || laneMap.get(r.buildId) === lane),
    ),
  );

  const needsYou = $derived(countIn('input'));
  const inFlight = $derived(countIn('building') + countIn('review'));
  const shipped = $derived(countIn('shipped'));
  const running = $derived(rows.filter((r) => r.state.autopilot?.enabled && !r.state.autopilot.stopReason).length);

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
      key: 'auto',
      label: 'On autopilot',
      value: String(running),
      tone: running ? 'steady' : 'quiet',
      sub: running ? 'running unattended right now' : 'every run is owner-driven',
    },
    {
      key: 'brief',
      label: 'Still in brief',
      value: String(countIn('brief')),
      tone: 'quiet',
      sub: 'drafted, not yet commissioned',
    },
    {
      key: 'shipped',
      label: 'Shipped',
      value: String(shipped),
      tone: shipped ? 'good' : 'quiet',
      sub: `${countIn('accepted')} accepted into the batch`,
    },
  ]);

  // ── archive helpers ─────────────────────────────────────────────────────
  const bucketFor = (b: ArchiveRow): BuildBucket => bucketOf(b);
  const sourceOf = (b: ArchiveRow): string => {
    const rowLane = laneOf({ origin: b.origin, gitTargetConfig: b.gitTargetConfig } as Parameters<typeof laneOf>[0]);
    if (b.origin === 'chat' || b.origin === 'hermes') return 'From chat';
    if (b.origin === 'forge') return 'Forge';
    if (rowLane === 'studio') return 'Studio';
    if (rowLane === 'repo') return 'Change request';
    return 'Sandbox app';
  };
  const archiveFacets = $derived<Facet[]>([
    { id: 'all', label: 'Everything', count: archive.length },
    ...(['delivered', 'proposed', 'published', 'capped', 'stopped', 'failed', 'registered'] as const).map((id) => ({
      id,
      label: id === 'published' ? 'Published' : bucketLabel(id as BuildBucket),
      count: id === 'published' ? archive.filter((b) => b.publishedSlug || b.projectSlug).length : archive.filter((b) => bucketFor(b) === id).length,
    })),
  ]);
  const archiveVisible = $derived(
    archive.filter((b) =>
      archiveFilter === 'all' ? true : archiveFilter === 'published' ? Boolean(b.publishedSlug || b.projectSlug) : bucketFor(b) === archiveFilter,
    ),
  );
  const formatDay = (value: string | Date) =>
    new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  /** A repo build's page already lives in the repo; only its card is missing. */
  const promoteKind = (b: ArchiveRow): 'app' | 'repo' =>
    laneOf({ origin: b.origin, gitTargetConfig: b.gitTargetConfig } as Parameters<typeof laneOf>[0]) === 'repo' ? 'repo' : 'app';
  /**
   * A card names a page in THIS repo, so only a build that targets this repo can
   * have one. The Forge is a repo build too — it drives the game repo — and the
   * card detector reads a /projects route out of an SR-Main pull request, so
   * offering the button there could only ever produce a card pointing at a page
   * that does not exist here.
   */
  const cardable = (b: ArchiveRow) => {
    const config = b.gitTargetConfig as { repoUrl?: unknown } | null;
    return typeof config?.repoUrl === 'string' && config.repoUrl.includes('SR-Main');
  };
  const canPromote = (b: ArchiveRow) =>
    !['queued', 'pending'].includes(b.status) &&
    (promoteKind(b) === 'repo' ? cardable(b) && !b.projectSlug : !b.publishedSlug);

  async function removeBuild(b: ArchiveRow) {
    // Deleting the row does not delete the files it published. Those live under
    // data/jkai-projects and are rsynced to the VPS, so a delete here would
    // leave a public page with nothing left in the database able to take it
    // down. Unpublish first; that is what unpublish is for.
    if (publishedLink(b.publishedSlug) && !publishedLink(b.publishedSlug)?.external) {
      notice = 'Unpublish this build before deleting it, or its published files stay on the site with nothing left to remove them.';
      return;
    }
    if (!confirm(`Delete "${b.title ?? b.id.slice(0, 8)}"? This also removes its saved lessons, which later builds in the same area read.`)) return;
    removing = b.id;
    try {
      const response = await fetch(`/api/jkai/builds/${b.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Delete failed');
      notice = 'Build deleted.';
      await invalidateAll();
    } catch {
      notice = 'Could not delete that build.';
    } finally {
      removing = null;
    }
  }

  async function unpublish(b: ArchiveRow) {
    if (!confirm(`Remove the published files for "${b.publishedSlug}"? The build itself is kept.`)) return;
    removing = b.id;
    try {
      const response = await fetch(`/api/jkai/builds/${b.id}/unpublish`, { method: 'POST' });
      notice = response.ok ? 'Unpublished.' : 'Could not unpublish that build; its files are still live.';
      if (response.ok) await invalidateAll();
    } catch {
      notice = 'Could not reach the server; the build is still published.';
    } finally {
      removing = null;
    }
  }

  async function copyLink(b: ArchiveRow) {
    const link = publishedLink(b.publishedSlug) ?? publishedLink(b.projectSlug);
    if (!link) return;
    const href = link.external ? link.href : `${location.origin}${link.href}`;
    try {
      await navigator.clipboard.writeText(href);
      notice = 'Link copied.';
    } catch {
      notice = href;
    }
  }
</script>

<svelte:head><title>Site development — Strange Ramblings</title></svelte:head>

<DaydreamShell
  path="/jkai/develop"
  kicker="JKAI · Pi site development"
  title={['What should the', 'site do next?']}
  standfirst="Describe an outcome and the model proposes acceptance criteria, dependencies and the questions it still has. You review the brief, guide the build, and try the result in an isolated preview. An autonomous run has a reviewer of its own and can carry a finished feature all the way to a pull request."
  readout={[
    { label: 'Portfolio', value: `${rows.length} features` },
    { label: 'In flight', value: String(inFlight) },
    { label: 'Archive', value: `${archive.length} builds` },
  ]}
  {tabs}
  active={lane}
  ontab={(id) => setLane(id as LaneTab)}
  footer={[
    'strangeramblings.com/jkai/develop · site development',
    '01 brief → 02 build → 03 checks → 04 preview → 05 accept → 06 release',
    'a release opens a pull request; CI decides whether it merges',
  ]}
>
  {#snippet masthead()}
    <StatDeck {tiles} dark min={196} />
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

      <details class="dv-fold" bind:open={advanced}>
        <summary>How far it may go on its own</summary>
        <div class="dv-adv">
          <label class="dv-field dv-narrow">
            <span class="dv-label">Where it stops</span>
            <select aria-label="Where it stops" bind:value={releasePolicy}>
              {#each RELEASE_POLICIES as value (value)}<option {value}>{RELEASE_POLICY_LABELS[value]}</option>{/each}
            </select>
          </label>
          <label class="dv-check">
            <input type="checkbox" bind:checked={autopilot} />
            <span>Run it on autopilot</span>
          </label>
          <label class="dv-field dv-narrow">
            <span class="dv-label">Round limit</span>
            <input type="number" aria-label="Round limit" min="1" max={AUTOPILOT_ROUNDS.max} bind:value={maxRounds} disabled={!autopilot} />
          </label>
        </div>
        <p class="dv-aside">
          On autopilot a reviewer model — not the one writing the code — judges each acceptance
          criterion against the browser evidence and the diff, sends the gaps back to the builder,
          and answers the builder's questions from your accepted brief. It stops and asks for you
          when the brief does not settle a question, when its round limit is reached, or when
          anything fails that a person should see. Releasing opens a pull request; merging stays
          with CI, and anything touching auth, secrets or the deploy path always waits for you.
        </p>
      </details>

      {#if error}<p role="alert" class="dv-error">{error}</p>{/if}

      <p class="dv-aside">
        Bigger pieces of work live in the epic backlog.
        <a href="/jkai/daydreams/backlog">Open the epic backlog →</a>
        <a class="dv-sep" href="/jkai/codegraph">What building this has already taught us →</a>
      </p>
    </div>
  </section>

  {#if lane === 'archive'}
    <section class="dv-sec dv-sec-last">
      <div class="dv-inner">
        <SectionHead
          kicker="03 / The archive"
          title={['Every build', 'before this']}
          strap="Sandbox apps, studio explainers, forge runs and change requests. This is where a finished build becomes a card on /projects, and where the record of what the builder actually manages is kept."
        />

        {#if lanes.some((l) => l.total > 0)}
          <!-- A horizontal scroller is unreachable by keyboard unless it can take
               focus, and this one is nine columns wide on a phone. -->
          <div class="dv-table-wrap" tabindex="0" role="region" aria-label="Delivery rate and iteration cost by lane">
            <table class="dv-table">
              <caption class="dv-caption">Delivery rate counts only builds that ran, and iterations are counted from the rows, never from the lossy column on the build.</caption>
              <thead>
                <tr><th scope="col">Lane</th><th scope="col">Ran</th><th scope="col">Delivered</th><th scope="col">PR open</th><th scope="col">Median iterations</th><th scope="col">Hit cap</th><th scope="col">Stopped</th><th scope="col">Published</th><th scope="col">Never ran</th></tr>
              </thead>
              <tbody>
                {#each lanes as row (row.lane)}
                  <tr>
                    <th scope="row">{row.lane === 'repo' ? 'Change request' : row.lane === 'app' ? 'Sandbox app' : 'Studio'}</th>
                    <td>{row.ran} / {row.total}</td>
                    <td>{row.successRate === null ? '—' : `${row.successRate}%`} <span class="dv-dim">({row.delivered})</span></td>
                    <td>{row.proposed}</td>
                    <td>{row.medianIterations ?? '—'}</td>
                    <td>{row.capped}</td>
                    <td>{row.stopped}</td>
                    <td>{row.published}</td>
                    <td>{row.neverRan}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}

        <div class="dv-facets">
          <FacetBar label="Ending" facets={archiveFacets} active={archiveFilter} onpick={(id) => (archiveFilter = id)} />
        </div>

        {#if notice}<p class="dv-note" role="status">{notice}</p>{/if}

        {#if !archiveVisible.length}
          <p class="dv-empty">Nothing in the archive with that ending.</p>
        {:else}
          <div class="dv-rows">
            {#each archiveVisible as b, i (b.id)}
              {@const bucket = bucketFor(b)}
              {@const published = publishedLink(b.publishedSlug)}
              {@const link = published ?? publishedLink(b.projectSlug)}
              <div class="dv-row dv-arch">
                <p class="dv-rank">{String(i + 1).padStart(2, '0')}</p>
                <div class="dv-cell">
                  <p class="dv-area-mark">{sourceOf(b)} · {formatDay(b.createdAt)}</p>
                  <p class="dv-title"><a class="dv-open" href={`/jkai/builds/${b.id}`}>{b.title ?? b.prompt.slice(0, 70)}</a></p>
                </div>
                <div class="dv-cell dv-outcome-cell">
                  <p class="dv-blurb">{b.prompt.slice(0, 180)}</p>
                  <p class="dv-acts">
                    {#if canPromote(b)}<button class="dv-act" onclick={() => (promoting = b)}>{promoteKind(b) === 'repo' ? 'Add card' : 'Promote'}</button>{/if}
                    {#if b.publishedSlug || b.projectSlug}
                      <button class="dv-act" onclick={() => (promoting = b)}>Edit card</button>
                      <button class="dv-act" onclick={() => copyLink(b)}>Copy link</button>
                    {/if}
                    {#if published && !published.external}
                      <button class="dv-act" disabled={removing === b.id} onclick={() => unpublish(b)}>Unpublish</button>
                    {/if}
                    <a class="dv-act" href={`/jkai/builds/${b.id}`}>Console</a>
                    <button class="dv-act dv-danger" disabled={removing === b.id} onclick={() => removeBuild(b)}>Delete</button>
                  </p>
                </div>
                <div class="dv-cell dv-status">
                  <span class="dv-pill tone-{bucket === 'delivered' ? 'good' : bucket === 'failed' ? 'urgent' : bucket === 'running' ? 'steady' : bucket === 'capped' || bucket === 'stopped' ? 'watch' : 'quiet'}">{bucketLabel(bucket)}</span>
                  <p class="dv-meta">{b.iterationCount} iteration{b.iterationCount === 1 ? '' : 's'}</p>
                  {#if link}<p class="dv-meta"><a href={link.href} target={link.external ? '_blank' : undefined} rel={link.external ? 'noopener noreferrer' : undefined}>{link.label} ↗</a></p>{/if}
                  {#if outcomeNote(bucket)}<p class="dv-meta dv-dim">{outcomeNote(bucket)}</p>{/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </section>
  {:else}
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
              {@const pilot = row.state.autopilot}
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
                  {#if pilot?.enabled && !pilot.stopReason}
                    <p class="dv-meta">autopilot · round {pilot.rounds}/{pilot.maxRounds}</p>
                  {:else if pilot?.stopReason}
                    <p class="dv-meta dv-dim">autopilot stopped</p>
                  {/if}
                  {#if row.state.release?.prUrl}
                    <p class="dv-meta">pull request open</p>
                  {/if}
                </div>
              </a>
            {/each}
          </div>
        {/if}
      </div>
    </section>
  {/if}
</DaydreamShell>

{#if promoting}
  <PromoteModal
    build={promoting}
    kind={promoteKind(promoting)}
    onClose={() => (promoting = null)}
    ondone={async () => { promoting = null; notice = 'Card saved.'; await invalidateAll(); }}
  />
{/if}

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
  .dv-narrow {
    max-width: 260px;
  }
  .dv-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .dv-form select,
  .dv-form textarea,
  .dv-adv select,
  .dv-adv input[type='number'] {
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

  /* ——— the advanced fold ——— */
  .dv-fold {
    border-top: 1px solid var(--line);
    padding: 12px 0 0;
    margin: 22px 0 0;
  }
  summary {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
    cursor: pointer;
  }
  summary:hover {
    color: var(--accent);
  }
  .dv-adv {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 22px;
    margin: 16px 0 0;
  }
  .dv-check {
    display: flex;
    align-items: center;
    gap: 9px;
    font-size: var(--fs-nav);
    color: var(--text-primary);
    padding-bottom: 11px;
  }
  .dv-check input {
    width: 17px;
    height: 17px;
    accent-color: var(--accent);
  }

  .dv-error {
    color: var(--error);
    font-size: var(--fs-nav);
    margin: 16px 0 0;
  }
  .dv-note {
    font-size: var(--fs-nav);
    color: var(--accent-ink);
    margin: 0 0 14px;
  }
  .dv-aside {
    font-size: var(--fs-nav);
    line-height: 1.55;
    color: var(--text-secondary);
    margin: 20px 0 0;
    max-width: 88ch;
  }
  .dv-aside a {
    color: var(--accent-ink);
  }
  .dv-sep {
    margin-left: 14px;
  }

  /* ——— the portfolio and the archive share the ledger ——— */
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
  .dv-arch:hover {
    background: var(--bg);
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
  .dv-open {
    color: inherit;
    text-decoration: none;
  }
  .dv-open:hover {
    color: var(--accent);
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
  .dv-acts {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    margin: 12px 0 0;
  }
  .dv-act {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent-ink);
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
    text-decoration: none;
  }
  .dv-act:hover:not(:disabled) {
    color: var(--accent);
  }
  .dv-act:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .dv-danger {
    color: var(--error);
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
  .dv-meta a {
    color: var(--accent-ink);
  }
  .dv-dim {
    color: var(--text-ghost);
  }

  /* ——— the performance table ——— */
  .dv-table-wrap {
    overflow-x: auto;
    margin: 0 0 26px;
    border: 1px solid var(--card-border);
    background: var(--bg);
  }
  .dv-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-nav);
  }
  .dv-caption {
    caption-side: bottom;
    text-align: left;
    padding: 10px 16px;
    font-size: var(--fs-label);
    color: var(--text-muted);
  }
  .dv-table th,
  .dv-table td {
    padding: 11px 16px;
    text-align: left;
    border-bottom: 1px solid var(--line-hair);
    white-space: nowrap;
  }
  .dv-table thead th {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
    font-weight: 400;
  }
  .dv-table tbody th {
    font-family: var(--font-display);
    font-size: var(--fs-label);
    text-transform: uppercase;
    font-weight: 400;
  }

  .dv-empty {
    font-size: var(--fs-body-sm);
    color: var(--text-secondary);
    margin: 0;
  }

  a:focus-visible,
  button:focus-visible,
  select:focus-visible,
  textarea:focus-visible,
  input:focus-visible,
  summary:focus-visible {
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
