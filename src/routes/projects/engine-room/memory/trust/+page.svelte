<script lang="ts">
  // Deciding what to believe — Part II, leaf 4.
  //
  // The page exists because the thing it replaced was a three-valued text column the
  // extractor wrote by guesswork. So the instrument is not a gauge, it is a DECOMPOSITION:
  // the four contributions drawn to scale, with the portion age has eaten struck through
  // rather than quietly missing. If the parts did not add up to the number, the whole
  // argument of the page would be false, so they are made to add up exactly.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import Bars from '../../components/viz/Bars.svelte';
  import Stat from '../../components/viz/Stat.svelte';
  import TrustBench from './components/TrustBench.svelte';
  import {
    GRADES, CREDIBILITIES, GRADE_LABEL, CREDIBILITY_LABEL, UNASSESSED, HALF_LIFE_DAYS,
    reliabilityFraction, credibilityFraction, corroborationFraction,
    NEUTRAL_NOTE, SATURATION_NOTE, WHY_A_SCORE, BANDS,
  } from '../../lib/trust';

  const TONE = 'var(--accent)';

  const gradeBars = GRADES.map((g) => ({
    label: `${g} — ${GRADE_LABEL[g]}`,
    value: +reliabilityFraction(g).toFixed(2),
    muted: g === 'F',
    note: g === 'F' ? 'no verdict' : undefined,
  }));

  const credBars = CREDIBILITIES.map((c) => ({
    label: `${c} — ${CREDIBILITY_LABEL[c]}`,
    value: +credibilityFraction(c).toFixed(2),
    muted: c === 6,
    note: c === 6 ? 'no verdict' : undefined,
  }));

  const satBars = [0, 1, 2, 3, 5, 10, 20].map((n) => ({
    label: `${n} source${n === 1 ? '' : 's'}`,
    value: +corroborationFraction(n).toFixed(2),
    muted: n >= 10,
  }));
</script>

<svelte:head>
  <title>Deciding what to believe · The Engine Room</title>
  <meta name="description" content="An explainable confidence score for a knowledge graph: two independent grading axes, saturating corroboration, decay with a floor, and a human confirmation that does not rot." />
</svelte:head>

<section class="pe-route wide">
  <LeafHead
    part="memory"
    title="Deciding what to believe"
    line="Every claim in the graph carries a number between nought and one. The number is worth precisely nothing unless it comes apart into the four things that made it, so it does."
    lineEli5="Everything it believes carries a score between nought and one, and the score can always be pulled apart into the reasons behind it: who said it, whether it holds up, how many sources agree, and how old the evidence is." />

  <Instrument
    kicker="The instrument"
    title="Grade a claim and watch the score assemble"
    tone={TONE}
    reading="Two independent axes, how many sources say it, how old that is, and whether a person has signed it off."
    readingEli5="Set who said a thing, how well it holds up, how many sources agree and how old it all is — then watch the score assemble itself."
    takeaway="The parts add up to the total exactly. That is the design constraint rather than a happy accident: a score you cannot take apart is just an assertion that has put on a decimal point and hopes you will not ask."
    takeawayEli5="The parts always add up to the total, exactly — that is the point of the design. A confidence number you cannot take apart is just an opinion wearing a decimal point.">
    <TrustBench />
  </Instrument>

  <aside class="note">
    <span class="n-kick">{WHY_A_SCORE.title}</span>
    <p>{WHY_A_SCORE.body}</p>
  </aside>

  <Instrument
    kicker="The two axes"
    title="Neither scale bottoms out where you expect"
    tone={TONE}
    reading="What each grade contributes, as a fraction of its axis."
    readingEli5="What each grade is worth, on both of the two scales."
    takeaway={NEUTRAL_NOTE.body}>
    <div class="two">
      <div class="col">
        <span class="c-head">Who told you</span>
        <Bars items={gradeBars} max={1} grouped={false} tone="var(--accent-ink)" height={20} />
      </div>
      <div class="col">
        <span class="c-head">Does the claim hold up</span>
        <Bars items={credBars} max={1} grouped={false} tone="var(--accent)" height={20} />
      </div>
    </div>
  </Instrument>

  <Instrument
    kicker="The heaviest term"
    title="Repetition saturates"
    tone={TONE}
    reading="What each additional independent source is worth, as a fraction of the corroboration axis."
    readingEli5="What each extra independent source actually adds to the score."
    takeaway={SATURATION_NOTE.body}>
    <Bars items={satBars} max={1} grouped={false} tone="#2d7a3a" height={20} />
  </Instrument>

  <Instrument
    kicker="Reading the number"
    title="Four bands, and one of them is honesty"
    tone={TONE}
    reading="Where the boundaries sit, and why the bottom band is not called 'low'. It is not low. It is empty, which is a different problem."
    readingEli5="Where the score boundaries sit. The bottom band is not 'low confidence' — it means nothing is known yet, which is a different thing and worth saying out loud.">
    <div class="bands">
      {#each BANDS as b (b.id)}
        <div class="band">
          <span class="b-from">{b.from === 0 ? '0.00' : `≥ ${b.from.toFixed(2)}`}</span>
          <b class="b-lab">{b.label}</b>
          <span class="b-what">{b.what}</span>
        </div>
      {/each}
    </div>
    <div class="stats">
      <Stat value={UNASSESSED.toFixed(2)} label="what an entity nothing is known about scores"
            how="both axes neutral, nothing corroborating, no review" tone={TONE} />
      <Stat value={HALF_LIFE_DAYS} unit="days" label="half-life on the evidence"
            how="roles and affiliations churn on about a two-year cycle" tone={TONE} />
    </div>
  </Instrument>

  <PageFoot />
</section>

<style>
  .note { display: flex; flex-direction: column; gap: 4px; margin: -6px 0 22px;
    padding: 10px 14px; border-left: 3px solid var(--accent);
    border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0;
    background: color-mix(in srgb, var(--accent) 8%, transparent); }
  .n-kick { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--accent); }
  .note p { margin: 0; font-size: var(--fs-label); line-height: 1.55; color: rgba(28,22,17,0.74); max-width: 82ch; }

  .two { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px 26px; }
  .col { min-width: 0; }
  .c-head { display: block; margin-bottom: 7px; font-family: var(--font-mono);
    font-size: var(--fs-label-xs); letter-spacing: 0.12em; text-transform: uppercase; color: rgba(28,22,17,0.5); }

  .bands { display: flex; flex-direction: column; gap: 3px; }
  .band { display: grid; grid-template-columns: 68px 96px 1fr; gap: 10px; align-items: baseline;
    padding: 6px 10px; border-radius: var(--radius-sharp); background: rgba(255,255,255,0.55); }
  .b-from { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent); }
  .b-lab { font-family: var(--fs-serif); font-size: var(--fs-nav); font-weight: 600; color: var(--text-primary); }
  .b-what { font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.68); }

  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 9px; margin-top: 12px; }


  @media (max-width: 620px) {
    .band { grid-template-columns: 60px 1fr; }
    .b-what { grid-column: 1 / -1; }
  }
</style>
