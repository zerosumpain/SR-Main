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

  const TONE = '#8a2d3a';
</script>

<svelte:head>
  <title>The night shift · The Engine Room</title>
  <meta name="description" content="The unattended improvement run: eight phases you can step through, one you can break, and the six caps that bound a night." />
</svelte:head>

<section class="pe-route wide">
  <LeafHead
    part="change"
    title="The night shift"
    line="Unattended, it reads its own failures and writes improvements — eight phases, and six caps that bound what any one night may spend."
    lineEli5="While nobody is watching, it looks at what went wrong, tries to fix it, and is only allowed to do so much."
  />

  <Instrument
    kicker="The instrument"
    title="One night, eight phases"
    tone={TONE}
    reading="Pick a phase to read it. Break one, and watch the run's verdict."
    takeaway="Every phase is caught on its own: one that fails marks the run partial rather than aborting the night. The other seven still run."
  >
    <NightRun tone={TONE} />
  </Instrument>

  <Instrument
    kicker="The budget"
    title="What one night may spend"
    tone={TONE}
    reading="Six ceilings. Autonomy here is bounded by arithmetic, not by the model behaving."
    takeaway="It writes the code and opens a draft pull request — it cannot merge one."
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
  .caps { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 9px; }

  .onward { margin: 11px 0 0; font-size: 12.5px; line-height: 1.55; }
  .onward a { color: var(--accent-ink); text-decoration: none;
    border-bottom: 1px dashed currentColor; font-weight: 500; }

  @media (max-width: 380px) {
    .caps { grid-template-columns: 1fr; }
  }
</style>
