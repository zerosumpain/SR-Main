<script lang="ts">
  import { LEGISLATION, LEGAL_LAYER_META } from '$lib/dfe-data-strategy/legislation';
  import type { LegalLayer } from '$lib/dfe-data-strategy/types';

  const LAYERS: LegalLayer[] = ['protection-basis', 'legal-gateway', 'governance'];
  const byLayer = (l: LegalLayer) => LEGISLATION.filter((x) => x.layer === l);
</script>

<div class="lr">
  {#each LAYERS as layer}
    <section class="layer">
      <div class="layer-head">
        <h3>{LEGAL_LAYER_META[layer].name}</h3>
        <p>{LEGAL_LAYER_META[layer].blurb}</p>
      </div>
      <div class="pe-grid">
        {#each byLayer(layer) as l (l.id)}
          <article class="li" id={l.id}>
            <div class="li-head">
              <h4>{l.name}</h4>
              {#if l.citation}<span class="li-cite">{l.citation}</span>{/if}
            </div>
            <p class="li-sum">{l.summary}</p>
            <p class="li-rel"><span class="rel-lab">Why it matters here</span> {l.relevance}</p>
            {#if l.sourceUrl}<a class="li-src" href={l.sourceUrl} target="_blank" rel="noopener">Read the source ↗</a>{/if}
          </article>
        {/each}
      </div>
    </section>
  {/each}
</div>

<style>
  .lr { display: flex; flex-direction: column; gap: 22px; }
  .layer-head h3 { margin: 0 0 2px; font-family: var(--fs-serif); font-size: 18px; font-weight: 600; color: var(--ink); }
  .layer-head p { margin: 0 0 10px; font-size: var(--fs-label); line-height: 1.5; color: rgba(28,22,17,0.62); max-width: 72ch; }
  .li { border: 1px solid rgba(28,22,17,0.12); border-left: 3px solid var(--accent-ink); border-radius: var(--radius-sharp); background: rgba(255,255,255,0.45); padding: 14px 16px; scroll-margin-top: 120px; }
  .li-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .li-head h4 { margin: 0; font-family: var(--fs-serif); font-size: var(--fs-body-sm); font-weight: 600; color: var(--ink); }
  .li-cite { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.5); }
  .li-sum { margin: 6px 0; font-size: var(--fs-label); line-height: 1.5; color: rgba(28,22,17,0.76); }
  .li-rel { margin: 6px 0 8px; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.66); }
  .rel-lab { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--accent-ink); margin-bottom: 2px; }
  .li-src { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent-ink); text-decoration: none; border-bottom: 1px dashed currentColor; }
</style>
