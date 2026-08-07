<script lang="ts">
  // Standing questions — Part II, leaf 7.
  //
  // Every other surface over the graph answers "what does this look like now". This one
  // answers "what moved", and the whole of it is shaped by a single requirement: it has to
  // stay quiet. So the instrument is the threshold, with each bar switchable, because the
  // fastest way to believe a rule about noise is to remove it and hear the noise.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import Stat from '../../components/viz/Stat.svelte';
  import AlarmBench from './components/AlarmBench.svelte';
  import {
    ALARMS, THRESHOLDS, BOTH_KINDS, ANCHOR, SNAPSHOT, LENS_RULES, LENS_FILTERS, STANDING,
  } from '../../lib/watch';

  const TONE = 'var(--accent)';
  let alarm = $state(ALARMS[0].id);
  const chosen = $derived(ALARMS.find((a) => a.id === alarm) ?? ALARMS[0]);
  let rule = $state(0);
  const chosenRule = $derived(LENS_RULES[rule]);
  const alarming = ALARMS.filter((a) => a.id !== 'appeared').length;
</script>

<svelte:head>
  <title>Standing questions · The Engine Room</title>
  <meta name="description" content="Watching a knowledge graph for change rather than querying it: nine structural alarms, thresholds that are both relative and absolute, and a saved perspective that narrows a view and briefs the assistant at the same time." />
</svelte:head>

<section class="pe-route wide">
  <LeafHead
    part="memory"
    title="Standing questions"
    line="A graph will tell you its shape whenever you ask. Nothing in it tells you what changed since you last looked — and that is the only part worth an interruption."
    lineEli5="You can mark things as worth watching. Overnight it works out what actually moved, and tells you only when it is genuinely worth knowing." />

  <Instrument
    kicker="The instrument"
    title="Two bars, and a change has to clear both"
    tone={TONE}
    reading="Move an entity between two nights. Switch a bar off to hear what it was keeping quiet."
    takeaway={BOTH_KINDS.body}>
    <AlarmBench />
  </Instrument>

  <div class="pair">
    <aside class="note">
      <span class="n-kick">{ANCHOR.title}</span>
      <p>{ANCHOR.body}</p>
    </aside>
    <aside class="note">
      <span class="n-kick">{SNAPSHOT.title}</span>
      <p>{SNAPSHOT.body}</p>
    </aside>
  </div>

  <Instrument
    kicker="What it notices"
    title="Nine kinds of movement, and one that never wakes you"
    tone={TONE}
    reading="Pick one."
    takeaway="Joining the watchlist is reported and never alarms — you did that on purpose, so telling you is noise. The baseline it recorded is still shown, because that is the thing every later comparison is against.">
    <div class="strip">
      <div class="chips" role="group" aria-label="Kinds of change">
        {#each ALARMS as a (a.id)}
          <button type="button" class="chip" class:on={alarm === a.id} class:quiet={a.id === 'appeared'}
                  aria-pressed={alarm === a.id} onclick={() => (alarm = a.id)}>{a.label}</button>
        {/each}
      </div>
      <div class="read" aria-live="polite">
        <p class="r-what">{chosen.what}</p>
        <p class="r-why">{chosen.why}</p>
      </div>
    </div>
    <div class="stats">
      <Stat value={alarming} unit="of {ALARMS.length}" label="kinds that raise something"
            how="every kind except joining the watchlist" tone={TONE} />
      <Stat value={THRESHOLDS.brokerPercentile * 100 + '%'} label="the bar for counting as a bridge"
            how="top tenth for sitting between otherwise-unconnected parts of the graph" tone={TONE} />
      <Stat value={THRESHOLDS.confidenceDrop.toFixed(2)} label="fall in confidence worth saying"
            how="below that, evidence has not meaningfully weakened" tone={TONE} />
      <Stat value={THRESHOLDS.snapshotNeighbours} label="neighbours kept per snapshot"
            how="enough to notice a new important one without storing the graph twice" tone={TONE} />
    </div>
  </Instrument>

  <Instrument
    kicker="The other kind of standing question"
    title="A perspective saved once, and used everywhere"
    tone={TONE}
    reading="Three rules shape how a saved view behaves. Pick one."
    takeaway={STANDING.body}>
    <div class="strip">
      <div class="chips" role="group" aria-label="Rules a saved view follows">
        {#each LENS_RULES as r, i (r.k)}
          <button type="button" class="chip" class:on={rule === i} aria-pressed={rule === i}
                  onclick={() => (rule = i)}>{r.k}</button>
        {/each}
      </div>
      <p class="why" aria-live="polite">{chosenRule.why}</p>
    </div>
    <ul class="filters">
      {#each LENS_FILTERS as f (f.k)}<li><b>{f.k}</b><em>{f.v}</em></li>{/each}
    </ul>
  </Instrument>

  <PageFoot />
</section>

<style>
  .note { display: flex; flex-direction: column; gap: 4px; margin: 0 0 16px;
    padding: 10px 14px; border-left: 3px solid var(--accent);
    border-radius: 0 var(--radius-round) var(--radius-round) 0;
    background: color-mix(in srgb, var(--accent) 8%, transparent); }
  .n-kick { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--accent); }
  .note p { margin: 0; font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.74); max-width: 82ch; }
  .pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 10px; margin-top: -6px; }

  .strip { display: flex; flex-direction: column; gap: 9px; min-width: 0; }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .chip { font-family: 'DM Sans', sans-serif; font-size: 11.5px; color: var(--text-primary);
    background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.18);
    border-radius: var(--radius-round); padding: 5px 11px; cursor: pointer; }
  .chip:hover { background: rgba(28,22,17,0.07); }
  .chip.on { background: var(--accent); border-color: var(--accent); color: #fff; }
  .chip.quiet { border-style: dashed; }
  .chip.quiet.on { border-style: solid; background: rgba(28,22,17,0.5); border-color: rgba(28,22,17,0.5); }

  .read { min-height: 4.4em; }
  .r-what { margin: 0 0 4px; font-size: 13px; line-height: 1.5; color: var(--text-primary); max-width: 84ch; }
  .r-why { margin: 0; font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.68); max-width: 84ch; }
  .why { margin: 0; min-height: 3.4em; font-size: 12.5px; line-height: 1.55;
    color: rgba(28,22,17,0.72); max-width: 84ch; }

  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 9px; margin-top: 12px; }

  .filters { margin: 12px 0 0; padding: 0; list-style: none; display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 6px; }
  .filters li { display: flex; align-items: baseline; gap: 8px; padding: 6px 10px;
    border-radius: var(--radius-sharp); background: rgba(255,255,255,0.55); }
  .filters b { font-size: 12px; color: var(--text-primary); }
  .filters em { font-style: normal; font-family: 'JetBrains Mono', monospace; font-size: 9.5px;
    color: rgba(28,22,17,0.5); margin-left: auto; text-align: right; }


  @media (max-width: 560px) { .read, .why { min-height: 0; } }
</style>
