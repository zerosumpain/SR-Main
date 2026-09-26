<script lang="ts">
  /**
   * The owner's places panel — /home/people/places.
   *
   * Every place on a map, beside the same places as a list. On the map a
   * place is a circle: select it (click it, or its row) and its details open
   * in a panel NEXT TO the map (under it on a phone, with the map kept in
   * view), so nothing is a scroll away. Drag the centre to move it, drag the
   * edge handle to set the radius, then Save. × or Escape closes the panel. "Add a place"
   * drops a new circle where the map is next clicked. Moving, resizing or
   * creating a place pins its geometry: the nightly places refresh stops
   * re-deriving it.
   *
   * Each place says whether the household hears about a crossing ("Notify
   * family"), in which directions (arrive, leave), and whether by WhatsApp as
   * well. Nothing notifies unless its switch is on — home included (home is
   * still watched, so who is in stays known).
   *
   * A place that is no longer wanted can be removed from its editor (never
   * home): it is set aside, not deleted, so its alerts stop and the nightly
   * refresh does not suggest it again. The editor also says who spends how
   * long there — streamed after the page, so the map never waits for it.
   *
   * The list is the whole page without the map: every place can be selected
   * from it by keyboard, which opens the same panel and moves focus into it.
   * While a place is open the list sits under the map and panel. Owner only; the load
   * and every action check.
   */
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import HomeFrame from '$lib/components/home/HomeFrame.svelte';
  import PlaceEditor from '$lib/components/home/PlaceEditor.svelte';
  import PlacesMap, { type Geometry } from '$lib/components/home/PlacesMap.svelte';
  import LoadErrorCard from '$lib/components/jkai/daydream/hub/LoadErrorCard.svelte';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import { NEW_PLACE_RADIUS_M, clampRadius } from '$lib/home/presence/geo';
  import { tick } from 'svelte';
  import type { ActionData, PageData } from './$types';

  type EditorForm = import('svelte').ComponentProps<typeof PlaceEditor>['form'];

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const places = $derived(data.places);
  const alerting = $derived(places.filter((p) => p.alerts).length);
  const byWhatsApp = $derived(places.filter((p) => p.whatsappAlerts).length);
  const summary = $derived([
    { label: 'Places', value: String(places.length), sub: 'named, plus home' },
    { label: 'Alerting', value: String(alerting), sub: 'notify the family' },
    { label: 'WhatsApp', value: String(byWhatsApp), sub: 'also sent by message' },
  ]);

  /** The place being looked at / edited, and its unsaved geometry. With no
   *  selection, a non-null draft is a NEW place being drawn. */
  let selectedId = $state<string | null>(null);
  let draft = $state<Geometry | null>(null);
  let placing = $state(false);
  /** Adding a place needs a working map: it is placed by clicking one. */
  let mapStatus = $state<'loading' | 'ready' | 'unavailable'>('loading');
  let mapView = $state<{ centre: () => { lat: number; lon: number } | null; fitAll: () => void } | null>(null);
  /** The detail panel, for moving focus into it. */
  let panelEl: HTMLElement | undefined = $state();

  const selected = $derived(places.find((p) => p.id === selectedId) ?? null);

  // A selected place that has gone from the list (ignored or merged since, by
  // another tab or the nightly refresh) leaves nothing to edit. Reads only the
  // list and the id; the write is guarded, so it runs once.
  $effect(() => {
    if (selectedId && !places.some((p) => p.id === selectedId)) {
      selectedId = null;
      draft = null;
    }
  });
  const creating = $derived(!selectedId && !!draft);
  const moved = $derived(
    !!selected &&
      !!draft &&
      (draft.lat !== selected.lat || draft.lon !== selected.lon || Math.round(draft.radiusM) !== Math.round(selected.radiusM)),
  );

  function geometryOf(p: { lat: number; lon: number; radiusM: number }): Geometry {
    return { lat: p.lat, lon: p.lon, radiusM: Math.round(p.radiusM) };
  }

  /** Select a place. From the list (`focus`), keyboard focus follows it into
   *  the panel, wherever the panel is drawn. */
  async function select(id: string, focus = false) {
    placing = false;
    if (selectedId !== id) confirming = false;
    if (selectedId !== id) {
      const p = places.find((x) => x.id === id);
      selectedId = p ? id : null;
      draft = p ? geometryOf(p) : null;
    }
    if (!selectedId) return;
    await tick();
    showPanel();
    // preventScroll: showPanel has just put the map and panel on screen.
    if (focus) panelEl?.querySelector<HTMLElement>('#place-panel-title')?.focus({ preventScroll: true });
  }

  /** Bring the map and the open panel onto the screen together, unless they
   *  already are (a click on the map must not jump the page). */
  function showPanel() {
    const mapEl = document.querySelector<HTMLElement>('.places-layout .map-col');
    if (!mapEl || !panelEl) return;
    const nav = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--site-nav-height')) || 56;
    const top = mapEl.getBoundingClientRect().top;
    const bottom = Math.max(mapEl.getBoundingClientRect().bottom, panelEl.getBoundingClientRect().bottom);
    if (top < nav || bottom > window.innerHeight) mapEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  async function closeEditor() {
    const was = selectedId;
    confirming = false;
    selectedId = null;
    draft = null;
    placing = false;
    // Keyboard focus goes back to the place's row, not to the top of the page.
    if (was && panelEl?.contains(document.activeElement)) {
      await tick();
      document.querySelector<HTMLElement>(`.row-select[data-place="${CSS.escape(was)}"]`)?.focus();
    }
  }

  /** The remove confirm in the open panel is showing. */
  let confirming = $state(false);

  /** Escape backs out ONE step and never throws work away: never from a
   *  field being typed in; a remove confirm answers "Keep"; an unsaved move
   *  is undone; only then does the panel close. */
  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.closest('input, select, textarea') || t.isContentEditable)) return;
    if (placing) placing = false;
    else if (!selectedId) return;
    else if (confirming) confirming = false;
    else if (moved) revert();
    else closeEditor();
  }

  function revert() {
    if (selected) draft = geometryOf(selected);
    else closeEditor();
  }

  function startAdding() {
    selectedId = null;
    draft = null;
    placing = true;
  }

  function dropAt(lat: number, lon: number) {
    placing = false;
    selectedId = null;
    draft = { lat, lon, radiusM: NEW_PLACE_RADIUS_M };
  }

  function dropAtCentre() {
    const c = mapView?.centre();
    if (c) dropAt(c.lat, c.lon);
  }

  function onRadiusInput(e: Event & { currentTarget: HTMLInputElement }) {
    const v = Number(e.currentTarget.value);
    if (draft && Number.isFinite(v) && v >= data.radius.min && v <= data.radius.max) draft = { ...draft, radiusM: Math.round(v) };
  }

  function onRadiusChange(e: Event & { currentTarget: HTMLInputElement }) {
    if (!draft) return;
    const r = clampRadius(Number(e.currentTarget.value));
    draft = { ...draft, radiusM: r };
    e.currentTarget.value = String(r);
  }

  function kindLabel(kind: string): string {
    return kind === 'unknown' ? 'kind not set' : kind;
  }

  const keep: SubmitFunction = () => async ({ update }) => {
    await update({ reset: false });
  };

  /** After a geometry save, the draft is whatever was stored. */
  const afterGeometry: SubmitFunction = () => async ({ result, update }) => {
    await update({ reset: false });
    if (result.type === 'success' && selectedId) {
      const p = data.places.find((x) => x.id === selectedId);
      if (p) draft = geometryOf(p);
    }
  };

  /** A created place becomes the selected one. */
  const afterCreate: SubmitFunction = () => async ({ result, update }) => {
    await update({ reset: false });
    if (result.type === 'success' && typeof result.data?.created === 'string') {
      const p = data.places.find((x) => x.id === result.data?.created);
      selectedId = p ? p.id : null;
      draft = p ? geometryOf(p) : null;
    }
  };

  /** A removed place leaves the list on the refreshed load; the editor goes
   *  with it (the selection effect above would clear it anyway). */
  const afterRemove: SubmitFunction = () => async ({ result, update }) => {
    await update({ reset: false });
    if (result.type === 'success') closeEditor();
  };

  const formError = $derived(form && 'error' in form && form.error ? form : null);
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet listBlock()}
  <div class="list-head">
    {#if mapStatus === 'unavailable'}
      <p class="map-note">Map unavailable — places can still be edited in the list.</p>
    {/if}
    {#if form && 'removed' in form && form.removed}
      <p class="map-note good" role="status">Removed {form.removedLabel ?? 'the place'}.</p>
    {/if}
    {#if mapStatus === 'ready'}
      <button class="btn" type="button" onclick={() => mapView?.fitAll()}>Show all places</button>
    {/if}
    <button
      class="btn"
      type="button"
      onclick={startAdding}
      aria-pressed={placing}
      disabled={mapStatus !== 'ready'}
      aria-describedby={mapStatus === 'ready' ? undefined : 'add-needs-map'}
    >Add a place</button>
    {#if mapStatus === 'loading'}<span class="map-note" id="add-needs-map">Waiting for the map</span>{/if}
    {#if mapStatus === 'unavailable'}<span class="visually-hidden" id="add-needs-map">Adding a place needs the map.</span>{/if}
  </div>

  {#if creating && draft}
    <form class="card place open new" method="POST" action="?/create" use:enhance={afterCreate}>
      <p class="card-kicker">New place · pinned where you put it</p>
      <input type="hidden" name="lat" value={draft.lat} />
      <input type="hidden" name="lon" value={draft.lon} />
      <div class="actions">
        <label class="field">
          <span class="field-label">Name</span>
          <!-- svelte-ignore a11y_autofocus -->
          <input class="text-input" name="label" maxlength={data.labelMax} required autocomplete="off" autofocus />
        </label>
        <label class="field kind">
          <span class="field-label">Kind</span>
          <select class="text-input select" name="kind">
            {#each data.kinds as k (k)}<option value={k} selected={k === 'other'}>{k}</option>{/each}
          </select>
        </label>
        <label class="field radius">
          <span class="field-label">Radius (m)</span>
          <input
            class="text-input"
            name="radiusM"
            type="number"
            inputmode="numeric"
            min={data.radius.min}
            max={data.radius.max}
            step="10"
            value={draft.radiusM}
            oninput={onRadiusInput}
            onchange={onRadiusChange}
            required
          />
        </label>
      </div>
      <div class="card-actions">
        <button class="cta sm" type="submit">Save</button>
        <button class="btn" type="button" onclick={closeEditor}>Cancel</button>
      </div>
      {#if formError && !formError.placeId}<p class="err" role="alert">{formError.error}</p>{/if}
    </form>
  {/if}

  {#if !places.length}
    <p class="lede">No named places yet. Add one on the map, or name them from the daydream naming queue.</p>
  {:else}
    <ul class="stack place-list">
      {#each places as p (p.id)}
        {@const open = p.id === selectedId}
        <li class="card place" class:open>
          <button
            class="row-select"
            type="button"
            data-place={p.id}
            aria-expanded={open}
            aria-controls={open ? 'place-panel' : undefined}
            onclick={() => (open ? closeEditor() : select(p.id, true))}
          >
            <span class="card-kicker">
              {p.isHome ? 'home' : kindLabel(p.kind)} · {p.visitCount} visits{p.radiusPinned ? ' · set by you' : ''}
            </span>
            <span class="row-title">{p.label ?? 'Home'}</span>
            <span class="row-meta">
              {Math.round(open && draft ? draft.radiusM : p.radiusM)} m ·
              {#if p.alerts}
                notifies on {p.alertArrive && p.alertLeave ? 'arrive and leave' : p.alertArrive ? 'arrive' : p.alertLeave ? 'leave' : 'neither'}{#if p.whatsappAlerts}, WhatsApp too{/if}
              {:else}
                no notifications
              {/if}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if formError && !formError.placeId && !creating}<p class="err" role="alert">{formError.error}</p>{/if}
  <p class="rules">
    <span class="phone-only">Select a place on the map or in the list; drag its centre to move it and the square handle to set the radius, 50 to 2,000 m.</span>
    Someone arrives on the first fix inside a place’s edge and leaves on the first one more than 50 m outside it. No place
    notifies anyone until you switch it on; a place with WhatsApp on also messages anyone who asked, at most once every half
    hour per person and place.
  </p>
{/snippet}

<HomeFrame
  path="/home/people/places"
  kicker="Home · People · Places"
  title={['Where an arrival', 'is worth a message']}
  standfirst="Who hears when someone comes or goes."
  {summary}
  footer={['strangeramblings.com/home/people/places', 'Arrive and leave alerts', 'Owner only']}
>
  {#if data.loadError}
    <section class="band"><div class="inner"><LoadErrorCard kicker="The places did not load" message={data.loadError} /></div></section>
  {/if}

  <section class="band places-band">
    <div class="inner">
      <div class="head">
      <SectionHead
        kicker="A / Places"
        title={['Named places,', 'and home']}
        strap="Select a place on the map or in the list: its details open beside the map. Drag its centre to move it and the square handle to set the radius, 50 to 2,000 m."
      />
      </div>

      <div class="places-layout" class:has-panel={!!selected}>
        <div class="map-col">
          <PlacesMap
            bind:this={mapView}
            {places}
            {selectedId}
            {draft}
            {placing}
            onselect={select}
            ondraft={(g) => (draft = g)}
            onplace={dropAt}
            onstatus={(st) => {
              mapStatus = st;
              if (st !== 'ready') placing = false;
            }}
          />
          {#if placing}
            <div class="map-bar" role="status">
              <span>Click the map where the place is.</span>
              <button class="btn" type="button" onclick={dropAtCentre}>Use the map centre</button>
              <button class="btn" type="button" onclick={() => (placing = false)}>Cancel</button>
            </div>
          {:else if selected && moved && draft}
            <form class="map-bar" method="POST" action="?/move" use:enhance={afterGeometry}>
              <input type="hidden" name="placeId" value={selected.id} />
              <input type="hidden" name="lat" value={draft.lat} />
              <input type="hidden" name="lon" value={draft.lon} />
              <input type="hidden" name="radiusM" value={draft.radiusM} />
              <span>{selected.label ?? 'Home'}: {draft.radiusM} m, not saved.</span>
              <button class="cta sm" type="submit">Save</button>
              <button class="btn" type="button" onclick={revert}>Cancel</button>
            </form>
          {/if}
        </div>

        <div class="side-col">
          {#if selected && draft}
            <section
              class="card place-panel"
              id="place-panel"
              aria-labelledby="place-panel-title"
              bind:this={panelEl}
            >
              <header class="panel-head">
                <div>
                  <p class="card-kicker">
                    {selected.isHome ? 'home' : kindLabel(selected.kind)} · {selected.visitCount} visits{selected.radiusPinned ? ' · set by you' : ''}
                  </p>
                  <h3 class="panel-title" id="place-panel-title" tabindex="-1">{selected.label ?? 'Home'}</h3>
                </div>
                <button class="close" type="button" onclick={closeEditor} aria-label="Close {selected.label ?? 'home'}">
                  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.8" fill="none" /></svg>
                </button>
              </header>
              {#key selected.id}
                <PlaceEditor
                  place={selected}
                  {draft}
                  {moved}
                  radius={data.radius}
                  labelMax={data.labelMax}
                  kinds={data.kinds}
                  placeTimeDays={data.placeTimeDays}
                  placeTime={data.placeTime}
                  form={form as EditorForm}
                  onradius={(r) => draft && (draft = { ...draft, radiusM: r })}
                  onrevert={revert}
                  {afterGeometry}
                  {afterRemove}
                  bind:confirming
                />
              {/key}
            </section>
          {:else}
            {@render listBlock()}
          {/if}
        </div>

        {#if selected}
          <div class="below">{@render listBlock()}</div>
        {/if}
      </div>
    </div>
  </section>
</HomeFrame>

<style>
  /* Room-specific only — `.card`, `.text-input`, `.field-label`, `.actions`,
     `.card-actions`, `.cta`, `.btn`, `.note`, `.err` come from HomeFrame's
     DsVocab. */
  /* On a phone the map has to start near the top, so the section's masthead
     is kept for the outline and screen readers but not drawn: the hero has
     just said what the page is, and the how-to sits under the list. */
  @media (max-width: 719px) {
    .head {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .head + .places-layout {
      margin-top: 0;
    }
    .band.places-band {
      padding-top: 8px;
    }
  }
  @media (min-width: 720px) {
    .phone-only {
      display: none;
    }
  }
  .rules {
    margin: 16px 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.65;
    color: var(--text-secondary);
  }
  .places-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 20px;
    margin-top: 20px;
  }
  .map-col {
    position: relative;
    height: 55vh;
    min-height: 320px;
  }
  /* The page shell clips overflow, so `position: sticky` never sticks here.
     Instead, while a place is open, the map and its panel are sized to share
     one screen, and selecting scrolls them into it (see `showPanel`). On a
     phone the panel sits straight under a shorter map and scrolls inside
     itself, so the map stays in view above it. */
  .map-col,
  .place-panel {
    scroll-margin-top: calc(var(--site-nav-height, 56px) + 8px);
  }
  @media (max-width: 899px) {
    .has-panel .map-col {
      height: 38svh;
      min-height: 220px;
    }
    .has-panel {
      gap: 12px;
    }
    .place-panel {
      max-height: calc(100svh - max(38svh, 220px) - var(--site-nav-height, 56px) - 28px);
      min-height: 240px;
      overflow-y: auto;
    }
  }
  @media (min-width: 900px) {
    .places-layout {
      grid-template-columns: minmax(0, 1.5fr) minmax(340px, 1fr);
      align-items: start;
    }
    .map-col {
      height: min(78vh, 760px);
    }
    /* The panel is as tall as the map at most, and scrolls inside itself, so
       the map and the place's details sit side by side on one screen. */
    .place-panel {
      max-height: min(78vh, 760px);
      overflow-y: auto;
    }
    .below {
      grid-column: 1 / -1;
    }
  }
  .side-col,
  .below {
    min-width: 0;
  }
  .place-panel {
    margin: 0;
    background: var(--surface-elevated);
    border-left: 3px solid var(--accent);
  }
  .panel-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--line-hair);
  }
  .panel-head .card-kicker {
    margin: 0 0 4px;
  }
  .panel-title {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--fs-body-lg, 1.2rem);
    font-weight: 400;
    color: var(--text-primary);
  }
  .panel-title:focus-visible,
  .close:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
  .close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    background: var(--bg);
    color: var(--text-primary);
    cursor: pointer;
  }
  .close:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .place.open {
    border-left-color: var(--accent);
  }
  .map-bar {
    position: absolute;
    top: 12px;
    right: 12px;
    left: 56px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    padding: 10px 12px;
    background: var(--surface-elevated);
    border: 1px solid var(--line-strong);
    border-left: 3px solid var(--accent);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-primary);
  }
  .map-bar span {
    flex: 1 1 160px;
  }
  .list-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 8px 12px;
    margin-bottom: 12px;
  }
  .map-note {
    margin: 0;
    flex: 1 1 200px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .place-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .place.new {
    margin-bottom: 12px;
    border-left-color: var(--accent);
  }
  .row-select {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    width: 100%;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .row-select:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 4px;
  }
  .row-select .card-kicker {
    margin: 0;
  }
  .row-title {
    font-family: var(--font-display);
    font-size: var(--fs-body-lg, 1.2rem);
    color: var(--text-primary);
  }
  .row-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
  }
  .field {
    display: flex;
    flex-direction: column;
    flex: 1 1 200px;
    min-width: 0;
  }
  .field .field-label {
    margin-bottom: 6px;
  }
  .field.radius {
    flex: 0 1 130px;
  }
  .field.kind {
    flex: 0 1 140px;
  }
  .map-note.good {
    color: var(--success);
  }
</style>
