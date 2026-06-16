<script lang="ts">
  import { LEGISLATION, LEGAL_LAYER_META } from '../lib/legislation';
  import type { LegalLayer } from '../lib/types';

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
      <div class="items">
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
  .layer-head h3 { margin: 0 0 2px; font-family: 'Fraunces', serif; font-size: 18px; font-weight: 600; color: var(--ink); }
  .layer-head p { margin: 0 0 10px; font-size: 12.5px; line-height: 1.5; color: rgba(28,22,17,0.62); max-width: 72ch; }
  .items { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
  .li { border: 1px solid rgba(28,22,17,0.12); border-left: 3px solid #2f6f97; border-radius: 9px; background: rgba(255,255,255,0.45); padding: 12px 14px; scroll-margin-top: 120px; }
  .li-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .li-head h4 { margin: 0; font-family: 'Fraunces', serif; font-size: 15px; font-weight: 600; color: var(--ink); }
  .li-cite { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: rgba(28,22,17,0.5); }
  .li-sum { margin: 6px 0; font-size: 12.5px; line-height: 1.5; color: rgba(28,22,17,0.76); }
  .li-rel { margin: 6px 0 8px; font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.66); }
  .rel-lab { display: block; font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.06em; color: #2f6155; margin-bottom: 2px; }
  .li-src { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #2f6f97; text-decoration: none; border-bottom: 1px dashed currentColor; }
</style>
