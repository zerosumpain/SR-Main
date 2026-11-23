<script lang="ts">
  /**
   * The room cell — the second cell on every bar, after the home icon — and
   * the door to the site's one menu.
   *
   * It names the room you are in (`/health/plan` says LIFE, `/trips` says
   * LIFE) and opens the map (`NavMap`): every room side by side in one block,
   * yours marked, with the box that goes somewhere or asks jkai. There is no
   * second, smaller menu. The rooms used to drop their own lists from five
   * separate cells; John preferred the single block the home icon opened
   * (2026-11-23), so that block is now what every way in opens.
   *
   * On a page in no room (`/`, jkai chat) the cell says EVERYWHERE. A bar that
   * passes `only` names that room instead.
   *
   * It renders nothing for a viewer whose reach is too small for rooms (see
   * `wearsRooms`) — their bar is the flat strip, and three destinations need
   * no map.
   *
   * The first one mounted on a page also draws the map, as a sibling: inside
   * the cell, resting on the sheet would count as resting on the cell.
   *
   * Opens on a mouse by hovering, on a touch screen or a keyboard by pressing.
   */
  import { onDestroy } from 'svelte';
  import NavMap from './NavMap.svelte';
  import {
    cellHoverOpen,
    closeNavMap,
    mapHoverLeave,
    navMap,
    openNavMap,
  } from '$lib/nav/nav-map.svelte';
  import { roomFor, visibleRooms, wearsRooms } from '$lib/nav/site-nav';

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
    /** A room id: name that room on the cell, whatever page this is. */
    only?: string;
    /**
     * For a bar that is not a strip of full-height cells (the jkai masthead,
     * the news bar): a label sat on the bar's baseline, no hairline, no fill.
     */
    chip?: boolean;
  } = $props();

  const rooms = $derived(wearsRooms(isOwner, reach) ? visibleRooms(isOwner, reach) : []);
  const hereId = $derived(roomFor(path)?.id);
  /** The room this cell names, if it names one. */
  const room = $derived(rooms.find((r) => r.id === (only ?? hereId)));
  const id = $props.id();
  let cell = $state<HTMLButtonElement>();

  /** A mouse has already opened it by arriving, so its press pins rather than shuts. */
  function toggle() {
    if (navMap.open && !navMap.hovered) return closeNavMap();
    openNavMap(cell);
  }

  // One map a page, drawn by whichever room cell got there first.
  $effect(() => {
    if (rooms.length && navMap.host === null) navMap.host = id;
  });
  onDestroy(() => {
    if (navMap.host === id) navMap.host = null;
  });
</script>

{#if rooms.length}
  <nav
    class="room-menu"
    class:open={navMap.open}
    class:here={!!room && room.id === hereId}
    class:chip
    aria-label="Site"
    data-room-menu
    onpointerenter={cellHoverOpen}
    onpointerleave={mapHoverLeave}
  >
    <button
      bind:this={cell}
      type="button"
      class="room-cell"
      aria-expanded={navMap.open}
      aria-haspopup="dialog"
      title={room ? `${room.label}: ${room.blurb}. Everywhere else is in the same menu.` : 'Everywhere on the site'}
      data-map-trigger
      onclick={toggle}
    >
      {room ? room.label : 'Everywhere'}
      <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
        <path d="M1.5 3.5 5 7l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.4" />
      </svg>
    </button>
  </nav>
  {#if navMap.host === id}
    <NavMap {path} {isOwner} {reach} anchor={cell} />
  {/if}
{/if}

<style>
  /* Literal ink and cream, not --text-primary / --bg: the bars are ink in both
     themes, and this cell sits on all of them. */
  .room-menu {
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
  .room-cell:focus-visible {
    outline: 2px solid var(--accent-on-dark);
    outline-offset: -4px;
  }

  @media (max-width: 640px) {
    .room-cell {
      padding: 0 10px;
      gap: 4px;
    }
    /* A masthead that is already full: the word fits, the caret does not. */
    .room-menu.chip .room-cell svg {
      display: none;
    }
    .room-menu.chip .room-cell {
      padding: 6px 2px;
    }
  }
</style>
