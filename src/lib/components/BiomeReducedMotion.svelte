<script lang="ts">
  import type { BiomeState, DayPhase } from '$lib/biome/state';

  let { biomeState }: { biomeState: BiomeState } = $props();

  const DAY_PHASE_HUE: Record<DayPhase, number> = {
    night: 30, dawn: 35, day: 38, dusk: 25,
  };

  let hue = $derived(DAY_PHASE_HUE[biomeState.dayPhase]);
  let saturation = $derived(Math.round(4 + biomeState.recovery * 0.12));
</script>

<div
  class="fixed inset-0 z-0"
  style="background: radial-gradient(ellipse at 50% 100%, hsl({hue}, {saturation}%, 88%) 0%, hsl({hue}, {saturation}%, 82%) 100%)"
></div>
