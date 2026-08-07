<script lang="ts">
  // TrustBench — the confidence score, assembled in front of you.
  //
  // The whole argument of the page is that the number decomposes, so the instrument is the
  // decomposition: four positive segments drawn to scale, and the portion age has eaten shown
  // as a struck-through tail rather than quietly missing. The score is where the solid part
  // ends, which means you can see WHY it is where it is without reading a formula.
  //
  // Arithmetic is the re-declared scorer in lib/trust.ts — same weights, same neutral
  // midpoint, same saturation constant, same half-life and floor as the live one.
  import {
    GRADES, CREDIBILITIES, GRADE_LABEL, CREDIBILITY_LABEL, WEIGHTS, UNASSESSED,
    CASES, score, credibilityFromCorroboration, type Grade, type Credibility,
  } from '../../../lib/trust';

  let grade = $state<Grade>(CASES[0].grade);
  let credibility = $state<Credibility>(CASES[0].credibility);
  let corroboration = $state<number>(CASES[0].corroboration);
  let ageDays = $state<number>(CASES[0].ageDays);
  let confirmed = $state<boolean>(CASES[0].confirmed);
  let caseId = $state<string | null>(CASES[0].id);
  let story = $state<string>(CASES[0].story);

  function load(c: (typeof CASES)[number]) {
    grade = c.grade; credibility = c.credibility; corroboration = c.corroboration;
    ageDays = c.ageDays; confirmed = c.confirmed; caseId = c.id; story = c.story;
  }
  /** Any hand adjustment detaches from the worked case it came from. */
  function touched() { caseId = null; story = ''; }

  const r = $derived(score({ grade, credibility, corroboration, ageDays, confirmed }));

  /** Positive contributions, before age takes its cut. */
  const gross = $derived(
    r.parts.reliability + r.parts.credibility + r.parts.corroboration + r.parts.confirmation,
  );
  const bite = $derived(Math.abs(r.parts.age));
  /** Scale: the widest the bar can ever be is 1.00 of positives. */
  const pct = (v: number) => v * 100;

  const SEGMENTS = $derived([
    { key: 'reliability', label: 'source reliability', value: r.parts.reliability, max: WEIGHTS.reliability, tone: 'var(--accent-ink)' },
    { key: 'credibility', label: 'information credibility', value: r.parts.credibility, max: WEIGHTS.credibility, tone: 'var(--accent)' },
    { key: 'corroboration', label: 'corroboration', value: r.parts.corroboration, max: WEIGHTS.corroboration, tone: '#2d7a3a' },
    { key: 'confirmation', label: 'human confirmation', value: r.parts.confirmation, max: WEIGHTS.confirmation, tone: '#b0892a' },
  ]);

  const suggested = $derived(credibilityFromCorroboration(corroboration));
  const BANDS = [
    { at: 0.75, label: 'high' },
    { at: 0.5, label: 'moderate' },
    { at: UNASSESSED, label: 'nothing known' },
  ];
</script>

<div class="tb">
  <div class="cases">
    <span class="k" id="tb-cases">Start from a case</span>
    <div class="c-row" role="group" aria-labelledby="tb-cases">
      {#each CASES as c (c.id)}
        <button type="button" class:on={caseId === c.id} aria-pressed={caseId === c.id} onclick={() => load(c)}>
          {c.label}
        </button>
      {/each}
    </div>
  </div>

  <div class="axes">
    <div class="axis">
      <span class="k" id="tb-grade">Who told you — source reliability</span>
      <div class="a-row" role="group" aria-labelledby="tb-grade">
        {#each GRADES as g (g)}
          <button type="button" class="pip" class:on={grade === g} class:neutral={g === 'F'}
                  aria-pressed={grade === g} title={GRADE_LABEL[g]}
                  onclick={() => { grade = g; touched(); }}>{g}</button>
        {/each}
        <span class="a-say">{GRADE_LABEL[grade]}</span>
      </div>
    </div>

    <div class="axis">
      <span class="k" id="tb-cred">Does it hold up — information credibility</span>
      <div class="a-row" role="group" aria-labelledby="tb-cred">
        {#each CREDIBILITIES as c (c)}
          <button type="button" class="pip" class:on={credibility === c} class:neutral={c === 6}
                  aria-pressed={credibility === c} title={CREDIBILITY_LABEL[c]}
                  onclick={() => { credibility = c; touched(); }}>{c}</button>
        {/each}
        <span class="a-say">{CREDIBILITY_LABEL[credibility]}</span>
      </div>
    </div>
  </div>

  <div class="dials">
    <label class="f">
      <span class="k">Independent sources</span>
      <input type="range" min="0" max="8" step="1" bind:value={corroboration} oninput={touched} />
      <output>{corroboration}</output>
    </label>
    <label class="f">
      <span class="k">Days since last corroborated</span>
      <input type="range" min="0" max="730" step="5" bind:value={ageDays} oninput={touched} />
      <output>{ageDays}</output>
    </label>
    <button type="button" class="toggle" class:on={confirmed} aria-pressed={confirmed}
            onclick={() => { confirmed = !confirmed; touched(); }}>
      {confirmed ? '✓' : '○'} Confirmed by hand
    </button>
  </div>

  <div class="bar-wrap">
    <div class="bar" role="img"
         aria-label="Score {r.score.toFixed(2)}, {r.label}. Reliability {r.parts.reliability.toFixed(2)}, credibility {r.parts.credibility.toFixed(2)}, corroboration {r.parts.corroboration.toFixed(2)}, confirmation {r.parts.confirmation.toFixed(2)}, less {bite.toFixed(2)} for age.">
      {#each SEGMENTS as s (s.key)}
        {#if s.value > 0.0005}
          <span class="seg" style="width:{pct(s.value)}%; background:{s.tone}" title="{s.label} {s.value.toFixed(2)}"></span>
        {/if}
      {/each}
      {#if bite > 0.0005}
        <span class="seg bite" style="width:{pct(bite)}%" title="age took {bite.toFixed(2)}"></span>
      {/if}
      <span class="score-mark" style="left:{pct(r.score)}%"></span>
      {#each BANDS as b (b.label)}
        <span class="band-mark" style="left:{pct(b.at)}%"><i>{b.label}</i></span>
      {/each}
    </div>
  </div>

  <div class="read" aria-live="polite">
    <b class="s-val" data-band={r.label}>{r.score.toFixed(2)}</b>
    <span class="s-band" data-band={r.label}>{r.label}</span>
    <!-- 0.005, not 0.0005: below that it rounds to "less 0.00 to age", which reads as a bug. -->
    <span class="s-sum">
      {gross.toFixed(2)} earned{#if bite >= 0.005}, less {bite.toFixed(2)} to age{/if}
    </span>
  </div>

  <ol class="ledger">
    {#each SEGMENTS as s (s.key)}
      <li>
        <span class="l-sw" style="background:{s.tone}"></span>
        <span class="l-lab">{s.label}</span>
        <span class="l-val">{s.value.toFixed(2)}<em>of {s.max.toFixed(2)}</em></span>
      </li>
    {/each}
    <li class="neg" class:idle={bite < 0.005}>
      <span class="l-sw bite"></span>
      <span class="l-lab">age, on the evidence only</span>
      <span class="l-val">{bite < 0.005 ? 'nothing yet' : `−${bite.toFixed(2)}`}<em>×{r.decay.toFixed(2)}</em></span>
    </li>
  </ol>

  <p class="says">
    {#if grade === 'F' && credibility === 6}
      Neither the source nor the claim has been graded, so both are treated as neutral rather than as bad.
    {:else}
      Graded {grade}{credibility} — {grade === 'F' ? 'source reliability cannot be judged' : `the source is ${GRADE_LABEL[grade]}`},
      and {credibility === 6 ? 'the claim itself cannot be judged' : `the claim is ${CREDIBILITY_LABEL[credibility]}`}.
    {/if}
    {#if corroboration === 0}
      Nothing corroborates it — no source asserts this independently.
    {:else if corroboration === 1}
      One source asserts this; a second independent one would raise it materially.
    {:else}
      {corroboration} independent sources assert it, which is where most of the credit comes from.
    {/if}
    {#if confirmed}
      You confirmed it by hand, which is the single largest contribution and does not decay.
    {:else}
      Nobody has confirmed it by hand — that alone would add {WEIGHTS.confirmation.toFixed(2)}.
    {/if}
    {#if bite > 0.005}
      Age has taken {Math.round(bite * 100)} points off.
    {/if}
    {#if credibility !== suggested && corroboration > 0}
      <em>With {corroboration} source{corroboration === 1 ? '' : 's'} the derived credibility would be {suggested} — a
      hand grade always beats the default.</em>
    {/if}
  </p>

  {#if story}<p class="story">{story}</p>{/if}
</div>

<style>
  .tb { display: flex; flex-direction: column; gap: 11px; min-width: 0; }
  .k { display: block; font-family: 'JetBrains Mono', monospace; font-size: 9px;
    letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); }

  .c-row { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 5px; }
  .c-row button { font-family: 'DM Sans', sans-serif; font-size: 11.5px; color: var(--text-primary);
    background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.18);
    border-radius: var(--radius-round); padding: 5px 11px; cursor: pointer; }
  .c-row button:hover { background: rgba(28,22,17,0.07); }
  .c-row button.on { background: var(--accent); border-color: var(--accent); color: #fff; }

  .axes { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 10px; }
  .a-row { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-top: 5px; }
  .pip { width: 28px; height: 26px; font-family: 'JetBrains Mono', monospace; font-size: 11.5px;
    font-weight: 600; color: var(--text-primary); background: rgba(255,255,255,0.65);
    border: 1px solid rgba(28,22,17,0.2); border-radius: var(--radius-round); cursor: pointer;
    transition: background 0.12s, border-color 0.12s; }
  .pip:hover { background: rgba(28,22,17,0.08); }
  .pip.neutral { border-style: dashed; }
  .pip.on { background: var(--accent-ink); border-color: var(--accent-ink); color: #fff; }
  .a-say { font-size: 11.5px; color: rgba(28,22,17,0.6); margin-left: 4px; }

  .dials { display: flex; align-items: center; gap: 10px 20px; flex-wrap: wrap; }
  .f { display: flex; align-items: center; gap: 8px; }
  .f .k { color: rgba(28,22,17,0.5); white-space: nowrap; }
  .f input { accent-color: var(--accent); width: 118px; }
  .f output { font-family: 'JetBrains Mono', monospace; font-size: 12.5px; font-weight: 600;
    color: var(--text-primary); min-width: 3ch; }
  .toggle { font-family: 'DM Sans', sans-serif; font-size: 11.5px; color: var(--text-primary);
    background: rgba(255,255,255,0.65); border: 1px solid rgba(28,22,17,0.2);
    border-radius: var(--radius-round); padding: 5px 12px; cursor: pointer; }
  .toggle:hover { background: rgba(28,22,17,0.07); }
  .toggle.on { background: #b0892a; border-color: #b0892a; color: #fff; }

  .bar-wrap { padding-top: 12px; }
  .bar { position: relative; display: flex; height: 30px; border-radius: var(--radius-round);
    background: rgba(28,22,17,0.06); border: 1px solid rgba(28,22,17,0.14); overflow: visible; }
  .seg { height: 100%; transition: width 0.22s cubic-bezier(0.3,0,0.2,1); opacity: 0.85; }
  .seg:first-child { border-radius: var(--radius-round) 0 0 var(--radius-round); }
  .seg.bite { background: repeating-linear-gradient(135deg, rgba(138,45,58,0.35) 0 4px, rgba(138,45,58,0.12) 4px 8px); }
  .score-mark { position: absolute; top: -6px; bottom: -6px; width: 0;
    border-left: 2px solid var(--text-primary); transition: left 0.22s; }
  .band-mark { position: absolute; top: -11px; bottom: 0; width: 0; border-left: 1px dashed rgba(28,22,17,0.4); }
  .band-mark i { position: absolute; left: 3px; top: -2px; font-style: normal;
    font-family: 'JetBrains Mono', monospace; font-size: 8px; color: rgba(28,22,17,0.45); white-space: nowrap; }

  .read { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .s-val { font-family: 'JetBrains Mono', monospace; font-size: 30px; font-weight: 600;
    line-height: 1; letter-spacing: -0.02em; color: var(--accent-ink); }
  .s-val[data-band='high'] { color: #2d7a3a; }
  .s-val[data-band='unverified'] { color: #8a2d3a; }
  .s-band { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.1em;
    text-transform: uppercase; padding: 2px 9px; border-radius: var(--radius-pill);
    background: rgba(14,91,102,0.14); color: var(--accent-ink); }
  .s-band[data-band='high'] { background: rgba(45,122,58,0.16); color: #2d7a3a; }
  .s-band[data-band='unverified'] { background: rgba(138,45,58,0.14); color: #8a2d3a; }
  .s-sum { font-size: 12px; color: rgba(28,22,17,0.55); margin-left: auto; }

  .ledger { margin: 0; padding: 0; list-style: none; display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 3px 14px; }
  .ledger li { display: flex; align-items: baseline; gap: 7px; padding: 3px 0; }
  .l-sw { width: 9px; height: 9px; border-radius: 2px; flex-shrink: 0; }
  .l-sw.bite { background: repeating-linear-gradient(135deg, rgba(138,45,58,0.55) 0 3px, rgba(138,45,58,0.15) 3px 6px); }
  .l-lab { font-size: 12px; color: rgba(28,22,17,0.72); }
  .l-val { margin-left: auto; font-family: 'JetBrains Mono', monospace; font-size: 11.5px;
    font-weight: 600; color: var(--text-primary); white-space: nowrap; }
  .l-val em { font-style: normal; font-weight: 400; font-size: 9px; color: rgba(28,22,17,0.4); margin-left: 4px; }
  .ledger li.neg .l-val { color: #8a2d3a; }
  .ledger li.neg.idle .l-val { color: rgba(28,22,17,0.4); font-weight: 400; }

  .says { margin: 0; font-size: 12.5px; line-height: 1.6; color: rgba(28,22,17,0.74); max-width: 86ch; }
  .says em { font-style: normal; color: rgba(28,22,17,0.5); }

  .story { margin: 0; font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.74);
    border-left: 3px solid var(--accent); background: color-mix(in srgb, var(--accent) 9%, transparent);
    border-radius: 0 var(--radius-round) var(--radius-round) 0; padding: 9px 13px; }

  @media (max-width: 620px) {
    .s-sum { margin-left: 0; }
    .f input { width: 96px; }
  }
</style>
