<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { hub, toggleHubMenu, cycleGraphSheet } from '$lib/jkai/hub-bus.svelte';

  // Phone-only bottom navigation (screen 2a). The desktop `menu ▾` dropdown
  // collapses to five glyph tabs; `more` opens that same menu as a sheet, and
  // `graph` raises the knowledge-graph bottom sheet (2b) rather than routing —
  // the graph is *about* the open thread, so leaving it would be wrong.
  const onChat = $derived(page.url.pathname === '/jkai');

  async function openGraph() {
    if (!onChat) {
      await goto('/jkai');
    }
    cycleGraphSheet();
  }
</script>

<nav class="tab-bar" aria-label="jkai sections">
  <a class="tab" class:active={onChat} href="/jkai">
    <span class="glyph" aria-hidden="true">◉</span>
    <span class="label">chat</span>
  </a>
  <a class="tab" class:active={page.url.pathname.startsWith('/jkai/canvas')} href="/jkai/canvas">
    <span class="glyph" aria-hidden="true">⌥</span>
    <span class="label">canvas</span>
  </a>
  <button type="button" class="tab" class:active={hub.graphSheet !== 'closed'} onclick={openGraph}>
    <span class="glyph" aria-hidden="true">◆</span>
    <span class="label">graph</span>
  </button>
  <a class="tab" class:active={page.url.pathname.startsWith('/jkai/intel')} href="/jkai/intel">
    <span class="glyph" aria-hidden="true">#</span>
    <span class="label">intel</span>
  </a>
  <a class="tab" class:active={page.url.pathname.startsWith('/jkai/notes')} href="/jkai/notes">
    <span class="glyph" aria-hidden="true">✎</span>
    <span class="label">notes</span>
  </a>
  <a class="tab" class:active={page.url.pathname.startsWith('/jkai/codegraph')} href="/jkai/codegraph">
    <span class="glyph" aria-hidden="true">⌗</span>
    <span class="label">code</span>
  </a>
  <button type="button" class="tab" class:active={hub.menuOpen} onclick={toggleHubMenu} data-hub-menu>
    <span class="glyph" aria-hidden="true">≡</span>
    <span class="label">more</span>
  </button>
</nav>

<style>
  .tab-bar {
    display: none;
  }

  @media (max-width: 799px) {
    /* The band the masthead is, closing the page the way it opened it — ink
       ground, cream glyphs, the accent lifted to --accent-on-dark.
       SIX columns, not five: the sixth tab (`more`) had been wrapping onto a
       second row, which is why the bar looked 112px tall on a phone. */
    .tab-bar {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      flex: none;
      height: 56px;
      background: var(--text-primary);
      border-top: none;
      /* Reserve the home-indicator strip beneath the bar. */
      padding-bottom: env(safe-area-inset-bottom);
      box-sizing: content-box;
    }
    .tab {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      height: 56px;
      background: transparent;
      border: none;
      padding: 0;
      cursor: pointer;
      text-decoration: none;
      color: rgba(237, 228, 212, 0.55);
      transition: color 0.2s ease-out, background 0.2s ease-out;
    }
    .tab.active {
      color: var(--accent-on-dark);
      background: rgba(232, 134, 58, 0.12);
      /* A seam, not a fill — the same 3px accent rule the sticky rails use to
         say which one you are on. */
      box-shadow: inset 0 -3px 0 var(--accent-on-dark);
    }
    .tab:focus-visible {
      outline: 2px solid var(--accent-on-dark);
      outline-offset: -3px;
    }
    .glyph {
      font-family: var(--font-mono);
      font-size: var(--fs-body);
      line-height: 1;
    }
    .label {
      font-family: var(--font-mono);
      font-size: var(--fs-label-xs);
      text-transform: uppercase;
      letter-spacing: 0.12em;
    }
  }
</style>
