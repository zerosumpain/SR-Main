<script lang="ts">
  // C (public) — THE RECORD. Every publicly-describable capability, grouped by
  // the day it went live.
  //
  // A reader thinks in days, not release ids, and the backfilled releases have
  // approximate timestamps anyway — so the day is the heading and the version
  // is a footnote on the row.
  //
  // The list is COMPLETE: no paging. This half of the page is an archive meant
  // to be read straight through and indexed, and the entrance is a pure CSS
  // animation rather than a scroll-reveal — an IntersectionObserver gate left
  // this page blank once, because at ~74,000px tall it never reached a 2%
  // threshold and no-JS visitors saw nothing at all.
  import { shortDate } from '$lib/releases/seam';
  import type { ShowcaseItem } from '$lib/releases/public';

  interface Props {
    items: ShowcaseItem[];
  }

  let { items }: Props = $props();

  const groups = $derived.by(() => {
    const by = new Map<string, ShowcaseItem[]>();
    for (const it of items) {
      const day = it.deployedAt.slice(0, 10);
      const list = by.get(day);
      if (list) list.push(it);
      else by.set(day, [it]);
    }
    return [...by.entries()].map(([day, group]) => ({ day, items: group }));
  });
</script>

<div class="cr">
  {#each groups as g, gi (g.day)}
    <section class="day" style="--i: {Math.min(gi, 12)}">
      <header class="day-hd">
        <h3 class="day-date">{shortDate(g.day)}</h3>
        <span class="day-year">{g.day.slice(0, 4)}</span>
        <span class="day-rule"></span>
        <span class="day-n">{g.items.length}</span>
      </header>
      <ul class="day-items">
        {#each g.items as item (item.title + item.version)}
          <li class="item">
            <span class="item-kind" data-kind={item.kind}>{item.kind}</span>
            <div class="item-body">
              <h4 class="item-title">{item.title}</h4>
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
    <p class="cr-empty">Nothing matches that filter.</p>
  {/each}
</div>

<style>
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
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0;
  }
  .day-year,
  .day-n {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    color: var(--text-ghost);
  }
  .day-n {
    font-variant-numeric: tabular-nums;
  }
  .day-rule {
    flex: 1;
    height: 1px;
    background: var(--line-hair);
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
    border-bottom: 1px solid var(--line-hair);
    position: relative;
    transition:
      background 0.2s ease-out,
      padding-left 0.2s ease-out;
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
      opacity 0.2s ease-out,
      transform 0.2s ease-out;
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
    font-size: var(--fs-label-xs);
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
    font-size: var(--fs-body-sm);
    font-weight: 600;
    line-height: 1.3;
    color: var(--text-primary);
    margin: 0;
    overflow-wrap: anywhere;
  }
  .item-sum {
    font-family: var(--font-body);
    font-size: var(--fs-label);
    line-height: 1.55;
    color: var(--text-muted);
    margin: 5px 0 0;
    /* Release summaries quote route paths and slugs, which are single
       unbreakable tokens. One of them was taking the whole page 92px sideways
       on a phone — the paragraph's box stayed 330px, so nothing showed up in a
       bounding-box audit; only the document's scrollWidth did. */
    overflow-wrap: anywhere;
  }
  .item-surfaces {
    margin: 7px 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
    color: var(--text-ghost);
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  /* A single route path can be longer than the column on a phone, and a flex
     item will not break mid-token on its own. */
  .item-surfaces a {
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--accent-ink);
    text-decoration: none;
    border-bottom: 1px solid transparent;
  }
  .item-surfaces a:hover {
    border-bottom-color: var(--accent-ink);
  }

  .cr-empty {
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    color: var(--text-muted);
  }

  /* A CSS-only entrance: it runs on load with no JS gate, so the page is
     readable without JavaScript. `both` holds the end state, and only the first
     dozen groups stagger — beyond that the reader has scrolled past the reveal
     anyway, and 200 delayed animations cost real frames. */
  .day {
    animation: day-in 0.4s ease-out both;
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
