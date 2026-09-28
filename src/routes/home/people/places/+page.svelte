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
  let draft = $state<Geometry | null>(null);
  let placing = $state(false);
  let placesMap: PlacesMap | undefined = $state();
  let adding = $state(false);
  let confirming = $state(false);
  let busy = $state<string | null>(null);
  let mapStatus = $state<'loading' | 'ready' | 'unavailable'>('loading');
  let panelEl: HTMLElement | undefined = $state();
  let workspaceEl: HTMLDivElement | undefined = $state();
  let addFormEl: HTMLFormElement | undefined = $state();
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
  const geometryOf = (p: PanelPlace): Geometry => ({ lat: p.lat, lon: p.lon, radiusM: Math.round(p.radiusM) });
  async function select(id: string) {
    const p = data.places.find(x => x.id === id);
    if (!p) return;
    if (selectedId !== id) draft = geometryOf(p);
    selectedId = id; confirming = false; adding = false; placing = false;
    await tick(); panelEl?.focus({ preventScroll: true }); workspaceEl?.scrollIntoView({ block: 'start' });
  }
  async function close() { const id = selectedId; selectedId = null; draft = null; confirming = false; await tick(); document.getElementById(`edit-${id}`)?.focus(); }
  const keep: SubmitFunction = ({ formData }) => {
    busy = String(formData.get('placeId') ?? 'new');
    return async ({ update }) => { try { await update({ reset: false }); } finally { busy = null; } };
  };
  const afterGeometry: SubmitFunction = () => async ({ result, update }) => {
    await update({ reset: false });
    if (result.type === 'success' && selected) draft = geometryOf(selected);
  };
  const afterRemove: SubmitFunction = () => async ({ result, update }) => { await update({ reset: false }); if (result.type === 'success') await close(); };
  const afterCreate: SubmitFunction = () => async ({ result, update }) => { await update({ reset: false }); if (result.type === 'success' && typeof result.data?.created === 'string') { adding = false; await select(result.data.created); } };
  async function dropAt(lat: number, lon: number) {
    draft = { lat, lon, radiusM: NEW_PLACE_RADIUS_M }; selectedId = null; placing = false; adding = true;
    await tick(); addFormEl?.querySelector<HTMLInputElement>('[name="label"]')?.focus();
  }
  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || (e.target as HTMLElement)?.closest('input,select,textarea')) return;
    if (confirming) confirming = false;
    else if (moved && selected) draft = geometryOf(selected);
    else if (placing) placing = false;
    else void close();
  }
</script>
<svelte:head><title>Family places — Strange Ramblings</title><meta name="robots" content="noindex" /></svelte:head>
<svelte:window onkeydown={onKeydown} />
<HomeFrame path="/home/people/places" kicker="Home · People / Places" title={['Familiar places.', 'Better insights.']} standfirst="Every stop has a story. Start with its address, add the name your family uses, and let your routines take shape." {summary} footer={['Private household places', 'Automatic Mapbox address lookup', 'Confirmed family names always take priority']}>
  <PeopleNav active="places" />
  <div class="places-desk">
    {#if data.places.some(p => p.id.startsWith('sample-insights-'))}<p class="message">Local preview includes clearly labelled synthetic family places and journeys.</p>{/if}
    {#if data.loadError}<p class="error" role="alert">Places could not be loaded. Refresh to try again.</p>{/if}
    <div class="lookup-status"><span>{data.geocoder}</span><a href="/home/people/insights">See journey insights →</a></div>
    <div class="toolbar">
      <label class="search">Find a place<input type="search" bind:value={query} placeholder="Name, street or kind…" /></label>
      <div class="filters" aria-label="Filter places">
        {#each [['all', 'All places'], ['review', 'Ready to name'], ['named', 'Named'], ['alerts', 'Alerts on']] as [id, label]}
          <button type="button" aria-pressed={filter === id} onclick={() => filter = id as typeof filter}>{label}{id === 'review' ? ` (${review.length})` : ''}</button>
        {/each}
      </div>
      <button class="btn" type="button" onclick={async () => { adding = !adding; selectedId = null; draft = null; placing = false; await tick(); if (adding) addFormEl?.querySelector<HTMLInputElement>('[name="label"]')?.focus(); }}>Add place</button>
    </div>
    {#if form && 'note' in form && form.note}<p class="message" role="status">{form.note}</p>{/if}
    {#if form && 'saved' in form && form.saved && !('note' in form)}<p class="message" role="status">Place saved.</p>{/if}
    {#if form && 'removed' in form}<p class="message" role="status">Place removed from your active places.</p>{/if}
    {#if form && 'error' in form}<p class="error" role="alert">{form.error}</p>{/if}
    <section class="map-section" aria-labelledby="places-map-title">
      <header class="map-heading"><div><p class="eyebrow">01 / Your surroundings</p><h2 id="places-map-title">Your places on the map</h2></div><div class="map-actions">
        <button class="btn sm" type="button" disabled={mapStatus !== 'ready'} onclick={() => placesMap?.fitAll()}>Show all places</button>
        <button class="btn sm" type="button" disabled={mapStatus !== 'ready'} aria-pressed={placing} onclick={() => { placing = !placing; if (placing) { selectedId = null; draft = null; adding = false; } }}>{placing ? 'Cancel placement' : 'Add on map'}</button>
      </div></header>
      <p class="map-help" aria-live="polite">{placing ? 'Choose a point on the map, then give the new place a name.' : 'Select a marker or a place below to name it, adjust its boundary and manage alerts. The map shows all household places.'}</p>
      <div class="map-workspace" bind:this={workspaceEl} class:editing={!!selected}>
        <div class="map"><PlacesMap bind:this={placesMap} places={data.places.map(p => ({ ...p, label: name(p) }))} {selectedId} {draft} {placing} onselect={select} ondraft={g => draft = g} onplace={dropAt} onstatus={s => mapStatus = s} /></div>
        {#if selected && draft}
          <section class="editor-panel" bind:this={panelEl} tabindex="-1" aria-label={`Edit ${name(selected)}`}>
            <header><div><p class="eyebrow">Place details</p><h2>{name(selected)}</h2></div><button class="btn sm" type="button" onclick={close}>Close</button></header>
            {#key selected.id}<PlaceEditor place={selected} {draft} {moved} radius={data.radius} labelMax={data.labelMax} kinds={data.kinds} placeTimeDays={data.placeTimeDays} placeTime={data.placeTime} form={form as EditorForm} onradius={r => { if (draft) draft = { ...draft, radiusM: r }; }} onrevert={() => { if (selected) draft = geometryOf(selected); }} {afterGeometry} {afterRemove} bind:confirming />{/key}
          </section>
        {/if}
      </div>
    </section>
    {#if adding}
      <form class="add-form" bind:this={addFormEl} method="POST" action="?/create" use:enhance={afterCreate}>
        <h2>Add a familiar place</h2><p>Choose a point on the map, or enter its coordinates.</p>
        <div class="fields"><label>Name<input name="label" required maxlength={data.labelMax} /></label><label>Kind<select name="kind">{#each data.kinds as k}<option value={k} selected={k === 'other'}>{k}</option>{/each}</select></label>
        <label>Latitude<input name="lat" type="number" step="any" min="-90" max="90" required value={draft?.lat ?? ''} /></label><label>Longitude<input name="lon" type="number" step="any" min="-180" max="180" required value={draft?.lon ?? ''} /></label><label>Radius (m)<input name="radiusM" type="number" min={data.radius.min} max={data.radius.max} required value={draft?.radiusM ?? NEW_PLACE_RADIUS_M} /></label></div>
        <button class="cta" type="submit">Save place</button><button class="btn" type="button" onclick={() => { adding = false; draft = null; }}>Cancel</button>
      </form>
    {/if}
      <section class="ledger" aria-label="Places">
        <div class="ledger-heading"><h2>{filter === 'review' ? 'Make these places yours' : 'Your place book'}</h2><span>{visible.length} places</span></div>
        {#if !data.places.length}<p class="empty">Your first place will appear after a ten-minute observed stop. You can also add Home or School now.</p>
        {:else if !visible.length}<p class="empty">No places match this filter. Try another name or choose All places.</p>{/if}
        {#each visible as p (p.id)}
          <article class="place-row" class:selected={p.id === selectedId}>
            <div class="place-top"><div><p class="eyebrow">{p.isHome ? 'Home' : p.label ? 'Family named' : p.suggestedLabel ? `Map-derived ${p.suggestedPrecision ?? 'address'}` : p.suggestedAt ? 'Lookup pending · retry scheduled' : 'New stop · awaiting lookup'}</p><h3>{name(p)}</h3></div><span class="visits">{p.visitCount}<small>visits</small></span></div>
            <p class="address">{p.suggestedAddress || `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`}</p>
            <div class="place-meta"><span>Last seen {stamp(p.lastSeenAt)}</span>{#if p.medianDwellMins}<span>Typically {p.medianDwellMins} min</span>{/if}<span>{Math.round(p.radiusM)} m boundary</span><span>{p.alerts ? 'Family alerts on' : 'Alerts off'}</span></div>
            {#if needsName(p)}
              <form class="quick-name" method="POST" action="?/name" use:enhance={keep}>
                <input type="hidden" name="placeId" value={p.id} />
                <label>Family name<input name="label" value={p.suggestedLabel ?? ''} placeholder="e.g. Carmel College" required maxlength={data.labelMax} /></label>
                <label>Kind<select name="kind">{#each data.kinds as k}<option value={k} selected={k === (p.suggestedKind ?? 'other')}>{k}</option>{/each}</select></label>
                <button class="cta" type="submit" disabled={busy === p.id}>{busy === p.id ? 'Saving…' : 'Save name'}</button>
              </form>
            {/if}
            <div class="row-actions"><button class="text-button" id={`edit-${p.id}`} type="button" aria-expanded={p.id === selectedId} onclick={() => p.id === selectedId ? close() : select(p.id)}>View on map & edit →</button>
              {#if !p.label && !p.suggestedLabel}<form method="POST" action="?/lookup" use:enhance={keep}><input type="hidden" name="placeId" value={p.id} /><button class="text-button" disabled={busy === p.id} type="submit">Look up address</button></form>{/if}
              {#if p.suggestedLabel}<span>{p.suggestedProvider ?? 'Map lookup'}</span>{/if}
            </div>
          </article>
        {/each}
      </section>
    <p class="footnote">Stops are discovered after ten minutes of continuous, accurate observations. Address lookup runs automatically; family names take priority. Mapbox provides addresses, so a school or workplace may still benefit from your own name. Lookup data: Mapbox / <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>.</p>
  </div>
</HomeFrame>
<style>
  .places-desk { max-width: 1488px; margin: auto; padding: 0 clamp(20px, 3vw, 44px) 3rem; }
  .lookup-status { display: flex; flex-wrap: wrap; justify-content: space-between; gap: .75rem; padding: 1rem 0; font-size: var(--fs-label); border-bottom: 1px solid var(--line); color: var(--text-muted); }
  .lookup-status a { color: var(--accent-ink); }
  .toolbar { display: flex; flex-wrap: wrap; align-items: end; gap: 1rem; padding: 1.5rem 0; }
  label { display: grid; gap: .4rem; font-size: var(--fs-label); font-weight: 700; }
  input, select { width: 100%; min-width: 0; padding: .65rem .75rem; border: 1px solid var(--line-strong); background: var(--surface-card); color: var(--text-primary); font: var(--fs-body) var(--font-body); border-radius: 0; }
  .search { flex: 1; min-width: 200px; } .filters { display: flex; flex-wrap: wrap; }
  .filters button { border: 1px solid var(--line-strong); padding: .75rem; font-size: var(--fs-label); background: var(--surface-rail); color: var(--text-primary); cursor: pointer; }
  .filters button[aria-pressed='true'] { background: var(--text-primary); color: var(--bg); }
  button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  .map-workspace { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.5rem; align-items: start; scroll-margin-top: 80px; }
  .map-workspace.editing { grid-template-columns: minmax(0, 1.4fr) minmax(340px, 1fr); }
  .ledger { min-width: 0; } .ledger-heading { display: flex; align-items: baseline; justify-content: space-between; border-bottom: 2px solid var(--text-primary); padding: .5rem 0 1rem; }
  h2 { font: clamp(1.3rem, 2vw, 1.8rem) var(--font-display); margin: 0; } .ledger-heading span { font-size: var(--fs-label); }
  .place-row { border-bottom: 1px solid var(--line-strong); padding: 1.5rem 1rem; } .place-row.selected { background: var(--surface-rail); border-left: 3px solid var(--accent); }
  .place-top { display: flex; justify-content: space-between; gap: 1rem; } h3 { font: 1.25rem var(--font-display); margin: .4rem 0 0; overflow-wrap: anywhere; }
  .eyebrow { font: var(--fs-label-xs) var(--font-mono); text-transform: uppercase; letter-spacing: .06em; color: var(--accent); margin: 0; }
  .visits { font: 1.8rem var(--font-display); text-align: right; color: var(--accent-ink); } small { display: block; font: var(--fs-label-xs) var(--font-body); color: var(--text-muted); }
  .address { color: var(--text-secondary); margin: .6rem 0; font-size: var(--fs-nav); overflow-wrap: anywhere; }
  .place-meta { display: flex; flex-wrap: wrap; gap: .5rem 1.2rem; font-size: var(--fs-label-xs); color: var(--text-muted); }
  .quick-name { display: grid; grid-template-columns: minmax(150px, 1fr) minmax(100px, .4fr) auto; gap: .75rem; align-items: end; background: var(--surface-rail); padding: 1rem; margin-top: 1rem; }
  .row-actions { display: flex; flex-wrap: wrap; gap: 1.4rem; align-items: center; margin-top: .9rem; font-size: var(--fs-label-xs); color: var(--text-muted); }
  .text-button { padding: .35rem 0; border: 0; border-bottom: 1px solid var(--line); background: transparent; cursor: pointer; color: var(--accent-ink); font-size: var(--fs-label); }
  .editor-panel { border: 1px solid var(--line-strong); padding: 1.5rem; background: var(--surface-card); min-width: 0; scroll-margin-top: 80px; }
  .editor-panel:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  .editor-panel header { display: flex; justify-content: space-between; align-items: start; gap: 1rem; padding-bottom: 1rem; margin-bottom: 1rem; border-bottom: 2px solid var(--text-primary); }
  .editor-panel h2 { margin-top: .5rem; overflow-wrap: anywhere; }
  .empty, .footnote { line-height: 1.65; color: var(--text-muted); padding: 1.2rem 0; } .footnote { font-size: var(--fs-label); max-width: 110ch; }
  .map-section { margin-bottom: 2rem; }
  .map-heading { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: end; gap: 1rem; padding-bottom: .8rem; border-bottom: 2px solid var(--text-primary); }
  .map-heading h2 { margin-top: .5rem; } .map-actions { display: flex; flex-wrap: wrap; gap: .5rem; }
  .map { height: clamp(360px, 50vh, 560px); min-width: 0; }
  .map-help { font-size: var(--fs-label); color: var(--text-muted); line-height: 1.65; margin: .8rem 0; }
  .add-form { padding: 1.5rem; margin: 0 0 1.5rem; border: 1px solid var(--line-strong); } .fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 1rem; margin: 1rem 0; }
  .add-form > button { margin-right: .6rem; } .error, .message { padding: 1rem; background: var(--surface-rail); border-left: 3px solid var(--accent); }
  @media(max-width: 1000px) { .map-workspace.editing { grid-template-columns: minmax(0, 1fr); } }
  @media(max-width: 600px) { .quick-name { grid-template-columns: minmax(0, 1fr) 110px; } .quick-name button { grid-column: 1 / -1; } .place-row { padding: 1.25rem 0; } .toolbar { gap: .75rem; } .filters { width: 100%; } }
</style>
