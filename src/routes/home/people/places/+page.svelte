<script lang="ts">
  import { enhance } from '$app/forms';
  import { tick } from 'svelte';
  import type { SubmitFunction } from '@sveltejs/kit';
  import HomeFrame from '$lib/components/home/HomeFrame.svelte';
  import PeopleNav from '$lib/components/home/PeopleNav.svelte';
  import PlaceEditor from '$lib/components/home/PlaceEditor.svelte';
  import PlacesMap, { type Geometry } from '$lib/components/home/PlacesMap.svelte';
  import { NEW_PLACE_RADIUS_M } from '$lib/home/presence/geo';
  import type { PanelPlace } from '$lib/home/presence/places';
  import type { ActionData, PageData } from './$types';
  type EditorForm = import('svelte').ComponentProps<typeof PlaceEditor>['form'];
  let { data, form }: { data: PageData; form: ActionData } = $props();
  let query = $state('');
  let filter = $state<'all' | 'review' | 'named' | 'alerts'>('all');
  let selectedId = $state<string | null>(null);
  /** The place the list is pointing at: the map flies to it and lights it,
   *  without opening the editor. */
  let focusId = $state<string | null>(null);
  let draft = $state<Geometry | null>(null);
  let placing = $state(false);
  let placesMap: PlacesMap | undefined = $state();
  let adding = $state(false);
  let confirming = $state(false);
  let busy = $state<string | null>(null);
  let mapStatus = $state<'loading' | 'ready' | 'unavailable'>('loading');
  let panelEl: HTMLElement | undefined = $state();
  let paneEl: HTMLElement | undefined = $state();
  let addFormEl: HTMLFormElement | undefined = $state();
  /** Where the list was scrolled when the editor replaced it. */
  let listScroll = 0;
  const name = (p: PanelPlace) => p.label || (p.isHome ? 'Home' : p.suggestedLabel || 'Unnamed stop');
  const needsName = (p: PanelPlace) => !p.label && !p.isHome;
  const review = $derived(data.places.filter(needsName));
  const visible = $derived(data.places.filter(p => (filter === 'all' || filter === 'review' && needsName(p) || filter === 'named' && !needsName(p) || filter === 'alerts' && p.alerts)
    && `${name(p)} ${p.suggestedAddress ?? ''} ${p.kind}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => Number(needsName(b)) - Number(needsName(a)) || b.visitCount - a.visitCount));
  const selected = $derived(data.places.find(p => p.id === selectedId) ?? null);
  const moved = $derived(!!selected && !!draft && (selected.lat !== draft.lat || selected.lon !== draft.lon || Math.round(selected.radiusM) !== draft.radiusM));
  const summary = $derived([
    { label: 'Places', value: String(data.places.length), sub: 'every observed stop, including unnamed' },
    { label: 'Ready to name', value: String(review.length), sub: 'addresses become familiar places' },
    { label: 'Auto-resolved', value: String(data.places.filter(p => p.suggestedLabel).length), sub: 'map-derived addresses retained' },
    { label: 'Alerts on', value: String(data.places.filter(p => p.alerts).length), sub: 'arrival and departure preferences' },
  ]);
  const stamp = (d: Date | string | null | undefined) => d ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short' }).format(new Date(d)) : 'No visit yet';
  /** Bring the pane's new content into view on a phone, where the page
   *  scrolls under a pinned map. On a desktop the pane already starts at
   *  its top and the page must not move. */
  const reveal = (el: Element | null | undefined) => {
    if (el && window.matchMedia('(max-width: 900px)').matches) el.scrollIntoView({ block: 'start' });
  };
  const geometryOf = (p: PanelPlace): Geometry => ({ lat: p.lat, lon: p.lon, radiusM: Math.round(p.radiusM) });
  /** Open a place's editor in the side pane, in place of the list. The map
   *  stays where it is on screen; only the pane changes. */
  async function select(id: string) {
    const p = data.places.find(x => x.id === id);
    if (!p) return;
    if (!selectedId && !adding && paneEl) listScroll = paneEl.scrollTop;
    if (selectedId !== id) draft = geometryOf(p);
    selectedId = id; focusId = id; confirming = false; adding = false; placing = false;
    await tick();
    if (paneEl) paneEl.scrollTop = 0;
    panelEl?.focus({ preventScroll: true }); reveal(panelEl);
  }
  /** Back to the list, where it was, with the place still lit on the map. */
  async function close() {
    const id = selectedId; selectedId = null; draft = null; confirming = false;
    await tick();
    if (paneEl) paneEl.scrollTop = listScroll;
    const back = document.getElementById(`edit-${id}`);
    back?.focus({ preventScroll: true }); back?.scrollIntoView({ block: 'nearest' });
  }
  const keep: SubmitFunction = ({ formData }) => {
    busy = String(formData.get('placeId') ?? 'new');
    return async ({ update }) => { try { await update({ reset: false }); } finally { busy = null; } };
  };
  /** Save a name, then move straight on to the next place still waiting
   *  for one — its field focused, the map already flying to it. */
  const afterName: SubmitFunction = ({ formData }) => {
    const id = String(formData.get('placeId') ?? '');
    busy = id;
    const queue = visible.filter(needsName).map(p => p.id);
    return async ({ result, update }) => {
      try { await update({ reset: false }); } finally { busy = null; }
      if (result.type !== 'success') return;
      const waiting = new Set(data.places.filter(needsName).map(p => p.id));
      const at = queue.indexOf(id);
      const next = [...queue.slice(at + 1), ...queue.slice(0, Math.max(at, 0))].find(x => waiting.has(x));
      await tick();
      if (next) focusName(next);
    };
  };
  function focusName(id: string) {
    const input = document.getElementById(`name-${id}`) as HTMLInputElement | null;
    if (!input) return;
    input.focus({ preventScroll: true });
    input.select();
    input.closest('article')?.scrollIntoView({ block: 'nearest' });
  }
  const afterGeometry: SubmitFunction = () => async ({ result, update }) => {
    await update({ reset: false });
    if (result.type === 'success' && selected) draft = geometryOf(selected);
  };
  const afterRemove: SubmitFunction = () => async ({ result, update }) => { await update({ reset: false }); if (result.type === 'success') { focusId = null; await close(); } };
  const afterCreate: SubmitFunction = () => async ({ result, update }) => { await update({ reset: false }); if (result.type === 'success' && typeof result.data?.created === 'string') { adding = false; await select(result.data.created); } };
  async function openAdd(at: Geometry | null) {
    if (!selectedId && !adding && paneEl) listScroll = paneEl.scrollTop;
    draft = at; selectedId = null; placing = false; adding = true;
    await tick();
    if (paneEl) paneEl.scrollTop = 0;
    const field = addFormEl?.querySelector<HTMLInputElement>('[name="label"]');
    field?.focus({ preventScroll: true }); reveal(addFormEl);
  }
  async function closeAdd() { adding = false; draft = null; await tick(); if (paneEl) paneEl.scrollTop = listScroll; }
  const dropAt = (lat: number, lon: number) => openAdd({ lat, lon, radiusM: NEW_PLACE_RADIUS_M });
  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || (e.target as HTMLElement)?.closest('input,select,textarea')) return;
    if (confirming) confirming = false;
    else if (moved && selected) draft = geometryOf(selected);
    else if (placing) placing = false;
    else if (adding) void closeAdd();
    else if (selectedId) void close();
  }
</script>
<svelte:head><title>Family places — Strange Ramblings</title><meta name="robots" content="noindex" /></svelte:head>
<svelte:window onkeydown={onKeydown} />
<HomeFrame path="/home/people/places" kicker="Home · People / Places" title={['Familiar places.', 'Better insights.']} standfirst="Every stop has a story. Start with its address, add the name your family uses, and let your routines take shape." {summary} footer={['Private household places', 'Automatic Mapbox address lookup', 'Confirmed family names always take priority']}>
  <PeopleNav active="places" />
  <div class="places-desk">
    {#if data.places.some(p => p.id.startsWith('sample-insights-'))}<p class="message">Local preview includes clearly labelled synthetic family places and journeys.</p>{/if}
    {#if data.loadError}<p class="error" role="alert">Places could not be loaded. Refresh to try again.</p>{/if}
    <div class="lookup-status"><span>{data.geocoder}</span><a href="/home/people">Routes and routines →</a></div>
    {#if form && 'note' in form && form.note}<p class="message" role="status">{form.note}</p>{/if}
    {#if form && 'removed' in form}<p class="message" role="status">Place removed from your active places.</p>{/if}
    {#if form && 'error' in form}<p class="error" role="alert">{form.error}</p>{/if}
    <div class="workspace">
      <div class="pane" bind:this={paneEl}>
        {#if selected && draft}
          <section class="editor-panel" bind:this={panelEl} tabindex="-1" aria-label={`Edit ${name(selected)}`}>
            <button class="back" type="button" onclick={close}>← All places</button>
            <header><p class="eyebrow">Place details</p><h2>{name(selected)}</h2>{#if selected.suggestedAddress}<p class="address">{selected.suggestedAddress}</p>{/if}</header>
            {#key selected.id}<PlaceEditor place={selected} {draft} {moved} radius={data.radius} labelMax={data.labelMax} kinds={data.kinds} placeTimeDays={data.placeTimeDays} placeTime={data.placeTime} form={form as EditorForm} onradius={r => { if (draft) draft = { ...draft, radiusM: r }; }} onrevert={() => { if (selected) draft = geometryOf(selected); }} {afterGeometry} {afterRemove} bind:confirming />{/key}
          </section>
        {:else if adding}
          <form class="add-form" bind:this={addFormEl} method="POST" action="?/create" use:enhance={afterCreate}>
            <button class="back" type="button" onclick={closeAdd}>← All places</button>
            <h2>Add a familiar place</h2><p>{draft ? 'Drag the circle on the map to adjust it, then name it.' : 'Choose “Add on map” and tap the spot, or enter its coordinates.'}</p>
            <div class="fields"><label>Name<input name="label" required maxlength={data.labelMax} /></label><label>Kind<select name="kind">{#each data.kinds as k}<option value={k} selected={k === 'other'}>{k}</option>{/each}</select></label>
            <label>Latitude<input name="lat" type="number" step="any" min="-90" max="90" required value={draft?.lat ?? ''} /></label><label>Longitude<input name="lon" type="number" step="any" min="-180" max="180" required value={draft?.lon ?? ''} /></label><label>Radius (m)<input name="radiusM" type="number" min={data.radius.min} max={data.radius.max} required value={draft?.radiusM ?? NEW_PLACE_RADIUS_M} /></label></div>
            <button class="cta" type="submit">Save place</button><button class="btn" type="button" onclick={closeAdd}>Cancel</button>
          </form>
        {/if}
        <section class="ledger" aria-label="Places" hidden={!!selected || adding}>
          <div class="toolbar">
            <label class="search">Find a place<input type="search" bind:value={query} placeholder="Name, street or kind…" /></label>
            <div class="filters" aria-label="Filter places">
              {#each [['all', 'All'], ['review', 'To name'], ['named', 'Named'], ['alerts', 'Alerts on']] as [id, label]}
                <button type="button" aria-pressed={filter === id} onclick={() => filter = id as typeof filter}>{label}{id === 'review' ? ` (${review.length})` : ''}</button>
              {/each}
            </div>
            <div class="ledger-heading"><span>{visible.length} places{review.length ? ` · ${review.length} to name` : ''}</span><button class="text-button" type="button" onclick={() => openAdd(null)}>Add by coordinates</button></div>
          </div>
          {#if form && 'saved' in form && form.saved && !('note' in form)}<p class="message" role="status">Saved.</p>{/if}
          {#if !data.places.length}<p class="empty">Your first place will appear after a ten-minute observed stop. You can also add Home or School now.</p>
          {:else if !visible.length}<p class="empty">No places match this filter. Try another name or choose All.</p>{/if}
          {#each visible as p (p.id)}
            <!-- The row lights its place on the map; the buttons and fields inside it are the keyboard route. -->
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
            <article class="place-row" class:lit={p.id === focusId} onfocusin={() => focusId = p.id} onclick={() => focusId = p.id}>
              <div class="place-top"><div><p class="eyebrow">{p.isHome ? 'Home' : p.label ? 'Family named' : p.suggestedLabel ? `Map-derived ${p.suggestedPrecision ?? 'address'}` : p.suggestedAt ? 'Lookup pending · retry scheduled' : 'New stop · awaiting lookup'}</p><h3>{name(p)}</h3></div><span class="visits">{p.visitCount}<small>visits</small></span></div>
              <p class="address">{p.suggestedAddress || `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`}</p>
              <div class="place-meta"><span>Last seen {stamp(p.lastSeenAt)}</span>{#if p.medianDwellMins}<span>Typically {p.medianDwellMins} min</span>{/if}<span>{Math.round(p.radiusM)} m</span>{#if p.alerts}<span>Alerts on</span>{/if}</div>
              {#if needsName(p)}
                <form class="quick-name" method="POST" action="?/name" use:enhance={afterName}>
                  <input type="hidden" name="placeId" value={p.id} />
                  <label>Family name<input id={`name-${p.id}`} name="label" value={p.suggestedLabel ?? ''} placeholder="e.g. Carmel College" required maxlength={data.labelMax} /></label>
                  <label>Kind<select name="kind">{#each data.kinds as k}<option value={k} selected={k === (p.suggestedKind ?? 'other')}>{k}</option>{/each}</select></label>
                  <button class="cta" type="submit" disabled={busy === p.id}>{busy === p.id ? 'Saving…' : 'Save'}</button>
                </form>
              {/if}
              <div class="row-actions"><button class="text-button" id={`edit-${p.id}`} type="button" onclick={() => select(p.id)}>Edit details →</button>
                {#if !p.label && !p.suggestedLabel}<form method="POST" action="?/lookup" use:enhance={keep}><input type="hidden" name="placeId" value={p.id} /><button class="text-button" disabled={busy === p.id} type="submit">Look up address</button></form>{/if}
                {#if p.suggestedLabel}<span>{p.suggestedProvider ?? 'Map lookup'}</span>{/if}
              </div>
            </article>
          {/each}
        </section>
      </div>
      <div class="map-pane">
        <div class="map-actions">
          <p class="map-help" aria-live="polite">{placing ? 'Tap the map where the new place is.' : selected ? 'Drag the centre to move it, the square to resize.' : 'Pick a place in the list to see it here, or tap a circle to edit it.'}</p>
          <button class="btn sm" type="button" disabled={mapStatus !== 'ready'} onclick={() => placesMap?.fitAll()}>Show all</button>
          <button class="btn sm" type="button" disabled={mapStatus !== 'ready'} aria-pressed={placing} onclick={() => { placing = !placing; if (placing) { selectedId = null; draft = null; adding = false; } }}>{placing ? 'Cancel' : 'Add on map'}</button>
        </div>
        <div class="map"><PlacesMap bind:this={placesMap} places={data.places.map(p => ({ ...p, label: name(p) }))} {selectedId} {focusId} {draft} {placing} onselect={select} ondraft={g => draft = g} onplace={dropAt} onstatus={s => mapStatus = s} /></div>
      </div>
    </div>
    <p class="footnote">Stops are discovered after ten minutes of continuous, accurate observations. Address lookup runs automatically; family names take priority. Mapbox provides addresses, so a school or workplace may still benefit from your own name. Lookup data: Mapbox / <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>.</p>
  </div>
</HomeFrame>
<style>
  .places-desk { max-width: 1488px; margin: auto; padding: 0 clamp(16px, 3vw, 44px) 3rem; --map-h: 38dvh; }
  .lookup-status { display: flex; flex-wrap: wrap; justify-content: space-between; gap: .75rem; padding: 1rem 0; font-size: var(--fs-label); color: var(--text-muted); }
  .lookup-status a { color: var(--accent-ink); }
  label { display: grid; gap: .4rem; font-size: var(--fs-label); font-weight: 700; }
  input, select { width: 100%; min-width: 0; padding: .65rem .75rem; border: 1px solid var(--line-strong); background: var(--surface-card); color: var(--text-primary); font: var(--fs-body) var(--font-body); border-radius: 0; }
  button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  /* The workspace: the list (or one place's editor) beside a map that never
     leaves the screen. Desktop fits it to the viewport and scrolls the pane,
     not the page; a phone pins the map under the site bar instead. */
  .workspace { display: grid; grid-template-columns: minmax(340px, 440px) minmax(0, 1fr); border: 1px solid var(--line-strong); border-top: 2px solid var(--text-primary);
    height: max(560px, calc(100dvh - var(--site-nav-height, 64px) - 32px)); scroll-margin-top: calc(var(--site-nav-height, 64px) + 16px); }
  .pane { overflow-y: auto; overscroll-behavior: contain; min-width: 0; border-right: 1px solid var(--line-strong); background: var(--surface-card); }
  .map-pane { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .map-actions { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; padding: .6rem .8rem; border-bottom: 1px solid var(--line-strong); background: var(--surface-card); }
  .map-help { flex: 1; min-width: 12rem; font-size: var(--fs-label); color: var(--text-muted); margin: 0; }
  .map { flex: 1; min-height: 0; }
  .map :global(.places-map) { border: 0; }
  .toolbar { position: sticky; top: 0; z-index: 2; display: grid; gap: .75rem; padding: 1rem; background: var(--surface-card); border-bottom: 2px solid var(--text-primary); }
  .filters { display: flex; flex-wrap: wrap; }
  .filters button { border: 1px solid var(--line-strong); padding: .5rem .7rem; font-size: var(--fs-label); background: var(--surface-rail); color: var(--text-primary); cursor: pointer; }
  .filters button[aria-pressed='true'] { background: var(--text-primary); color: var(--bg); }
  .ledger { min-width: 0; } .ledger-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; font-size: var(--fs-label); color: var(--text-muted); }
  h2 { font: clamp(1.3rem, 2vw, 1.8rem) var(--font-display); margin: 0; }
  .place-row { border-bottom: 1px solid var(--line-strong); border-left: 3px solid transparent; padding: 1rem; cursor: pointer; scroll-margin-top: 9rem; }
  .place-row.lit { background: var(--surface-rail); border-left-color: var(--accent); }
  .place-top { display: flex; justify-content: space-between; gap: 1rem; } h3 { font: 1.15rem var(--font-display); margin: .3rem 0 0; overflow-wrap: anywhere; }
  .eyebrow { font: var(--fs-label-xs) var(--font-mono); text-transform: uppercase; letter-spacing: .06em; color: var(--accent); margin: 0; }
  .visits { font: 1.5rem var(--font-display); text-align: right; color: var(--accent-ink); } small { display: block; font: var(--fs-label-xs) var(--font-body); color: var(--text-muted); }
  .address { color: var(--text-secondary); margin: .4rem 0; font-size: var(--fs-label); overflow-wrap: anywhere; }
  .place-meta { display: flex; flex-wrap: wrap; gap: .3rem 1rem; font-size: var(--fs-label-xs); color: var(--text-muted); }
  .quick-name { display: grid; grid-template-columns: minmax(0, 1fr) 110px; gap: .6rem; align-items: end; margin-top: .8rem; }
  .quick-name button { grid-column: 1 / -1; }
  .row-actions { display: flex; flex-wrap: wrap; gap: 1.2rem; align-items: center; margin-top: .6rem; font-size: var(--fs-label-xs); color: var(--text-muted); }
  .text-button { padding: .35rem 0; border: 0; border-bottom: 1px solid var(--line); background: transparent; cursor: pointer; color: var(--accent-ink); font-size: var(--fs-label); }
  .back { padding: .35rem 0; margin-bottom: .8rem; border: 0; background: transparent; cursor: pointer; color: var(--accent-ink); font: var(--fs-label) var(--font-mono); }
  .editor-panel, .add-form { padding: 1rem 1.25rem 1.5rem; min-width: 0; }
  .editor-panel:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .editor-panel header { padding-bottom: .8rem; margin-bottom: 1rem; border-bottom: 2px solid var(--text-primary); }
  .editor-panel h2 { margin-top: .4rem; overflow-wrap: anywhere; }
  .empty, .footnote { line-height: 1.65; color: var(--text-muted); padding: 1.2rem 1rem; } .footnote { font-size: var(--fs-label); max-width: 110ch; padding-inline: 0; }
  .fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 1rem; margin: 1rem 0; }
  .add-form > button:not(.back) { margin-right: .6rem; } .error, .message { padding: 1rem; margin: 0 0 1rem; background: var(--surface-rail); border-left: 3px solid var(--accent); }
  .ledger .message { margin: 1rem; }
  /* Phone and narrow tablet: the page scrolls; the map sticks under the
     site bar, so a place is on screen while it is being named. */
  @media(max-width: 900px) {
    .workspace { display: flex; flex-direction: column; height: auto; }
    .pane { overflow: visible; border-right: 0; order: 2; }
    .map-pane { order: 1; position: sticky; top: calc(var(--site-nav-height, 0px) + env(safe-area-inset-top, 0px)); z-index: 3; height: var(--map-h); border-bottom: 2px solid var(--text-primary); background: var(--bg); }
    .map-actions { padding: .4rem .6rem; } .map-help { display: none; }
    .toolbar { position: static; }
    .place-row, .editor-panel, .add-form { scroll-margin-top: calc(var(--site-nav-height, 64px) + var(--map-h) + 8px); }
  }
  @media(max-width: 600px) { .places-desk { padding-inline: 0; } .lookup-status, .footnote { padding-inline: 16px; } .workspace { border-inline: 0; } }
</style>
