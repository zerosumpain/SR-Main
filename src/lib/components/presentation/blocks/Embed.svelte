<script lang="ts">
  // Registered-interactive block. Components load via dynamic import so the
  // deck bundle only pays for Three.js when an embed slide actually mounts.
  // Autoplay uses FederationSim's onReady(api) callback — no bind:this races.
  import { onMount } from 'svelte';
  import type { EmbedBlock } from '$lib/presentation/types';
  import type { Component } from 'svelte';

  let { block }: { block: EmbedBlock } = $props();

  let SimComponent = $state<Component<{ onReady?: (api: { run: (id: string) => void }) => void }> | null>(null);
  let failed = $state(false);

  onMount(async () => {
    if (block.embed === 'federation-sim') {
      try {
        SimComponent = (await import('$lib/sim/federation/FederationSim.svelte')).default;
      } catch (err) {
        console.error('embed failed to load', err);
        failed = true;
      }
    } else {
      failed = true; // unknown embeds are filtered at validation; belt-and-braces
    }
  });

  function handleReady(api: { run: (id: string) => void }) {
    const cfg = (block.config ?? {}) as { scenario?: string; autoplay?: boolean };
    if (cfg.autoplay && cfg.scenario) api.run(cfg.scenario);
  }
</script>

<div class="embed">
  {#if SimComponent}
    <SimComponent onReady={handleReady} />
  {:else if failed}
    <div class="embed-fallback">
      <span class="ef-kicker">EMBED UNAVAILABLE</span>
      <p>“{block.embed}” could not be loaded here.</p>
    </div>
  {:else}
    <div class="embed-loading">
      <span class="ef-kicker">LOADING {block.embed.toUpperCase()}…</span>
    </div>
  {/if}
</div>

<style>
  .embed { width: 100%; min-height: 200px; }
  .embed-loading,
  .embed-fallback {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 320px;
    border: 1px dashed rgba(28, 22, 17, 0.25);
    border-radius: var(--radius-round);
    color: var(--ink-soft);
  }
  .ef-kicker {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    letter-spacing: 0.18em;
    color: var(--ink-soft);
  }
  .embed-fallback p { font-size: 14px; margin: 0; }
</style>
