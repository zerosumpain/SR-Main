<script lang="ts">
  // Getting it live — Part IV, leaf 3.
  //
  // The old version of this page had no instrument at all: six stages as prose, five safety
  // rules as five paragraphs, eight protected paths as a list. All three are now things the
  // reader operates. The runner is the argument — the boundary of autonomy is a file path,
  // and you find that out by ticking a path and watching stage four hold.
  //
  // SAFETY's first entry is not a call-out here: it is the second instrument, because "the
  // deploy job declares the gate as a dependency" is a shape, not a sentence.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import PipelineRun from './components/PipelineRun.svelte';
  import GateWall from './components/GateWall.svelte';
  import { SAFETY } from '../../lib/shipping';

  const TONE = '#8a2d3a';
  const WALL = 'The deploy cannot run if the gate is red';

  /** SAFETY's own bodies, cut to a line each. Titles are untouched; no fact is replaced. */
  const GLOSS: Record<string, string> = {
    'Two deploys never touch the machine at once':
      'Serialised, never cancelled. A newer run can evict a waiting one.',
    'The runner is capped below the machine':
      'A runaway build hits the ceiling before the kernel picks a victim.',
    'Never deploy by hand':
      'One hand-rolled deploy copied a development machine’s settings over production’s; the site was wrong for more than a day.',
    'The anonymous surface is a lockfile':
      'Every signed-out route is checked in. Adding one fails the gate.',
  };

  const CALLOUTS = SAFETY.filter((s) => s.title !== WALL).map((s) => ({
    title: s.title,
    line: GLOSS[s.title] ?? s.body,
  }));
</script>

<svelte:head>
  <title>Getting it live · The Engine Room</title>
  <meta name="description" content="Six stages between a change and production, and the one stage a machine cannot clear on its own." />
</svelte:head>

<section class="pe-route wide">
  <LeafHead
    part="change"
    title="Getting it live"
    line="Six stages sit between a change and production. File path decides which a machine may clear alone."
    lineEli5="Six steps sit between a change and the live site. Whether the computer can finish them alone depends on which files it touched." />

  <Instrument
    kicker="The instrument"
    title="Push a change to production"
    tone={TONE}
    reading="Say who wrote it, whether the gate passed, and what it touches."
    takeaway="A routine machine-written change with a green gate merges itself. A protected path waits for a person.">
    <PipelineRun tone={TONE} />
  </Instrument>

  <Instrument
    kicker="Enforcement"
    title="A red gate is a wall, not a warning"
    tone={TONE}
    reading="The deploy job declares the gate as a dependency."
    takeaway="Required status checks are not available on this plan at all. A rule a person must remember would be no rule; a job that cannot start is one.">
    <GateWall tone={TONE} />

    <p class="sub">{CALLOUTS.length} more standing rules</p>
    <ul class="calls">
      {#each CALLOUTS as c (c.title)}
        <li><b>{c.title}</b><span>{c.line}</span></li>
      {/each}
    </ul>
  </Instrument>

  <PageFoot />
</section>

<style>
  .sub { margin: 16px 0 8px; font-family: 'JetBrains Mono', monospace; font-size: 9px;
    letter-spacing: 0.13em; text-transform: uppercase; color: rgba(28,22,17,0.5); }

  .calls { list-style: none; margin: 0; padding: 0;
    display: grid; grid-template-columns: repeat(auto-fit, minmax(min(250px, 100%), 1fr)); gap: 8px 18px; }
  .calls li { display: flex; flex-direction: column; gap: 2px; min-width: 0;
    padding-left: 11px; border-left: 2px solid color-mix(in srgb, #8a2d3a 40%, transparent); }
  .calls b { font-size: 12.5px; font-weight: 600; color: var(--text-primary); line-height: 1.3; }
  .calls span { font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.62); overflow-wrap: anywhere; }
</style>
