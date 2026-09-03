<script lang="ts">
  /**
   * The one top nav bar. Every page that wears chrome wears this.
   *
   * The strip is a row of CELLS divided by hairlines — the grammar
   * `.site-nav-bar` has always used — read left to right:
   *
   *   [⌂] [← jkai] [ Intel ] [ MAIL NOTES REVIEW … ] ········· [ right slot ]
   *
   * The two new cells are the first two, and they are what the rest of the site
   * was missing:
   *
   *  * HOME is an icon, always first, on every page. It was previously a mono
   *    `HOME` cell sitting second, behind the title — present on the 58 pages
   *    that used PageHeader and absent from the other 150.
   *  * BACK is its own cell, one level up. It used to be done by re-purposing
   *    the title cell as a link (`titleHref`), which made one cell mean both
   *    "you are here" and "go up" — legible on /blog/[slug], not legible
   *    anywhere else. Where it points is `parentHref()`; nothing here decides.
   *
   * Everything is on the INK ground (`.site-nav-bar` is `background:
   * var(--text-primary)`), so every colour in here is written for a dark
   * ground: `--bg` for cream text, `--accent-on-dark` for the accent (plain
   * `--accent` scores 2.6:1 on #1a1008), and cream-alpha for the hairlines.
   */
  import type { Snippet } from 'svelte';
  import { currentPath } from '$lib/nav/page-path';
  import {
    activeSection,
    isItemActive,
    navCellsFor,
    parentHref,
    parentLabel,
    visibleItems,
    type NavItem,
  } from '$lib/nav/site-nav';

  let {
    title,
    items,
    isOwner = true,
    showBack = true,
    meta,
    before,
    right,
  }: {
    /** The section cell. Defaults to the manifest's name for this section. */
    title?: string;
    /** Sub-nav override. Defaults to the manifest's items for this section. */
    items?: NavItem[];
    /** Signed-out visitors are never offered a cell that would 302 to /login. */
    isOwner?: boolean;
    showBack?: boolean;
    /** Small metadata beside the section cell (counts, sync status). */
    meta?: Snippet;
    /** Rendered before the home icon — a mobile menu toggle, say. */
    before?: Snippet;
    /** The far right of the strip: live signal, meters, actions. */
    right?: Snippet;
  } = $props();

  const path = $derived(currentPath());
  const section = $derived(activeSection(path));
  const sectionLabel = $derived(title ?? section?.label ?? null);
  const sectionHref = $derived(section?.rootHref ?? null);
  const backHref = $derived(showBack ? parentHref(path) : null);
  const backLabel = $derived(backHref ? parentLabel(path) : null);
  const cells = $derived(
    items ? visibleItems(items, isOwner) : navCellsFor(path, isOwner),
  );
  const atHome = $derived(path === '/');

  /**
   * The section cell is dropped when the back cell already points at it.
   * `/jkai/intel/mail` has "← Intel" one level up AND "Intel" as its section:
   * two adjacent cells, one destination. The back cell wins — it carries the
   * same word and it is the affordance the brief asked for.
   */
  const showTitle = $derived(!!sectionLabel && sectionHref !== backHref);

  /**
   * A cell that would bounce a signed-out visitor off the auth gate is not a
   * link. `/jkai/shared/<token>` is public and its section is jkai, so the
   * title cell was an <a href="/jkai"> pointed straight at /login.
   */
  const titleIsLink = $derived(
    !!sectionHref && path !== sectionHref && (isOwner || !section?.ownerOnly),
  );
</script>

<header class="site-nav-bar" data-site-header>
  {#if before}
    <div class="hdr-before">{@render before()}</div>
  {/if}

  <!-- Top-left on every page. An icon, not a word: it is the one destination
       that never needs naming, and the width it gives back is what lets the
       section's own cells fit on a phone. -->
  <a
    href="/"
    class="hdr-home"
    aria-label="Home"
    aria-current={atHome ? 'page' : undefined}
    title="Home"
  >
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
      <path
        d="M2 7.2 8 2.2l6 5M3.4 6v7.3h9.2V6"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="square"
        stroke-linejoin="miter"
      />
    </svg>
  </a>

  {#if backHref}
    <a class="hdr-back" href={backHref} title="Back to {backLabel}">
      <span class="back-arrow" aria-hidden="true">←</span>
      <span class="back-word">{backLabel}</span>
    </a>
  {/if}

  {#if showTitle}
    {#if titleIsLink}
      <a href={sectionHref} class="brand hdr-title" title={sectionLabel}>{sectionLabel}</a>
    {:else}
      <span class="brand hdr-title" title={sectionLabel}>{sectionLabel}</span>
    {/if}
  {/if}

  {#if meta}
    <div class="hdr-meta">{@render meta()}</div>
  {/if}

  {#if cells.length}
    <nav class="hdr-cells" aria-label="{sectionLabel ?? 'Site'} sections">
      {#each cells as item (item.href + item.label)}
        <a
          href={item.href}
          class="nav-cell"
          aria-current={isItemActive(item, path) ? 'page' : undefined}
        >
          {item.label}
        </a>
      {/each}
    </nav>
  {:else}
    <div class="hdr-spacer"></div>
  {/if}

  {#if right}
    <div class="hdr-right">{@render right()}</div>
  {/if}
</header>

<style>
  /* Every cell shares one shape: full-height, hairline on the right, mono
     label. The differences below are only what each cell says. */
  .hdr-home,
  .hdr-back,
  .hdr-title,
  .hdr-meta,
  .hdr-before,
  .nav-cell {
    display: inline-flex;
    align-items: center;
    flex: none;
    border-right: 1px solid rgba(237, 228, 212, 0.14);
    text-decoration: none;
    white-space: nowrap;
  }

  .hdr-home {
    padding: 0 14px;
    color: rgba(237, 228, 212, 0.72);
    transition: color 0.2s var(--ease-out), background 0.2s var(--ease-out);
  }
  .hdr-home:hover {
    color: var(--bg);
    background: rgba(237, 228, 212, 0.07);
  }
  /* Cut out of the strip, like any other current cell. */
  .hdr-home[aria-current='page'] {
    color: var(--text-primary);
    background: var(--bg);
    box-shadow: inset 0 -2px 0 var(--accent);
  }
  .hdr-home svg {
    display: block;
  }

  .hdr-back {
    gap: 7px;
    padding: 0 14px;
    font-family: var(--font-code);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: rgba(237, 228, 212, 0.62);
    transition: color 0.2s var(--ease-out), background 0.2s var(--ease-out);
  }
  .hdr-back:hover {
    color: var(--accent-on-dark);
    background: rgba(237, 228, 212, 0.07);
  }
  .back-arrow {
    font-size: var(--fs-label);
    line-height: 1;
  }

  .hdr-title {
    min-width: 0;
    max-width: min(45vw, 420px);
    margin: 0;
    padding: 0 18px;
    font-size: var(--fs-body-sm);
    line-height: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--bg);
    transition: color 0.2s var(--ease-out);
  }
  a.hdr-title:hover {
    color: var(--accent-on-dark);
  }

  .hdr-meta {
    display: none;
    padding: 0 16px;
    min-width: 0;
  }

  .hdr-cells {
    display: flex;
    align-items: stretch;
    min-width: 0;
    flex: 1;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .hdr-cells::-webkit-scrollbar {
    display: none;
  }
  .hdr-spacer {
    flex: 1;
    min-width: 0;
  }

  .nav-cell {
    padding: 0 15px;
    font-family: var(--font-code);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: rgba(237, 228, 212, 0.62);
    transition: color 0.2s var(--ease-out), background 0.2s var(--ease-out);
  }
  .nav-cell:hover {
    color: var(--bg);
    background: rgba(237, 228, 212, 0.07);
  }
  /* The current cell is cut out of the band: page ground behind it and an
     accent seam on its bottom edge. "You are stood here", without a filled
     block shouting it. */
  .nav-cell[aria-current='page'] {
    color: var(--text-primary);
    background: var(--bg);
    box-shadow: inset 0 -2px 0 var(--accent);
  }

  .hdr-right {
    display: inline-flex;
    align-items: center;
    flex: none;
    padding: 0 16px;
    border-left: 1px solid rgba(237, 228, 212, 0.14);
    gap: 12px;
    min-width: 0;
  }

  @media (min-width: 768px) {
    .hdr-meta {
      display: inline-flex;
    }
  }

  /* Phone: the back cell keeps its arrow and drops its word, and the section
     cell tightens. The sub-nav keeps scrolling rather than collapsing into a
     menu — the cells ARE the wayfinding, and a burger hides exactly the thing
     this bar exists to show. */
  @media (max-width: 640px) {
    .back-word {
      display: none;
    }
    .hdr-back,
    .hdr-home {
      padding: 0 12px;
    }
    .hdr-title {
      padding: 0 12px;
      max-width: 38vw;
    }
    .hdr-right {
      padding: 0 12px;
    }
  }
</style>
