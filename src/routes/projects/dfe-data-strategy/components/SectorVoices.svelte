<script lang="ts">
  import { SECTOR_VOICES, VOICE_GROUP_META, STANCE_META, type VoiceGroup, type Stance } from '$lib/dfe-data-strategy/sectorVoices';

  let stanceFilter = $state<'all' | Stance>('all');

  const GROUP_ORDER: VoiceGroup[] = ['central', 'local-authorities', 'mats', 'third-sector', 'press'];
  const STANCES: Stance[] = ['supportive', 'cautious', 'mixed', 'critical'];

  const inGroup = (g: VoiceGroup) => SECTOR_VOICES.filter((v) => v.group === g);
  const shown = (g: VoiceGroup) => inGroup(g).filter((v) => stanceFilter === 'all' || v.stance === stanceFilter);
  const balance = (g: VoiceGroup) => {
    const vs = inGroup(g);
    return STANCES.map((s) => ({ s, n: vs.filter((v) => v.stance === s).length })).filter((x) => x.n > 0);
  };
</script>

<div class="sv">
  <div class="sv-filter">
    <span class="f-lab">Filter by stance</span>
    <button class:on={stanceFilter === 'all'} onclick={() => (stanceFilter = 'all')}>All</button>
    {#each STANCES as s}
      <button class:on={stanceFilter === s} style="--c:{STANCE_META[s].color}" onclick={() => (stanceFilter = s)}>{STANCE_META[s].label}</button>
    {/each}
  </div>

  {#each GROUP_ORDER as g}
    {@const m = VOICE_GROUP_META[g]}
    {@const list = shown(g)}
    {#if inGroup(g).length}
      <section class="grp" style="--c:{m.color}">
        <div class="g-head">
          <div>
            <h3 class="g-label">{m.label}</h3>
            <p class="g-blurb">{m.blurb}</p>
          </div>
          <div class="g-balance" title="Balance of opinion in this group">
            {#each balance(g) as b}
              <span class="bal" style="--bc:{STANCE_META[b.s].color}; flex:{b.n}">{b.n}</span>
            {/each}
          </div>
        </div>
        {#if list.length}
          <div class="cards">
            {#each list as v (v.id)}
              <article class="vc" style="--sc:{STANCE_META[v.stance].color}">
                <div class="v-top">
                  <span class="v-stance" style="background:{STANCE_META[v.stance].color}">{STANCE_META[v.stance].label}</span>
                  <span class="v-who">{v.who}</span>
                </div>
                <p class="v-point">{v.point}</p>
                {#if v.sourceUrl}<a class="v-src" href={v.sourceUrl} target="_blank" rel="noopener">{v.sourceName ?? 'Source'} ↗</a>{/if}
              </article>
            {/each}
          </div>
        {:else}
          <p class="g-empty">No {stanceFilter} voices in this group.</p>
        {/if}
      </section>
    {/if}
  {/each}
</div>

<style>
  .sv { display: flex; flex-direction: column; gap: 24px; }
  .sv-filter { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .f-lab { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; color: rgba(28,22,17,0.5); margin-right: 4px; }
  .sv-filter button { font-family: var(--font-mono); font-size: var(--fs-label-xs); padding: 4px 10px; border-radius: var(--radius-sharp); cursor: pointer; border: 1px solid rgba(28,22,17,0.2); background: rgba(255,255,255,0.6); color: var(--ink); }
  .sv-filter button.on { background: var(--c, var(--ink)); color: #fff; border-color: var(--c, var(--ink)); }
  .grp { border-top: 3px solid var(--c); padding-top: 10px; }
  .g-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 12px; }
  .g-label { margin: 0; font-family: var(--fs-serif); font-size: 19px; font-weight: 600; color: var(--ink); }
  .g-blurb { margin: 2px 0 0; font-size: var(--fs-label-xs); line-height: 1.45; color: rgba(28,22,17,0.6); max-width: 60ch; }
  .g-balance { display: flex; gap: 2px; align-items: center; min-width: 120px; height: 18px; }
  .bal { display: flex; align-items: center; justify-content: center; height: 100%; background: var(--bc); color: #fff; border-radius: var(--radius-sharp); font-family: var(--font-mono); font-size: var(--fs-label-xs); min-width: 16px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
  .vc { border: 1px solid rgba(28,22,17,0.12); border-left: 3px solid var(--sc); border-radius: var(--radius-sharp); background: rgba(255,255,255,0.45); padding: 11px 13px; display: flex; flex-direction: column; }
  .v-top { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
  .v-stance { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.04em; color: #fff; padding: 2px 6px; border-radius: var(--radius-sharp); }
  .v-who { font-family: var(--font-body); font-size: var(--fs-label); font-weight: 600; color: var(--ink); line-height: 1.25; }
  .v-point { margin: 0 0 9px; font-size: var(--fs-label); line-height: 1.5; color: rgba(28,22,17,0.78); flex: 1; }
  .v-src { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent-ink); text-decoration: none; border-bottom: 1px dashed currentColor; align-self: flex-start; }
  .g-empty { font-size: var(--fs-label-xs); color: rgba(28,22,17,0.45); }
</style>
