<script lang="ts">
  /**
   * The site map: one sheet, hung under the bar from the home icon, holding
   * every room at once and the box that either goes somewhere or asks jkai.
   *
   *  * Rest on the home icon and it opens (the icon still goes home when
   *    pressed). `/` opens it from the keyboard, and the last row of every room
   *    menu opens it on a touch screen.
   *  * Type a place and Enter goes there; the rows under the box say which.
   *    A line that names no place is a question, and Enter sends it to jkai.
   *  * With the box empty it shows Lately (the last few places this browser
   *    went — the only part of the nav that reorders itself) and the rooms.
   *
   * Drawn by `RoomMenu`, once per page, so it exists exactly where rooms do:
   * a viewer with three destinations has no use for a map of them.
   */
  import { askHref, matchPlaces, placeAt, placesFor, type Place } from '$lib/nav/go';
  import {
    closeNavMap,
    mapHoverLeave,
    mapHoverStay,
    navMap,
    openNavMap,
    pinNavMap,
    readLately,
    recordVisit,
  } from '$lib/nav/nav-map.svelte';
  import { isItemActive, visibleRooms } from '$lib/nav/site-nav';

  let {
    path,
    isOwner = true,
    reach = [],
    anchor,
  }: {
    path: string;
    isOwner?: boolean;
    reach?: readonly string[];
    /** An element on the bar; the sheet hangs from the bar that holds it. */
    anchor?: HTMLElement;
  } = $props();

  const rooms = $derived(visibleRooms(isOwner, reach));
  const places = $derived(placesFor(isOwner, reach));
  const here = $derived(placeAt(path, places));

  let query = $state('');
  let picked = $state(0);
  let lately = $state<string[]>([]);
  let top = $state(48);
  let field = $state<HTMLInputElement>();
  let sheet = $state<HTMLElement>();

  const asking = $derived(query.trim().length > 0);
  const found = $derived(matchPlaces(query, places).slice(0, 7));
  /** Only the owner has a jkai to ask. */
  const canAsk = $derived(isOwner && asking);
  const rowCount = $derived(found.length + (canAsk ? 1 : 0));
  const latelyPlaces = $derived(
    lately
      .map((href) => places.find((p) => p.href === href))
      .filter((p): p is Place => !!p && p.href !== here?.href)
      .slice(0, 4),
  );

  // A new page: remember it, and take the sheet down.
  $effect(() => {
    if (here) recordVisit(here.href);
    closeNavMap();
  });

  $effect(() => {
    if (!navMap.open) return;
    query = '';
    picked = 0;
    lately = readLately();
    const bar = anchor?.closest('header') ?? anchor?.parentElement;
    if (bar) top = Math.max(0, bar.getBoundingClientRect().bottom);
    field?.focus();
  });

  $effect(() => {
    void query;
    picked = 0;
  });

  function typing(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    return !!el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
  }
  function onWindowKey(e: KeyboardEvent) {
    if (navMap.open) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeNavMap();
      }
      return;
    }
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
    e.preventDefault();
    openNavMap();
  }
  function onWindowPointer(e: PointerEvent) {
    if (!navMap.open) return;
    const t = e.target as Node | null;
    if (t && sheet?.contains(t)) return pinNavMap();
    closeNavMap();
  }
  function onFieldKey(e: KeyboardEvent) {
    if (!rowCount) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      picked = (picked + 1) % rowCount;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      picked = (picked - 1 + rowCount) % rowCount;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Pressing the row itself, so a place in another app loads the way
      // every other link to it does.
      sheet?.querySelector<HTMLAnchorElement>(`[data-row="${picked}"]`)?.click();
    }
  }
</script>

<svelte:window onkeydown={onWindowKey} onpointerdown={onWindowPointer} />

{#if navMap.open}
  <div
    bind:this={sheet}
    class="nav-map"
    role="dialog"
    aria-label="Site map"
    style="top: {top}px"
    onpointerenter={mapHoverStay}
    onpointerleave={mapHoverLeave}
  >
    <label class="box">
      <span class="box-key" aria-hidden="true">/</span>
      <input
        bind:this={field}
        bind:value={query}
        type="text"
        placeholder={isOwner ? 'Go somewhere, or ask jkai' : 'Go somewhere'}
        aria-label={isOwner ? 'Go somewhere, or ask jkai' : 'Go somewhere'}
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        enterkeyhint="go"
        oninput={pinNavMap}
        onkeydown={onFieldKey}
      />
      <span class="box-hint" aria-hidden="true">esc</span>
    </label>

    {#if asking}
      <ul class="rows">
        {#each found as place, i (place.href)}
          <li>
            <a
              href={place.href}
              class="row"
              class:picked={i === picked}
              data-row={i}
              onclick={closeNavMap}
              onpointermove={() => (picked = i)}
            >
              <span class="row-label">{place.label}</span>
              <span class="row-meta">{place.context}</span>
              <span class="row-do">Go</span>
            </a>
          </li>
        {/each}
        {#if canAsk}
          <li>
            <a
              href={askHref(query)}
              class="row ask"
              class:picked={picked === found.length}
              data-row={found.length}
              onclick={closeNavMap}
              onpointermove={() => (picked = found.length)}
            >
              <span class="row-label">{query.trim()}</span>
              <span class="row-meta">A question for jkai</span>
              <span class="row-do">Ask</span>
            </a>
          </li>
        {:else if !found.length}
          <li class="none">Nowhere by that name.</li>
        {/if}
      </ul>
    {:else}
      {#if latelyPlaces.length}
        <div class="lately">
          <span class="lately-head">Lately</span>
          {#each latelyPlaces as place (place.href)}
            <a href={place.href} class="lately-chip" onclick={closeNavMap}>{place.label}</a>
          {/each}
        </div>
      {/if}
      <div class="rooms">
        {#each rooms as room (room.id)}
          <section class="room" aria-label={room.label}>
            <h2>{room.label}</h2>
            <p>{room.blurb}</p>
            <ul>
              {#each room.items as item (item.href + item.label)}
                <li>
                  <a
                    href={item.href}
                    aria-current={isItemActive(item, path) ? 'page' : undefined}
                    onclick={closeNavMap}>{item.label}</a
                  >
                </li>
              {/each}
            </ul>
          </section>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  /* The bar carried on downwards, as the room menus are: literal ink and
     cream, because the bars are ink in both themes. */
  .nav-map {
    position: fixed;
    left: 0;
    z-index: 45;
    width: min(760px, 100vw);
    max-height: calc(100dvh - 64px);
    overflow-y: auto;
    background: #1a1008;
    color: #ede4d4;
    border: 1px solid rgba(237, 228, 212, 0.14);
    border-top: 2px solid var(--accent-on-dark);
    box-shadow: 0 14px 32px rgba(0, 0, 0, 0.45);
    text-align: left;
  }

  .box {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 16px;
    border-bottom: 1px solid rgba(237, 228, 212, 0.14);
  }
  .box-key,
  .box-hint {
    flex: none;
    font-family: var(--font-code);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.5);
  }
  .box-key {
    color: var(--accent-on-dark);
  }
  .box input {
    flex: 1;
    min-width: 0;
    padding: 15px 0;
    border: 0;
    outline: none;
    background: none;
    font-family: var(--font-body);
    font-size: 1rem;
    color: #ede4d4;
  }
  .box input::placeholder {
    color: rgba(237, 228, 212, 0.5);
  }
  .box:focus-within {
    box-shadow: inset 0 -2px 0 var(--accent-on-dark);
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .rows li + li {
    border-top: 1px solid rgba(237, 228, 212, 0.14);
  }
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 2px 16px;
    align-items: center;
    padding: 11px 16px;
    text-decoration: none;
    color: rgba(237, 228, 212, 0.72);
  }
  .row-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-code);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
  }
  /* A question is a sentence, not a label. */
  .row.ask .row-label {
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
  }
  .row-meta {
    grid-column: 1;
    font-family: var(--font-code);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
    color: rgba(237, 228, 212, 0.5);
  }
  .row-do {
    grid-column: 2;
    grid-row: 1 / span 2;
    font-family: var(--font-code);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: rgba(237, 228, 212, 0.5);
  }
  /* The row Enter takes: the cream cut-out a current cell wears. */
  .row.picked,
  .row:focus-visible {
    outline: none;
    color: #1a1008;
    background: #ede4d4;
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .row.picked .row-meta,
  .row.picked .row-do,
  .row:focus-visible .row-meta,
  .row:focus-visible .row-do {
    color: rgba(26, 16, 8, 0.6);
  }
  .none {
    padding: 14px 16px;
    font-family: var(--font-code);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
    color: rgba(237, 228, 212, 0.5);
  }

  .lately {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 8px;
    padding: 10px 16px;
    border-bottom: 1px solid rgba(237, 228, 212, 0.14);
  }
  .lately-head {
    margin-right: 4px;
    font-family: var(--font-code);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: rgba(237, 228, 212, 0.5);
  }
  .lately-chip {
    padding: 4px 10px;
    border: 1px solid rgba(237, 228, 212, 0.22);
    border-radius: 100px;
    font-family: var(--font-code);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    text-decoration: none;
    color: rgba(237, 228, 212, 0.72);
  }
  .lately-chip:hover,
  .lately-chip:focus-visible {
    outline: none;
    color: var(--accent-on-dark);
    border-color: var(--accent-on-dark);
  }

  .rooms {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
  .room {
    padding: 14px 0 10px;
    border-right: 1px solid rgba(237, 228, 212, 0.14);
  }
  .room:last-child {
    border-right: 0;
  }
  .room h2 {
    margin: 0;
    padding: 0 16px;
    font-family: var(--font-code);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--accent-on-dark);
  }
  .room p {
    margin: 4px 0 8px;
    padding: 0 16px;
    min-height: 2.6em;
    font-family: var(--font-code);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
    line-height: 1.3;
    color: rgba(237, 228, 212, 0.5);
  }
  .room a {
    display: block;
    padding: 7px 16px;
    font-family: var(--font-code);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    text-decoration: none;
    color: rgba(237, 228, 212, 0.72);
  }
  .room a:hover,
  .room a:focus-visible {
    outline: none;
    color: var(--accent-on-dark);
    background: rgba(237, 228, 212, 0.07);
  }
  .room a[aria-current='page'] {
    color: #1a1008;
    background: #ede4d4;
    box-shadow: inset 3px 0 0 var(--accent);
  }

  /* Phone: the sheet is the width of the screen and the rooms run two abreast. */
  @media (max-width: 640px) {
    .nav-map {
      border-left: 0;
      border-right: 0;
    }
    .box-hint {
      display: none;
    }
    .rooms {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .room {
      border-bottom: 1px solid rgba(237, 228, 212, 0.14);
    }
    .room:nth-child(2n) {
      border-right: 0;
    }
    .room p {
      min-height: 0;
    }
    .room a {
      padding: 10px 16px;
    }
  }
</style>
