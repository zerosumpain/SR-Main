<script lang="ts">
  import { STRATEGIES_BY_TIER, TIER_META, TIER_ORDER, KIND_META } from '../lib/strategies';
</script>

<div class="st">
  {#each TIER_ORDER as tier}
    {@const m = TIER_META[tier]}
    <section class="tier" id={`tier-${tier}`} style="--c:{m.color}">
      <div class="t-head">
        <span class="t-kicker">{m.kicker}</span>
        <h3 class="t-label">{m.label}</h3>
        <span class="t-count">{STRATEGIES_BY_TIER[tier].length}</span>
      </div>
      <p class="t-blurb">{m.blurb}</p>
      <div class="cards">
        {#each STRATEGIES_BY_TIER[tier] as s (s.id)}
          <article class="card">
            <div class="c-top">
              <span class="c-kind" style="background:{KIND_META[s.kind].color}">{KIND_META[s.kind].label}</span>
              <span class="c-status">{s.status}</span>
            </div>
            <h4 class="c-name">{s.name}</h4>
            <p class="c-take">“{s.take}”</p>
            <p class="c-why">{s.whyDfE}</p>
            <a class="c-src" href={s.sourceUrl} target="_blank" rel="noopener">Source ↗</a>
          </article>
        {/each}
      </div>
    </section>
  {/each}
</div>

<style>
  .st { display: flex; flex-direction: column; gap: 30px; }
  .tier { border-top: 3px solid var(--c); padding-top: 12px; scroll-margin-top: 130px; }
  .t-head { display: flex; align-items: baseline; gap: 10px; }
  .t-kicker { font-family: 'JetBrains Mono', monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--c); font-weight: 600; }
  .t-label { margin: 0; font-family: 'Fraunces', serif; font-size: clamp(20px, 2.6vw, 26px); font-weight: 600; color: var(--ink); letter-spacing: -0.01em; }
  .t-count { margin-left: auto; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: rgba(28,22,17,0.4); }
  .t-blurb { margin: 6px 0 14px; font-size: 14px; line-height: 1.55; color: rgba(28,22,17,0.7); max-width: 80ch; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 12px; }
  .card { border: 1px solid rgba(28,22,17,0.12); border-left: 3px solid var(--c); border-radius: 10px; background: rgba(255,255,255,0.48); padding: 13px 15px; display: flex; flex-direction: column; }
  .c-top { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .c-kind { font-family: 'JetBrains Mono', monospace; font-size: 8px; text-transform: uppercase; letter-spacing: 0.05em; color: #fff; padding: 2px 6px; border-radius: 4px; }
  .c-status { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.04em; color: rgba(28,22,17,0.5); margin-left: auto; }
  .c-name { margin: 0 0 7px; font-family: 'Fraunces', serif; font-size: 16px; font-weight: 600; color: var(--ink); line-height: 1.2; }
  .c-take { margin: 0 0 8px; font-size: 14px; line-height: 1.45; color: var(--ink); font-style: italic; font-weight: 500; }
  .c-why { margin: 0 0 10px; font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.68); flex: 1; }
  .c-src { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: #2f6f97; text-decoration: none; border-bottom: 1px dashed currentColor; align-self: flex-start; }
</style>
