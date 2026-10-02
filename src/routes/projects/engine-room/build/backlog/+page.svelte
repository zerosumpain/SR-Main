<script lang="ts">
  // Backlog — one intake, the work stages, and the nightly run that works through it. Every
  // stage, phase, cap and schedule is read from the feature (selfimprove/board.ts,
  // selfimprove/types.ts, the heartbeat registry) by the layout load.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import Steps from '../../components/viz/Steps.svelte';
  import Stat from '../../components/viz/Stat.svelte';
  import { BUILD_COPY as C, PHASE_COPY, SOURCE_COPY, ACTIVITY_COPY } from '../../lib/build';
  import { app } from '../../lib/appState.svelte';
  import { every, words } from '../../lib/format';
  import type { PhaseName } from '$lib/selfimprove/types';
  import type { IdeaSource } from '$lib/selfimprove/board';

  let { data } = $props();
  const f = $derived(data.facts.build);
  const eli = $derived(app.narrative === 'eli5');
  const t = (x: { plain: string; eng: string }) => (eli ? x.plain : x.eng);

  const sources = $derived(f.ideaSources.filter((s) => !SOURCE_COPY[s as IdeaSource].includes('retired')));
  const phases = Object.keys(PHASE_COPY) as PhaseName[];
  let phase = $state<PhaseName>('gather');
  let stage = $state<string>('proposed');
  const stageInfo = $derived(f.workStages.find((s) => s.id === stage) ?? f.workStages[0]);
  const night = $derived(f.activities.find((a) => a.name === 'daydream-improve'));
</script>

<svelte:head><title>Backlog — Build — The Engine Room</title></svelte:head>

<section class="pe-route">
  <LeafHead part="build" title="Backlog" line={C.backlog.line.eng} lineEli5={C.backlog.line.plain} />

  <Instrument kicker="One way in" title="Where ideas come from" reading="Every channel that can file a backlog item. Retired channels are kept on old rows, but nothing new arrives through them.">
    <ul class="chips">
      {#each sources as s (s)}<li>{SOURCE_COPY[s as IdeaSource]}</li>{/each}
    </ul>
  </Instrument>

  <Instrument kicker="The board" title="What happens to an idea" reading="Select a column.">
    <Steps items={f.workStages.map((s) => ({ id: s.id, label: s.label }))} selected={stage} onselect={(id) => (stage = id)} />
    <p class="explain"><b>{stageInfo.label}</b> — {stageInfo.question}.</p>
  </Instrument>

  <Instrument
    kicker="Overnight"
    title="The night shift"
    reading={`Runs once a night${night?.window ? ` between ${night.window} UK time` : ''}, and only after ${f.idleMinutes} minutes with nobody using the site.`}
  >
    <Steps
      items={phases.map((p) => ({ id: p, label: words(p), state: 'retired' in PHASE_COPY[p] ? 'skipped' : undefined }))}
      selected={phase}
      onselect={(id) => (phase = id as PhaseName)}
    />
    <p class="explain">{t(PHASE_COPY[phase])}</p>
    <div class="stats">
      <Stat value={`$${f.night.maxCostUsd.toFixed(2)}`} label="most a night may spend on models" />
      <Stat value={f.night.maxLlmCalls} label="model calls, at most" />
      <Stat value={f.night.maxWallMinutes} unit=" min" label="wall clock, at most" />
      <Stat value={f.night.maxDeliveries} label="new deliveries started a night" />
      <Stat value={f.night.maxToolsRepaired} label="broken tools repaired a night" />
    </div>
  </Instrument>

  <Instrument kicker="The heartbeat" title="What runs, and how often" reading="The scheduled activities behind daydream and the builder, with their default timing, read from the scheduler’s registry.">
    <ul class="beats">
      {#each f.activities as a (a.name)}
        <li><code>{a.name}</code><span>{ACTIVITY_COPY[a.name]}</span><em>{every(a.cadenceMinutes)}{a.window ? `, ${a.window}` : ''}</em></li>
      {/each}
    </ul>
  </Instrument>

  <PageFoot />
</section>

<style>
  .chips { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
  .chips li { font-size: var(--fs-label); padding: 5px 11px; border-radius: var(--radius-pill); border: 1px solid rgba(28,22,17,0.2); background: rgba(255,255,255,0.6); }
  .explain { margin: 12px 0; font-size: var(--fs-body-sm); line-height: 1.55; color: rgba(28,22,17,0.8); }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
  .beats { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  .beats li { display: grid; grid-template-columns: minmax(16ch, auto) 1fr auto; gap: 12px; align-items: baseline; font-size: var(--fs-label); padding: 5px 0; border-bottom: 1px dashed rgba(28,22,17,0.12); }
  .beats code { font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  .beats em { font-style: normal; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.6); white-space: nowrap; }
  @media (max-width: 620px) { .beats li { grid-template-columns: 1fr; gap: 2px; } }
</style>
