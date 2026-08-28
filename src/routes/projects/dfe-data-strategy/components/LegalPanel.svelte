<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { LEGISLATION_BY_ID, LEGAL_LAYER_META } from '$lib/dfe-data-strategy/legislation';
  import type { LegalLayer } from '$lib/dfe-data-strategy/types';

  const items = $derived(app.align.legalImplicated.map((id) => LEGISLATION_BY_ID[id]).filter(Boolean));
  const LAYERS: LegalLayer[] = ['protection-basis', 'legal-gateway', 'governance'];
  const byLayer = $derived(LAYERS.map((l) => ({ layer: l, items: items.filter((i) => i.layer === l) })).filter((g) => g.items.length));
</script>

<div class="lp">
  <p class="lp-note">The legal instruments your current posture brings into play. A lawful basis (A) is not the same as a legal power to share (B) — and both need governance (C).</p>
  {#each byLayer as g}
    <div class="lp-grp">
      <span class="lp-layer" title={LEGAL_LAYER_META[g.layer].blurb}>{LEGAL_LAYER_META[g.layer].name}</span>
      {#each g.items as i}
        <a class="lp-item" href={`/projects/dfe-data-strategy/legislation#${i.id}`} title={i.relevance}>
          <span class="li-name">{i.name}</span>
          {#if i.citation}<span class="li-cite">{i.citation}</span>{/if}
        </a>
      {/each}
    </div>
  {/each}
</div>

<style>
  .lp { display: flex; flex-direction: column; gap: 8px; }
  .lp-note { margin: 0 0 2px; font-size: var(--fs-label-xs); line-height: 1.45; color: rgba(28,22,17,0.6); }
  .lp-grp { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .lp-layer { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: rgba(28,22,17,0.55); width: 100%; }
  .lp-item { display: inline-flex; align-items: baseline; gap: 6px; padding: 4px 9px; border: 1px solid var(--accent-ink-tint-35); background: var(--accent-ink-tint-06); border-radius: var(--radius-sharp); text-decoration: none; }
  .lp-item:hover { background: var(--accent-ink-tint-12); }
  .li-name { font-size: var(--fs-label-xs); font-weight: 600; color: var(--accent-ink); }
  .li-cite { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.45); }
</style>
