<script lang="ts">
  // Native API — the app's doorway into the site. Every endpoint is listed from the route
  // ledger (lib/routes.ts) joined to the build-time route manifest, so the list is what the
  // deployed build serves, and a new native route without a ledger entry fails the drift
  // test. Pairing lifetimes come from $lib/server/native-auth.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import OnTheSite from '../../components/OnTheSite.svelte';
  import Stat from '../../components/viz/Stat.svelte';
  import { APP_COPY as C, AREA_COPY } from '../../lib/app';
  import { app } from '../../lib/appState.svelte';
  import { words } from '../../lib/format';

  let { data } = $props();
  const f = $derived(data.facts.app);
  const eli = $derived(app.narrative === 'eli5');
  const t = (x: { plain: string; eng: string }) => (eli ? x.plain : x.eng);
  // Every /api/native route the study shows, grouped by its first segment — including the
  // ones another page explains in depth (Daydream's, for instance).
  const native = $derived(data.facts.routes.filter((r) => r.path.startsWith('/api/native/')));
  const areas = $derived(
    [...new Set(native.map((r) => r.path.split('/')[3]))].map((area) => ({ area, routes: native.filter((r) => r.path.split('/')[3] === area) })),
  );
</script>

<svelte:head><title>Native API — App — The Engine Room</title></svelte:head>

<section class="pe-route">
  <LeafHead part="app" title="Native API" line={C.api.line.eng} lineEli5={C.api.line.plain} />

  <Instrument
    kicker="From the route list"
    title="Every endpoint the app can call"
    reading="Grouped by what each area is for, listed from the routes this build actually serves."
    tone="#2d7a3a"
  >
    {#each areas as a (a.area)}
      <div class="area">
        <OnTheSite routes={a.routes} title={`${words(a.area)} · ${AREA_COPY[a.area] ?? ''}`} />
      </div>
    {/each}
    <p class="foot">{native.length} endpoints across {areas.length} areas.</p>
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
  .area :global(.ots) { margin-top: 14px; }
  .area:first-child :global(.ots) { margin-top: 0; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; }
  .foot { margin: 10px 0 0; font-size: var(--fs-label); color: rgba(28,22,17,0.75); }
</style>
