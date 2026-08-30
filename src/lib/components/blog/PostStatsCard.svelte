<script lang="ts" module>
  /**
   * The Umami half of the card, exported so the loader that assembles it has a
   * name to build against rather than an inline shape it can silently get wrong.
   *
   * `available` is the load-bearing field and it CANNOT be inferred from the
   * numbers — see the long note in the instance script.
   */
  export type UmamiWindow = { pageviews: number; visitors: number };
  export type UmamiDaily = { date: string; count: number };
  export type UmamiReferrer = { name: string; count: number };

  export type UmamiBlock = {
    available: boolean;
    /** The windowed figure. Named `30d` historically; the window is `days`. */
    stats30d: UmamiWindow;
    statsLifetime: UmamiWindow;
    /** Bucketed Europe/London by the client. NOT comparable to `reads.daily`. */
    daily: UmamiDaily[];
    referrers: UmamiReferrer[];
  };
</script>

<script lang="ts">
  /**
   * Per-post reader statistics. Purely presentational: it fetches nothing,
   * holds no state, and every figure arrives as a prop.
   *
   * ─── WHY THIS COMPONENT EXISTS ───────────────────────────────────────────
   *
   * "UNAVAILABLE" AND "ZERO" ARE DIFFERENT, and the data cannot tell them
   * apart on its own. `src/lib/umami/client.ts` swallows every failure — a
   * dead container, a 401, a DNS miss, a JSON body that changed shape — and
   * returns `{ pageviews: 0, visitors: 0 }` / `[]` from the catch. So a broken
   * analytics integration and a post nobody has opened produce byte-identical
   * payloads. A row of confident zeros over a broken integration is a lie the
   * reader has no way to detect, and it is the failure this card is built to
   * prevent: when there is no working source, it says so in words instead.
   *
   * That is why `available` must be decided by the LOADER from configuration
   * and a successful call — never re-derived here from whether the numbers are
   * zero, which would collapse the two states again. Umami is production-only;
   * the env vars do not exist on the dev box, so `available: false` is the
   * NORMAL state locally and must not read as an outage either. `reads === null`
   * is the same distinction for the first-party side: null means the beacons
   * were not queried, `reads.reads === 0` means they were and nobody read it.
   */
  // A runtime import, not just a type. $lib/blog/analytics is pure since the
  // queries moved to ./analytics.server — it imports nothing at all, so it
  // carries no $env/dynamic/private into the client graph.
  import { formatDwell, type ReadStats } from '$lib/blog/analytics';

  let {
    umami,
    reads,
    days = 30,
  }: { umami: UmamiBlock | null; reads: ReadStats | null; days?: number } = $props();


  // An em dash rather than a 0 for a value that is not a number: the whole
  // point of the card is that a figure it prints is a figure it stands behind.
  function num(n: number): string {
    return Number.isFinite(n) ? Math.round(n).toLocaleString('en-GB') : '—';
  }

  // `completionRate` and `bounceRate` arrive as 0–1 fractions; `medianScrollPct`
  // arrives already scaled 0–100. Two different conventions in one type, so the
  // conversion happens at the call site and not inside a shared helper that
  // would have to guess.
  function pct(fraction: number): string {
    return Number.isFinite(fraction) ? `${Math.round(fraction * 100)}%` : '—';
  }

  const hasReads = $derived(reads !== null && reads.reads > 0);

  // Umami is only "empty" when its LIFETIME count is zero as well. A post can
  // legitimately have no traffic in the last `days` and years of it before
  // that, and calling that "no pageviews" would be wrong in the same direction
  // as the zeros this component exists to avoid.
  const umamiLive = $derived(umami !== null && umami.available);
  const hasUmami = $derived(
    umamiLive &&
      (umami!.statsLifetime.pageviews > 0 ||
        umami!.stats30d.pageviews > 0 ||
        umami!.daily.length > 0),
  );

  // ─── Sparkline ───────────────────────────────────────────────────────────
  // Inline SVG, one polyline, one colour, no axes and no library. It answers
  // "was this a spike or a trickle", nothing more; anything that needs a real
  // axis needs a real chart on a page of its own.
  const SPARK_W = 240;
  const SPARK_H = 30;
  const SPARK_PAD = 2; // keeps a 1.5px stroke off the viewBox edge at the peak

  function sparkPoints(values: number[]): string | null {
    const xs = values.map((v) => (Number.isFinite(v) ? Math.max(0, v) : 0));
    // Two points make a line; one makes a dot nobody can read a trend from, and
    // dividing by (length - 1) at length 1 is a division by zero.
    if (xs.length < 2) return null;
    // A flat all-zero series would divide by zero and then render as NaN in the
    // points attribute, which most browsers drop silently — a missing chart
    // rather than a flat one. Floored at 1 so it draws along the baseline.
    const span = Math.max(...xs) || 1;
    const stepX = SPARK_W / (xs.length - 1);
    const usable = SPARK_H - SPARK_PAD * 2;
    return xs
      .map((v, i) => `${(i * stepX).toFixed(1)},${(SPARK_H - SPARK_PAD - (v / span) * usable).toFixed(1)}`)
      .join(' ');
  }

  // The two series are bucketed on DIFFERENT day boundaries — Umami hard-codes
  // `timezone=Europe/London` in `getDailyViews`, the first-party summariser
  // keys on a UTC date. Through British Summer Time they disagree by an hour,
  // so overlaying them moves traffic across a boundary and invents a dip on the
  // day of a clock change. They are drawn as two separate lines, each captioned
  // with its own timezone, and they are never summed or averaged together.
  const readsSpark = $derived(reads ? sparkPoints(reads.daily.map((d) => d.reads)) : null);
  const umamiSpark = $derived(umami ? sparkPoints(umami.daily.map((d) => d.count)) : null);

  const devices = $derived(reads?.byDevice ?? []);

  // Normalised to one shape so a single snippet renders both lists. `host` and
  // `name` are the same thing under two names; the counts are not — see the
  // captions.
  const readReferrers = $derived(
    (reads?.topReferrers ?? []).map((r) => ({ label: r.host, count: r.reads })),
  );
  const umamiReferrers = $derived(
    (umami?.referrers ?? []).map((r) => ({ label: r.name, count: r.count })),
  );
</script>

{#snippet spark(points: string | null, zone: string, what: string)}
  <div class="spark-wrap">
    {#if points}
      <svg
        class="spark"
        viewBox="0 0 {SPARK_W} {SPARK_H}"
        preserveAspectRatio="none"
        role="img"
        aria-label="Daily {what} over the last {days} days, bucketed {zone}"
      >
        <!-- non-scaling-stroke: preserveAspectRatio="none" stretches the
             viewBox horizontally, which would otherwise squash the stroke into
             a hairline at one end and a slab at the other. -->
        <polyline points={points} vector-effect="non-scaling-stroke" />
      </svg>
    {:else}
      <p class="muted-note">Not enough days to plot.</p>
    {/if}
    <p class="src-caption">Daily {what} · days bucketed {zone}</p>
  </div>
{/snippet}

{#snippet referrers(rows: { label: string; count: number }[], caption: string)}
  {#if rows.length > 0}
    <h4 class="sub-label">Referrers</h4>
    <ul class="ref-list">
      {#each rows as r (r.label)}
        <li class="ref-row">
          <span class="ref-host">{r.label}</span>
          <span class="ref-count">{num(r.count)}</span>
        </li>
      {/each}
    </ul>
    <p class="src-caption">{caption}</p>
  {/if}
{/snippet}

<section class="nm-sec">
  <div class="nm-sec-hd">
    <h2 class="sr-label-tight">Readers</h2>
    <span class="nm-sec-meta">Last {days} days</span>
  </div>

  <!-- ─── First-party beacon ─────────────────────────────────────────────── -->
  <div class="src-block">
    <h3 class="sr-label-tight">Reads</h3>

    {#if reads === null}
      <!-- Not queried. Distinct from "queried and found nothing", below. -->
      <p class="muted-note">Reading figures were not loaded for this post.</p>
    {:else if !hasReads}
      <p class="muted-note">No reads recorded yet.</p>
      <p class="src-caption">
        First-party beacon · a session that reached the article and stayed
      </p>
    {:else}
      <div class="tiles">
        <div class="tile">
          <div class="tile-figure">{num(reads.reads)}</div>
          <div class="tile-label">Reads</div>
        </div>

        <!-- MEDIAN is the headline and the mean is a footnote, on purpose.
             Dwell is long-tailed: one tab left open through a lunch break
             outweighs twenty honest two-minute reads and drags the mean
             somewhere no reader has ever been. The mean is still shown,
             because the GAP between the two is the signal. -->
        <div
          class="tile"
          title="Dwell is long-tailed — a single tab left open outweighs twenty honest reads and drags the mean somewhere nobody actually sat. The median is the honest figure; the mean is shown because the gap between them is what tells you there is a tail."
        >
          <div class="tile-figure">{formatDwell(reads.medianDwellMs)}</div>
          <div class="tile-label">Median dwell</div>
          <div class="tile-note">mean {formatDwell(reads.meanDwellMs)}</div>
        </div>

        <div class="tile">
          <div class="tile-figure">{pct(reads.completionRate)}</div>
          <div class="tile-label">Completed</div>
        </div>
        <div class="tile">
          <div class="tile-figure">{num(reads.medianScrollPct)}%</div>
          <div class="tile-label">Median scroll</div>
        </div>
        <div class="tile">
          <div class="tile-figure">{pct(reads.bounceRate)}</div>
          <div class="tile-label">Bounced</div>
          <div class="tile-note">brief and shallow</div>
        </div>
      </div>

      <p class="src-caption">
        First-party beacon · sessions that reached the article and stayed, one row per session
      </p>

      {#if devices.length > 0}
        <!-- 'unknown' is a real bucket, not a tidy-up: a beacon that fired
             before the viewport was measured lands there, so watching it climb
             is how a broken beacon announces itself. -->
        <p class="dev-line">
          {#each devices as d, i (d.deviceClass)}{i > 0 ? ' · ' : ''}{d.deviceClass}
            {num(d.reads)} ({formatDwell(d.medianDwellMs)}){/each}
        </p>
      {/if}

      {@render spark(readsSpark, 'UTC', 'reads')}
      {@render referrers(readReferrers, 'Referrers of sessions that stayed · direct traffic is excluded')}
    {/if}
  </div>

  <!-- ─── Umami ──────────────────────────────────────────────────────────── -->
  <div class="src-block">
    <h3 class="sr-label-tight">Pageviews</h3>

    {#if !umamiLive}
      <!-- Production-only integration. On the dev box the env vars simply do
           not exist, so this is the expected state here and is worded as a
           configuration fact rather than as an error. -->
      <p class="muted-note">Umami is not configured here — no pageview figures for this post.</p>
    {:else if !hasUmami}
      <p class="muted-note">No pageviews recorded yet.</p>
      <p class="src-caption">Umami · every load of the post's URL</p>
    {:else}
      <div class="tiles">
        <div class="tile">
          <div class="tile-figure">{num(umami!.stats30d.pageviews)}</div>
          <div class="tile-label">Pageviews</div>
          <div class="tile-note">last {days} days</div>
        </div>
        <div class="tile">
          <div class="tile-figure">{num(umami!.stats30d.visitors)}</div>
          <div class="tile-label">Visitors</div>
          <div class="tile-note">last {days} days</div>
        </div>
        <div class="tile">
          <div class="tile-figure">{num(umami!.statsLifetime.pageviews)}</div>
          <div class="tile-label">Pageviews</div>
          <div class="tile-note">lifetime</div>
        </div>
        <div class="tile">
          <div class="tile-figure">{num(umami!.statsLifetime.visitors)}</div>
          <div class="tile-label">Visitors</div>
          <div class="tile-note">lifetime</div>
        </div>
      </div>

      <!-- The two blocks WILL disagree and neither is broken. Umami counts
           every load of the URL, including bots it has not filtered and the
           bounce that left before the beacon's first tick; the beacon counts
           sessions that reached the article and stayed. Pageviews above reads
           is the normal, expected shape. -->
      <p class="src-caption">
        Umami · every load of the post's URL, including visits that left immediately
      </p>

      {@render spark(umamiSpark, 'Europe/London', 'pageviews')}
      {@render referrers(umamiReferrers, 'Referrers of pageviews · not the same denominator as the reads above')}
    {/if}
  </div>
</section>

<style>
  /* Mirrors the admin section chrome rather than relying on admin.css: Svelte
     scopes these styles to this component, and the card should render the same
     wherever it is mounted, not only under the /admin layout. */
  .nm-sec {
    background: var(--surface-sunken);
    border: 1px solid var(--line-strong);
    padding: 1rem 1.1rem 1.15rem;
    margin-bottom: 1.25rem;
  }
  .nm-sec-hd {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    margin-bottom: 0.9rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--line-strong);
  }
  .sr-label-tight {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
    margin: 0;
  }
  .nm-sec-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    margin-left: auto;
  }

  /* One block per source. The rule between them is the visual claim that these
     are two different measurements, not one running total. */
  .src-block + .src-block {
    margin-top: 1.25rem;
    padding-top: 1.1rem;
    border-top: 1px solid var(--line-strong);
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
    gap: 0.5rem;
    margin: 0.75rem 0 0.6rem;
  }
  .tile {
    border: 1px solid var(--line-strong);
    background: var(--surface-elevated);
    padding: 0.65rem 0.7rem;
  }
  .tile-figure {
    font-family: var(--font-display);
    font-size: 1.5rem;
    line-height: 1.05;
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
  }
  .tile-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-muted);
    margin-top: 0.3rem;
  }
  .tile-note {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    margin-top: 0.15rem;
    line-height: 1.3;
  }

  /* The caption under each block is the whole answer to "why don't these two
     numbers match", so it is body-legible rather than fine print. */
  .src-caption {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    line-height: 1.45;
    margin: 0.35rem 0 0;
  }
  .muted-note {
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    color: var(--text-muted);
    margin: 0.75rem 0 0;
  }
  .sub-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-muted);
    margin: 0.9rem 0 0.35rem;
  }
  .dev-line {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    margin: 0.5rem 0 0;
    line-height: 1.5;
  }

  .spark-wrap {
    margin-top: 0.9rem;
  }
  .spark {
    display: block;
    width: 100%;
    height: 30px;
    overflow: visible;
  }
  .spark polyline {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.5;
    stroke-linejoin: round;
    stroke-linecap: round;
  }

  .ref-list {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--line-hair);
  }
  .ref-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.3rem 0;
    border-bottom: 1px solid var(--line-hair);
  }
  .ref-host {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-secondary);
    overflow-wrap: anywhere;
  }
  .ref-count {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
    flex-shrink: 0;
  }
</style>
