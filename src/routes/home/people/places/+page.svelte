<script lang="ts">
  /**
   * The owner's places panel — /home/people/places.
   *
   * Every place on a map, beside the same places as a list. On the map a
   * place is a circle: select it (click it, or its row), drag the centre to
   * move it, drag the edge handle to set the radius, then Save. "Add a place"
   * drops a new circle where the map is next clicked. Moving, resizing or
   * creating a place pins its geometry: the nightly places refresh stops
   * re-deriving it.
   *
   * Each place says whether the household hears about a crossing ("Notify
   * family"), in which directions (arrive, leave), and whether by WhatsApp as
   * well. Home is always watched; its direction switches still apply.
   *
   * The list is the whole page without the map: every place can be selected,
   * renamed, resized and switched from it by keyboard. Owner only; the load
   * and every action check.
   */
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import HomeFrame from '$lib/components/home/HomeFrame.svelte';
  import PlacesMap, { type Geometry } from '$lib/components/home/PlacesMap.svelte';
  import LoadErrorCard from '$lib/components/jkai/daydream/hub/LoadErrorCard.svelte';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import { NEW_PLACE_RADIUS_M, clampRadius } from '$lib/home/presence/geo';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const places = $derived(data.places);
  const watched = $derived(places.filter((p) => p.alerts || p.isHome).length);
  const byWhatsApp = $derived(places.filter((p) => p.whatsappAlerts).length);
  const summary = $derived([
    { label: 'Places', value: String(places.length), sub: 'named, plus home' },
    { label: 'Alerting', value: String(watched), sub: 'home always' },
    { label: 'WhatsApp', value: String(byWhatsApp), sub: 'also sent by message' },
  ]);

  /** The place being looked at / edited, and its unsaved geometry. With no
   *  selection, a non-null draft is a NEW place being drawn. */
  let selectedId = $state<string | null>(null);
  let draft = $state<Geometry | null>(null);
  let placing = $state(false);
  let mapView = $state<{ centre: () => { lat: number; lon: number } | null } | null>(null);

  const selected = $derived(places.find((p) => p.id === selectedId) ?? null);
  const creating = $derived(!selectedId && !!draft);
  const moved = $derived(
    !!selected &&
      !!draft &&
      (draft.lat !== selected.lat || draft.lon !== selected.lon || Math.round(draft.radiusM) !== Math.round(selected.radiusM)),
  );

  function geometryOf(p: { lat: number; lon: number; radiusM: number }): Geometry {
    return { lat: p.lat, lon: p.lon, radiusM: Math.round(p.radiusM) };
  }

  function select(id: string) {
    placing = false;
    if (selectedId === id) return;
    const p = places.find((x) => x.id === id);
    selectedId = p ? id : null;
    draft = p ? geometryOf(p) : null;
  }

  function closeEditor() {
    selectedId = null;
    draft = null;
    placing = false;
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

  function submitOnChange(e: Event & { currentTarget: HTMLInputElement }) {
    e.currentTarget.form?.requestSubmit();
  }

  const formError = $derived(form && 'error' in form && form.error ? form : null);
</script>

<HomeFrame
  path="/home/people/places"
  kicker="Home · People · Places"
  title={['Where an arrival', 'is worth a message']}
  standfirst="The places that tell the household when someone arrives or leaves. Home always does. A place with WhatsApp on also sends a message to anyone who has asked for them, at most one every half hour per person and place."
  {summary}
  footer={['strangeramblings.com/home/people/places', 'Arrive and leave alerts', 'Owner only']}
>
  {#if data.loadError}
    <section class="band"><div class="inner"><LoadErrorCard kicker="The places did not load" message={data.loadError} /></div></section>
  {/if}

  <section class="band">
    <div class="inner">
      <SectionHead
        kicker="A / Places"
        title={['Named places,', 'and home']}
        strap="Select a place on the map or in the list. Drag its centre to move it and the square handle to set the radius, 50 to 2,000 m. Someone arrives on the first fix inside the edge and leaves on the first one more than 50 m outside it."
      />

      <div class="places-layout">
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

        <div class="list-col">
          <div class="list-head">
            <button class="btn" type="button" onclick={startAdding} aria-pressed={placing}>Add a place</button>
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
                    aria-expanded={open}
                    aria-controls="place-{p.id}"
                    onclick={() => (open ? closeEditor() : select(p.id))}
                  >
                    <span class="card-kicker">
                      {p.isHome ? 'home' : kindLabel(p.kind)} · {p.visitCount} visits{p.radiusPinned ? ' · set by you' : ''}
                    </span>
                    <span class="row-title">{p.label ?? 'Home'}</span>
                    <span class="row-meta">
                      {Math.round(open && draft ? draft.radiusM : p.radiusM)} m ·
                      {#if p.alerts || p.isHome}
                        notifies on {p.alertArrive && p.alertLeave ? 'arrive and leave' : p.alertArrive ? 'arrive' : p.alertLeave ? 'leave' : 'neither'}{#if p.whatsappAlerts}, WhatsApp too{/if}
                      {:else}
                        no alerts
                      {/if}
                    </span>
                  </button>

                  {#if open && draft}
                    <div class="editor" id="place-{p.id}">
                      <form method="POST" action="?/save" use:enhance={afterGeometry}>
                        <input type="hidden" name="placeId" value={p.id} />
                        <input type="hidden" name="lat" value={draft.lat} />
                        <input type="hidden" name="lon" value={draft.lon} />
                        <div class="actions">
                          <label class="field">
                            <span class="field-label">Name</span>
                            <input
                              class="text-input"
                              name="label"
                              value={p.label ?? ''}
                              placeholder={p.isHome ? 'home' : ''}
                              maxlength="200"
                              autocomplete="off"
                            />
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
                          <button class="btn" type="button" onclick={revert} disabled={!moved}>Undo move</button>
                          {#if form && 'saved' in form && form.saved === p.id}<span class="note good inline">Saved.</span>{/if}
                          {#if form && 'moved' in form && form.moved === p.id}<span class="note good inline">Moved.</span>{/if}
                        </div>
                      </form>

                      <form class="notify" method="POST" action="?/notify" use:enhance={keep}>
                        <input type="hidden" name="placeId" value={p.id} />
                        <label class="toggle">
                          <input type="checkbox" name="alerts" checked={p.alerts || p.isHome} disabled={p.isHome} onchange={submitOnChange} />
                          <span>Notify family{#if p.isHome} (always, for home){/if}</span>
                        </label>
                        <fieldset class="sub" class:dim={!p.alerts && !p.isHome}>
                          <legend class="field-label">When they</legend>
                          <label class="toggle">
                            <input type="checkbox" name="alertArrive" checked={p.alertArrive} onchange={submitOnChange} />
                            <span>arrive</span>
                          </label>
                          <label class="toggle">
                            <input type="checkbox" name="alertLeave" checked={p.alertLeave} onchange={submitOnChange} />
                            <span>leave</span>
                          </label>
                          <label class="toggle">
                            <input type="checkbox" name="whatsappAlerts" checked={p.whatsappAlerts} onchange={submitOnChange} />
                            <span>also by WhatsApp</span>
                          </label>
                        </fieldset>
                        <noscript><button class="btn" type="submit">Save alerts</button></noscript>
                        {#if form && 'notified' in form && form.notified === p.id}<span class="note good inline">Saved.</span>{/if}
                      </form>
                      {#if formError && formError.placeId === p.id}<p class="err" role="alert">{formError.error}</p>{/if}
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
          {#if formError && !formError.placeId && !creating}<p class="err" role="alert">{formError.error}</p>{/if}
        </div>
      </div>
    </div>
  </section>
</HomeFrame>

<style>
  /* Room-specific only — `.card`, `.text-input`, `.field-label`, `.actions`,
     `.card-actions`, `.cta`, `.btn`, `.note`, `.err` come from HomeFrame's
     DsVocab. */
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
  @media (min-width: 900px) {
    .places-layout {
      grid-template-columns: minmax(0, 1.5fr) minmax(320px, 1fr);
      align-items: start;
    }
    .map-col {
      position: sticky;
      top: calc(var(--site-nav-height, 56px) + 16px);
      height: min(78vh, 760px);
    }
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
  .list-col {
    min-width: 0;
  }
  .list-head {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 12px;
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
  .editor {
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid var(--line-hair);
    display: flex;
    flex-direction: column;
    gap: 16px;
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
  /* DsVocab gives `.text-input` `flex: 1 1 220px` for a row of controls; in
     this column label that basis is a HEIGHT, and made every input 220px
     tall. */
  .field .text-input {
    flex: 0 0 auto;
  }
  .field.radius {
    flex: 0 1 130px;
  }
  .field.kind {
    flex: 0 1 140px;
  }
  .notify {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .sub {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 18px;
    margin: 0;
    padding: 0 0 0 26px;
    border: 0;
  }
  .sub legend {
    float: left;
    margin-right: 4px;
    padding: 0;
  }
  .sub.dim {
    opacity: 0.6;
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
  }
  .toggle input {
    accent-color: var(--accent);
    width: 18px;
    height: 18px;
  }
  .inline {
    margin: 0;
  }
</style>
