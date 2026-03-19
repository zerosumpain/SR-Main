<script lang="ts">
  import type { BiomeState, DayPhase } from '$lib/biome/state';

  let { state }: { state: BiomeState } = $props();

  const DAY_PHASE_HUE: Record<DayPhase, number> = {
    night: 252, dawn: 29, day: 209, dusk: 299,
  };

  let hue = $derived(DAY_PHASE_HUE[state.dayPhase]);
  let saturation = $derived(Math.round(state.recovery * 0.6));
</script>

<div
  class="fixed inset-0 z-0"
  style="background: radial-gradient(ellipse at 50% 100%, hsl({hue}, {saturation}%, 12%) 0%, hsl({hue}, {saturation}%, 4%) 100%)"
></div>
