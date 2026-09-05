<script lang="ts">
  /**
   * A Mermaid diagram, rendered inline in the chat.
   *
   * Mermaid is loaded on demand exactly as vega-embed and Leaflet are — it is
   * a large dependency and most turns never draw a diagram, so it must not sit
   * in the entry bundle.
   *
   * TRUST. The diagram source is written by a model, so `securityLevel` stays
   * `'strict'`: HTML labels are off and mermaid runs its output through
   * DOMPurify before handing it back. That is what makes the `{@html}` below
   * safe — the string is mermaid's sanitised SVG, never the model's text. Do
   * not relax it to `'loose'` to get clickable nodes. `hardenDiagramSvg` then
   * closes the one gap DOMPurify's SVG profile leaves open; see that module.
   */
  import { onMount } from 'svelte';
  import type { DiagramArtifact } from '$lib/workflows/site-tools/artifact-types';
  import { hardenDiagramSvg } from '$lib/jkai/artifacts/diagram-svg';

  let { artifact }: { artifact: DiagramArtifact } = $props();

  let svg = $state<string | null>(null);
  let error = $state<string | null>(null);

  // A render id must be unique per mount: mermaid uses it as a DOM id while it
  // measures the diagram, and two charts sharing one produce an empty second.
  const renderId = `mmd-${Math.random().toString(36).slice(2, 10)}`;

  onMount(() => {
    let cancelled = false;
    (async () => {
      try {
        const { default: mermaid } = await import('mermaid');
        if (cancelled) return;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          // Labels as native SVG <text>, not HTML inside <foreignObject>.
          // Mermaid's default is HTML labels, and `hardenDiagramSvg` removes
          // foreignObject — which drew every box correctly and emptied every
          // one of them. Native text is also the stricter of the two: with
          // this off there is no HTML anywhere in the output to sanitise.
          htmlLabels: false,
          flowchart: { htmlLabels: false },
          class: { htmlLabels: false },
          fontFamily:
            '"Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif',
          themeVariables: {
            // The site palette. Mermaid derives a lot of shades from these, so
            // only the roles are set and the rest is left to its own ramp.
            background: '#ede4d4',
            mainBkg: '#e8dece',
            primaryColor: '#e8dece',
            primaryTextColor: '#1a1008',
            primaryBorderColor: '#0e5b66',
            secondaryColor: '#ded3c2',
            tertiaryColor: '#ede4d4',
            lineColor: '#7a6a55',
            textColor: '#1a1008',
            nodeBorder: '#0e5b66',
            clusterBkg: 'rgba(26, 16, 8, 0.035)',
            clusterBorder: 'rgba(26, 16, 8, 0.14)',
            edgeLabelBackground: '#ede4d4',
            titleColor: '#1a1008',
            fontSize: '13px',
          },
        });
        const out = await mermaid.render(renderId, artifact.code);
        if (cancelled) return;
        // Mermaid's own DOMPurify pass stops script and event handlers; this
        // second one closes `<img>`/`<foreignObject>`, which it permits and the
        // chat's prose sanitiser does not. See diagram-svg.ts.
        const safe = hardenDiagramSvg(out.svg);
        // An empty return means the hardener would not vouch for the markup.
        // Say so: without this the card sits on "Drawing diagram…" for ever,
        // which reads as a hang rather than a refusal.
        if (safe) svg = safe;
        else error = 'the rendered diagram could not be safely displayed';
      } catch (err) {
        // Mermaid throws on a syntax error, which is the common case when a
        // model writes the source. Show what it said rather than a blank box —
        // a diagram that silently renders nothing is indistinguishable from one
        // that never mounted.
        if (!cancelled) error = err instanceof Error ? err.message : String(err);
      }
    })();
    return () => {
      cancelled = true;
      // Mermaid leaves its measuring node behind when a render throws.
      document.getElementById(renderId)?.remove();
      document.getElementById(`d${renderId}`)?.remove();
    };
  });
</script>

<figure class="diagram-artifact">
  {#if artifact.caption}
    <figcaption>{artifact.caption}</figcaption>
  {/if}
  <div class="diagram-body">
    {#if svg}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html svg}
    {:else if error}
      <p class="error">Diagram failed to render: {error}</p>
      <pre class="src">{artifact.code}</pre>
    {:else}
      <p class="pending">Drawing diagram…</p>
    {/if}
  </div>
</figure>

<style>
  .diagram-artifact {
    margin: 0.5rem 0;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-round);
    overflow: hidden;
    max-width: 100%;
    background: var(--surface-elevated);
  }
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
  .diagram-body {
    padding: 0.75rem;
    /* A wide diagram scrolls on its own rather than stretching the message. */
    overflow-x: auto;
  }
  .diagram-body :global(svg) {
    max-width: 100%;
    height: auto;
    display: block;
    margin: 0 auto;
  }
  .pending {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-muted);
  }
  .error {
    color: var(--error);
    font-size: 0.85rem;
    margin: 0 0 0.5rem;
  }
  .src {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--text-muted);
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
