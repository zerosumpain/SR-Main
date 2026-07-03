<script lang="ts">
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import TakeawayBar from '../components/TakeawayBar.svelte';
  import NextStep from '../components/NextStep.svelte';
  import Reveal from '../components/Reveal.svelte';
  import IntelInline from '../components/IntelInline.svelte';
  import PressureMatrix from '../components/PressureMatrix.svelte';
  import PressureMap from '../components/PressureMap.svelte';
  import CapabilityDemand from '../components/CapabilityDemand.svelte';
  import { PRESSURES } from '../lib/pressures';
  import { CAPABILITY_AREAS } from '../lib/capabilities';

  const urgent = PRESSURES.filter((p) => p.severity >= 4 && p.urgency >= 4).length;
</script>

<svelte:head><title>The pressures landscape — Keystone</title></svelte:head>

<div class="pe-route wide">
  <StoryMasthead
    kicker="Understand · The pressures landscape"
    title="The pressures a DfE data strategy must answer to"
    thesis="A data-strategy lead does not get to choose their pressures. They arrive from three directions at once — the centre of government, the department's own policy agenda, and a sprawling delivery system — and a credible strategy has to hold all three in view. These are the {PRESSURES.length} that shape the field."
    thesisEli5="Lots of different forces push on how DfE uses data. They come from three places: the rest of government, DfE's own plans, and the schools and councils it works with. Here they all are."
    asks={['A clear read on where each pressure comes from and how hard it pushes', 'Which capabilities each one demands', 'A way to test whether a strategy actually answers them']}
    askLabel="What the lead needs"
  />

  <TakeawayBar
    takeaway="The heaviest pressures all land at once — and they converge on the same few capabilities: sharing, interoperability and quality. The strategy's centre of gravity is not in dispute."
    takeawayEli5="The biggest pressures all point at the same things: joining data up, common standards, and making the data trustworthy."
    chips={[
      { n: String(PRESSURES.length), label: 'pressures', href: '#all-pressures' },
      { n: String(urgent), label: 'severe & urgent', href: '#shape' },
      { n: String(CAPABILITY_AREAS.length), label: 'capabilities under load', href: '#load' },
    ]}
    drill={[
      { label: 'the shape of the pressure', href: '#shape' },
      { label: 'where the load lands', href: '#load' },
    ]}
  />

  <IntelInline section="landscape" note="items that bear on the pressures" />

  <section class="viz" id="shape">
    <div class="viz-head">
      <h2 class="pe-h2">The shape of the pressure</h2>
      <p class="pe-prose">Not every pressure is equal. Plotted by how consequential (severity) and how soon (urgency), the top-right is what a strategy has to answer first — and the colour shows it’s a problem arriving from every direction at once.</p>
    </div>
    <PressureMap />
  </section>

  <section class="viz" id="load">
    <div class="viz-head">
      <h2 class="pe-h2">Where the load lands</h2>
      <p class="pe-prose">Sum the severity of every pressure onto the capability it demands, split by origin, and the strategy’s real centre of gravity appears — the capabilities that carry the most weight are where investment has to go first.</p>
    </div>
    <CapabilityDemand />
  </section>

  <div id="all-pressures">
    <Reveal label="Show all {PRESSURES.length} pressures — the full matrix, with sources">
      <PressureMatrix />
    </Reveal>
  </div>

  <NextStep
    links={[
      { label: 'The commitments ledger — what DfE is already bound to', href: '/projects/dfe-data-strategy/commitments', kind: 'primary' },
      { label: 'Which strategies should shape it', href: '/projects/dfe-data-strategy/strategies' },
      { label: 'Draft the strategy', href: '/projects/dfe-data-strategy/author' },
    ]}
  />
</div>

<style>
  .viz { margin: 8px 0 22px; }
  .viz-head { max-width: 80ch; margin-bottom: 12px; }
  .viz-head .pe-h2 { margin-bottom: 4px; }
</style>
