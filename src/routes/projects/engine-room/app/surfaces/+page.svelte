<script lang="ts">
  // Surfaces — everywhere the app shows up, generated from app-manifest.json (which
  // scripts/sync-app-manifest.mjs writes from the app's Swift source).
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import { APP, APP_COPY as C, TAB_COPY, MORE_COPY, WATCH_COPY, SURFACE_COPY, BACKGROUND_COPY } from '../../lib/app';
  import { app } from '../../lib/appState.svelte';
  import { words } from '../../lib/format';

  const eli = $derived(app.narrative === 'eli5');
  const t = (x: { plain: string; eng: string }) => (eli ? x.plain : x.eng);

  type Place = 'phone' | 'lock' | 'home' | 'watch' | 'siri' | 'background';
  interface Row { name: string; what: string }
  const PLACES: Array<{ id: Place; label: string; rows: Row[]; note?: string }> = $derived([
    { id: 'phone', label: 'The app', rows: [
      ...APP.tabs.map((id) => ({ name: words(id), what: TAB_COPY[id] ?? '' })),
      ...APP.morePages.map((id) => ({ name: `More › ${words(id)}`, what: MORE_COPY[id] ?? '' })),
    ] },
    { id: 'lock', label: 'Lock Screen', note: SURFACE_COPY['live-activity'].plain,
      rows: APP.widgets.filter((w) => w.surface === 'live-activity').map((w) => ({ name: w.name, what: w.description ?? SURFACE_COPY['live-activity'].label })) },
    { id: 'home', label: 'Home Screen', note: SURFACE_COPY['home-screen'].plain,
      rows: APP.widgets.filter((w) => w.surface === 'home-screen').map((w) => ({ name: w.name, what: w.description ?? '' })) },
    { id: 'watch', label: 'Apple Watch', note: SURFACE_COPY['watch-face'].plain, rows: [
      ...APP.watchPages.map((id) => ({ name: `${words(id)} page`, what: WATCH_COPY[id] ?? '' })),
      ...APP.complications.map((c) => ({ name: `${c.name} complication`, what: c.description ?? '' })),
    ] },
    { id: 'siri', label: 'Siri and Shortcuts', note: `${APP.shortcuts} shortcuts with spoken phrases, also usable from the Action button.`,
      rows: APP.intents.map((i) => ({ name: i.title, what: '' })) },
    { id: 'background', label: 'In the background', rows: APP.backgroundModes.map((m) => ({ name: words(m), what: BACKGROUND_COPY[m] ? t(BACKGROUND_COPY[m]) : '' })) },
  ]);
  let place = $state<Place>('phone');
  const current = $derived(PLACES.find((p) => p.id === place)!);
</script>

<svelte:head><title>Surfaces — App — The Engine Room</title></svelte:head>

<section class="pe-route">
  <LeafHead part="app" title="Surfaces" line={C.surfaces.line.eng} lineEli5={C.surfaces.line.plain} />

  <Instrument kicker="Where it lives" title="Pick a place" reading="Each list is generated from the app’s source." tone="#2d7a3a">
    {#snippet controls()}
      <div class="seg" role="group" aria-label="Place">
        {#each PLACES as p (p.id)}
          <button class:on={place === p.id} onclick={() => (place = p.id)}>{p.label} <span class="n">{p.rows.length}</span></button>
        {/each}
      </div>
    {/snippet}
    {#if current.note}<p class="note">{current.note}</p>{/if}
    <ul class="rows">
      {#each current.rows as r (r.name)}<li><b>{r.name}</b>{#if r.what}<span>{r.what}</span>{/if}</li>{/each}
    </ul>
  </Instrument>

  <Instrument kicker="Also in the app" title="Family games" reading="Games the household can play against each other, listed from the app’s own catalogue.">
    <ul class="games">{#each APP.games as g (g.id)}<li>{g.title}</li>{/each}</ul>
  </Instrument>

  <PageFoot />
</section>

<style>
  .seg { display: inline-flex; flex-wrap: wrap; gap: 2px; background: rgba(28,22,17,0.07); padding: 2px; border-radius: var(--radius-sharp); border: 1px solid rgba(28,22,17,0.12); }
  .seg button { background: transparent; border: none; padding: 5px 10px; border-radius: var(--radius-sharp); font-family: var(--font-mono); font-size: var(--fs-label-xs); cursor: pointer; color: var(--text-primary); }
  .seg button.on { background: #2d7a3a; color: #fff; }
  .seg .n { opacity: 0.65; }
  .note { margin: 0 0 10px; font-size: var(--fs-label); color: rgba(28,22,17,0.7); }
  .rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  .rows li { display: grid; grid-template-columns: minmax(14ch, 22ch) 1fr; gap: 12px; font-size: var(--fs-label); padding: 6px 0; border-bottom: 1px dashed rgba(28,22,17,0.12); }
  .rows b { font-weight: 600; text-transform: capitalize; }
  .games { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
  .games li { font-size: var(--fs-label); padding: 5px 11px; border-radius: var(--radius-pill); border: 1px solid rgba(28,22,17,0.2); background: rgba(255,255,255,0.6); }
  @media (max-width: 620px) { .rows li { grid-template-columns: 1fr; gap: 2px; } }
</style>
