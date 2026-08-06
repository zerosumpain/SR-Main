<script lang="ts">
  // Trace a turn — the flagship instrument. The page is a frame; TurnTrace is the argument.
  //
  // Adversarial pass 2026-08-06: this page carried a second "Legend" instrument that
  // re-listed the six stages and six layers as chips. The grid prints both axes on itself,
  // so that block was ~69 rendered words restating the visual — the exact pattern this
  // rewrite exists to remove. Deleted. The one thing it added that the grid does not say is
  // the hazard count, and that is now the instrument's takeaway, still counted from MATRIX
  // so it can never drift from the cells.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import TurnTrace from './components/TurnTrace.svelte';
  import { app } from '../../lib/appState.svelte';
  import { LAYERS, STAGES, MATRIX } from '../../lib/trace';

  const depth = $derived(app.narrative === 'eli5' ? 'eli5' : 'engineering');

  const LAYER_HAZ = LAYERS.map((l) => STAGES.filter((s) => MATRIX[s.id][l.id].hazard).length);
  const hazCells = LAYER_HAZ.reduce((a, n) => a + n, 0);
  const hazLayers = LAYER_HAZ.filter((n) => n > 0).length;
  const allCells = STAGES.length * LAYERS.length;
</script>

<svelte:head>
  <title>Trace a turn · The Engine Room</title>
  <meta name="description" content="Follow one message through six stages and six layers of a personal AI system, with a live clock and a running bill." />
</svelte:head>

<section class="pe-route wide">
  <LeafHead
    part="turn"
    title="Trace a turn"
    line="One message followed from keystroke to bill, across all six layers at once. Pick a scenario and press play."
    lineEli5="Type a message to an AI and a lot has to happen. Pick an example and press play."
  />

  <Instrument
    kicker="The instrument"
    title="One turn, end to end"
    tone="var(--accent-ink)"
    reading="Six stages across, six layers down. The marker holds one instant on every row."
    takeaway="⚠ marks a known failure mode: {hazCells} cells of {allCells}, inside {hazLayers} of the six layers."
  >
    <TurnTrace {depth} />
  </Instrument>

  <PageFoot />
</section>
