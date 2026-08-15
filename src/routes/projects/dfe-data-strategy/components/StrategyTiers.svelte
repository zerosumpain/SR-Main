<script lang="ts">
  import { STRATEGIES_BY_TIER, TIER_META, TIER_ORDER, KIND_META, voicesForStrategy } from '../lib/strategies';
  import { STANCE_META } from '../lib/sectorVoices';
  import { app } from '../lib/appState.svelte';
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
          {@const voices = voicesForStrategy(s.id, 2)}
          <article class="card">
            <div class="c-top">
              <span class="c-kind" style="background:{KIND_META[s.kind].color}">{KIND_META[s.kind].label}</span>
              <span class="c-status">{s.status}</span>
            </div>
            <h4 class="c-name">{s.name}</h4>
            <p class="c-take">“{s.take}”</p>
            <p class="c-why">{s.whyDfE}</p>
            {#if voices.length}
              <div class="c-voices">
                <span class="cv-l">Sector says</span>
                {#each voices as v}
                  <div class="cv" title={`${v.who} (${STANCE_META[v.stance].label}): ${v.point}`}>
                    <span class="cv-dot" style="background:{STANCE_META[v.stance].color}"></span>
                    <span class="cv-who">{v.who}</span>
                  </div>
                {/each}
              </div>
            {/if}
            <div class="c-foot">
              <a class="c-src" href={s.sourceUrl} target="_blank" rel="noopener">Source ↗</a>
              <button class="c-draft" onclick={() => app.openSuggest({ kind: 'strategy', id: s.id, label: s.short })} title="Draft data-strategy policies in response to this">✎ Draft policies</button>
            </div>
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
  .t-kicker { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.12em; color: var(--c); font-weight: 600; }
  .t-label { margin: 0; font-family: var(--fs-serif); font-size: clamp(20px, 2.6vw, 26px); font-weight: 600; color: var(--ink); letter-spacing: -0.01em; }
  .t-count { margin-left: auto; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.4); }
  .t-blurb { margin: 6px 0 14px; font-size: var(--fs-nav); line-height: 1.55; color: rgba(28,22,17,0.7); max-width: 80ch; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
  .card { border: 1px solid rgba(28,22,17,0.12); border-left: 3px solid var(--c); border-radius: var(--radius-sharp); background: rgba(255,255,255,0.48); padding: 13px 15px; display: flex; flex-direction: column; }
  .c-top { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .c-kind { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.05em; color: #fff; padding: 2px 6px; border-radius: var(--radius-sharp); }
  .c-status { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.04em; color: rgba(28,22,17,0.5); margin-left: auto; }
  .c-name { margin: 0 0 7px; font-family: var(--fs-serif); font-size: var(--fs-body); font-weight: 600; color: var(--ink); line-height: 1.2; }
  .c-take { margin: 0 0 8px; font-size: var(--fs-nav); line-height: 1.45; color: var(--ink); font-style: italic; font-weight: 500; }
  .c-why { margin: 0 0 10px; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.68); flex: 1; }
  .c-voices { margin: 0 0 10px; padding-top: 8px; border-top: 1px dotted rgba(28,22,17,0.15); }
  .cv-l { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: rgba(28,22,17,0.45); margin-bottom: 3px; }
  .cv { display: flex; align-items: center; gap: 5px; margin-bottom: 2px; cursor: help; }
  .cv-dot { width: 6px; height: 6px; border-radius: var(--radius-pill); flex-shrink: 0; }
  .cv-who { font-size: var(--fs-label-xs); color: rgba(28,22,17,0.66); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .c-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: auto; }
  .c-src { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent-ink); text-decoration: none; border-bottom: 1px dashed currentColor; }
  .c-draft { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: #8a2d3a; background: rgba(138,45,58,0.06); border: 1px solid rgba(138,45,58,0.3); border-radius: var(--radius-sharp); padding: 4px 8px; cursor: pointer; white-space: nowrap; }
  .c-draft:hover { background: rgba(138,45,58,0.14); }
</style>
