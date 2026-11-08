<script lang="ts">
  /**
   * The jkai cell and its menu — on every nav bar on the site: SiteHeader (and
   * so PageHeader, HealthShell, the welcome frame and the releases hub), the
   * admin bar and the jkai hub's own masthead.
   *
   * jkai is not one more destination in a row: it is the assistant, and it
   * holds things (Daydreams, Trips) that have no cell of their own on a site
   * page. So it is the one cell filled with colour and wearing its wordmark,
   * with a caret that says there is more under it.
   *
   * A mouse opens the menu by hovering; the caret opens it for a touch screen
   * or a keyboard. Leaving with the mouse closes it after a beat, so the trip
   * from the cell down into the menu does not drop it. Escape, a click
   * elsewhere, or moving to another page closes it.
   */
  import { isItemActive, type NavItem } from '$lib/nav/site-nav';

  let { item, path }: { item: NavItem; path: string } = $props();

  let open = $state(false);
  let caret = $state<HTMLButtonElement>();
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const menuId = $props.id();

  function hoverOpen(e: PointerEvent) {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(closeTimer);
    open = true;
  }
  function hoverClose(e: PointerEvent) {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => (open = false), 180);
  }
  function toggle() {
    clearTimeout(closeTimer);
    open = !open;
  }
  $effect(() => {
    void path;
    open = false;
  });
  function onWindowKey(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !open) return;
    open = false;
    caret?.focus();
  }
  function onWindowPointer(e: PointerEvent) {
    if (!open) return;
    const t = e.target as Element | null;
    if (!t?.closest('[data-jkai-menu]')) open = false;
  }
</script>

<svelte:window onkeydown={onWindowKey} onpointerdown={onWindowPointer} />

<nav
  class="jkai-menu"
  class:open
  class:here={isItemActive(item, path)}
  aria-label="jkai"
  data-jkai-menu
  onpointerenter={hoverOpen}
  onpointerleave={hoverClose}
>
  <a href={item.href} class="menu-cell" aria-current={path === item.href ? 'page' : undefined}>
    {item.label}
  </a>
  {#if item.children?.length}
    <button
      bind:this={caret}
      type="button"
      class="menu-caret"
      aria-expanded={open}
      aria-controls={menuId}
      aria-label="More in {item.label}"
      onclick={toggle}
    >
      <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
        <path d="M1.5 3.5 5 7l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.4" />
      </svg>
    </button>
    {#if open}
      <ul class="menu" id={menuId}>
        {#each item.children as row (row.href)}
          <li>
            <a
              href={row.href}
              class="menu-row"
              aria-current={isItemActive(row, path) ? 'page' : undefined}
              onclick={() => (open = false)}
            >
              <span class="menu-label">{row.label}</span>
              {#if row.meta}<span class="menu-meta">{row.meta}</span>{/if}
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</nav>

<style>
  /* Filled with the on-dark accent, ink text on it (7:1). Literal ink and
     cream, not --text-primary / --bg: the bars are ink in both themes. */
  .jkai-menu {
    position: relative;
    display: flex;
    align-items: stretch;
    align-self: stretch;
    flex: none;
    background: var(--accent-on-dark);
    color: #1a1008;
    transition: background 0.2s var(--ease-out);
  }
  .menu-cell {
    display: inline-flex;
    align-items: center;
    padding: 0 4px 0 18px;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: var(--fs-body-sm);
    letter-spacing: -0.01em;
    text-decoration: none;
    color: inherit;
  }
  .menu-caret {
    display: inline-flex;
    align-items: center;
    padding: 0 16px 0 6px;
    border: 0;
    background: none;
    color: inherit;
    cursor: pointer;
  }
  .menu-caret svg {
    transition: transform 0.2s var(--ease-out);
  }
  .jkai-menu.open .menu-caret svg {
    transform: rotate(180deg);
  }
  .jkai-menu:hover,
  .jkai-menu.open {
    background: #f09a55;
  }
  /* In the jkai family (Trips included): a cream seam along the bottom, the
     filled cell's version of a current cell's accent seam. */
  .jkai-menu.here {
    box-shadow: inset 0 -3px 0 rgba(26, 16, 8, 0.55);
  }
  .menu-caret:focus-visible,
  .menu-cell:focus-visible {
    outline: 2px solid #1a1008;
    outline-offset: -5px;
  }

  /* The menu is the bar carried on downwards: the same ink, the same mono
     cells divided by the same hairlines, and the current row cut out to the
     page ground with an accent seam — exactly as a current cell in the strip.
     It hangs from the jkai cell by an accent edge of the same colour. */
  .menu {
    position: absolute;
    top: 100%;
    right: 0;
    z-index: 40;
    width: 248px;
    max-width: calc(100vw - 32px);
    margin: 0;
    padding: 0;
    list-style: none;
    background: #1a1008;
    border: 1px solid rgba(237, 228, 212, 0.14);
    border-top: 2px solid var(--accent-on-dark);
    box-shadow: 0 14px 32px rgba(0, 0, 0, 0.45);
  }
  .menu li + li {
    border-top: 1px solid rgba(237, 228, 212, 0.14);
  }
  .menu-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px 16px;
    text-decoration: none;
    color: rgba(237, 228, 212, 0.72);
    transition: color 0.2s var(--ease-out), background 0.2s var(--ease-out);
  }
  .menu-row:hover,
  .menu-row:focus-visible {
    color: #ede4d4;
    background: rgba(237, 228, 212, 0.07);
    outline: none;
  }
  .menu-label {
    font-family: var(--font-code);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
  }
  .menu-meta {
    font-family: var(--font-code);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
    color: rgba(237, 228, 212, 0.5);
  }
  .menu-row:hover .menu-label,
  .menu-row:focus-visible .menu-label {
    color: var(--accent-on-dark);
  }
  .menu-row[aria-current='page'] {
    color: #1a1008;
    background: #ede4d4;
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .menu-row[aria-current='page'] .menu-label {
    color: #1a1008;
  }
  .menu-row[aria-current='page'] .menu-meta {
    color: rgba(26, 16, 8, 0.6);
  }

  @media (max-width: 640px) {
    .menu-cell {
      padding: 0 4px 0 12px;
    }
    .menu-caret {
      padding: 0 12px 0 4px;
    }
  }
</style>
