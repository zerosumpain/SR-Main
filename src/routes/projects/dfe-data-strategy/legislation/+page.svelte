<script lang="ts">
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import TakeawayBar from '../components/TakeawayBar.svelte';
  import NextStep from '../components/NextStep.svelte';
  import IntelInline from '../components/IntelInline.svelte';
  import LegalRegistry from '../components/LegalRegistry.svelte';
  import { LEGISLATION } from '../lib/legislation';
</script>

<svelte:head><title>Legal foundations & gateways — Keystone</title></svelte:head>

<div class="pe-route wide">
  <StoryMasthead
    kicker="Understand · Legal foundations & gateways"
    title="The legal stack a data-sharing strategy stands on"
    thesis="The single most common failure in public-sector data strategy is to confuse a lawful basis with a legal power. Having a UK GDPR basis to process data does not mean you have the statutory power (the vires) to share it — and even with both, the common-law duty of confidence and the right governance must be in place. This registry separates the three layers so the strategy can name each one."
    thesisEli5="There are three separate legal questions for sharing data: are we allowed to process it, do we have the legal power to share it, and have we set up the right controls? People mix these up. This page keeps them apart."
    asks={['A · the data-protection basis (UK GDPR / DPA)', 'B · the legal power / gateway that permits the share', 'C · the governance instruments that must be in place']}
    askLabel="The three layers"
  />

  <TakeawayBar
    takeaway="A lawful basis is not a legal power. Every new data flow the commitments create needs all three layers named — basis, gateway, governance — or it will stall in legal review."
    takeawayEli5="Being allowed to hold data isn't the same as being allowed to share it. Each new share needs three separate boxes ticked."
    chips={[
      { n: String(LEGISLATION.length), label: 'instruments in the registry' },
      { n: '3', label: 'layers per flow' },
    ]}
  />

  <IntelInline section="legislation" note="new law, commencement and guidance" />

  <LegalRegistry />

  <NextStep
    links={[
      { label: 'DfE in context — the partner web', href: '/projects/dfe-data-strategy/dfe', kind: 'primary' },
      { label: 'Write the legal-basis section', href: '/projects/dfe-data-strategy/author' },
      { label: 'Diagnose the posture', href: '/projects/dfe-data-strategy/author?tab=diagnose' },
    ]}
  />
</div>
