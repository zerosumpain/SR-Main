<script lang="ts">
  // The federation, live — a dedicated single-screen simulation. The canvas fills
  // the viewport; every control (scenarios, joins, ask-the-federation, log, contract,
  // counters) is an on-canvas HUD overlay. Reached from Solutions and Outcomes.
  import FederationSim from '$lib/sim/federation/FederationSim.svelte';
</script>

<svelte:head>
  <title>The Data Spine — the federation, live</title>
  <meta name="description" content="A single-screen interactive Three.js simulation of a federated (X-Road-style) education data exchange for England: ~22,600 schools clustered by their real MIS vendor, a local-authority context space, fourteen scenarios, and cross-context join queries that resolve a school UPN to an LA case ID with an honest match confidence." />
</svelte:head>

<h1 class="sr-only">The federation, live — a single-screen simulation</h1>
<div class="sim-page">
  <FederationSim standalone />
</div>

<style>
  .sim-page { width: 100%; }
  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
  }
</style>
