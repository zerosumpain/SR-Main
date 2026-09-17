<svelte:head><title>Estate — Admin</title></svelte:head>
<script lang="ts">
  import { onMount } from 'svelte';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';
  import type { PageData } from './$types';
  import type { EstateEndpoint, EstateHost } from '$lib/estate/endpoints';
  import type { GateClass, RouteEntry } from '$lib/estate/api-surface.server';

  let { data }: { data: PageData } = $props();

  // Only the probe result changes after load. Everything else renders straight
  // from `data` — no prop→state sync effect, nothing to loop.
  let health = $state<Record<string, string>>(data.health);
  let lastAt = $state<number | null>(null);
  let refreshing = $state(false);
  // Plain let — never $state (svelte5-pitfalls rule 1: internal handle).
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  let tab = $state<'model' | 'estate' | 'surface'>('model');
  let query = $state('');
  let gateFilter = $state<'all' | GateClass>('all');

  // $derived, not const: a plain capture would freeze these at first load and
  // go stale the next time the page re-runs its loader (invalidate, or a
  // client-side navigation back to it) — reporting an exposure picture that is
  // no longer true, which is the one thing this page must not do.
  const surface = $derived(data.surface);
  const model = $derived(data.model);
  const byLayer = $derived.by(() => {
    const m = new Map<string, typeof model.nodes>();
    for (const n of model.nodes) {
      const list = m.get(n.layer);
      if (list) list.push(n);
      else m.set(n.layer, [n]);
    }
    return m;
  });
  /** Which repository builds each app, so the app rows can name it inline. */
  const appRepo = $derived(
    new Map(model.edges.filter((e) => e.kind === 'builds').map((e) => [e.to, e.from.slice('repo:'.length)])),
  );
  /** The queue lanes an app's own worker claims — the activity to repository link. */
  const appLanes = $derived.by(() => {
    const m = new Map<string, string[]>();
    for (const e of model.edges.filter((x) => x.kind === 'owns-worker')) {
      const list = m.get(e.from);
      if (list) list.push(e.to.slice('activity:'.length));
      else m.set(e.from, [e.to.slice('activity:'.length)]);
    }
    return m;
  });
  const endpoints = $derived(data.endpoints as EstateEndpoint[]);
  const publicUnauth = $derived(new Set(data.findings.publicUnauthenticated));

  const filteredRoutes = $derived.by(() => {
    if (!surface.available) return [] as RouteEntry[];
    const q = query.trim().toLowerCase();
    return surface.routes.filter(
      (r) =>
        (gateFilter === 'all' || r.gate === gateFilter) &&
        (!q || r.path.toLowerCase().includes(q)),
    );
  });

  const probed = $derived(endpoints.filter((e) => e.probeId));
  // Count 'up' explicitly rather than "not down". `unknown` means the probe did
  // not apply on this host (the WhatsApp bridge is VPS-loopback) or could not
  // authenticate — folding that into the healthy number is how a dashboard ends
  // up reporting full health while something is unwatched.
  const upCount = $derived(probed.filter((e) => health[e.probeId as string] === 'up').length);
  const downCount = $derived(probed.filter((e) => health[e.probeId as string] === 'down').length);
  const unknownCount = $derived(probed.length - upCount - downCount);

  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      const res = await fetch('/api/admin/estate/probe');
      if (res.ok) {
        const body = await res.json();
        health = body.health;
        lastAt = body.at;
      }
    } catch {
      /* transient — keep the last known status */
    } finally {
      refreshing = false;
    }
  }

  function agoLabel(at: number | null): string {
    if (!at) return 'live on load';
    const s = Math.round((Date.now() - at) / 1000);
    return s < 5 ? 'just now' : `${s}s ago`;
  }

  function statusOf(e: EstateEndpoint): string {
    if (!e.probeId) return 'static';
    return health[e.probeId] ?? 'unknown';
  }

  /** Pill colour. 'static' means "not probed", which must not read as healthy. */
  function statusState(s: string): string {
    if (s === 'up') return 'ok';
    if (s === 'degraded') return 'warn';
    if (s === 'down') return 'error';
    return 'idle';
  }

  function exposureState(e: EstateEndpoint): string {
    if (publicUnauth.has(e.id)) return 'error';
    return e.exposure === 'public' ? 'warn' : 'idle';
  }

  function gateState(g: GateClass): string {
    if (g === 'open') return 'warn';
    if (g === 'self-gated') return 'info';
    return 'idle';
  }

  onMount(() => {
    pollTimer = setInterval(refresh, 20000);
    return () => {
      if (pollTimer) clearInterval(pollTimer);
    };
  });
</script>

<PageWrap width="wide">
  <PageHeader
    kicker="Estate"
    title="Endpoints"
    sub="Every URL across the estate and what stands in front of it — the site, both home boxes, porkserv and the external consoles — plus the site's own HTTP surface as the auth gate actually classifies it."
  >
    {#snippet actions()}
      <span class="upd">updated {agoLabel(lastAt)}</span>
      <button class="nm-save-btn" onclick={refresh} disabled={refreshing}>
        {refreshing ? 'Probing…' : 'Refresh'}
      </button>
    {/snippet}
  </PageHeader>

  <!-- ---------------------------------------------------------- analysis -->
  <section class="nm-sec">
    <div class="nm-sec-hd"><span class="sr-label-tight">Analysis</span></div>
    <div class="grid">
      <div class="tile">
        <span class="k">Catalogued</span>
        <span class="v">{endpoints.length} endpoints</span>
        <span class="s">{probed.length} live-probed</span>
      </div>
      <div class="tile">
        <span class="k">Reachable now</span>
        <span class="v" class:warn={downCount > 0} class:ok={downCount === 0 && unknownCount === 0}>
          {upCount} / {probed.length}
        </span>
        <span class="s">
          {downCount > 0 ? `${downCount} not answering` : 'all probes answering'}{unknownCount > 0
            ? ` · ${unknownCount} not applicable here`
            : ''}
        </span>
      </div>
      <div class="tile">
        <span class="k">Monitored</span>
        <span class="v" class:warn={data.findings.unmonitored.length > 0}>
          {endpoints.length - data.findings.unmonitored.length} / {endpoints.length}
        </span>
        <span class="s">everything else fails silently</span>
      </div>
      <div class="tile">
        <span class="k">Site surface</span>
        <span class="v">
          {surface.available ? `${surface.counts.api} API · ${surface.counts.page} pages` : 'unavailable'}
        </span>
        <span class="s">
          {surface.available
            ? `${surface.counts.open} open · ${surface.counts.selfGated} self-gated`
            : 'route tree not readable'}
        </span>
      </div>
    </div>

    {#if publicUnauth.size > 0}
      <p class="finding error">
        <strong>{publicUnauth.size}</strong>
        endpoint{publicUnauth.size === 1 ? '' : 's'} reachable from the open internet with no
        authentication in front. Each one is listed below with an
        <span class="mono">exposed</span> flag.
      </p>
    {:else}
      <p class="finding ok">
        No endpoint is both internet-facing and unauthenticated. The public entries that look like
        exceptions each carry a stated reason.
      </p>
    {/if}

    <p class="finding warn">
      The uptime monitor watches <strong>2</strong> URLs — the site root and
      <span class="mono">/api/landing/vitals</span>. Everything else in this catalogue can fail
      without anyone being told, including AdGuard, which takes LAN name resolution down with it.
    </p>

    {#if surface.available}
      <p class="note">
        Surface {surface.source}, and classified by the same
        <span class="mono">isPublicPath</span> the gate calls plus the bypass list the CI
        public-surface lockfile reads. It travels inside the build that serves it, so it cannot
        drift from the running code — a runtime scan of <span class="mono">src/</span> would read
        a stale tree on the VPS, where that directory is a leftover the deploy does not update.
      </p>
    {:else}
      <p class="finding error">Site surface unavailable — {surface.reason}</p>
    {/if}
  </section>

  <!-- -------------------------------------------------------------- tabs -->
  <div class="nm-tabs" role="tablist">
    <button
      class="nm-tab" class:active={tab === 'model'} role="tab"
      aria-selected={tab === 'model'} onclick={() => (tab = 'model')}
    >
      Model <span class="nm-tab-count">{model.nodes.length}</span>
    </button>
    <button
      class="nm-tab" class:active={tab === 'estate'} role="tab"
      aria-selected={tab === 'estate'} onclick={() => (tab = 'estate')}
    >
      Estate <span class="nm-tab-count">{endpoints.length}</span>
    </button>
    <button
      class="nm-tab" class:active={tab === 'surface'} role="tab"
      aria-selected={tab === 'surface'} onclick={() => (tab = 'surface')}
    >
      Site surface
      <span class="nm-tab-count">{surface.available ? surface.routes.length : 0}</span>
    </button>
  </div>

  {#if tab === 'model'}
    <!--
      The model tab. Everything here is assembled from a feed that regenerates
      itself; the ledger below says which, and what it could not read. The two
      hand-written catalogues in the other tabs are what this replaces.
    -->
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Where this comes from</span>
        <span class="nm-pill">{model.ledger.length} feeds</span>
      </div>
      <div class="nm-table-scroll">
        <table class="nm-table">
          <thead>
            <tr><th>Feed</th><th>Describes</th><th>Refreshes</th><th class="num">Nodes</th><th>Kind</th></tr>
          </thead>
          <tbody>
            {#each model.ledger as l (l.feed)}
              <tr>
                <td class="mono">{l.feed}</td>
                <td>{l.describes}{#if l.asOf}<span class="asof"> · as of {l.asOf}</span>{/if}</td>
                <td class="dim">{l.refresh}</td>
                <td class="num">
                  {#if l.count === null}<span class="blind">not read</span>{:else}{l.count}{/if}
                </td>
                <td><span class="prov" data-p={l.provenance}>{l.provenance}</span></td>
              </tr>
              {#if l.error}
                <tr class="why"><td></td><td colspan="4">{l.error}</td></tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    {#if model.findings.length}
      <section class="nm-sec">
        <div class="nm-sec-hd">
          <span class="sr-label-tight">What does not line up</span>
          <span class="nm-pill" data-state="failed">{model.findings.length}</span>
        </div>
        <ul class="findings">
          {#each model.findings as f (f.title)}
            <li data-sev={f.severity}>
              <div class="f-t">{f.title}</div>
              <div class="f-d">{f.detail}</div>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Applications · repositories · the lanes they own</span>
        <span class="nm-pill">{(byLayer.get('app') ?? []).length}</span>
      </div>
      <div class="nm-table-scroll">
        <table class="nm-table">
          <thead>
            <tr><th>App</th><th>Repository</th><th>Status</th><th>Paths</th><th>Owns lane</th><th>Ports</th></tr>
          </thead>
          <tbody>
            {#each byLayer.get('app') ?? [] as n (n.id)}
              <tr>
                <td class="mono">{n.label}</td>
                <td class="mono dim">{appRepo.get(n.id) ?? '—'}</td>
                <td>
                  <span class="prov" data-p={n.warning ? 'declared' : 'generated'}>{n.facts?.status}</span>
                </td>
                <td class="mono dim">{n.facts?.paths || '—'}</td>
                <td class="mono">{(appLanes.get(n.id) ?? []).join(' ') || '—'}</td>
                <td class="mono dim">{n.facts?.['release dir'] ?? '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="note">
        cloudflared is first-match, so the ingress order is behaviour rather than presentation:
        <span class="mono">{model.nodes.find((n) => n.id === 'edge:cloudflared')?.facts?.['match order']}</span>.
        Main is last, deliberately — it is the fallback that keeps a half-finished extraction safe.
      </p>
    </section>

    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Runtime</span>
        <span class="nm-pill">{(byLayer.get('container') ?? []).length}</span>
      </div>
      {#if (byLayer.get('container') ?? []).length === 0}
        <div class="nm-empty">
          Nothing probed from here. These ports bind 127.0.0.1 on the release host, so a reading
          taken anywhere else could only say "closed" — which would read as "down" rather than
          "not here".
        </div>
      {:else}
        <div class="nm-table-scroll">
          <table class="nm-table">
            <thead><tr><th>Process</th><th class="num">Port</th><th>Serving</th></tr></thead>
            <tbody>
              {#each byLayer.get('container') ?? [] as n (n.id)}
                <tr>
                  <td class="mono">{n.label}</td>
                  <td class="num">{n.facts?.port}</td>
                  <td>
                    <span class="prov" data-p={n.facts?.serving ? 'generated' : 'declared'}>
                      {n.facts?.serving ? 'yes' : n.warning}
                    </span>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>
  {:else if tab === 'estate'}
    {#each data.groups as [host, items] (host)}
      <section class="nm-sec">
        <div class="nm-sec-hd">
          <span class="sr-label-tight">{data.hostLabels[host as EstateHost]}</span>
        </div>
        <div class="nm-table-scroll">
          <table class="nm-table">
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>Address</th>
                <th>Exposure</th>
                <th>Auth</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {#each items as e (e.id)}
                <tr>
                  <td>
                    {#if e.url}
                      <a class="link" href={e.url} target="_blank" rel="noreferrer noopener">{e.label} ↗</a>
                    {:else}
                      {e.label}
                    {/if}
                    <div class="sub">{e.note}</div>
                    {#if e.exposureNote}<div class="sub reason">{e.exposureNote}</div>{/if}
                    <div class="sub cfg"><span class="cfg-k">configured in</span> {e.configuredIn}</div>
                  </td>
                  <td class="mono nowrap">{e.address ?? e.url}</td>
                  <td>
                    <span class="nm-pill" data-state={exposureState(e)}>{e.exposure}</span>
                    {#if publicUnauth.has(e.id)}
                      <span class="nm-pill" data-state="error">exposed</span>
                    {/if}
                  </td>
                  <td class="mono">{e.auth}</td>
                  <td>
                    <span class="nm-pill" data-state={statusState(statusOf(e))}>{statusOf(e)}</span>
                    {#if e.monitored}<span class="nm-pill" data-state="ok">monitored</span>{/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/each}
  {:else if surface.available}
    <section class="nm-sec">
      <div class="nm-sec-hd"><span class="sr-label-tight">Site surface</span></div>
      <div class="filters">
        <input
          class="nm-text-input" type="search" placeholder="Filter by path…"
          bind:value={query} aria-label="Filter routes by path"
        />
        {#each [['all', 'All'], ['open', 'Open'], ['self-gated', 'Self-gated'], ['owner', 'Owner-only']] as [val, label] (val)}
          <button
            class="nm-tab" class:active={gateFilter === val}
            onclick={() => (gateFilter = val as 'all' | GateClass)}
          >
            {label}
          </button>
        {/each}
        <span class="count">{filteredRoutes.length} shown</span>
      </div>
      <div class="nm-table-scroll">
        <table class="nm-table">
          <thead>
            <tr>
              <th>Path</th>
              <th>Kind</th>
              <th>Methods</th>
              <th>Gate</th>
              <th>Guard</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredRoutes as r (r.kind + r.path)}
              <tr>
                <td class="mono">{r.path}</td>
                <td class="mono small">{r.kind}</td>
                <td class="mono small">{r.methods.join(' ') || '—'}</td>
                <td><span class="nm-pill" data-state={gateState(r.gate)}>{r.gate}</span></td>
                <td class="small guard">{r.guard ?? 'owner session'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if filteredRoutes.length === 0}
        <p class="nm-empty">No route matches that filter.</p>
      {/if}
    </section>
  {/if}
</PageWrap>

<style>
  .upd {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    align-self: center;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr));
    gap: 0.75rem;
    margin-bottom: 1rem;
  }
  .tile {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.7rem 0.8rem;
    border: 1px solid var(--border-subtle, rgba(26, 16, 8, 0.14));
    border-radius: 2px;
    min-width: 0;
  }
  .k {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .v { font-size: 0.95rem; color: var(--text-primary); }
  .v.ok { color: var(--success); }
  .v.warn { color: var(--warn); }
  .s { font-size: 0.78rem; color: var(--text-muted); }
  .finding {
    margin: 0 0 0.5rem;
    font-size: 0.85rem;
    line-height: 1.5;
    color: var(--text-secondary);
    padding-left: 0.7rem;
    border-left: 2px solid var(--text-ghost);
  }
  .finding.error { border-left-color: var(--error); }
  .finding.warn { border-left-color: var(--warn); }
  .finding.ok { border-left-color: var(--success); }
  .note {
    margin: 0.75rem 0 0;
    font-size: 0.78rem;
    line-height: 1.5;
    color: var(--text-muted);
  }
  .filters {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
    margin-bottom: 0.75rem;
  }
  .filters .nm-text-input { min-width: 16rem; max-width: 320px; }
  .count {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    margin-left: auto;
  }
  .sub {
    font-size: 0.78rem;
    line-height: 1.4;
    color: var(--text-muted);
    margin-top: 0.2rem;
    max-width: 46ch;
  }
  .sub.reason { color: var(--text-ghost); font-style: italic; }
  .sub.cfg { font-family: var(--font-mono); color: var(--text-ghost); }
  .cfg-k { text-transform: uppercase; letter-spacing: 0.08em; font-size: var(--fs-label-xs); }
  .mono { font-family: var(--font-mono); font-size: max(0.82em, var(--fs-label-xs)); }

  /* ── the model tab ─────────────────────────────────────────────────────
     Provenance is the one thing this tab must encode in form as well as
     words: a reader scanning it should be able to see, without reading, how
     much of the page regenerates itself and how much is somebody's memory. */
  .prov {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 0.1rem 0.4rem;
    white-space: nowrap;
  }
  .prov[data-p='generated'] { background: color-mix(in srgb, var(--success) 14%, transparent); color: var(--success); }
  .prov[data-p='observed']  { background: color-mix(in srgb, var(--accent-ink) 14%, transparent); color: var(--accent-ink); }
  .prov[data-p='declared']  { background: color-mix(in srgb, var(--warn) 16%, transparent); color: var(--warn); }
  .blind { color: var(--warn); font-style: italic; }
  .asof { color: var(--text-ghost); }
  .dim { color: var(--text-muted); }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .why td {
    color: var(--text-muted);
    font-size: 0.78rem;
    line-height: 1.5;
    padding-top: 0;
    border-top: 0;
  }
  .findings { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
  .findings li {
    padding: 0.6rem 0.75rem;
    border-left: 3px solid var(--warn);
    background: var(--surface-2, transparent);
  }
  .findings li[data-sev='high'] { border-left-color: var(--error); }
  .findings li[data-sev='low'] { border-left-color: var(--text-ghost); }
  .f-t { font-weight: 600; font-size: 0.86rem; }
  .f-d { font-size: 0.78rem; line-height: 1.5; color: var(--text-muted); margin-top: 0.25rem; }
  .small { font-size: 0.78rem; }
  .nowrap { white-space: nowrap; }
  /* The guard sentence is the longest cell on the row; let it wrap rather than
     run off the right edge, where the reason a route is open goes unread. */
  .guard { white-space: normal; max-width: 34ch; line-height: 1.4; }
  .link { color: var(--accent); text-decoration: none; }
  .link:hover { text-decoration: underline; }
</style>
