<script lang="ts">
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import LegalRegistry from '../components/LegalRegistry.svelte';
</script>

<svelte:head><title>Legal foundations & gateways — Keystone</title></svelte:head>

<div class="pe-route wide">
  <StoryMasthead
    kicker="Field study · Legal foundations & gateways"
    title="The legal stack a data-sharing strategy stands on"
    thesis="The single most common failure in public-sector data strategy is to confuse a lawful basis with a legal power. Having a UK GDPR basis to process data does not mean you have the statutory power (the vires) to share it — and even with both, the common-law duty of confidence and the right governance must be in place. This registry separates the three layers so the strategy can name each one."
    thesisEli5="There are three separate legal questions for sharing data: are we allowed to process it, do we have the legal power to share it, and have we set up the right controls? People mix these up. This page keeps them apart."
    asks={['A · the data-protection basis (UK GDPR / DPA)', 'B · the legal power / gateway that permits the share', 'C · the governance instruments that must be in place']}
    askLabel="The three layers"
  />

  <LegalRegistry />

  <p class="foot-link">The workbench surfaces which of these your chosen posture brings into play. See it in the <a href="/projects/dfe-data-strategy/workbench">diagnostic</a>.</p>
</div>

<style>
  .foot-link { margin: 22px 0 0; font-size: 13px; color: rgba(28,22,17,0.65); }
  .foot-link a { color: var(--accent-ink); }
</style>
