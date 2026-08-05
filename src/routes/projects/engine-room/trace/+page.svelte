<script lang="ts">
  // The instrument route. One turn, six stages, six layers — the whole study in one screen.
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import TurnTrace from './components/TurnTrace.svelte';
  import { app } from '../lib/appState.svelte';
  import { LAYERS, STAGES } from '../lib/trace';

  const depth = $derived(app.narrative === 'eli5' ? 'eli5' : 'engineering');
</script>

<svelte:head>
  <title>Trace a turn · The Engine Room</title>
  <meta name="description" content="Follow one message through every stage and every layer of a personal AI system — where the time goes, where the money goes, and what is checking what." />
</svelte:head>

<section class="pe-route wide">
  <StoryMasthead
    kicker="The instrument"
    title="Trace a turn"
    thesis="Everything else in this study is a description. This is the thing itself: one message, followed from the moment it leaves the keyboard to the moment the bill is written, across all six layers at once. Pick a message, press play, and open whichever layer you want to watch."
    thesisEli5="Type a message to an AI assistant and something has to happen. This shows you exactly what — step by step, with a running clock and a running bill. Pick one of the four examples and press play."
    asks={[
      'Where does the time in an AI answer actually go? (Rarely where you would guess.)',
      'What makes one message cost a fraction of a penny and another cost ten pence?',
      'What is being checked, at which point, and what happens when a check fails?',
    ]}
  />

  <TurnTrace {depth} />

  <h2 class="pe-h2">How to read it</h2>
  <div class="ds-grid">
    <div class="ds-card">
      <span class="ds-kicker">Across — six stages</span>
      <h3>What happens, in order</h3>
      <p class="ds-body">
        {#each STAGES as s, i}<b>{s.name}</b>{i < STAGES.length - 1 ? ' → ' : '. '}{/each}
        Every turn goes through all six, whether it is a one-line question or an overnight job with nobody watching.
      </p>
    </div>
    <div class="ds-card">
      <span class="ds-kicker">Down — six layers</span>
      <h3>Who is doing it</h3>
      <p class="ds-body">
        {#each LAYERS as l, i}<b>{l.name}</b>{i < LAYERS.length - 1 ? ' · ' : '. '}{/each}
        All six are live at every stage. The marker sits at the same instant on every row — open one to see what that
        instant looks like from there.
      </p>
    </div>
    <div class="ds-card">
      <span class="ds-kicker">⚠ — the interesting ones</span>
      <h3>Where it went wrong</h3>
      <p class="ds-body">
        Cells marked with a warning are places something actually broke, in production, and had to be fixed. Those are
        the cells worth opening — a system's design is mostly a record of what it has already got wrong.
      </p>
    </div>
  </div>

  <div class="er-lesson">
    <span class="el-lab">The point of the grid</span>
    <p>Run the <b>quick question</b> and watch the <b>Context</b> layer: more of the elapsed time goes into assembling
      the prompt and shipping it than into the model thinking. Then run the <b>research request</b> and watch the
      <b>Model</b> layer: the cost curve is not driven by how hard the question is, but by how many times an
      ever-growing prompt gets re-read.</p>
    <p>Then run <b>nobody is watching</b>. The top layer is empty — there is no interface, no spinner, no person. The
      other five layers do exactly the same work, and the guardrail layer is doing the most.</p>
  </div>

  <a class="pe-next" href="/projects/engine-room/chat">Next — how a conversation is actually run →</a>
</section>
