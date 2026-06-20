<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { PRESSURES_BY_ORIGIN } from '../lib/pressures';
  import { CAPABILITY_BY_ID } from '../lib/capabilities';
  import ConfidenceBadge from './ConfidenceBadge.svelte';
  import type { Origin } from '../lib/types';

  const COLS: { id: Origin; label: string; blurb: string; color: string }[] = [
    { id: 'cross-government', label: 'From across government', blurb: 'What the centre and the wider system expect of every department’s data.', color: '#2f6155' },
    { id: 'dfe-policy', label: 'From DfE’s own policy', blurb: 'What the department’s priorities demand of its data — drawn from the Policy Engine.', color: '#8a2d3a' },
    { id: 'partners', label: 'From the partner web', blurb: 'What working through schools, trusts, councils and agencies requires.', color: '#2f6f97' },
  ];
  const eli = $derived(app.narrative === 'eli5');
</script>

<div class="pm">
  {#each COLS as col}
    <div class="col">
      <div class="col-head" style="--c:{col.color}">
        <h3>{col.label}</h3>
        <p>{col.blurb}</p>
      </div>
      {#each PRESSURES_BY_ORIGIN[col.id] as p (p.id)}
        <div class="pc" style="--c:{col.color}">
          <div class="pc-top">
            <span class="pc-title">{p.title}</span>
            <span class="pc-su" title={`Severity ${p.severity}/5 · Urgency ${p.urgency}/5`}>
              <i class="sev" style="--n:{p.severity}"></i><i class="urg" style="--n:{p.urgency}"></i>
            </span>
          </div>
          <p class="pc-desc">{eli && p.eli5 ? p.eli5 : p.description}</p>
          <div class="pc-demands">{#each p.demands as d}<span class="dem">{CAPABILITY_BY_ID[d]?.short ?? d}</span>{/each}</div>
          <div class="pc-foot">
            <ConfidenceBadge level={p.confidence} small />
            {#if p.policyEngineRef}<a class="pe" href={p.policyEngineRef.href}>↪ {p.policyEngineRef.label}</a>{/if}
            {#if p.sourceUrl}<a class="src" href={p.sourceUrl} target="_blank" rel="noopener" title={p.sourceName}>source ↗</a>{/if}
            <button class="draft" onclick={() => app.openSuggest({ kind: 'pressure', id: p.id, label: p.title })} title="Draft data-strategy policies in response to this pressure">✎ Draft policies</button>
          </div>
        </div>
      {/each}
    </div>
  {/each}
</div>

<style>
  .pm { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .col { display: flex; flex-direction: column; gap: 9px; }
  .col-head { border-top: 3px solid var(--c); padding-top: 8px; }
  .col-head h3 { margin: 0 0 3px; font-family: 'Fraunces', serif; font-size: 17px; font-weight: 600; color: var(--ink); }
  .col-head p { margin: 0 0 4px; font-size: 11.5px; line-height: 1.4; color: rgba(28,22,17,0.6); }
  .pc { border: 1px solid rgba(28,22,17,0.12); border-left: 3px solid var(--c); border-radius: var(--radius-round); background: rgba(255,255,255,0.45); padding: 9px 11px; }
  .pc-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
  .pc-title { font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 600; color: var(--ink); line-height: 1.3; }
  .pc-su { display: inline-flex; flex-direction: column; gap: 2px; flex-shrink: 0; margin-top: 2px; }
  .pc-su i { display: block; height: 4px; width: 34px; border-radius: var(--radius-sharp); background: linear-gradient(90deg, var(--g, #b4632e) calc(var(--n) * 20%), rgba(28,22,17,0.12) 0); }
  .pc-su .urg { --g: var(--error); }
  .pc-desc { margin: 6px 0; font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.74); }
  .pc-demands { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 7px; }
  .dem { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; background: rgba(28,22,17,0.06); border-radius: var(--radius-round); padding: 2px 5px; color: rgba(28,22,17,0.6); }
  .pc-foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .pe { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: #8a2d3a; text-decoration: none; border-bottom: 1px dashed currentColor; }
  .src { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: var(--accent-ink); text-decoration: none; border-bottom: 1px dashed currentColor; }
  .draft { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: #8a2d3a; background: rgba(138,45,58,0.06); border: 1px solid rgba(138,45,58,0.3); border-radius: var(--radius-round); padding: 3px 7px; cursor: pointer; margin-left: auto; white-space: nowrap; }
  .draft:hover { background: rgba(138,45,58,0.14); }
  @media (max-width: 900px) { .pm { grid-template-columns: 1fr; } }
</style>
