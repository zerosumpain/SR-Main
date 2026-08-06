<script lang="ts">
  import PartHub from '../components/PartHub.svelte';
  import PageFoot from '../components/PageFoot.svelte';
  import Stat from '../components/viz/Stat.svelte';
  import { MANIFEST } from '../lib/tools';
  import { NODE_COUNT } from '../lib/automation';
</script>

<svelte:head>
  <title>Part III — Reach · The Engine Room</title>
  <meta name="description" content="What the system can touch: the tool catalogue and its context cost, the protocol that exposes it, and the workflow engine that wires it together." />
</svelte:head>

<section class="pe-route wide">
  <PartHub part="reach">
    <div class="row">
      <Stat lead value={MANIFEST.registered} label="tools registered" tone="var(--success)"
            how="entries in the tool registry" />
      <Stat value={MANIFEST.shown} label="sent to the model by default" tone="var(--success)"
            how="essentials plus one dispatcher" />
      <Stat value={MANIFEST.savedTokens} label="prefill tokens saved per turn" tone="var(--success)"
            how="full manifest minus served manifest, at ~4 bytes per token" />
      <Stat value={NODE_COUNT} label="workflow node types" tone="var(--success)"
            how="register() calls in the workflow node registry" />
    </div>
  </PartHub>
  <PageFoot />
</section>

<style>
  .row { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; }
</style>
