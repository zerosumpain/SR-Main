<script lang="ts">
  // The Memo — the capstone: every field study drawn into one analytical summary.
  // Headline finding, the case in five findings, the ranked improvements grouped by
  // unlock, the missing-instruments register (Annex A), what the record cautions
  // against, and the suggested sequencing. Styled as a civil-service memo.
  import { app } from '../lib/appState.svelte';
  import {
    MEMO_META, MEMO_CASE, MOVES, HORIZON_META, INSTRUMENTS, MEMO_DONTS, DECISIONS,
    ONE_SENTENCE, type Horizon,
  } from '../lib/memo';

  const eli = $derived(app.narrative === 'eli5');
  const HORIZONS: Horizon[] = ['now', 'identifier', 'sr'];
</script>

<svelte:head><title>The memo · Education Policy Modelling</title></svelte:head>

<div class="pe-route">
  <!-- ===================== head ===================== -->
  <header class="syn-head">
    <span class="sh-tag">SYNTHESIS · FIELD STUDIES №1–8</span>
    <h1 class="sh-title">{MEMO_META.title}</h1>
    <p class="sh-sub">{MEMO_META.subtitle}</p>
  </header>

  <!-- ===================== headline finding ===================== -->
  <section class="block">
    <h2 class="pe-h2">The headline finding</h2>
    <div class="bluf">
      <p>{eli ? MEMO_META.bluf.eli5 : MEMO_META.bluf.research}</p>
    </div>
  </section>

  <!-- ===================== the case ===================== -->
  <section class="block">
    <h2 class="pe-h2">What the evidence shows — seven findings</h2>
    <p class="cap">
      {eli
        ? 'Each finding comes from one of the field studies on this site. Click through for the full evidence.'
        : 'One finding per thread of this project, each argued in full — with sources, uncertainty and the counter-evidence — in its field study.'}
    </p>
    <ol class="case">
      {#each MEMO_CASE as f, i (f.point)}
        <li class="cf">
          <span class="cf-n">{i + 1}</span>
          <div class="cf-body">
            <span class="cf-point">{f.point}</span>
            <p class="cf-det">{eli ? f.eli5 : f.research}</p>
            <a class="cf-link" href={f.link.href}>{f.link.label} →</a>
          </div>
        </li>
      {/each}
    </ol>
  </section>

  <!-- ===================== the moves ===================== -->
  <section class="block">
    <h2 class="pe-h2">The improvements — thirteen, grouped by what unlocks them</h2>
    <p class="cap">
      {eli
        ? 'Every improvement the field studies identified, in one list. Blue = possible now. Amber = waits for the new child ID. Purple = needs a money decision.'
        : 'The complete improvement set, deduped across the field studies. Grouping is by UNLOCK, not by theme: what requires nothing new, what the CWS Act identifier enables, and what is a resource decision. Cost tiers are indicative (£ = specification/publication work · ££ = a programme · £££ = infrastructure).'}
    </p>
    {#each HORIZONS as h (h)}
      <div class="mv-grp">
        <span class="mv-grp-lab" style="color:{HORIZON_META[h].colour}">{eli ? HORIZON_META[h].eli5 : HORIZON_META[h].label}</span>
        {#each MOVES.filter((m) => m.horizon === h) as m (m.n)}
          <div class="mv" style="--mc:{HORIZON_META[h].colour}">
            <span class="mv-n">{m.n}</span>
            <div class="mv-body">
              <div class="mv-head">
                <span class="mv-title">{m.title}</span>
                <span class="mv-cost">{m.cost}</span>
              </div>
              <p class="mv-what">{eli ? m.eli5 : m.what}</p>
              <div class="mv-meta">
                <span class="mv-owner">{m.owner}</span>
                <a class="mv-ev" href={m.evidence.href}>{m.evidence.label} →</a>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/each}
  </section>

  <!-- ===================== annex A: instruments ===================== -->
  <section class="block">
    <h2 class="pe-h2">Annex A — the missing-instruments register</h2>
    <p class="cap">
      {eli
        ? 'Every measurement gap named anywhere on this site, in one table: what we can’t see today, and what seeing it would look like.'
        : 'Every data ask on this site, deduped into one register. The pattern worth noticing: most rows are £-tier — publication and specification work over data the state already holds — not new collection.'}
    </p>
    <div class="inst-scroll">
      <table class="inst">
        <thead>
          <tr><th>Instrument</th><th>{eli ? 'Today' : 'State today'}</th><th>{eli ? 'What better looks like' : 'Target state'}</th><th>Owner</th><th>Cost</th><th>Case</th></tr>
        </thead>
        <tbody>
          {#each INSTRUMENTS as ins (ins.name)}
            <tr>
              <td class="in-name">{ins.name}</td>
              <td class="in-today">{ins.today}</td>
              <td class="in-target">{ins.target}</td>
              <td class="in-owner">{ins.owner}</td>
              <td class="in-cost">{ins.cost}</td>
              <td class="in-study"><a href={ins.study.href}>{ins.study.label}</a></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  <!-- ===================== the don'ts ===================== -->
  <section class="block">
    <h2 class="pe-h2">What the history cautions against</h2>
    <div class="donts-grid">
      {#each MEMO_DONTS as d (d.title)}
        <div class="dont">
          <span class="dont-t">✕ {d.title}</span>
          <p class="dont-w">{eli ? d.eli5 : d.why}</p>
        </div>
      {/each}
    </div>
  </section>

  <!-- ===================== decision requested ===================== -->
  <section class="block">
    <h2 class="pe-h2">Sequencing — what comes first, and why</h2>
    <div class="decisions">
      {#each DECISIONS as d, i (d.ask)}
        <div class="dec">
          <span class="dec-box">{i + 1}</span>
          <p>{eli ? d.eli5 : d.ask}</p>
        </div>
      {/each}
    </div>
    <div class="one-sentence">
      <span class="os-lab">{eli ? 'The whole page in one line' : 'The throughline, in one sentence'}</span>
      <p>{eli ? ONE_SENTENCE.eli5 : ONE_SENTENCE.research}</p>
    </div>
  </section>

  <a class="pe-next" href="/projects/policy-engine/method">How every number in this memo was derived → the Method page</a>
</div>

<style>
  .block { margin: 34px 0; }
  .cap { margin: 0 0 16px; font-size: var(--fs-nav); line-height: 1.6; color: rgba(28,22,17,0.72); max-width: 92ch; }

  /* head */
  .syn-head { margin: 28px 0 8px; max-width: 96ch; }
  .sh-tag { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.18em; color: rgba(28,22,17,0.5); }
  .sh-title { margin: 8px 0 6px; font-family: var(--fs-serif); font-weight: 600; font-size: clamp(26px, 4.5vw, 40px); line-height: 1.1; color: var(--ink); }
  .sh-sub { margin: 0; font-size: var(--fs-nav); line-height: 1.6; color: rgba(28,22,17,0.72); max-width: 80ch; }

  /* headline finding */
  .bluf { border: 1.5px solid var(--success-border); border-left: 5px solid var(--success); border-radius: var(--radius-sharp);
    background: var(--success-bg); padding: 16px 20px; max-width: 96ch; }
  .bluf p { margin: 0; font-family: var(--fs-serif); font-size: clamp(15px, 2.2vw, 18px); line-height: 1.55; color: var(--ink); }

  /* the case */
  .case { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; max-width: 96ch; }
  .cf { display: flex; gap: 13px; align-items: flex-start; border: 1px solid rgba(28,22,17,0.14); border-radius: var(--radius-sharp);
    background: rgba(255,255,255,0.45); padding: 12px 15px; }
  .cf-n { flex-shrink: 0; width: 26px; height: 26px; border-radius: var(--radius-pill); background: var(--ink); color: var(--paper);
    font-family: var(--font-mono); font-size: var(--fs-label); display: inline-flex; align-items: center; justify-content: center; }
  .cf-body { display: flex; flex-direction: column; gap: 4px; }
  .cf-point { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-body-sm); color: var(--ink); }
  .cf-det { margin: 0; font-size: var(--fs-label); line-height: 1.55; color: rgba(28,22,17,0.74); }
  .cf-link { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent-ink); text-decoration: none; border-bottom: 1px dashed currentColor; align-self: flex-start; }

  /* moves */
  .mv-grp { margin-bottom: 18px; display: flex; flex-direction: column; gap: 9px; max-width: 96ch; }
  .mv-grp-lab { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em;
    padding-bottom: 4px; border-bottom: 1px dashed rgba(28,22,17,0.25); }
  .mv { display: flex; gap: 12px; align-items: flex-start; border: 1px solid rgba(28,22,17,0.14); border-left: 4px solid var(--mc);
    border-radius: var(--radius-sharp); background: rgba(255,255,255,0.45); padding: 11px 14px; }
  .mv-n { flex-shrink: 0; width: 26px; height: 26px; border-radius: var(--radius-sharp); background: var(--mc); color: #fff;
    font-family: var(--font-mono); font-size: var(--fs-label); font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
  .mv-body { display: flex; flex-direction: column; gap: 4px; flex: 1; }
  .mv-head { display: flex; align-items: baseline; gap: 10px; justify-content: space-between; flex-wrap: wrap; }
  .mv-title { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-body-sm); color: var(--ink); }
  .mv-cost { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 700; color: var(--mc); }
  .mv-what { margin: 0; font-size: var(--fs-label-xs); line-height: 1.55; color: rgba(28,22,17,0.74); }
  .mv-meta { display: flex; gap: 14px; align-items: baseline; flex-wrap: wrap; }
  .mv-owner { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.55); text-transform: uppercase; letter-spacing: 0.05em; }
  .mv-ev { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent-ink); text-decoration: none; border-bottom: 1px dashed currentColor; }

  /* annex A */
  .inst-scroll { overflow-x: auto; }
  .inst { border-collapse: collapse; width: 100%; min-width: 880px; }
  .inst th { text-align: left; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em;
    color: rgba(28,22,17,0.55); padding: 4px 10px 6px 0; border-bottom: 1px solid rgba(28,22,17,0.2); }
  .inst td { padding: 8px 10px 8px 0; border-bottom: 1px solid rgba(28,22,17,0.08); vertical-align: top; font-size: var(--fs-label-xs); line-height: 1.45; }
  .in-name { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-label); color: var(--ink); min-width: 170px; }
  .in-today { color: #8a2d3a; max-width: 240px; }
  .in-target { color: var(--success); max-width: 240px; }
  .in-owner { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.6); white-space: nowrap; }
  .in-cost { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 700; color: rgba(28,22,17,0.7); }
  .in-study a { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent-ink); text-decoration: none; border-bottom: 1px dashed currentColor; white-space: nowrap; }

  /* don'ts */
  .donts-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(290px, 100%), 1fr)); gap: 10px; max-width: 96ch; }
  .dont { border: 1px dashed var(--error-border); border-radius: var(--radius-sharp); padding: 11px 13px; background: var(--error-bg); }
  .dont-t { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-label); color: #8a2d3a; }
  .dont-w { margin: 5px 0 0; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.74); }

  /* decision requested */
  .decisions { display: flex; flex-direction: column; gap: 9px; max-width: 96ch; margin-bottom: 16px; }
  .dec { display: flex; gap: 12px; align-items: flex-start; border: 1.5px solid rgba(28,22,17,0.4); border-radius: var(--radius-sharp);
    background: rgba(255,255,255,0.55); padding: 12px 15px; }
  .dec-box { flex-shrink: 0; width: 24px; height: 24px; border: 1.5px solid var(--ink); border-radius: var(--radius-sharp);
    font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 700; color: var(--ink);
    display: inline-flex; align-items: center; justify-content: center; }
  .dec p { margin: 0; font-size: var(--fs-label); line-height: 1.55; color: var(--ink); }
  .one-sentence { border: 1.5px solid rgba(28,22,17,0.65); border-radius: var(--radius-sharp); background: var(--ink); padding: 15px 19px; max-width: 96ch; }
  .os-lab { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.14em; text-transform: uppercase; color: rgba(241,234,214,0.6); margin-bottom: 6px; }
  .one-sentence p { margin: 0; font-family: var(--fs-serif); font-size: clamp(15px, 2.4vw, 19px); line-height: 1.5; color: var(--paper); }
</style>
