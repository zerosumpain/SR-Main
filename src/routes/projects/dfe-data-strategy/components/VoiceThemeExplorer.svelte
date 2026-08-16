<script lang="ts">
  import { SECTOR_THEMES, SECTOR_VOICES, VOICE_GROUP_META, STANCE_META, type Stance } from '../lib/sectorVoices';

  // The interactive landing for /sector: pick a debate, hear what each voice
  // actually says about it. Voices are tagged to themes in the data, so the
  // explorer is a pivot — theme → the arguments, arranged by stance.
  let themeId = $state<string>(SECTOR_THEMES[0]?.id ?? '');

  const theme = $derived(SECTOR_THEMES.find((t) => t.id === themeId) ?? SECTOR_THEMES[0]);
  const voicesFor = (id: string) => SECTOR_VOICES.filter((v) => v.theme === id);
  const voices = $derived(voicesFor(themeId));

  // three columns: backs it / yes-but / pushes back
  const COLS: { key: string; label: string; stances: Stance[]; color: string }[] = [
    { key: 'for', label: 'Backs it', stances: ['supportive'], color: STANCE_META.supportive.color },
    { key: 'but', label: 'Yes, but…', stances: ['cautious', 'mixed'], color: STANCE_META.cautious.color },
    { key: 'against', label: 'Pushes back', stances: ['critical'], color: STANCE_META.critical.color },
  ];
  const inCol = (stances: Stance[]) => voices.filter((v) => stances.includes(v.stance));

  const SHORT_LABEL: Record<string, string> = {
    'consistent-identifier': 'The child identifier',
    'lawful-basis-vs-power': 'Lawful basis & scope creep',
    'data-quality-readiness': 'Data quality & AI-readiness',
    'census-to-realtime': 'Census → real-time',
    'deliverability-enforcement': 'The deliverability gap',
    'funding-capacity': 'Funding & capacity',
    'multiagency-fragility': 'Multi-agency fragility',
    'public-trust': 'Public trust',
  };
  // stance spread per theme, for the mini-bar in each chip
  const spread = (id: string) => {
    const vs = voicesFor(id);
    return COLS.map((c) => ({ color: c.color, n: vs.filter((v) => c.stances.includes(v.stance)).length })).filter((x) => x.n > 0);
  };
</script>

<div class="vte">
  <div class="chips" role="tablist" aria-label="Debates">
    {#each SECTOR_THEMES as t (t.id)}
      {@const on = themeId === t.id}
      <button class="chip" class:on role="tab" aria-selected={on} onclick={() => (themeId = t.id)}>
        <span class="c-label">{SHORT_LABEL[t.id] ?? t.title}</span>
        <span class="c-meta">
          <span class="c-bar">{#each spread(t.id) as s}<i style="--c:{s.color}; flex:{s.n}"></i>{/each}</span>
          <b>{voicesFor(t.id).length}</b>
        </span>
      </button>
    {/each}
  </div>

  {#if theme}
    <div class="stage">
      <div class="stage-head">
        <h3 class="st-title">{theme.title}</h3>
        <p class="st-sum">{theme.summary}</p>
      </div>
      <div class="cols">
        {#each COLS as col (col.key)}
          {@const list = inCol(col.stances)}
          <section class="col" style="--cc:{col.color}">
            <h4 class="col-h"><i></i>{col.label} <b>{list.length}</b></h4>
            {#each list as v (v.id)}
              <article class="vc" style="--gc:{VOICE_GROUP_META[v.group].color}">
                <span class="v-who">{v.who}</span>
                <span class="v-grp">{VOICE_GROUP_META[v.group].label}{v.role ? ` · ${v.role}` : ''}</span>
                <p class="v-point">{v.point}</p>
                {#if v.sourceUrl}<a class="v-src" href={v.sourceUrl} target="_blank" rel="noopener">{v.sourceName ?? 'Source'} ↗</a>{/if}
              </article>
            {/each}
            {#if !list.length}
              <p class="col-none">No cited voice takes this position on this debate — itself worth noticing.</p>
            {/if}
          </section>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .chips {
    display: flex;
    gap: 7px;
    flex-wrap: wrap;
    margin-bottom: 14px;
  }
  .chip {
    display: flex;
    flex-direction: column;
    gap: 4px;
    align-items: stretch;
    text-align: left;
    font-family: var(--font-body);
    font-size: var(--fs-label-xs);
    font-weight: 600;
    padding: 8px 12px 7px;
    border: 1px solid rgba(28, 22, 17, 0.2);
    border-radius: var(--radius-sharp);
    background: rgba(255, 255, 255, 0.55);
    color: var(--ink);
    cursor: pointer;
    min-width: 130px;
  }
  .chip:hover {
    border-color: rgba(28, 22, 17, 0.45);
    background: rgba(255, 255, 255, 0.85);
  }
  .chip.on {
    background: var(--ink);
    border-color: var(--ink);
    color: var(--paper, #f1ead6);
  }
  .c-label {
    line-height: 1.25;
  }
  .c-meta {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .c-bar {
    flex: 1;
    display: flex;
    gap: 1px;
    height: 4px;
    border-radius: var(--radius-sharp);
    overflow: hidden;
  }
  .c-bar i {
    background: var(--c);
    height: 100%;
  }
  .chip.on .c-bar i {
    opacity: 0.85;
  }
  .c-meta b {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 600;
    opacity: 0.7;
  }

  .stage {
    border: 1px solid rgba(28, 22, 17, 0.14);
    border-radius: var(--radius-sharp);
    background: rgba(255, 255, 255, 0.35);
    padding: 16px 18px 18px;
  }
  .stage-head {
    max-width: 90ch;
    margin-bottom: 14px;
  }
  .st-title {
    margin: 0 0 6px;
    font-family: var(--fs-serif);
    font-size: 19px;
    font-weight: 600;
    line-height: 1.25;
    color: var(--ink);
  }
  .st-sum {
    margin: 0;
    font-size: var(--fs-label);
    line-height: 1.6;
    color: rgba(28, 22, 17, 0.72);
  }
  .cols {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    align-items: start;
  }
  .col-h {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0 0 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink);
  }
  .col-h i {
    width: 9px;
    height: 9px;
    border-radius: var(--radius-pill);
    background: var(--cc);
  }
  .col-h b {
    font-weight: 600;
    color: rgba(28, 22, 17, 0.5);
  }
  .vc {
    border: 1px solid rgba(28, 22, 17, 0.12);
    border-left: 3px solid var(--gc);
    border-radius: var(--radius-sharp);
    background: rgba(255, 255, 255, 0.55);
    padding: 10px 12px;
    margin-bottom: 9px;
  }
  .v-who {
    display: block;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    font-weight: 700;
    color: var(--ink);
    line-height: 1.3;
  }
  .v-grp {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
    color: var(--gc);
    margin: 2px 0 6px;
  }
  .v-point {
    margin: 0 0 8px;
    font-size: var(--fs-label);
    line-height: 1.55;
    color: rgba(28, 22, 17, 0.78);
  }
  .v-src {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent-ink);
    text-decoration: none;
    border-bottom: 1px dashed currentColor;
  }
  .col-none {
    margin: 0;
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    color: rgba(28, 22, 17, 0.5);
    padding: 10px 12px;
    border: 1px dashed rgba(28, 22, 17, 0.22);
    border-radius: var(--radius-sharp);
  }
  @media (max-width: 980px) {
    .cols {
      grid-template-columns: 1fr;
    }
  }
</style>
