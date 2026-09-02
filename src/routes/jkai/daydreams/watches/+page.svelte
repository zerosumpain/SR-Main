<script lang="ts">
  import type { PageData } from './$types';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import MonitorsPanel from '$lib/components/jkai/daydream/MonitorsPanel.svelte';

  let { data }: { data: PageData } = $props();
</script>

<section class="band">
  <div class="inner">
    <SectionHead
      kicker="A / Things worth interrupting for"
      title={['Watch quietly,', 'speak on change']}
      strap="A watch is the deliberate counterpart to a daydream: you name the condition, a scheduled workflow checks it, and only a new match earns an interruption."
    />
    <MonitorsPanel data={{ monitors: data.monitors }} embedded />
  </div>
</section>
