<script lang="ts">
  import PartHub from '../components/PartHub.svelte';
  import PageFoot from '../components/PageFoot.svelte';
  import Instrument from '../components/viz/Instrument.svelte';
  import Stat from '../components/viz/Stat.svelte';
  import { APP } from '../lib/app';

  let { data } = $props();
  const areas = $derived(data.facts.app.nativeAreas);
  const endpoints = $derived(areas.reduce((a, x) => a + x.endpoints, 0));
  const PLATFORM: Record<string, string> = { iOS: 'iPhone', watchOS: 'Apple Watch' };
</script>

<svelte:head><title>App — The Engine Room</title></svelte:head>

<section class="pe-route">
  <PartHub part="app">
    <Instrument
      kicker="What it’s made of"
      title={`One app, ${APP.targets.length} pieces, one doorway`}
      reading="Read from the app’s own project files and the site’s route list, not written by hand."
      tone="#2d7a3a"
    >
      <div class="stats">
        <Stat value={APP.tabs.length} label="tabs on the phone" tone="#2d7a3a" />
        <Stat value={APP.widgets.length + APP.complications.length} label="widgets, Live Activities and complications" tone="#2d7a3a" />
        <Stat value={APP.intents.length} label="things Siri can do" tone="#2d7a3a" />
        <Stat value={endpoints} label="native endpoints on the site" tone="#2d7a3a" lead />
      </div>
      <ul class="targets">
        {#each APP.targets as tg (tg.id)}
          <li><b>{PLATFORM[tg.platform] ?? tg.platform}</b> {tg.type === 'application' ? 'app' : 'extension'}</li>
        {/each}
      </ul>
    </Instrument>
  </PartHub>
  <PageFoot />
</section>

<style>
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; margin-bottom: 12px; }
  .targets { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; font-size: var(--fs-label); }
  .targets li { padding: 5px 11px; border: 1px solid rgba(28,22,17,0.2); border-radius: var(--radius-pill); background: rgba(255,255,255,0.6); }
</style>
