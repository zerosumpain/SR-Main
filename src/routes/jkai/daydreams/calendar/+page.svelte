<script lang="ts">
  // The diary, and what the engine may see of it. A standing reminder is a
  // real event and a fictional commitment at once, and nothing in the data
  // separates them — so this is the control that does. The board loads its
  // own window through the thoughts endpoint; there is nothing to load here.
  import { invalidateAll } from '$app/navigation';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import CalendarBoard from '$lib/components/jkai/daydream/CalendarBoard.svelte';
</script>

<section class="band">
  <div class="inner">
    <SectionHead
      kicker="A / The diary"
      title={['What it may', 'reason about']}
      strap="A standing reminder is a real event and a fictional commitment at once, and nothing in the data separates them. This is the control that does."
    />
    <CalendarBoard onchanged={() => invalidateAll()} />
  </div>
</section>
