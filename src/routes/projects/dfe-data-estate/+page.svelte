<script lang="ts">
  import type { PageData } from './$types';
  import { SERVICES, TIERS, OPEN_API_COUNT, type Tier } from './lib/services';
  import StatCard from './components/StatCard.svelte';
  import ServiceCard from './components/ServiceCard.svelte';
  import Provenance from './components/Provenance.svelte';
  import SiteHeader from '$lib/components/SiteHeader.svelte';
  import { page } from '$app/state';

  let { data }: { data: PageData } = $props();
  const estate = $derived(data.estate);

  // ── catalogue filters ──────────────────────────────────────────────────────
  let tier = $state<'all' | Tier>('all');
  let openOnly = $state(false);

  const FILTERS: { id: 'all' | Tier; label: string }[] = [
    { id: 'all', label: 'All' },
    ...TIERS.map((t) => ({ id: t.id, label: t.label }))
  ];

  const shown = $derived(
    SERVICES.filter((s) => (tier === 'all' || s.tier === tier) && (!openOnly || s.hasOpenApi))
  );
  const groups = $derived(
    TIERS.map((t) => ({ ...t, items: shown.filter((s) => s.tier === t.id) })).filter(
      (g) => g.items.length > 0
    )
  );

  const liveCount = $derived(estate.stats.filter((s) => s.live).length);

  function fmtDateTime(iso: string): string {
    try {
      return new Date(iso).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/London'
      });
    } catch {
      return iso;
    }
  }
  function fmtDate(iso: string | null): string {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      });
    } catch {
      return iso;
    }
  }
</script>

<svelte:head>
  <title>The Data Estate — DfE's Public Data Services</title>
  <meta
    name="description"
    content="A live, fact-checked map of the Department for Education's public-facing data services — GIAS, Explore Education Statistics, performance tables, Teaching Vacancies and more — with where each one's data comes from, how often it refreshes, who owns it, and what's open. Six widgets call the real DfE APIs."
  />
  <meta property="og:title" content="The Data Estate — DfE's Public Data Services" />
  <meta
    property="og:description"
    content="Every public-facing DfE data service: source, refresh, owner, and API status — with six live calls to the real open DfE APIs."
  />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://strangeramblings.com/projects/dfe-data-estate" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link
    rel="stylesheet"
    href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=DM+Sans:wght@400;500&family=JetBrains+Mono:wght@400;500;600&display=swap"
  />
</svelte:head>

<SiteHeader isOwner={page.data?.isOwner !== false} />

<div class="page">
  <div class="paper-grain" aria-hidden="true"></div>

  <header class="head">
    <span class="tagline">DfE · Public data services · England</span>
    <h1>The Data Estate</h1>
    <p class="sub">
      The Department for Education runs a sprawl of public-facing services that share and aggregate
      data — a school register, a statistics platform, performance tables, finance benchmarking, jobs
      and training APIs, and a secure tier for pupil-level records. This is a map of all of it: where
      each service's data comes from, how often it refreshes, who owns it, and what's actually open.
    </p>
    <p class="meta-line">
      <b>{SERVICES.length}</b> services · <b>{OPEN_API_COUNT}</b> with a genuinely-open API ·
      <b>{liveCount}/{estate.stats.length}</b> signals live · read
      {estate.fetchedAt ? fmtDateTime(estate.fetchedAt) : ''}
    </p>
  </header>

  <!-- ── Live signals ───────────────────────────────────────────────────────── -->
  <section class="band">
    <div class="band-hd">
      <h2>Live signals</h2>
      <p>Fetched server-side, just now, from the real open DfE APIs — cached 30 minutes.</p>
    </div>
    <div class="stat-grid">
      {#each estate.stats as stat (stat.id)}
        <StatCard {stat} />
      {/each}
    </div>
  </section>

  <!-- ── Live publications feed ─────────────────────────────────────────────── -->
  <section class="band">
    <div class="band-hd">
      <h2>The statistics pipeline, live</h2>
      <p>
        Every DfE statistical publication on Explore Education Statistics, newest first — pulled live
        from <a href="https://api.education.gov.uk/statistics/v1/publications" target="_blank" rel="noopener">
          /v1/publications</a
        >.
        {#if !estate.publicationsLive}<span class="warn">(API unreachable — showing a cached sample.)</span>{/if}
      </p>
    </div>
    <ol class="feed">
      {#each estate.publications as pub (pub.slug)}
        <li>
          <a href={pub.url} target="_blank" rel="noopener" class="feed-title">{pub.title}</a>
          <span class="feed-date">{fmtDate(pub.lastPublished)}</span>
        </li>
      {/each}
    </ol>
  </section>

  <!-- ── The catalogue ──────────────────────────────────────────────────────── -->
  <section class="band">
    <div class="band-hd">
      <h2>The catalogue</h2>
      <p>All {SERVICES.length} services, grouped by who can reach the data.</p>
    </div>

    <div class="filters">
      <div class="chips" role="group" aria-label="Filter by tier">
        {#each FILTERS as f (f.id)}
          <button class:active={tier === f.id} onclick={() => (tier = f.id)}>{f.label}</button>
        {/each}
      </div>
      <button class="toggle" class:on={openOnly} onclick={() => (openOnly = !openOnly)}>
        <i></i> Open API only
      </button>
    </div>

    {#each groups as group (group.id)}
      <div class="group">
        <div class="group-hd tier-{group.id}">
          <h3>{group.label}</h3>
          <span class="count">{group.items.length}</span>
          <p>{group.blurb}</p>
        </div>
        <div class="card-grid">
          {#each group.items as service (service.key)}
            <ServiceCard {service} />
          {/each}
        </div>
      </div>
    {/each}

    {#if shown.length === 0}
      <p class="empty">No services match that filter.</p>
    {/if}
  </section>

  <!-- ── Provenance ─────────────────────────────────────────────────────────── -->
  <section class="band">
    <div class="band-hd">
      <h2>How the data flows</h2>
      <p>From the returns schools file, to the surfaces the public can read.</p>
    </div>
    <Provenance />
  </section>

  <!-- ── Method & caveats ───────────────────────────────────────────────────── -->
  <footer class="foot">
    <details class="method" open>
      <summary>Method &amp; caveats</summary>
      <ul>
        <li>
          Each <b>live signal</b> is fetched server-side from the named public API and cached for 30
          minutes. If a source is unreachable, the card falls back to a <b>snapshot</b> taken on the
          date shown — the value is real, just not refreshed this load.
        </li>
        <li>
          The "schools in England" figure comes from the <b>Explore Education Statistics</b> data-set
          query API, not GIAS: the GIAS bulk-CSV endpoint is currently returning HTTP 500. It counts
          schools in the Jan-2026 census (state-funded, independent and special/AP), England only —
          not a real-time UK-wide establishment count.
        </li>
        <li>
          <b>Ofsted</b> is included because it inspects schools, but it is a separate non-ministerial
          department, not part of the DfE.
        </li>
        <li>
          Compare School &amp; College Performance and the Financial Benchmarking tool publish
          <b>bulk downloads, not APIs</b>; the National Pupil Database, ASP and GIAP hold pupil-level
          data and are <b>restricted</b>. Every figure was checked against primary gov.uk sources
          (June 2026); services and cadences change.
        </li>
      </ul>
    </details>
    <p class="ogl">
      Contains public sector information licensed under the
      <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/" target="_blank" rel="noopener">Open Government Licence v3.0</a>.
    </p>
    <p class="foot-disc">
      The Data Estate · <code>/projects/dfe-data-estate</code> · a reference map, not an official DfE
      product. Live data correct as of {estate.fetchedAt ? fmtDateTime(estate.fetchedAt) : 'this load'}.
    </p>
  </footer>
</div>

<style>
  :global(body) {
    margin: 0;
  }
  .page {
    --paper: var(--bg);
    --paper-deep: var(--surface-elevated);
    --ink: var(--text-primary);
    --ink-soft: var(--text-muted);
    position: relative;
    min-height: 100vh;
    background: radial-gradient(ellipse 90% 50% at 50% 0%, rgba(255, 255, 255, 0.4), transparent 60%),
      var(--paper);
    color: var(--ink);
    font-family: var(--font-body);
    overflow-x: hidden;
  }
  .paper-grain {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    opacity: 0.5;
    mix-blend-mode: multiply;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.18  0 0 0 0 0.14  0 0 0 0 0.10  0 0 0 0.07 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
  }

  .head {
    position: relative;
    z-index: 1;
    max-width: 1180px;
    margin: 0 auto;
    padding: 24px 28px 18px;
    border-bottom: 1px solid rgba(28, 22, 17, 0.1);
  }
  .tagline {
    display: block;
    margin-top: 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.22em;
    color: var(--accent);
    text-transform: uppercase;
  }
  h1 {
    font-family: var(--fs-serif);
    font-weight: 600;
    font-size: clamp(30px, 5.5vw, 52px);
    line-height: 0.98;
    letter-spacing: -0.025em;
    margin: 6px 0 10px;
  }
  .sub {
    margin: 0;
    font-size: var(--fs-nav);
    line-height: 1.55;
    color: var(--ink-soft);
    max-width: 74ch;
  }
  .meta-line {
    margin: 12px 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.02em;
    color: rgba(28, 22, 17, 0.55);
  }
  .meta-line b {
    color: var(--accent);
    font-weight: 600;
  }

  .band {
    position: relative;
    z-index: 1;
    max-width: 1180px;
    margin: 0 auto;
    padding: 24px 28px;
    border-bottom: 1px solid rgba(28, 22, 17, 0.08);
  }
  .band-hd {
    margin-bottom: 16px;
  }
  .band-hd h2 {
    margin: 0;
    font-family: var(--fs-serif);
    font-weight: 600;
    font-size: 22px;
    letter-spacing: -0.01em;
  }
  .band-hd p {
    margin: 4px 0 0;
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--ink-soft);
    max-width: 80ch;
  }
  .band-hd a {
    color: var(--accent);
    text-decoration: none;
    border-bottom: 1px dashed currentColor;
  }
  .warn {
    color: var(--error);
  }

  .stat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    gap: 12px;
  }

  /* publications feed */
  .feed {
    margin: 0;
    padding: 0;
    list-style: none;
    column-count: 2;
    column-gap: 28px;
  }
  .feed li {
    break-inside: avoid;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 0;
    border-bottom: 1px dotted rgba(28, 22, 17, 0.16);
  }
  .feed-title {
    font-size: var(--fs-label);
    line-height: 1.35;
    color: var(--ink);
    text-decoration: none;
  }
  .feed-title:hover {
    color: var(--accent);
  }
  .feed-date {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: rgba(28, 22, 17, 0.5);
    white-space: nowrap;
  }

  /* catalogue filters */
  .filters {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 18px;
  }
  .chips {
    display: inline-flex;
    background: rgba(28, 22, 17, 0.06);
    padding: 3px;
    border-radius: var(--radius-sharp);
    flex-wrap: wrap;
  }
  .chips button {
    background: transparent;
    border: none;
    color: var(--ink);
    padding: 6px 12px;
    border-radius: var(--radius-sharp);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    cursor: pointer;
  }
  .chips button.active {
    background: var(--ink);
    color: var(--paper);
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    background: rgba(255, 255, 255, 0.4);
    border: 1px solid rgba(28, 22, 17, 0.2);
    color: var(--ink-soft);
    padding: 6px 11px;
    border-radius: var(--radius-sharp);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    cursor: pointer;
  }
  .toggle i {
    width: 9px;
    height: 9px;
    border-radius: var(--radius-pill);
    border: 1px solid rgba(28, 22, 17, 0.4);
  }
  .toggle.on {
    color: var(--accent);
    border-color: var(--accent);
  }
  .toggle.on i {
    background: var(--accent);
    border-color: var(--accent);
  }

  .group {
    margin-bottom: 22px;
  }
  .group-hd {
    --tier: var(--success);
    display: grid;
    grid-template-columns: auto auto 1fr;
    align-items: baseline;
    gap: 10px;
    padding-bottom: 8px;
    margin-bottom: 12px;
    border-bottom: 1px solid rgba(28, 22, 17, 0.1);
  }
  .group-hd.tier-open { --tier: var(--success); }
  .group-hd.tier-secure { --tier: var(--error); }
  .group-hd.tier-gateway { --tier: var(--accent-ink); }
  .group-hd h3 {
    margin: 0;
    font-family: var(--fs-serif);
    font-weight: 600;
    font-size: var(--fs-body);
    color: var(--tier);
  }
  .group-hd .count {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--paper);
    background: var(--tier);
    padding: 1px 7px;
    border-radius: var(--radius-pill);
  }
  .group-hd p {
    margin: 0;
    font-size: var(--fs-label-xs);
    line-height: 1.4;
    color: var(--ink-soft);
  }
  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
    gap: 12px;
    align-items: start;
  }
  .empty {
    font-size: var(--fs-label);
    color: var(--ink-soft);
  }

  .foot {
    position: relative;
    z-index: 1;
    max-width: 1180px;
    margin: 0 auto;
    padding: 22px 28px 40px;
  }
  .method summary {
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-soft);
    padding: 4px 0;
  }
  .method summary:hover {
    color: var(--accent);
  }
  .method ul {
    margin: 10px 0 4px;
    padding-left: 18px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
    gap: 8px 22px;
    list-style: square;
  }
  .method li {
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    color: rgba(28, 22, 17, 0.7);
  }
  .method b {
    color: var(--ink);
  }
  .ogl {
    margin: 16px 0 0;
    font-size: var(--fs-label-xs);
    color: rgba(28, 22, 17, 0.55);
  }
  .ogl a {
    color: var(--accent);
    text-decoration: none;
    border-bottom: 1px dashed currentColor;
  }
  .foot-disc {
    margin: 8px 0 0;
    font-size: var(--fs-label-xs);
    line-height: 1.55;
    color: rgba(28, 22, 17, 0.5);
  }
  .foot-disc code {
    background: rgba(28, 22, 17, 0.06);
    padding: 1px 5px;
    border-radius: var(--radius-sharp);
    font-family: var(--font-mono);
  }

  @media (max-width: 720px) {
    .feed {
      column-count: 1;
    }
    .group-hd {
      grid-template-columns: auto auto;
      row-gap: 4px;
    }
    .group-hd p {
      grid-column: 1 / -1;
    }
  }
</style>
