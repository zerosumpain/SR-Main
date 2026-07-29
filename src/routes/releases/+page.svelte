<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import { shortDate } from '$lib/releases/seam';

  let { data } = $props();

  // Group by deploy day — a reader thinks in days, not in release ids, and the
  // backfilled releases have approximate timestamps anyway.
  const groups = $derived.by(() => {
    const by = new Map<string, typeof data.items>();
    for (const it of data.items) {
      const day = it.deployedAt.slice(0, 10);
      const list = by.get(day);
      if (list) list.push(it);
      else by.set(day, [it]);
    }
    return [...by.entries()].map(([day, items]) => ({ day, items }));
  });

  function fmt(n: number): string {
    return n.toLocaleString('en-GB');
  }
  function year(iso: string): string {
    return iso.slice(0, 4);
  }

  // No scroll-reveal here on purpose. The entrance is a pure CSS animation
  // (see .day below) so the list is readable with JavaScript disabled — an
  // IntersectionObserver gate would leave a fully server-rendered page blank
  // for anyone without JS, and this list is ~74,000px tall, which is itself
  // below a 2% intersection threshold at any normal viewport height.
</script>

<svelte:head>
  <title>Shipped · Strange Ramblings</title>
  <meta
    name="description"
    content="Every production deploy of strangeramblings.com — {fmt(data.totals.releases)} releases and {fmt(data.totals.shipped)} shipped capabilities, generated from the deployed commit range."
  />
  <meta property="og:title" content="Shipped · Strange Ramblings" />
  <meta
    property="og:description"
    content="{fmt(data.totals.releases)} releases over {data.totals.days} days, and what each one put live."
  />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://strangeramblings.com/releases" />
</svelte:head>

<PageHeader title="strange ramblings" titleHref="/" />

<main class="rel-wrap">
  <header class="rel-hd">
    <span class="rel-eyebrow">Shipped</span>
    <h1 class="rel-title">The record</h1>
    <p class="rel-strap">
      Every production deploy of this site, summarised into the distinct things it put live.
      Generated from the deployed commit range — not written by hand.
    </p>

    <dl class="rel-stats">
      <div><dt>Releases</dt><dd>{fmt(data.totals.releases)}</dd></div>
      <div><dt>Shipped</dt><dd>{fmt(data.totals.shipped)}</dd></div>
      <div><dt>Commits</dt><dd>{fmt(data.totals.commits)}</dd></div>
      <div><dt>Lines added</dt><dd>{fmt(data.totals.insertions)}</dd></div>
      <div><dt>Days</dt><dd>{fmt(data.totals.days)}</dd></div>
    </dl>

    <nav class="rel-filters" aria-label="Filter by kind">
      <a class="chip" class:on={data.kind === 'all'} href="/releases">All</a>
      {#each data.kindMix as k (k.kind)}
        <a class="chip" class:on={data.kind === k.kind} href="/releases?kind={k.kind}">
          {k.kind}<span class="chip-n">{k.count}</span>
        </a>
      {/each}
    </nav>
  </header>

  <div class="rel-list">
    {#each groups as g, gi (g.day)}
      <section class="day" style="--i: {Math.min(gi, 12)}">
        <header class="day-hd">
          <h2 class="day-date">{shortDate(g.day)}</h2>
          <span class="day-year">{year(g.day)}</span>
          <span class="day-rule"></span>
          <span class="day-n">{g.items.length}</span>
        </header>
        <ul class="day-items">
          {#each g.items as item (item.title + item.version)}
            <li class="item">
              <span class="item-kind" data-kind={item.kind}>{item.kind}</span>
              <div class="item-body">
                <h3 class="item-title">{item.title}</h3>
                <p class="item-sum">{item.summary}</p>
                {#if item.surfaces.length}
                  <p class="item-surfaces">
                    {#each item.surfaces.slice(0, 5) as s, si (s)}
                      {#if s.startsWith('/')}
                        <a href={s}>{s}</a>
                      {:else}
                        <span>{s}</span>
                      {/if}{#if si < Math.min(item.surfaces.length, 5) - 1}<span class="dot">·</span>{/if}
                    {/each}
                  </p>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {:else}
      <p class="rel-empty">Nothing matches that filter.</p>
    {/each}
  </div>

  <footer class="rel-foot">
    <p>
      Internal infrastructure work, and anything touching a private project, is recorded but not
      listed here. Most of these releases were reconstructed from git history, so their timestamps
      are approximate.
    </p>
    <a class="back" href="/"><span aria-hidden="true">←</span> Back to the front</a>
  </footer>
</main>

<style>
  .rel-wrap {
    max-width: 1000px;
    margin: 0 auto;
    padding: 48px 24px 80px;
    box-sizing: border-box;
  }
  @media (min-width: 768px) {
    .rel-wrap {
      padding-left: 64px;
      padding-right: 64px;
    }
  }

  .rel-eyebrow {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.22em;
    color: var(--accent);
  }
  .rel-title {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: clamp(38px, 8vw, 72px);
    line-height: 0.92;
    letter-spacing: -0.03em;
    color: var(--text-primary);
    margin: 10px 0 0;
  }
  .rel-strap {
    font-family: var(--font-body);
    font-size: 15px;
    line-height: 1.55;
    color: var(--text-secondary);
    border-left: 3px solid var(--accent);
    padding-left: 14px;
    margin: 18px 0 0;
    max-width: 60ch;
  }

  .rel-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 26px;
    margin: 26px 0 0;
    padding: 16px 0 0;
    border-top: 1px solid var(--divider);
  }
  .rel-stats div {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .rel-stats dt {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }
  .rel-stats dd {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 26px;
    line-height: 1;
    letter-spacing: -0.02em;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  .rel-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
    margin-top: 24px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 5px 11px;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-pill);
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
    text-decoration: none;
    transition:
      border-color var(--t-base) var(--ease-out),
      color var(--t-base) var(--ease-out),
      background var(--t-base) var(--ease-out);
  }
  .chip:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .chip.on {
    border-color: var(--accent);
    background: var(--accent-tint-14);
    color: var(--accent);
  }
  .chip-n {
    font-variant-numeric: tabular-nums;
    color: var(--text-ghost);
  }
  .chip.on .chip-n {
    color: var(--accent);
  }

  .rel-list {
    margin-top: 40px;
  }

  .day {
    margin-bottom: 30px;
  }
  .day-hd {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 12px;
  }
  .day-date {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0;
  }
  .day-year {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.14em;
    color: var(--text-ghost);
  }
  .day-rule {
    flex: 1;
    height: 1px;
    background: var(--divider);
  }
  .day-n {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
    font-variant-numeric: tabular-nums;
  }

  .day-items {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .item {
    display: grid;
    grid-template-columns: 6.2rem 1fr;
    gap: 14px;
    padding: 13px 12px 13px 0;
    border-bottom: 1px solid var(--divider);
    position: relative;
    transition:
      background var(--t-base) var(--ease-out),
      padding-left var(--t-base) var(--ease-out);
  }
  /* The brand `>` gesture, same as FeatureIndex's rows. */
  .item::before {
    content: '>';
    position: absolute;
    left: 0;
    top: 13px;
    color: var(--accent);
    font-family: var(--font-brand);
    opacity: 0;
    transform: translateX(-6px);
    transition:
      opacity var(--t-base) var(--ease-out),
      transform var(--t-base) var(--ease-out);
  }
  .item:hover {
    background: var(--accent-tint-04);
    padding-left: 18px;
  }
  .item:hover::before {
    opacity: 0.8;
    transform: translateX(5px);
  }

  .item-kind {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--text-ghost);
    padding-top: 3px;
  }
  .item-kind[data-kind='feature'] {
    color: var(--accent);
  }
  .item-body {
    min-width: 0;
  }
  .item-title {
    font-family: var(--font-body);
    font-size: 15px;
    font-weight: 600;
    line-height: 1.3;
    color: var(--text-primary);
    margin: 0;
  }
  .item-sum {
    font-family: var(--font-body);
    font-size: 13.5px;
    line-height: 1.55;
    color: var(--text-muted);
    margin: 5px 0 0;
    max-width: 74ch;
  }
  .item-surfaces {
    margin: 7px 0 0;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.04em;
    color: var(--text-ghost);
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .item-surfaces a {
    color: var(--accent-ink);
    text-decoration: none;
    border-bottom: 1px solid transparent;
  }
  .item-surfaces a:hover {
    border-bottom-color: var(--accent-ink);
  }
  .item-surfaces .dot {
    color: var(--text-ghost);
  }

  .rel-empty {
    font-family: var(--font-body);
    color: var(--text-muted);
  }

  .rel-foot {
    margin-top: 48px;
    padding-top: 20px;
    border-top: 2px solid var(--card-border);
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 24px;
    flex-wrap: wrap;
  }
  .rel-foot p {
    font-family: var(--font-mono);
    font-size: 9.5px;
    line-height: 1.6;
    color: var(--text-ghost);
    margin: 0;
    max-width: 66ch;
  }
  .back {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent);
    text-decoration: none;
    white-space: nowrap;
    border-bottom: 1px solid transparent;
    transition: border-color var(--t-base) var(--ease-out);
  }
  .back:hover {
    border-bottom-color: var(--accent);
  }

  /* A CSS-only entrance: it runs on load with no JS gate, so the page is
     readable without JavaScript. `both` holds the end state, and only the first
     dozen groups stagger — beyond that the reader has scrolled past the reveal
     anyway, and 200 delayed animations cost real frames. */
  .day {
    animation: day-in 0.4s var(--ease-out) both;
    animation-delay: calc(var(--i) * 35ms);
  }
  @keyframes day-in {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (max-width: 600px) {
    .item {
      grid-template-columns: 1fr;
      gap: 3px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .day {
      animation: none;
    }
  }
</style>
