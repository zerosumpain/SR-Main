<script lang="ts">
  import { onMount } from 'svelte';
  import type { ChartArtifact } from '$lib/workflows/site-tools/artifact-types';
  import { srVegaConfig, applyNaturalSort } from '$lib/jkai/artifacts/vega-theme';

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
      // The design system goes UNDER the model's spec, so a spec that sets a
      // scale or an axis deliberately still wins. In practice a model supplies
      // marks, encodings and data and leaves every visual choice unset, which
      // is exactly what the config fills in.
      config: { ...srVegaConfig(), ...((specPlain.config as Record<string, unknown>) ?? {}) },
    };
    // If caller passed data separately and spec doesn't already have data, merge.
    if (dataPlain.length > 0) {
      const specData = (base.data as { values?: unknown[] } | undefined);
      if (!specData || !specData.values || specData.values.length === 0) {
        base.data = { values: dataPlain };
      }
    }
    // Vega-Lite sorts an ordinal domain alphabetically unless told otherwise,
    // which turns a week into "Fri Mon Sat Sun Thu Tue Wed". Models write the
    // rows in the order they mean; honour it.
    applyNaturalSort(base);
    return base;
  }

  onMount(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ default: embed }, { expressionInterpreter }] = await Promise.all([
          import('vega-embed'),
          import('vega-interpreter'),
        ]);
        if (cancelled || !container) return;
        const spec = buildFullSpec();
        try {
          await embed(container, spec as never, {
            actions: { export: true, source: false, compiled: false, editor: false },
            renderer: 'svg',
            // The site CSP has no 'unsafe-eval', and vega compiles a spec's
            // expressions into strings it hands to `Function()`. Vega ships an
            // AST interpreter for exactly this case: `ast` makes the parser emit
            // expression ASTs instead of source, and `expr` evaluates them.
            // Without this pair EVERY chart dies with an EvalError.
            ast: true,
            expr: expressionInterpreter,
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
  {#if artifact.caption}
    <figcaption>{artifact.caption}</figcaption>
  {/if}
  <div class="chart-container" bind:this={container}></div>
  {#if error}
    <p class="error">Chart failed to render: {error}</p>
  {/if}
</figure>

<style>
  .chart-artifact {
    margin: 0.5rem 0;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-round);
    max-width: 100%;
    overflow: hidden;
    background: var(--surface-elevated);
  }
  .chart-container {
    width: 100%;
    min-height: 240px;
    max-height: 400px;
    padding: 0.5rem;
  }
  /* Same caption treatment as the table, map and diagram cards: a mono kicker
     above the figure, not a centred line under it. */
  figcaption {
    padding: 0.4rem 0.75rem;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
    background: var(--surface-sunken);
    border-bottom: 1px solid var(--line-strong);
  }
  .error {
    color: var(--error);
    font-size: 0.85rem;
    margin: 0.5rem 0;
  }
</style>
