<script lang="ts">
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import HubTokenStrip from './HubTokenStrip.svelte';
  import { hub, setBpm, closeHubMenu, toggleHubMenu } from '$lib/jkai/hub-bus.svelte';
  import { openLauncher } from '$lib/jkai/launcher-bus.svelte';
  import { formatGbp } from '$lib/canvas/stats/costFormat';

  let {
    tokensToday,
    spendTodayUsd,
    budgetUsd,
    credit = null,
    activeRuns,
    workflowCount,
    workflowLiveCount,
    workflowFailedToday = 0,
  }: {
    tokensToday: number;
    spendTodayUsd: number;
    budgetUsd: number;
    /** Live OpenRouter balance, or null when it couldn't be read. */
    credit?: { remainingUsd: number; totalUsd: number; usedUsd: number } | null;
    activeRuns: number;
    workflowCount: number;
    workflowLiveCount: number;
    workflowFailedToday?: number;
  } = $props();

  // Menu state is shared with the phone tab bar's `≡ more` tab.
  const menuOpen = $derived(hub.menuOpen);

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
    { label: 'Builds', href: '/jkai/builds', meta: 'AUTONOMOUS' },
  ]);
  const library: MenuRow[] = [
    { label: 'Prompts', href: '/jkai/prompts', meta: 'STACKS' },
    { label: 'Research', href: '/jkai/research', meta: 'DEEP DIVE' },
    { label: 'Briefing', href: '/jkai/briefing', meta: 'DAILY' },
    { label: 'Monitors', href: '/jkai/monitors', meta: 'WATCHES' },
  ];
  const system = $derived<MenuRow[]>([
    { label: 'Agent team', href: '/jkai/agents', meta: 'DELEGATES' },
    { label: 'Improvement', href: '/jkai/improvement', meta: 'NIGHTLY' },
    { label: 'Doctor', href: '/jkai/doctor', meta: 'TRIAGE' },
    { label: 'Model defaults', href: '/admin/ai/models', meta: 'ADMIN' },
    {
      label: 'Spend & limits',
      href: '/admin/ops/costs',
      meta: credit
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

  // Live heart rate — the same public biome state the landing hero reads. Only
  // shown when the health source is actually reporting, so the strip never
  // carries a stale number.
  onMount(() => {
    let cancelled = false;
    const pull = async () => {
      try {
        const res = await fetch('/api/biome/state');
        if (!res.ok || cancelled) return;
        const state = (await res.json()) as {
          pulse?: number;
          sources?: { heartRate?: boolean };
        };
        if (cancelled) return;
        setBpm(
          state?.sources?.heartRate && typeof state.pulse === 'number' && state.pulse > 0
            ? Math.round(state.pulse)
            : null,
        );
      } catch {
        // ignore — next poll retries
      }
    };
    void pull();
    const timer = setInterval(pull, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      setBpm(null);
    };
  });
</script>

<header class="hub-hdr">
  <div class="hdr-row">
    <div class="hdr-left">
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
          contextTokens={hub.contextTokens}
          contextFraction={hub.contextFraction}
          liveRuns={runs}
          bpm={hub.bpm}
        />
      </div>
    </div>

    <div class="hdr-right" data-hub-menu>
      <!-- Mobile promotes spend out of the strip and into a tappable pill. -->
      <a class="spend-pill" href="/admin/ops/costs" title="Spend & limits">
        {formatGbp(spendTodayUsd)}
      </a>

      <button type="button" class="chip palette-chip" onclick={openLauncher} title="Command palette">
        ⌘K
      </button>

      <div class="menu-wrap">
        <button
          type="button"
          class="chip menu-btn"
          class:open={menuOpen}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onclick={toggleHubMenu}
        >
          <span class="menu-word">menu</span>
          <span class="menu-glyph" aria-hidden="true">{menuOpen ? '▴' : '▾'}</span>
          <span class="menu-burger" aria-hidden="true">≡</span>
        </button>

        {#if menuOpen}
          <div class="menu" role="menu">
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
      contextTokens={hub.contextTokens}
      contextFraction={hub.contextFraction}
      liveRuns={runs}
      bpm={hub.bpm}
    />
  </div>
</header>

<style>
  .hub-hdr {
    flex: none;
    position: relative;
    /* Above the thread rail's slide-over (30) and the phone graph sheet (40),
       below the grain overlay (100) — the menu must escape both. */
    z-index: 60;
    background: var(--bg-section);
    border-bottom: 1px solid var(--divider);
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
  .brand {
    flex: none;
    font-size: var(--fs-body);
  }
  .hdr-divider {
    width: 1px;
    height: 18px;
    flex: none;
    background: rgba(26, 16, 8, 0.16);
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
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-muted);
    cursor: pointer;
    transition: color 0.2s ease-out, border-color 0.2s ease-out, background 0.2s ease-out;
  }
  .chip:hover {
    color: var(--text-primary);
    border-color: var(--accent-tint-35);
  }
  .menu-btn {
    padding: 5px 10px;
  }
  .menu-btn.open {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .menu-burger {
    display: none;
  }

  .menu-wrap {
    position: relative;
  }
  .menu {
    position: absolute;
    right: 0;
    top: 32px;
    width: 250px;
    background: var(--bg);
    border: 2px solid rgba(26, 16, 8, 0.22);
    z-index: 50;
  }
  .menu-group {
    border-bottom: 1px solid var(--divider);
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
      background: rgba(196, 87, 10, 0.1);
      border: 1px solid var(--accent-tint-25);
      font-family: var(--font-mono);
      font-size: var(--fs-label);
      font-weight: 500;
      color: var(--accent);
      text-decoration: none;
      white-space: nowrap;
    }
    .menu-btn {
      width: 44px;
      height: 44px;
      padding: 0;
      justify-content: center;
      border-color: transparent;
    }
    .menu-btn.open {
      border-color: var(--accent);
    }
    .menu-word,
    .menu-glyph {
      display: none;
    }
    .menu-burger {
      display: inline;
      font-family: var(--font-mono);
      font-size: 1.25rem;
      font-weight: 400;
      letter-spacing: 0;
      text-transform: none;
      color: var(--text-primary);
    }
    .menu-btn.open .menu-burger {
      color: #fff;
    }
    /* Full-height sheet rather than a dropdown. */
    .menu {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      left: auto;
      width: min(86vw, 300px);
      border-width: 0 0 0 2px;
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
      border-top: 1px solid var(--divider);
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: none;
    }
    .mobile-strip::-webkit-scrollbar {
      display: none;
    }
  }
</style>
