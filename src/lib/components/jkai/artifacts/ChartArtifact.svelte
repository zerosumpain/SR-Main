<script lang="ts">
  import { onMount } from 'svelte';
  import type { ChartArtifact } from '$lib/workflows/site-tools/artifact-types';

  let { artifact }: { artifact: ChartArtifact } = $props();

  let container: HTMLDivElement | undefined = $state();
  let error = $state<string | null>(null);

  function buildFullSpec() {
    // Deep-clone spec + data out of Svelte's reactive Proxies — vega-embed
    // calls structuredClone internally and will otherwise throw
    // "The object can not be cloned" on our $state-wrapped props.
    const specPlain = JSON.parse(JSON.stringify(artifact.spec ?? {})) as Record<string, unknown>;
    const dataPlain = JSON.parse(JSON.stringify(artifact.data ?? [])) as unknown[];

    const base: Record<string, unknown> = {
      $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
      width: 'container',
      autosize: { type: 'fit', contains: 'padding' },
      ...specPlain,
    };
    // If caller passed data separately and spec doesn't already have data, merge.
    if (dataPlain.length > 0) {
      const specData = (base.data as { values?: unknown[] } | undefined);
      if (!specData || !specData.values || specData.values.length === 0) {
        base.data = { values: dataPlain };
      }
    }
    return base;
  }

  onMount(() => {
    let cancelled = false;
    (async () => {
      try {
        const { default: embed } = await import('vega-embed');
        if (cancelled || !container) return;
        const spec = buildFullSpec();
        try {
          await embed(container, spec as never, {
            actions: { export: true, source: false, compiled: false, editor: false },
            renderer: 'svg',
          });
        } catch (embedErr) {
          console.error('[ChartArtifact] vega-embed failed', { spec, error: embedErr });
          throw embedErr;
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  });
</script>

<figure class="chart-artifact">
  <div class="chart-container" bind:this={container}></div>
  {#if error}
    <p class="error">Chart failed to render: {error}</p>
  {/if}
  {#if artifact.caption}
    <figcaption>{artifact.caption}</figcaption>
  {/if}
</figure>

<style>
  .chart-artifact {
    margin: 0.5rem 0;
    padding: 0.5rem;
    border: 1px solid rgb(var(--border-rgb, 200 200 200) / 0.4);
    border-radius: 6px;
    max-width: 100%;
    overflow: hidden;
  }
  .chart-container {
    width: 100%;
    min-height: 240px;
    max-height: 400px;
  }
  figcaption {
    font-size: 0.8rem;
    margin-top: 0.4rem;
    color: rgb(var(--muted-fg-rgb, 100 100 100));
    text-align: center;
  }
  .error {
    color: #b00;
    font-size: 0.85rem;
    margin: 0.5rem 0;
  }
</style>
