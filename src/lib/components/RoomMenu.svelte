<script lang="ts">
  /**
   * A room cell and its menu — the second cell on every bar, after the home
   * icon. A room is not a page: the cell is a button, and what it opens is the
   * room's destinations (`ROOMS` in `$lib/nav/site-nav`).
   *
   * Two shapes, one component:
   *
   *  * Inside a room (`/health/plan`, `/trips`) it names the room you are in.
   *    Its menu lists that room and carries a row of the other rooms across
   *    the top, so anywhere on the site is one hover and one click away.
   *  * On an unfiled page (`/`, jkai chat) the bar passes `only` and mounts one
   *    per room: five cells, each opening its own list.
   *
   * A bar that mounts it bare on a page in no room (the jkai hub's masthead
   * on chat) gets a cell that just says ROOMS and opens on the first.
   *
   * It renders nothing for a viewer whose reach is too small for rooms (see
   * `wearsRooms`) — their bar is the flat strip.
   *
   * The first one mounted on a page also draws the site map (`NavMap`), which
   * the home icon and `/` open; the last row of every menu opens it too, for a
   * touch screen that has neither a hover nor a key.
   *
   * Opens like the jkai cell did: a mouse by hovering, a touch screen or a
   * keyboard by pressing the cell. Mount it OUTSIDE any scroller — a scroller
   * clips whatever drops below it.
   */
  import { onDestroy } from 'svelte';
  import NavMap from './NavMap.svelte';
  import { navMap, openNavMap } from '$lib/nav/nav-map.svelte';
  import { isItemActive, roomFor, visibleRooms, wearsRooms } from '$lib/nav/site-nav';

  let {
    path,
    isOwner = true,
    reach = [],
    only,
    chip = false,
  }: {
    path: string;
    isOwner?: boolean;
    reach?: readonly string[];
    /** A room id: render that room's cell, with no way across to the others. */
    only?: string;
    /**
     * For a bar that is not a strip of full-height cells (the jkai masthead,
     * the news bar): a label sat on the bar's baseline, no hairline, no fill.
     */
    chip?: boolean;
  } = $props();

  const rooms = $derived(wearsRooms(isOwner, reach) ? visibleRooms(isOwner, reach) : []);
  const hereId = $derived(roomFor(path)?.id);
  /** The room this cell names; unfiled and not `only`, the first, unnamed. */
  const room = $derived(
    rooms.find((r) => r.id === (only ?? hereId)) ?? (only ? undefined : rooms[0]),
  );
  const named = $derived(!!only || !!hereId);

  let open = $state(false);
  /** Opened by a press, not a hover: it stays until pressed again. */
  let pinned = false;
  /** The room whose rows the menu is showing; the cell's own until a tab is pressed. */
  let shownId = $state<string>();
  const shown = $derived(rooms.find((r) => r.id === shownId) ?? room);
  let cell = $state<HTMLButtonElement>();
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const menuId = $props.id();

  function hoverOpen(e: PointerEvent) {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(closeTimer);
    open = true;
  }
  function hoverClose(e: PointerEvent) {
    if (e.pointerType !== 'mouse' || pinned) return;
    clearTimeout(closeTimer);
    closeTimer = setTimeout(close, 180);
  }
  function close() {
    open = false;
    pinned = false;
    shownId = undefined;
  }
  /** A mouse has already opened it by arriving, so its press pins rather than shuts. */
  function toggle() {
    clearTimeout(closeTimer);
    if (open && pinned) return close();
    open = true;
    pinned = true;
  }
  $effect(() => {
    void path;
    close();
  });
  function onWindowKey(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !open) return;
    close();
    cell?.focus();
  }
  function onWindowPointer(e: PointerEvent) {
    if (!open) return;
    const t = e.target as Element | null;
    if (t?.closest('[data-room-menu]') !== root) close();
  }
  let root = $state<HTMLElement>();

  // One map a page, drawn by whichever room cell got there first.
  $effect(() => {
    if (room && navMap.host === null) navMap.host = menuId;
  });
  onDestroy(() => {
    if (navMap.host === menuId) navMap.host = null;
  });
  function showMap() {
    close();
    openNavMap();
  }
</script>

<svelte:window onkeydown={onWindowKey} onpointerdown={onWindowPointer} />

{#if room}
  <nav
    bind:this={root}
    class="room-menu"
    class:open
    class:here={room.id === hereId}
    class:only={!!only}
    class:chip
    aria-label={named ? room.label : 'Rooms'}
    data-room-menu
    onpointerenter={hoverOpen}
    onpointerleave={hoverClose}
  >
    <button
      bind:this={cell}
      type="button"
      class="room-cell"
      aria-expanded={open}
      aria-controls={menuId}
      title={named ? `${room.label}: ${room.blurb}` : 'Everywhere on the site'}
      onclick={toggle}
    >
      {named ? room.label : 'Rooms'}
      <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
        <path d="M1.5 3.5 5 7l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.4" />
      </svg>
    </button>
    {#if open && shown}
      <div class="menu" id={menuId}>
        {#if !only && rooms.length > 1}
          <div class="rooms" role="group" aria-label="Rooms">
            {#each rooms as r (r.id)}
              <button
                type="button"
                class="room-tab"
                aria-pressed={r.id === shown.id}
                onclick={() => (shownId = r.id)}
              >
                {r.label}
              </button>
            {/each}
          </div>
        {/if}
        <p class="blurb">{shown.blurb}</p>
        <ul>
          {#each shown.items as row (row.href + row.label)}
            <li>
              <a
                href={row.href}
                class="menu-row"
                aria-current={isItemActive(row, path) ? 'page' : undefined}
                onclick={close}
              >
                <span class="menu-label">{row.label}</span>
                {#if row.meta}<span class="menu-meta">{row.meta}</span>{/if}
              </a>
            </li>
          {/each}
        </ul>
        <button type="button" class="map-row" onclick={showMap}>
          <span>Everywhere, or ask</span>
          <kbd>/</kbd>
        </button>
      </div>
    {/if}
  </nav>
  <!-- Beside the cell, not in it: inside, resting on the map would count as
       resting on the cell and open its menu over the top. -->
  {#if navMap.host === menuId}
    <NavMap {path} {isOwner} {reach} anchor={root} />
  {/if}
{/if}

<style>
  /* Literal ink and cream, not --text-primary / --bg: the bars are ink in both
     themes, and this cell sits on all of them. */
  .room-menu {
    position: relative;
    display: flex;
    align-items: stretch;
    align-self: stretch;
    flex: none;
    border-right: 1px solid rgba(237, 228, 212, 0.14);
  }
  .room-cell {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 14px;
    border: 0;
    background: none;
    cursor: pointer;
    font-family: var(--font-code);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: #ede4d4;
    transition: color 0.2s var(--ease-out), background 0.2s var(--ease-out);
  }
  .room-cell svg {
    opacity: 0.6;
    transition: transform 0.2s var(--ease-out);
  }
  .room-menu.open .room-cell svg {
    transform: rotate(180deg);
  }
  .room-cell:hover,
  .room-menu.open .room-cell {
    color: var(--accent-on-dark);
    background: rgba(237, 228, 212, 0.07);
  }
  /* The room you are in: the accent seam a current cell wears, without the
     cut-out — the cut-out belongs to the page's own cell further along. */
  .room-menu.here .room-cell {
    box-shadow: inset 0 -2px 0 var(--accent-on-dark);
  }
  .room-menu.chip {
    align-self: center;
    border-right: 0;
  }
  .room-menu.chip .room-cell {
    padding: 6px 8px;
  }
  .room-menu.chip .room-cell:hover,
  .room-menu.chip.open .room-cell {
    background: none;
  }
  .room-cell:focus-visible,
  .room-tab:focus-visible,
  .map-row:focus-visible {
    outline: 2px solid var(--accent-on-dark);
    outline-offset: -4px;
  }

  /* The bar carried on downwards, as the jkai menu was: same ink, same mono
     rows, same hairlines, hung from the cell by an accent edge. */
  .menu {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 40;
    width: 288px;
    max-width: calc(100vw - 32px);
    background: #1a1008;
    border: 1px solid rgba(237, 228, 212, 0.14);
    border-top: 2px solid var(--accent-on-dark);
    box-shadow: 0 14px 32px rgba(0, 0, 0, 0.45);
  }
  .rooms {
    display: flex;
    border-bottom: 1px solid rgba(237, 228, 212, 0.14);
  }
  .room-tab {
    flex: 1;
    padding: 11px 0;
    border: 0;
    border-right: 1px solid rgba(237, 228, 212, 0.14);
    background: none;
    cursor: pointer;
    font-family: var(--font-code);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: rgba(237, 228, 212, 0.62);
  }
  .room-tab:last-child {
    border-right: 0;
  }
  .room-tab:hover {
    color: #ede4d4;
    background: rgba(237, 228, 212, 0.07);
  }
  .room-tab[aria-pressed='true'] {
    color: #1a1008;
    background: #ede4d4;
    box-shadow: inset 0 -2px 0 var(--accent);
  }
  .blurb {
    margin: 0;
    padding: 10px 16px 8px;
    font-family: var(--font-code);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
    color: rgba(237, 228, 212, 0.5);
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
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
  /* The way to the whole map: quieter than a destination, it is a tool. */
  .map-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 11px 16px;
    border: 0;
    border-top: 1px solid rgba(237, 228, 212, 0.14);
    background: rgba(237, 228, 212, 0.04);
    cursor: pointer;
    font-family: var(--font-code);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
    color: rgba(237, 228, 212, 0.62);
  }
  .map-row:hover {
    color: var(--accent-on-dark);
  }
  .map-row kbd {
    font: inherit;
    color: var(--accent-on-dark);
  }

  /* Phone: the menu is a sheet the width of the bar, hung from the bar rather
     than from the cell — five cells in, a 288px box would run off the screen. */
  @media (max-width: 640px) {
    .room-menu {
      position: static;
    }
    .room-cell {
      padding: 0 9px;
      gap: 4px;
    }
    /* Five in a row beside the home icon and jkai, or one on a masthead that
       is already full: the words fit, the carets do not. */
    .room-menu.only .room-cell svg,
    .room-menu.chip .room-cell svg {
      display: none;
    }
    .room-menu.chip .room-cell {
      padding: 6px 2px;
    }
    .menu {
      left: 0;
      right: 0;
      width: auto;
      max-width: none;
    }
  }
</style>
