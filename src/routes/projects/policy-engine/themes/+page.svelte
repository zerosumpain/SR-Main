<script lang="ts">
  // Themes — the SECOND spine. The studies' first spine threads each to a data-strategy
  // question; this one threads the substantive findings. Four cross-cutting themes, each
  // gathering the studies it runs through, the levers that move it, the third-party analyses
  // that bear on it, and the contradictions + confidence. This is where "learning across the
  // pages, by theme" lives, and where the evidence sits on the shoulders of the outcomes.
  import { app } from '../lib/appState.svelte';
  import LeverChart from '../components/LeverChart.svelte';
  import Contradiction from '../components/Contradiction.svelte';
  import AnalysisOnOutcome from '../components/AnalysisOnOutcome.svelte';
  import { THEMES } from '../lib/themes.ts';
  import { CONTRADICTIONS_BY_ID } from '../lib/contradictions.ts';
  import { OUTCOMES_BY_ID } from '../lib/outcomes';

  const eli = $derived(app.narrative === 'eli5');

  // a representative live exhibit per theme (first outcome + up to 3 of its levers)
  const exhibit = (t: typeof THEMES[number]) => ({
    outcome: t.outcomes.find((o) => OUTCOMES_BY_ID[o]) ?? t.outcomes[0],
    levers: t.levers.slice(0, 3),
  });
</script>

<svelte:head><title>Themes — Education Policy Modelling</title></svelte:head>

<div class="pe-route wide">
  <header class="th-mast">
    <span class="th-kicker">The second spine · learning across the studies</span>
    <h1 class="pe-h1">What the studies say in common</h1>
    <p class="pe-lede">
      {eli
        ? 'The nine field studies keep circling back to the same four ideas. This page pulls each idea out, shows where it turns up, what outside experts have found about it, and — honestly — where they disagree and how sure we can be.'
        : 'Each field study threads to one data question. Read across them and four substantive themes recur. This page makes that second spine explicit: for each theme, where it appears, the levers that move it, the third-party analyses that bear on it, the genuine contradictions in the evidence, and the confidence in the model\'s stance.'}
    </p>
    <nav class="th-jump">
      {#each THEMES as t (t.id)}
        <a href={`#${t.id}`} style="--c:{t.color}"><span class="tj-dot"></span>{t.title}</a>
      {/each}
    </nav>
  </header>

  {#each THEMES as t (t.id)}
    {@const ex = exhibit(t)}
    <section class="theme" id={t.id} style="--c:{t.color}">
      <div class="theme-head">
        <span class="theme-no">Theme {t.no}</span>
        <h2 class="pe-h2 theme-title">{t.title}</h2>
        <p class="theme-tag">{t.tagline}</p>
      </div>

      <div class="theme-grid">
        <div class="theme-prose">
          <p class="theme-summary">{eli ? t.summaryEli5 : t.summary}</p>
          <div class="recurs">
            <span class="rec-lab">Where it recurs</span>
            <ul>
              {#each t.recurs as s (s.route)}
                <li><a href={s.route}>{s.label}</a> — {s.note}</li>
              {/each}
            </ul>
          </div>
          <div class="dataask">
            <span class="da-lab">▸ To monitor this</span>
            <p>{t.dataAsk}</p>
          </div>
        </div>

        <div class="theme-data">
          {#if app.mounted && ex.outcome && ex.levers.length}
            <LeverChart outcome={ex.outcome} levers={ex.levers}
              title={`${OUTCOMES_BY_ID[ex.outcome]?.label ?? ex.outcome} — live`} color={t.color} />
          {/if}
          <AnalysisOnOutcome theme={t.id} title="What the analysts find" max={6} />
        </div>
      </div>

      {#if t.contradictions.length}
        <div class="theme-cx">
          <span class="cx-lab">Where the analysts disagree — and how sure we are</span>
          {#each t.contradictions as cid (cid)}
            {#if CONTRADICTIONS_BY_ID[cid]}<Contradiction c={CONTRADICTIONS_BY_ID[cid]} />{/if}
          {/each}
        </div>
      {/if}
    </section>
  {/each}

  <p class="th-foot">
    Confidence is shown openly throughout: well-evidenced, moderate, weak, assumption, or contested. A "contested"
    badge means the evidence genuinely splits — the two-camps panels say what each side argues, what the model assumes
    to proceed, and what study or data would resolve it. The goal is an unbiased reading of how settled each finding is.
  </p>
</div>

<style>
  .th-mast { margin: 0 0 22px; }
  .th-kicker { display: block; font-family: 'JetBrains Mono', monospace; font-size: 10.5px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--ink-soft, rgba(28,22,17,0.62)); margin-bottom: 7px; }
  .pe-lede { max-width: 80ch; }
  .th-jump { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
  .th-jump a { display: inline-flex; align-items: center; gap: 6px; text-decoration: none; font-family: 'DM Sans', system-ui, sans-serif; font-size: 12.5px; color: var(--ink); background: color-mix(in srgb, var(--c) 9%, transparent); border: 1px solid color-mix(in srgb, var(--c) 35%, transparent); border-radius: var(--radius-round); padding: 4px 12px; }
  .th-jump a:hover { background: color-mix(in srgb, var(--c) 18%, transparent); }
  .tj-dot { width: 7px; height: 7px; border-radius: var(--radius-pill); background: var(--c); }

  .theme { margin: 30px 0; padding-top: 18px; border-top: 1px solid rgba(28,22,17,0.12); scroll-margin-top: 120px; }
  .theme-head { border-left: 3px solid var(--c); padding-left: 12px; margin-bottom: 14px; }
  .theme-no { font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--c); }
  .theme-title { margin: 2px 0 2px; }
  .theme-tag { margin: 0; font-family: 'Fraunces', serif; font-style: italic; font-size: 14px; color: rgba(28,22,17,0.7); }
  .theme-grid { display: grid; grid-template-columns: minmax(280px, 40ch) minmax(0, 1fr); gap: 18px 32px; align-items: start; }
  @media (max-width: 1000px) { .theme-grid { grid-template-columns: 1fr; } }
  .theme-summary { font-size: 13.5px; line-height: 1.6; color: rgba(28,22,17,0.85); margin: 0 0 12px; }
  .recurs { margin-bottom: 12px; }
  .rec-lab, .da-lab, .cx-lab { display: block; font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(28,22,17,0.5); margin-bottom: 4px; }
  .recurs ul { margin: 0; padding-left: 16px; }
  .recurs li { font-size: 11.5px; line-height: 1.5; color: rgba(28,22,17,0.78); margin-bottom: 3px; }
  .recurs a { color: var(--c); text-decoration: none; font-weight: 600; border-bottom: 1px dashed currentColor; }
  .dataask { border-left: 3px solid var(--accent-ink); background: var(--accent-ink-tint-12); border-radius: var(--radius-round); padding: 8px 12px; }
  .dataask p { margin: 0; font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.78); }
  .theme-data { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  .theme-cx { margin-top: 14px; }
  .th-foot { margin: 30px 0 10px; max-width: 80ch; font-size: 12px; line-height: 1.6; color: rgba(28,22,17,0.65); border-top: 1px solid rgba(28,22,17,0.1); padding-top: 14px; }
</style>
