<script lang="ts">
  // Two instruments people constantly conflate, kept strictly distinct: the DfE "data spine"
  // (connectivity layer WITHIN education) vs the statutory "consistent identifier" (a cross-service
  // join key). Self-contained; reads the site-wide narrative register.
  import { app } from '../lib/appState.svelte';
  import { SPINE, IDENTIFIER } from '../lib/monitoring';
  const eli = $derived(app.narrative === 'eli5');
  const cards = [
    { d: SPINE, accent: '#2f6f97', tag: 'THE WIRING' },
    { d: IDENTIFIER, accent: '#7a5aa6', tag: 'THE JOIN KEY' },
  ];
</script>

<div class="svi">
  {#each cards as c, i (c.d.name)}
    <article class="svi-card" style="--ac:{c.accent}">
      <span class="svi-tag">{c.tag}</span>
      <h3 class="svi-name">{c.d.name}</h3>
      <p class="svi-kind">{c.d.kind}</p>
      {#if eli}
        <p class="svi-eli">{c.d.eli5}</p>
      {:else}
        <dl class="svi-dl">
          <div><dt>Legal basis</dt><dd>{c.d.legal}</dd></div>
          <div><dt>Scope</dt><dd>{c.d.scope}</dd></div>
          <div><dt>Status</dt><dd class="svi-status">{c.d.status}</dd></div>
        </dl>
      {/if}
      <a class="svi-src" href={c.d.url} target="_blank" rel="noopener">source ↗</a>
    </article>
    {#if i === 0}<div class="svi-neq" aria-hidden="true"><span>≠</span></div>{/if}
  {/each}
</div>
<p class="svi-foot">
  {#if eli}
    They’re being built by the same team — but they’re different things. The spine connects the school system to itself; the identifier lets schools, the NHS, social care and the police tell they mean the <b>same child</b>.
  {:else}
    They are steered together inside DfE — but they are <b>legally and operationally distinct</b>. The spine is intra-education connectivity; the consistent identifier is the cross-domain key that resolves datasets to the same child. Confusing the two is the most common error in coverage of the policy.
  {/if}
</p>

<style>
  .svi { display: grid; grid-template-columns: 1fr auto 1fr; align-items: stretch; gap: 6px; margin: 6px 0 0; }
  .svi-card { position: relative; border: 1px solid rgba(28,22,17,0.12); border-top: 3px solid var(--ac); border-radius: var(--radius-sharp);
    padding: 13px 15px 30px; background: rgba(255,255,255,0.42); }
  .svi-tag { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.14em; color: var(--ac); font-weight: 600; }
  .svi-name { font-family: var(--fs-serif); font-weight: 600; font-size: 17px; margin: 4px 0 2px; color: var(--ink); }
  .svi-kind { margin: 0 0 9px; font-size: var(--fs-label-xs); line-height: 1.4; color: var(--ac); font-weight: 500; }
  .svi-eli { margin: 0; font-size: var(--fs-nav); line-height: 1.55; color: rgba(28,22,17,0.78); }
  .svi-dl { margin: 0; display: flex; flex-direction: column; gap: 7px; }
  .svi-dl div { display: grid; grid-template-columns: 78px 1fr; gap: 8px; }
  .svi-dl dt { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: rgba(28,22,17,0.45); padding-top: 2px; }
  .svi-dl dd { margin: 0; font-size: var(--fs-label); line-height: 1.45; color: rgba(28,22,17,0.8); }
  .svi-status { color: var(--error) !important; font-weight: 500; }
  .svi-src { position: absolute; left: 15px; bottom: 10px; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--ac); text-decoration: none; border-bottom: 1px dashed currentColor; }
  .svi-neq { display: flex; align-items: center; justify-content: center; padding: 0 2px; }
  .svi-neq span { font-family: var(--fs-serif); font-size: 26px; color: rgba(28,22,17,0.35); font-weight: 600; }
  .svi-foot { margin: 12px 0 0; padding: 9px 13px; border-radius: var(--radius-sharp); font-size: var(--fs-label); line-height: 1.5; color: rgba(28,22,17,0.74);
    background: var(--accent-ink-tint-12); border: 1px solid var(--accent-ink-tint-22); }
  .svi-foot b { color: var(--ink); }
  @media (max-width: 720px) {
    .svi { grid-template-columns: 1fr; }
    .svi-neq { transform: rotate(90deg); padding: 2px 0; }
    .svi-card { padding-bottom: 28px; }
  }
</style>
