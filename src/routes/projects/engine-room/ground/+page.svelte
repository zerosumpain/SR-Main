<script lang="ts">
  import PartHub from '../components/PartHub.svelte';
  import PageFoot from '../components/PageFoot.svelte';
  import Stat from '../components/viz/Stat.svelte';
  import { SUBSYSTEMS, STORES, MACHINES } from '../lib/ground';

  const TONE = '#5a6b7a';
  const singleHomed = SUBSYSTEMS.filter((s) => s.runs.length === 1).length;
  const places = MACHINES.filter((m) => m.id !== 'store').length;
</script>

<svelte:head>
  <title>Part V — Ground · The Engine Room</title>
  <meta name="description" content="Where the system actually runs: one codebase across a public origin, a machine at home and a disposable runner, and the four stores a byte can end up in." />
</svelte:head>

<section class="pe-route wide">
  <PartHub part="ground">
    <div class="row">
      <Stat lead value={places} label="machines running the same code"
            how="a public origin, a machine at home, and a disposable one per check" tone={TONE} />
      <Stat value="{singleHomed} of {SUBSYSTEMS.length}" label="subsystems that run in exactly one place"
            how="startup gates counted from source" tone={TONE} />
      <Stat value={STORES.length} label="stores a byte can end up in"
            how="a database, object storage, a disposable disk, an off-site snapshot" tone={TONE} />
      <Stat value="0" label="inbound ports open on the origin"
            how="the tunnel dials out; nothing dials in" tone={TONE} />
    </div>
  </PartHub>
  <PageFoot />
</section>

<style>
  .row { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
</style>
