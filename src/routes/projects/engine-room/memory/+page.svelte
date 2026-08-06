<script lang="ts">
  import PartHub from '../components/PartHub.svelte';
  import PageFoot from '../components/PageFoot.svelte';
  import Stat from '../components/viz/Stat.svelte';
  import { AUTO_MERGE, SIGNALS } from '../lib/memory';
  import { STATS } from '../lib/system';

  const tables = STATS.find((s) => s.label === 'database tables');
</script>

<svelte:head>
  <title>Part II — Memory · The Engine Room</title>
  <meta name="description" content="What the system knows: retrieval over documents, entity resolution, a knowledge graph, and reading the web without inventing things." />
</svelte:head>

<section class="pe-route wide">
  <PartHub part="memory">
    <div class="row">
      <Stat lead value={tables?.value ?? '117'} label="database tables" how={tables?.how} tone="var(--accent)" />
      <Stat value="2" label="separate embedding indexes, on purpose"
            how="3,072 dims per-collection, 1,536 dims global" tone="var(--accent)" />
      <Stat value={SIGNALS.length} label="signals in the matching ladder"
            how="entries in the scoring function" tone="var(--accent)" />
      <Stat value={AUTO_MERGE.toFixed(2)} label="confidence needed to merge unattended"
            how="the automatic-merge threshold" tone="var(--accent)" />
    </div>
  </PartHub>
  <PageFoot />
</section>

<style>
  .row { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; }
</style>
