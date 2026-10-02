<script lang="ts">
  // Native API — the app's doorway into the site. The endpoint list is grouped from the
  // build-time route manifest (virtual:sr-route-manifest), so a new native route appears
  // here on the next deploy. Pairing lifetimes come from $lib/server/native-auth.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import Bars from '../../components/viz/Bars.svelte';
  import Stat from '../../components/viz/Stat.svelte';
  import { APP_COPY as C, AREA_COPY } from '../../lib/app';
  import { app } from '../../lib/appState.svelte';
  import { words } from '../../lib/format';

  let { data } = $props();
  const f = $derived(data.facts.app);
  const eli = $derived(app.narrative === 'eli5');
  const t = (x: { plain: string; eng: string }) => (eli ? x.plain : x.eng);
  const total = $derived(f.nativeAreas.reduce((a, x) => a + x.endpoints, 0));
</script>

<svelte:head><title>Native API — App — The Engine Room</title></svelte:head>

<section class="pe-route">
  <LeafHead part="app" title="Native API" line={C.api.line.eng} lineEli5={C.api.line.plain} />

  <Instrument
    kicker="From the route list"
    title="Every endpoint the app can call"
    reading="Grouped by what each area is for, counted from the site’s own list of routes at build time."
    tone="#2d7a3a"
  >
    <Bars tone="#2d7a3a" grouped={false} items={f.nativeAreas.map((a) => ({ label: words(a.area), value: a.endpoints, note: AREA_COPY[a.area] }))} />
    <p class="foot">{total} endpoints across {f.nativeAreas.length} areas.</p>
  </Instrument>

  <Instrument kicker="Getting in" title="Pairing a phone" takeaway={t(C.api.pairing)} tone="#2d7a3a">
    <div class="stats">
      <Stat value={f.pairCodeMinutes} unit=" min" label="a pairing code lasts" tone="#2d7a3a" />
      <Stat value={f.deviceTokenDays} unit=" days" label="a paired phone’s key lasts" tone="#2d7a3a" />
    </div>
  </Instrument>

  <Instrument kicker="Coming back" title="Notifications and the Lock Screen" takeaway={t(C.api.push)} tone="#2d7a3a">
    <p class="foot">{eli ? 'Family members only see the areas they’ve been given. A parent can look at the app as a child sees it, but can’t act as them.' : 'Member access is per area, checked on every native route. View-as is read-only.'}</p>
  </Instrument>

  <PageFoot />
</section>

<style>
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; }
  .foot { margin: 10px 0 0; font-size: var(--fs-label); color: rgba(28,22,17,0.75); }
</style>
