<script lang="ts">
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import PressureMatrix from '../components/PressureMatrix.svelte';
  import { PRESSURES } from '../lib/pressures';
</script>

<svelte:head><title>The pressures landscape — Keystone</title></svelte:head>

<div class="pe-route wide">
  <StoryMasthead
    kicker="Field study · The pressures landscape"
    title="The pressures a DfE data strategy must answer to"
    thesis="A data-strategy lead does not get to choose their pressures. They arrive from three directions at once — the centre of government, the department's own policy agenda, and a sprawling delivery system — and a credible strategy has to hold all three in view. These are the {PRESSURES.length} that shape the field."
    thesisEli5="Lots of different forces push on how DfE uses data. They come from three places: the rest of government, DfE's own plans, and the schools and councils it works with. Here they all are."
    asks={['A clear read on where each pressure comes from and how hard it pushes', 'Which capabilities each one demands', 'A way to test whether a strategy actually answers them']}
    askLabel="What the lead needs"
  />

  <PressureMatrix />

  <p class="foot-link">→ Now <a href="/projects/dfe-data-strategy/workbench">test a strategy against these pressures</a> in the workbench, or read <a href="/projects/dfe-data-strategy/frameworks">how good data strategy is done</a>.</p>
</div>

<style>
  .foot-link { margin: 22px 0 0; font-size: 13px; color: rgba(28,22,17,0.65); }
  .foot-link a { color: #2f6f97; }
</style>
