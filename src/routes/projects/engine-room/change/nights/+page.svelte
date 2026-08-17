<script lang="ts">
  // The night shift — two instruments, no essay.
  //
  // First: the eight phases as a sequence the reader can step through and deliberately
  // break, because "each phase is independently caught" is a thing to do, not to read.
  // Second: the six caps on one screen — the entire autonomy budget of an unattended run,
  // which is the strongest single image this page has.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import Stat from '../../components/viz/Stat.svelte';
  import NightRun from './components/NightRun.svelte';
  import { NIGHT_CAPS } from '../../lib/building';
  import { href } from '../../lib/nav';
  import { app } from '../../lib/appState.svelte';

  const TONE = '#8a2d3a';
  const eli = $derived(app.narrative === 'eli5');
</script>

<svelte:head>
  <title>The night shift · The Engine Room</title>
  <meta name="description" content="The unattended improvement run: eight phases you can step through, one you can break, and the six caps that bound a night." />
</svelte:head>

<section class="pe-route wide">
  <LeafHead
    part="change"
    title="The night shift"
    line="At half past three, with nobody watching, it reads back its own failures and writes improvements. Eight phases, and six caps deciding exactly how much rope any one night gets."
    lineEli5="Every night at half past three, part of this system reviews its own week and tries to do better. This page explains what that actually means, and how much it is allowed to do about it."
  />

  <div class="pe-prose intro">
    {#if eli}
      <p>
        Most software improves because a person sits down and improves it. This site also does that
        to itself. Overnight, while nothing else is happening, a separate part of the system reads
        back the last week of use — the questions the assistant could not answer, the tools that
        kept failing — and has a go at doing something about it: registering a new data source,
        writing a small tool, or repairing one with a bad record.
      </p>
      <p>
        It exists because the small gaps appeared faster than my evenings could close them. The
        interesting part is not the ambition but the restraint: a night's work is bounded on every
        side — a fixed spend, a fixed number of attempts, a hard stop on the clock — and anything
        bigger than a small tool becomes a written proposal for me to read over breakfast, not a
        change it makes itself.
      </p>
    {:else}
      <p>
        The engine behind this page is a nightly, unattended run: it gathers a week of conversation
        and tool telemetry, distils unmet needs, discovers and verifies candidate data sources, then
        authors at most one runtime tool — which goes live only if it clears the gate on the next
        page. It was built because the backlog of small capability gaps grew faster than the time
        available to close them by hand.
      </p>
      <p>
        The design centre is restraint rather than reach. Every phase is separately caught, every
        resource is capped, and the ceiling on ambition is structural: repository-level ideas leave
        the run as written proposals, never as changes.
      </p>
    {/if}
  </div>

  <Instrument
    kicker="The instrument"
    title="One night, eight phases"
    tone={TONE}
    reading="Pick a phase to read it. Break one, and see what the run makes of that."
    readingEli5="Pick a phase to read what it does. Break one, and see what the night makes of that."
    takeaway="Every phase is caught on its own, so one falling over marks the night partial rather than writing the whole thing off. The other seven carry on regardless, like professionals."
    takeawayEli5="Each phase is caught on its own, so one falling over marks the night as partial rather than wasted — the other seven carry on regardless."
  >
    <NightRun tone={TONE} />
  </Instrument>

  <Instrument
    kicker="The budget"
    title="What one night may spend"
    tone={TONE}
    reading="Six ceilings. Autonomy here is bounded by arithmetic rather than by the model being on its best behaviour."
    readingEli5="Six ceilings. How much it may do in a night is fixed by arithmetic, not by trusting it to behave."
    takeaway="It writes the code and opens a draft pull request. It cannot merge one. That is not a setting; there is no code that does it."
    takeawayEli5="It can write code and open a draft change for review. It cannot approve one — and not because a setting says so: there is simply no code that does it."
  >
    <div class="caps">
      {#each NIGHT_CAPS as c (c.k)}
        <Stat value={c.v} label={c.k} how={c.why} tone={TONE} />
      {/each}
    </div>

    <p class="onward"><a href={href('change', 'shipping')}>Getting it live →</a></p>
  </Instrument>

  <PageFoot />
</section>

<style>
  .intro { margin: 0 0 20px; }

  .caps { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 9px; }

  .onward { margin: 11px 0 0; font-size: var(--fs-label); line-height: 1.55; }
  .onward a { color: var(--accent-ink); text-decoration: none;
    border-bottom: 1px dashed currentColor; font-weight: 500; }

  @media (max-width: 380px) {
    .caps { grid-template-columns: 1fr; }
  }
</style>
