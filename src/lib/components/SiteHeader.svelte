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
   * ground: `--chrome-ink` for cream text (an app with a night theme defines it;
   * without it the fallback is `--bg`, cream on the paper theme), `--accent-on-dark` for the accent (plain
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
    reach = [],
    signedIn = true,
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
    /** Pages a member's permissions open: their owner-only cells stay. */
    reach?: readonly string[];
    /** Signed out on the home page, the home cell becomes "Sign in". */
    signedIn?: boolean;
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
    items ? visibleItems(items, isOwner, reach) : navCellsFor(path, isOwner, reach),
  );
  /** Cells that open a menu sit after the strip, outside its scroller, so the menu can drop below the bar. */
  const stripCells = $derived(cells.filter((c) => !c.children?.length));
  const menuCells = $derived(cells.filter((c) => c.children?.length));

  /**
   * Which menu is open. A mouse opens it by hovering the cell; the caret opens
   * it for a touch screen or a keyboard. Leaving with the mouse closes it after
   * a beat, so the trip from the cell down into the menu does not drop it.
   */
  let openMenu = $state<string | null>(null);
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  function hoverOpen(e: PointerEvent, href: string) {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(closeTimer);
    openMenu = href;
  }
  function hoverClose(e: PointerEvent) {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => (openMenu = null), 180);
  }
  function toggleMenu(href: string) {
    clearTimeout(closeTimer);
    openMenu = openMenu === href ? null : href;
  }
  // Moving to another page closes it.
  $effect(() => {
    void path;
    openMenu = null;
  });
  function onWindowKey(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !openMenu) return;
    const caret = document.querySelector<HTMLElement>(`[data-menu-caret="${openMenu}"]`);
    openMenu = null;
    caret?.focus();
  }
  function onWindowPointer(e: PointerEvent) {
    if (!openMenu) return;
    const t = e.target as Element | null;
    if (!t?.closest('[data-hdr-menu]')) openMenu = null;
  }

  const atHome = $derived(path === '/');
  /**
   * On the home page the home icon points at the page you are already on, and
   * a signed-out visitor sees none of the gated sections — so nothing on the
   * site says there is anything to sign in to. There, and only there, the
   * cell becomes the way in.
   */
  const showSignIn = $derived(atHome && !signedIn);

  /**
   * The section cell is dropped when the back cell already points at it.
   * `/jkai/intel/sources` has "← Intel" one level up AND "Intel" as its section:
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
    !!sectionHref && path !== sectionHref && (isOwner || !section?.ownerOnly || reach.includes(sectionHref)),
  );
</script>

<svelte:window onkeydown={onWindowKey} onpointerdown={onWindowPointer} />

<header class="site-nav-bar" data-site-header>
  {#if before}
    <div class="hdr-before">{@render before()}</div>
  {/if}

  <!-- Top-left on every page. An icon, not a word: it is the one destination
       that never needs naming, and the width it gives back is what lets the
       section's own cells fit on a phone. -->
  {#if showSignIn}
    <a href="/login" class="hdr-home hdr-signin" title="Sign in">Sign in</a>
  {:else}
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
  {/if}

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
      <div class="hdr-strip">
        {#each stripCells as item (item.href + item.label)}
          <a
            href={item.href}
            data-sveltekit-reload={item.href.startsWith('/projects/policy-analysis') ? true : undefined}
            class="nav-cell"
            aria-current={isItemActive(item, path) ? 'page' : undefined}
          >
            {item.label}
          </a>
        {/each}
      </div>
      {#each menuCells as item (item.href + item.label)}
        {@const open = openMenu === item.href}
        {@const menuId = `hdr-menu-${item.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
        <div
          class="hdr-menu"
          class:open
          class:here={isItemActive(item, path)}
          data-hdr-menu
          role="presentation"
          onpointerenter={(e) => hoverOpen(e, item.href)}
          onpointerleave={hoverClose}
        >
          <a href={item.href} class="menu-cell" aria-current={path === item.href ? 'page' : undefined}>
            {item.label}
          </a>
          <button
            type="button"
            class="menu-caret"
            data-menu-caret={item.href}
            aria-expanded={open}
            aria-controls={menuId}
            aria-label="More in {item.label}"
            onclick={() => toggleMenu(item.href)}
          >
            <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
              <path d="M1.5 3.5 5 7l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.4" />
            </svg>
          </button>
          {#if open}
            <ul class="menu" id={menuId}>
              {#each item.children ?? [] as row (row.href)}
                <li>
                  <a
                    href={row.href}
                    class="menu-row"
                    aria-current={isItemActive(row, path) ? 'page' : undefined}
                    onclick={() => (openMenu = null)}
                  >
                    <span class="menu-label">{row.label}</span>
                    {#if row.meta}<span class="menu-meta">{row.meta}</span>{/if}
                  </a>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
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
    color: var(--chrome-ink, var(--bg));
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
  .hdr-signin {
    font-family: var(--font-code);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
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
    color: var(--chrome-ink, var(--bg));
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
  }
  /* The strip scrolls on a phone; a menu cell sits outside it, because a
     scroller clips anything that drops below it. */
  .hdr-strip {
    display: flex;
    align-items: stretch;
    min-width: 0;
    flex: 1;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .hdr-strip::-webkit-scrollbar {
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
    color: var(--chrome-ink, var(--bg));
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

  /* jkai is not one more destination in the row: it is the assistant, and it
     holds things (Daydreams, Trips) that have no cell of their own here. So it
     wears its wordmark rather than a mono label, and a caret that says there
     is more under it. */
  .hdr-menu {
    position: relative;
    display: flex;
    align-items: stretch;
    flex: none;
    border-left: 1px solid rgba(237, 228, 212, 0.14);
    border-right: 1px solid rgba(237, 228, 212, 0.14);
  }
  .menu-cell {
    display: inline-flex;
    align-items: center;
    padding: 0 6px 0 16px;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: var(--fs-body-sm);
    letter-spacing: -0.01em;
    text-decoration: none;
    color: var(--chrome-ink, var(--bg));
    transition: color 0.2s var(--ease-out);
  }
  .menu-caret {
    display: inline-flex;
    align-items: center;
    padding: 0 14px 0 6px;
    border: 0;
    background: none;
    color: var(--accent-on-dark);
    cursor: pointer;
  }
  .menu-caret svg {
    transition: transform 0.2s var(--ease-out);
  }
  .hdr-menu.open .menu-caret svg {
    transform: rotate(180deg);
  }
  .hdr-menu:hover,
  .hdr-menu.open {
    background: rgba(237, 228, 212, 0.07);
  }
  .menu-cell:hover {
    color: var(--accent-on-dark);
  }
  /* In the jkai family (Trips included): the same accent seam as a current cell. */
  .hdr-menu.here {
    box-shadow: inset 0 -2px 0 var(--accent-on-dark);
  }
  .menu-caret:focus-visible,
  .menu-cell:focus-visible {
    outline: 2px solid var(--accent-on-dark);
    outline-offset: -4px;
  }

  /* The dropped menu is paper, like the hub's own menu on /jkai, so the two
     read as one object seen from either side. */
  .menu {
    position: absolute;
    top: 100%;
    right: -1px;
    z-index: 40;
    width: 240px;
    max-width: calc(100vw - 32px);
    margin: 0;
    padding: 4px 0;
    list-style: none;
    background: var(--bg);
    border: 1px solid var(--line-strong);
    box-shadow: var(--elev-pop);
  }
  .menu-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 9px 16px 10px 14px;
    border-left: 2px solid transparent;
    text-decoration: none;
    transition: background 0.2s var(--ease-out);
  }
  .menu-row:hover,
  .menu-row:focus-visible {
    background: var(--accent-tint-04);
    outline: none;
  }
  .menu-row[aria-current='page'] {
    border-left-color: var(--accent);
    background: rgba(196, 87, 10, 0.08);
  }
  .menu-label {
    font-family: var(--font-body);
    font-size: var(--fs-label);
    color: var(--text-primary);
  }
  .menu-meta {
    font-family: var(--font-code);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    color: var(--text-muted);
    white-space: nowrap;
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
    .menu-cell {
      padding: 0 4px 0 12px;
    }
    .menu-caret {
      padding: 0 12px 0 4px;
    }
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
