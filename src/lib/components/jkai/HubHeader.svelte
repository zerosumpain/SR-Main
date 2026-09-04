<script lang="ts">
  import { page } from '$app/state';
  import { getContext, onMount } from 'svelte';
  import HubTokenStrip from './HubTokenStrip.svelte';
  import { hub, setBpm, closeHubMenu, toggleHubMenu } from '$lib/jkai/hub-bus.svelte';
  import { openLauncher } from '$lib/jkai/launcher-bus.svelte';
  import { formatGbp } from '$lib/canvas/stats/costFormat';
  import { codexMeters, type CodexUsageView } from '$lib/llm/usage-meter';
  import { SECTIONS, activeSection, parentHref, parentLabel } from '$lib/nav/site-nav';
  import type { BiomeStore } from '$lib/biome/store.svelte';

  let {
    tokensToday,
    spendTodayUsd,
    budgetUsd,
    credit = null,
    codex = null,
    defaultModelId = null,
    activeRuns,
    workflowCount,
    workflowLiveCount,
    workflowFailedToday = 0,
    buildVersion = 'development',
  }: {
    tokensToday: number;
    spendTodayUsd: number;
    budgetUsd: number;
    /** Live OpenRouter balance, or null when it couldn't be read. */
    credit?: { remainingUsd: number; totalUsd: number; usedUsd: number } | null;
    /** ChatGPT subscription position, or null with no Codex login on the host. */
    codex?: CodexUsageView | null;
    /** The model that answers a thread with no pin of its own. */
    defaultModelId?: string | null;
    activeRuns: number;
    workflowCount: number;
    workflowLiveCount: number;
    workflowFailedToday?: number;
    buildVersion?: string;
  } = $props();

  /**
   * The model that will actually answer: the active thread's pin when the chat
   * page has published one, otherwise the site default. Both can be a `codex/`
   * id, and the header has to follow whichever is paying.
   */
  const effectiveModelId = $derived(hub.modelId ?? defaultModelId);

  /**
   * Non-null only while a subscription model is answering, in which case the
   * dollar balance is the wrong number to show — a Codex turn spends quota, not
   * credit. Recomputed on `hub.modelId` so switching model in the picker swaps
   * the meter without a navigation.
   */
  const codexViews = $derived(codexMeters(codex, effectiveModelId, Date.now()));
  /** The tightest window — what the pill and the menu row report. The strip gets
   *  the whole list, because clicking it walks them. */
  const codexView = $derived(codexViews[0] ?? null);

  // Menu state is shared with the phone tab bar's `≡ more` tab.
  const menuOpen = $derived(hub.menuOpen);

  /**
   * A surface's own menu, when it has published one.
   *
   * Intel has nine pages of its own and used to render them as a second nav
   * strip under this header — two navigations stacked before the page started.
   * When a surface publishes a menu it takes over this dropdown: same button,
   * same position, its rows instead of the hub's, with a way back beside it.
   */
  const pageMenu = $derived(hub.pageMenu);

  /**
   * Every href the manifest actually names — section roots plus sub-nav cells.
   *
   * `parentHref()` walks the PATH, which is right where the parent is a real
   * page (/jkai/builds/42 -> /jkai/builds) and wrong where it is only a routing
   * segment (/jkai/trace/<id> -> /jkai/trace, which has no +page). Checked so a
   * back chip can never point at a 404.
   */
  const NAV_HREFS = new Set<string>([
    ...SECTIONS.map((s) => s.rootHref),
    ...SECTIONS.flatMap((s) => s.items.map((i) => i.href)),
  ]);

  /**
   * The way out, on every surface rather than only the ones that asked.
   *
   * A surface's own opinion always wins — Intel publishes `pageMenu.back`
   * because it knows something the path does not. Everything else falls back to
   * the nav manifest, which answers "one level up" for any path: /jkai/builds/42
   * gets `← Builds` without /jkai/builds publishing anything, and a new surface
   * inherits a back link the day it is routed. Null only where there is no up —
   * /jkai itself, where the home icon on the left is already the answer.
   */
  const backTo = $derived.by(() => {
    if (pageMenu?.back) return pageMenu.back;
    const path = page.url.pathname;
    const href = parentHref(path);
    if (!href) return null;
    if (NAV_HREFS.has(href)) return { href, label: parentLabel(path) ?? 'Back' };
    // A routing segment with no page behind it. /jkai/trace/<id>'s parent by
    // path is /jkai/trace, which 404s — there is only a [traceId] route under
    // it. The family root is the honest answer in that case.
    const section = activeSection(path);
    return section ? { href: section.rootHref, label: section.label } : null;
  });

  // Live runs: the layout load snapshotted a count at navigation time; the chat
  // page publishes a fresher one as jobs start and finish.
  const runs = $derived(hub.liveRuns ?? activeRuns);

  type MenuRow = { label: string; href: string; meta: string };
  // Canvas carries the workflow counts directly — there used to be a second
  // `Workflows` row under System pointing at the same href, which read as two
  // destinations when it was always one.
  const canvasMeta = $derived(
    workflowFailedToday > 0
      ? `${workflowCount} · ${workflowLiveCount} LIVE · ${workflowFailedToday} FAIL`
      : `${workflowCount} · ${workflowLiveCount} LIVE`,
  );
  const surfaces = $derived<MenuRow[]>([
    { label: 'Chat', href: '/jkai', meta: 'THREAD' },
    { label: 'Canvas', href: '/jkai/canvas', meta: canvasMeta },
    { label: 'Intel', href: '/jkai/intel', meta: 'GRAPH' },
    // Beside Intel, not under it: the two graphs answer different questions
    // (the world vs this codebase) and neither is a subsection of the other.
    { label: 'Codegraph', href: '/jkai/codegraph', meta: 'BUILD MEMORY' },
    { label: 'Builds', href: '/jkai/builds', meta: 'AUTONOMOUS' },
  ]);
  const library: MenuRow[] = [
    { label: 'Notes', href: '/jkai/notes', meta: 'NOTEBOOK' },
    { label: 'News', href: '/news', meta: 'LIVE WIRE' },
    { label: 'Research', href: '/research', meta: 'DEEP DIVE' },
    // The family prefix, matching SECTIONS in $lib/nav/site-nav — it 307s to the
    // feed, so the destination is unchanged, but the row now lights as `current`
    // on every daydream page instead of only on the feed.
    { label: 'Daydreams', href: '/jkai/daydreams', meta: 'BRIEF · WATCH · LEARN' },
  ];
  const system = $derived<MenuRow[]>([
    { label: 'Agent team', href: '/jkai/agents', meta: 'AGENTS · PROMPTS' },
      { label: 'Model defaults', href: '/admin/ai/models', meta: 'ADMIN' },
    {
      label: 'Spend & limits',
      href: '/admin/ops/costs',
      meta: codexView
        ? `${Math.round(codexView.remainingPercent)}% ${codexView.windowLabel} LEFT`
        : credit
          ? `${formatGbp(spendTodayUsd)} / ${formatGbp(credit.remainingUsd)} CREDIT`
          : `${formatGbp(spendTodayUsd)} / ${formatGbp(budgetUsd)}`,
    },
    // The site nav bar no longer sits above these pages, so the way out lives
    // in the menu.
    { label: 'Site', href: '/', meta: 'STRANGERAMBLINGS' },
  ]);

  function isCurrent(href: string): boolean {
    const path = page.url.pathname;
    if (href === '/jkai') return path === '/jkai';
    return path === href || path.startsWith(`${href}/`);
  }

  // Close on outside click and Escape — the prototype only toggles, but a
  // dropdown you can't dismiss with Escape is a trap on a keyboard-first page.
  $effect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeHubMenu();
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest('[data-hub-menu]')) return;
      closeHubMenu();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick, true);
    };
  });

  // Live heart rate — the root layout already owns this public state request.
  // Subscribing to it prevents the JKAI header from creating another minute
  // poll for data that is already in memory.
  const biome = getContext<BiomeStore>('biome');
  $effect(() => {
    // The compact number does not need the five-second visual interpolation;
    // observing the target avoids propagating a global hub update every frame.
    const state = biome?.targetState;
    setBpm(
      state?.sources?.heartRate && typeof state.pulse === 'number' && state.pulse > 0
        ? Math.round(state.pulse)
        : null,
    );
  });
  onMount(() => () => setBpm(null));
</script>

<header class="hub-hdr">
  <div class="hdr-row">
    <div class="hdr-left">
      <!-- Top-left on every page of the site, this one included. The same house
           SiteHeader draws — path data copied verbatim so the two marks are the
           same shape, not two drawings of a house. -->
      <a class="hdr-home" href="/" aria-label="Home" title="Home">
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
      <span class="hdr-divider" aria-hidden="true"></span>
      <!-- `.brand` is the site-wide mark: it supplies the accent `>` via
           ::before, so the word is all this needs to carry. -->
      <a class="brand" href="/jkai" title="jkai">jkai</a>
      <span class="hdr-divider" aria-hidden="true"></span>
      <div class="strip-slot">
        <HubTokenStrip
          {tokensToday}
          spendUsd={spendTodayUsd}
          {budgetUsd}
          {credit}
          codexWindows={codexViews}
          contextTokens={hub.contextTokens}
          contextFraction={hub.contextFraction}
          liveRuns={runs}
          bpm={hub.bpm}
        />
      </div>
    </div>

    <div class="hdr-right" data-hub-menu>
      <!-- Mobile promotes spend out of the strip and into a tappable pill. On a
           subscription model the cash figure is always £0.00 — Codex calls price
           as null, not zero — so the pill carries the quota instead. -->
      <a
        class="spend-pill"
        class:warn={codexView?.limitReached}
        href="/admin/ops/costs"
        title={codexView ? codexView.title : 'Spend & limits'}
      >
        {codexView ? `${Math.round(codexView.remainingPercent)}%` : formatGbp(spendTodayUsd)}
      </a>

      <button type="button" class="chip palette-chip" onclick={openLauncher} title="Command palette">
        ⌘K
      </button>

      {#if backTo}
        <!-- The way out, always visible rather than a row inside the dropdown:
             leaving a surface is the one navigation that should never need a
             menu opened first. -->
        <a class="chip back-chip" href={backTo.href} title="Back to {backTo.label}">
          <span aria-hidden="true">←</span>
          <span class="back-word">{backTo.label}</span>
        </a>
      {/if}

      <div class="menu-wrap">
        <button
          type="button"
          class="chip menu-btn"
          class:open={menuOpen}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onclick={toggleHubMenu}
        >
          <span class="menu-word">{pageMenu?.label ?? 'menu'}</span>
          <span class="menu-glyph" aria-hidden="true">{menuOpen ? '▴' : '▾'}</span>
          <span class="menu-burger" aria-hidden="true">≡</span>
        </button>

        {#if menuOpen}
          <div class="menu" role="menu">
            {#if pageMenu}
              {#each pageMenu.groups as group, gi (group.heading)}
                <div class="menu-group" class:last={gi === pageMenu.groups.length - 1}>
                  <div class="menu-heading">{group.heading}</div>
                  {#each group.rows as row (row.href + row.label)}
                    <a
                      class="menu-row"
                      class:current={isCurrent(row.href)}
                      href={row.href}
                      title={row.title}
                      onclick={closeHubMenu}
                      role="menuitem"
                    >
                      <span class="menu-label">{row.label}</span>
                      {#if row.meta}<span class="menu-meta" class:warn={row.warn}>{row.meta}</span>{/if}
                    </a>
                  {/each}
                </div>
              {/each}
            {:else}
              <div class="menu-group">
                <div class="menu-heading">Surfaces</div>
                {#each surfaces as row (row.href + row.label)}
                  <a class="menu-row" class:current={isCurrent(row.href)} href={row.href} onclick={closeHubMenu} role="menuitem">
                    <span class="menu-label">{row.label}</span>
                    <span class="menu-meta">{row.meta}</span>
                  </a>
                {/each}
              </div>
              <div class="menu-group">
                <div class="menu-heading">Library</div>
                {#each library as row (row.href + row.label)}
                  <a class="menu-row" class:current={isCurrent(row.href)} href={row.href} onclick={closeHubMenu} role="menuitem">
                    <span class="menu-label">{row.label}</span>
                    <span class="menu-meta">{row.meta}</span>
                  </a>
                {/each}
              </div>
              <div class="menu-group last">
                <div class="menu-heading">System</div>
                {#each system as row (row.href + row.label)}
                  <a class="menu-row" class:current={isCurrent(row.href)} href={row.href} onclick={closeHubMenu} role="menuitem">
                    <span class="menu-label">{row.label}</span>
                    <span class="menu-meta">{row.meta}</span>
                  </a>
                {/each}
              </div>
            {/if}
            <div class="build-version" title="Deployment identity">build {buildVersion}</div>
          </div>
        {/if}
      </div>
    </div>
  </div>

  <!-- Mobile metric strip (2a): 34px, scrolls horizontally, never wraps.
       Spend is already in the pill above, so it is dropped here. -->
  <div class="mobile-strip">
    <HubTokenStrip
      variant="mobile"
      {tokensToday}
      spendUsd={spendTodayUsd}
      {budgetUsd}
      {credit}
      codexWindows={codexViews}
      contextTokens={hub.contextTokens}
      contextFraction={hub.contextFraction}
      liveRuns={runs}
      bpm={hub.bpm}
    />
  </div>
</header>

<style>
  /* The masthead band.
   *
   * jkai wears the /health cover register as CHROME rather than as sections:
   * an ink ground with cream type and the accent lifted to --accent-on-dark,
   * the same band the health hub and the daydream hub open with. It is the
   * masthead for every jkai surface, which is why none of them mounts one of
   * its own — `DaydreamShell` says the same thing from the other side.
   *
   * Everything inside it is written for the dark ground: the paper tokens
   * (--text-muted, --line-strong, --accent) are ink on ink here. */
  .hub-hdr {
    flex: none;
    position: relative;
    /* Above the thread rail's slide-over (30) and the phone graph sheet (40),
       below the grain overlay (100) — the menu must escape both. */
    z-index: 60;
    background: var(--text-primary);
    color: var(--bg);
    /* A hairline, not nothing. This band is the only bar a jkai surface wears —
       nothing under /jkai mounts a `.site-nav-bar` of its own any more — so the
       rule is what separates the masthead from the page rather than one ink
       band from another. Without it the header bleeds into a dark page header
       and the two read as one undifferentiated slab. */
    border-bottom: 1px solid rgba(237, 228, 212, 0.16);
    padding-top: env(safe-area-inset-top);
  }
  .hdr-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    height: 46px;
    padding: 0 16px;
  }
  .hdr-left {
    display: flex;
    align-items: center;
    gap: 16px;
    min-width: 0;
  }
  /* The site mark, relit. `.brand` is global and written for paper; the
     element is this component's, so a scoped rule reaches it — including its
     ::before caret, which is the one orange stroke on the left of the band. */
  .brand {
    flex: none;
    font-size: var(--fs-body);
    color: var(--bg);
  }
  .brand::before {
    color: var(--accent-on-dark);
    opacity: 1;
  }
  .brand:hover {
    color: var(--accent-on-dark);
  }
  /* Cream-alpha on the ink band, the weight `.chip` uses for its own label —
     `--text-muted` is a paper token and would be ink on ink here. It lifts to
     the accent on hover, the way `.brand` beside it does. */
  .hdr-home {
    display: inline-flex;
    align-items: center;
    flex: none;
    color: rgba(237, 228, 212, 0.72);
    transition: color 0.2s ease-out;
  }
  .hdr-home:hover {
    color: var(--accent-on-dark);
  }
  .hdr-home:focus-visible {
    outline: 2px solid var(--accent-on-dark);
    outline-offset: 2px;
  }
  .hdr-home svg {
    display: block;
  }
  .hdr-divider {
    width: 1px;
    height: 18px;
    flex: none;
    background: rgba(237, 228, 212, 0.22);
  }
  .strip-slot {
    min-width: 0;
    overflow: hidden;
  }

  .hdr-right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: none;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 5px 9px;
    background: transparent;
    border: 1px solid rgba(237, 228, 212, 0.28);
    /* Radius 0 — the cover register has no rounded chrome. */
    border-radius: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: rgba(237, 228, 212, 0.72);
    cursor: pointer;
    transition: color 0.2s ease-out, border-color 0.2s ease-out, background 0.2s ease-out;
  }
  .chip:hover {
    color: var(--text-primary);
    background: var(--accent-on-dark);
    border-color: var(--accent-on-dark);
  }
  .chip:focus-visible {
    outline: 2px solid var(--accent-on-dark);
    outline-offset: 2px;
  }
  .menu-btn {
    padding: 5px 10px;
  }
  .menu-btn.open {
    background: var(--accent-on-dark);
    border-color: var(--accent-on-dark);
    color: var(--text-primary);
  }
  .menu-burger {
    display: none;
  }

  .menu-wrap {
    position: relative;
  }
  /* A floating layer — one of the two places elevation is allowed. The border
     drops to a hairline now that the shadow is doing the separating. */
  .menu {
    position: absolute;
    right: 0;
    top: 32px;
    width: 250px;
    background: var(--bg);
    border: 1px solid var(--line-strong);
    box-shadow: var(--elev-pop);
    z-index: 50;
  }
  .menu-group {
    border-bottom: 1px solid var(--line-hair);
  }
  .menu-group.last {
    border-bottom: none;
  }
  .menu-heading {
    padding: 8px 12px 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: var(--text-ghost);
  }
  .menu-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 7px 12px;
    text-decoration: none;
    cursor: pointer;
    transition: background 0.2s ease-out;
  }
  .menu-row:hover {
    background: var(--accent-tint-04);
  }
  .menu-row.current {
    background: rgba(196, 87, 10, 0.1);
  }
  .menu-label {
    font-family: var(--font-body);
    font-size: var(--fs-label);
    font-weight: 400;
    color: var(--text-primary);
  }
  .menu-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 400;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
    white-space: nowrap;
  }
  /* A backlog above its warnAbove threshold. Accent, not --warn: on this
     palette burnt orange IS "needs you", and the amber read as a third status
     colour nothing else on the surface used. */
  .menu-meta.warn {
    color: var(--accent);
  }

  .build-version {
    padding: 7px 12px;
    border-top: 1px solid var(--line-hair);
    color: var(--text-ghost);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  .back-chip {
    text-decoration: none;
    gap: 5px;
  }

  .spend-pill,
  .mobile-strip {
    display: none;
  }

  /* --- Installed-PWA / phone shell (2a) ------------------------------- */
  @media (max-width: 799px) {
    .strip-slot {
      display: none;
    }
    .hdr-divider {
      display: none;
    }
    .palette-chip {
      display: none;
    }
    .spend-pill {
      display: inline-flex;
      align-items: center;
      height: 32px;
      padding: 0 10px;
      border-radius: var(--radius-pill);
      background: rgba(232, 134, 58, 0.14);
      border: 1px solid rgba(232, 134, 58, 0.45);
      font-family: var(--font-mono);
      font-size: var(--fs-label);
      font-weight: 500;
      color: var(--accent-on-dark);
      text-decoration: none;
      white-space: nowrap;
    }
    /* Subscription quota exhausted — Codex calls are being refused. The paper
       --error is muddy on ink, so it lifts the way the accent does. */
    .spend-pill.warn {
      background: rgba(224, 139, 139, 0.14);
      border-color: #e08b8b;
      color: #e08b8b;
    }
    .menu-btn {
      width: 44px;
      height: 44px;
      padding: 0;
      justify-content: center;
      border-color: transparent;
    }
    .menu-btn.open {
      border-color: var(--accent-on-dark);
    }
    .menu-word,
    .menu-glyph {
      display: none;
    }
    /* A 15px glyph is not a thumb target. Padding + a matching negative margin
       widens the hit area to ~39x44 without moving the mark off the 16px gutter
       the row is drawn on. */
    .hdr-home {
      height: 44px;
      padding: 0 12px;
      margin: 0 -12px;
      justify-content: center;
    }
    /* The arrow alone, at a thumb-sized target. The word is what costs width on
       a phone, and "←" beside a surface header is not ambiguous. */
    .back-chip {
      width: 44px;
      height: 44px;
      justify-content: center;
      padding: 0;
      border-color: transparent;
      font-size: var(--fs-body);
      color: var(--bg);
    }
    .back-word {
      display: none;
    }
    .menu-burger {
      display: inline;
      font-family: var(--font-mono);
      font-size: 1.25rem;
      font-weight: 400;
      letter-spacing: 0;
      text-transform: none;
      color: var(--bg);
    }
    .menu-btn.open .menu-burger {
      color: var(--text-primary);
    }
    /* Full-height sheet rather than a dropdown. */
    .menu {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      left: auto;
      width: min(86vw, 300px);
      border-width: 0 0 0 1px;
      overflow-y: auto;
      padding-top: calc(env(safe-area-inset-top) + 8px);
      padding-bottom: env(safe-area-inset-bottom);
    }
    .menu-row {
      min-height: 44px;
      align-items: center;
    }
    .menu-label {
      font-size: var(--fs-nav);
    }
    .menu-meta {
      font-size: var(--fs-label-xs);
    }
    /* 34px, scrolls horizontally, never wraps. The `mobile` variant already
       drops spend and suspends the desktop chunk-drop rules. */
    .mobile-strip {
      display: flex;
      align-items: center;
      height: 34px;
      padding: 0 16px;
      border-top: 1px solid rgba(237, 228, 212, 0.14);
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: none;
    }
    .mobile-strip::-webkit-scrollbar {
      display: none;
    }
  }
</style>
