<script lang="ts">
  // Permissions — what the app asks the phone for, generated from the Info.plist usage keys
  // and the entitlements file via app-manifest.json. Keys only, never the wording or values.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import { APP, APP_COPY as C, PERMISSION_COPY, ENTITLEMENT_COPY } from '../../lib/app';

  const words = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/-/g, ' ');
</script>

<svelte:head><title>Permissions — App — The Engine Room</title></svelte:head>

<section class="pe-route">
  <LeafHead part="app" title="Permissions" line={C.privacy.line.eng} lineEli5={C.privacy.line.plain} />

  <Instrument kicker="Asked of me" title="What it asks the phone for" reading="Each permission prompt the app can show, and what it’s for." tone="#2d7a3a">
    <ul class="rows">
      {#each APP.permissions as p (p)}<li><b>{words(p)}</b><span>{PERMISSION_COPY[p] ?? ''}</span></li>{/each}
    </ul>
  </Instrument>

  <Instrument kicker="Granted by Apple" title="Capabilities" reading="What the app is signed to do, which Apple has to allow before it can ship." tone="#2d7a3a">
    <ul class="rows">
      {#each APP.entitlements as e (e)}<li><b>{words(e)}</b><span>{ENTITLEMENT_COPY[e] ?? ''}</span></li>{/each}
    </ul>
  </Instrument>

  <PageFoot />
</section>

<style>
  .rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  .rows li { display: grid; grid-template-columns: minmax(16ch, 26ch) 1fr; gap: 12px; font-size: var(--fs-label); padding: 6px 0; border-bottom: 1px dashed rgba(28,22,17,0.12); }
  .rows b { font-weight: 600; text-transform: capitalize; }
  @media (max-width: 620px) { .rows li { grid-template-columns: 1fr; gap: 2px; } }
</style>
