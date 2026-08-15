<script lang="ts">
  // Is this the same person? — Part II, leaf 2.
  //
  // Two instruments and almost no prose. EntityResolver is the argument: four worked cases
  // feed it, and every signal is a switch you can pull out of them. The bars underneath are
  // the ladder itself, drawn to scale — the old version listed the ten signals as a table of
  // sentences, which hid the only thing that matters about them, namely how far apart they
  // are. Both instruments mark 0.85 with the same dashed rule, so the mark reads as one idea.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import Bars from '../../components/viz/Bars.svelte';
  import EntityResolver from './components/EntityResolver.svelte';
  import { SIGNALS, AUTO_MERGE } from '../../lib/memory';

  const TONE = 'var(--accent)';        // primary — sets the confidence
  const CORR = 'var(--accent-ink)';    // corroborating — only adjusts it

  const primary = SIGNALS.filter((s) => s.kind === 'primary');
  const corroborating = SIGNALS.filter((s) => s.kind === 'corroborating');
  const negative = SIGNALS.find((s) => s.kind === 'negative')!;

  // Both bands share max = 1 and the same 0.85 threshold, so the two groups are honestly
  // comparable: the largest nudge is visibly smaller than the weakest name rule.
  // Anything a primary signal cannot reach the bar with on its own is drawn muted.
  const primaryBars = primary.map((s) => ({
    label: s.label,
    value: s.base as number,
    tone: TONE,
    muted: (s.base as number) < AUTO_MERGE,
  }));

  const corrobBars = corroborating.map((s) => ({
    label: s.label,
    value: s.delta as number,
    tone: CORR,
  }));

  const say = (items: { label: string; value: number }[]) =>
    items.map((i) => `${i.label} ${i.value}`).join(', ');

  // Counted, never typed out: the caption cannot drift from the constant it describes.
  const belowBar = primaryBars.filter((b) => b.muted).length;
  const maxNudge = Math.max(...corrobBars.map((b) => b.value));
</script>

<svelte:head>
  <title>Is this the same person? · The Engine Room</title>
  <meta name="description" content="Ten signals, one threshold: how two records are judged to be the same thing, and what is allowed to happen above the bar." />
</svelte:head>

<section class="pe-route wide">
  <LeafHead
    part="memory"
    title="Is this the same person?"
    line="Two records, ten signals, one threshold. Clear the bar and they are merged overnight with nobody watching. Fall short and it waits for me, which is the correct way round."
    lineEli5="The system spots two records that might be the same thing. It weighs up the evidence, and only joins them if it is sure enough." />

  <Instrument
    kicker="The instrument"
    title="Toggle the evidence"
    tone={TONE}
    reading="Pick a worked case, then pull the evidence out of it."
    takeaway="Merge two people who are not the same and you have destroyed something no amount of re-running will bring back. So the rules decide. The model is allowed to suggest, and that is where its authority ends.">
    <EntityResolver />
  </Instrument>

  <Instrument
    kicker="The ladder"
    title="What each signal is worth"
    tone={TONE}
    reading="Every scored signal on one nought-to-one scale. The dashed rule is the merge bar."
    takeaway="A shared address beats every clever thing you can do with a name. {belowBar} of the {primaryBars.length} cannot merge a pair on their own no matter how confident they feel, and the biggest nudge any corroborating signal can manage is {maxNudge}.">
    <div class="ladder">
      <div class="band">
        <span class="band-lab">Sets the confidence · strongest one wins</span>
        <div class="chart" role="img"
             aria-label="{primaryBars.length} primary signals scored out of one: {say(primaryBars)}. The automatic merge bar is {AUTO_MERGE}, so the weakest {belowBar} cannot merge a pair on their own.">
          <Bars items={primaryBars} max={1} threshold={AUTO_MERGE} thresholdLabel="{AUTO_MERGE} · merges unattended"
                grouped={false} height={22} tone={TONE} />
        </div>
      </div>

      <div class="band">
        <span class="band-lab" style="--tone:{CORR}">Only nudges · added on top, never enough alone</span>
        <div class="chart" role="img"
             aria-label="{corrobBars.length} corroborating signals on the same scale: {say(corrobBars)}. Neither sets a confidence; each is added to whatever a primary signal already set.">
          <Bars items={corrobBars} max={1} threshold={AUTO_MERGE} grouped={false} height={22} tone={CORR} />
        </div>
      </div>

      <div class="band">
        <span class="band-lab neg">Argues against</span>
        <p class="pen">
          <span class="p-lab">{negative.label}</span>
          <span class="p-op">overrules</span>
          <span class="p-why">Beats any name match, and holds the pair under the bar instead of dropping it.</span>
        </p>
      </div>
    </div>
  </Instrument>

  <PageFoot />
</section>

<style>
  .ladder { display: flex; flex-direction: column; gap: 15px; }
  .band { --tone: var(--accent); display: flex; flex-direction: column; gap: 7px; min-width: 0; }
  .band-lab { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--tone); }
  .band-lab.neg { --tone: var(--error); }

  /* Wide charts scroll inside their own box; the page body never does. */
  .chart { min-width: 0; overflow-x: auto; }

  .pen { display: flex; align-items: baseline; gap: 5px 10px; flex-wrap: wrap; margin: 0;
    padding: 8px 12px; border: 1px solid rgba(28,22,17,0.16);
    border-left: 3px solid var(--error); border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0;
    background: rgba(255,255,255,0.55); }
  .p-lab { font-size: var(--fs-label); color: var(--text-primary); }
  .p-op { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; color: var(--error); }
  .p-why { flex: 1 1 22ch; font-size: var(--fs-label-xs); line-height: 1.45; color: rgba(28,22,17,0.6); }
</style>
