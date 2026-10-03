<script lang="ts">
  // Backlog — one intake, the work stages, and the nightly run that works through it. Every
  // stage, phase, cap and schedule is read from the feature (selfimprove/board.ts,
  // selfimprove/types.ts, the heartbeat registry) by the layout load.
  //
  // Bands: the rivers of ideas on paper, the board on paper, the night shift and its budget
  // on ink (measurement), the heartbeat clock on paper.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Band from '../../components/kit/Band.svelte';
  import Masthead from '../../components/kit/Masthead.svelte';
  import Steps from '../../components/viz/Steps.svelte';
  import Stat from '../../components/viz/Stat.svelte';
  import IdeaRivers from '../../components/art/build/IdeaRivers.svelte';
  import NightShift from '../../components/art/build/NightShift.svelte';
  import HeartbeatClock from '../../components/art/build/HeartbeatClock.svelte';
  import { BUILD_COPY as C, PHASE_COPY, SOURCE_COPY, ACTIVITY_COPY, BACKLOG_COPY } from '../../lib/build';
  import { app } from '../../lib/appState.svelte';
  import { words } from '../../lib/format';
  import { reveal } from '../../lib/motion';
  import type { PhaseName } from '$lib/selfimprove/types';
  import type { IdeaSource } from '$lib/selfimprove/board';

  let { data } = $props();
  const f = $derived(data.facts.build);
  const eli = $derived(app.narrative === 'eli5');
  const t = (x: { plain: string; eng: string }) => (eli ? x.plain : x.eng);

  // Retired channels stay on old rows; nothing new arrives through them, so they aren't drawn.
  const sources = $derived(
    f.ideaSources
      .filter((s) => s !== 'unattributed' && !SOURCE_COPY[s as IdeaSource].includes('retired'))
      .map((s) => ({ id: s, label: SOURCE_COPY[s as IdeaSource] })),
  );
  const phases = $derived(
    (Object.keys(PHASE_COPY) as PhaseName[]).map((p) => ({ id: p, label: words(p), text: t(PHASE_COPY[p]), skipped: 'retired' in PHASE_COPY[p] })),
  );
  let stage = $state<string>('proposed');
  const stageInfo = $derived(f.workStages.find((s) => s.id === stage) ?? f.workStages[0]);
  const night = $derived(f.activities.find((a) => a.name === 'daydream-improve'));
  const acts = $derived(f.activities.map((a) => ({ ...a, what: ACTIVITY_COPY[a.name] })));
</script>

<svelte:head><title>Backlog — Build — The Engine Room</title></svelte:head>

<LeafHead part="build" title="Backlog" line={C.backlog.line.eng} lineEli5={C.backlog.line.plain}>
  {#snippet art()}
    <IdeaRivers {sources} note={() => t(BACKLOG_COPY.rivers)} />
  {/snippet}
</LeafHead>

<Band surface="deep" part="build">
  <Masthead kicker="The board" lines={['What happens', 'to an *idea*']} strap={t(BACKLOG_COPY.board)} />
  <Steps items={f.workStages.map((s) => ({ id: s.id, label: s.label }))} selected={stage} onselect={(id) => (stage = id)} />
  <p class="explain" aria-live="polite" {@attach reveal({ y: 12 })}><b>{stageInfo.label}</b> {stageInfo.question}.</p>
</Band>

<Band surface="ink" part="build">
  <Masthead kicker="Overnight" lines={['The night', '*shift*']}
    strap={`${t(BACKLOG_COPY.night)} It runs once a night${night?.window ? ` between ${night.window} UK time` : ''}, and only after ${f.idleMinutes} minutes with nobody using the site.`} />
  <NightShift {phases} />
  <div class="budget">
    <h3 class="b-h">The night’s budget, and it may not go over</h3>
    <div class="stats">
      <Stat value={f.night.maxCostUsd} prefix="$" places={2} label="the most a night may spend on models" lead />
      <Stat value={f.night.maxLlmCalls} label="model calls, at most" />
      <Stat value={f.night.maxWallMinutes} unit="min" label="on the clock, at most" />
      <Stat value={f.night.maxDeliveries} label="new deliveries started a night" />
      <Stat value={f.night.maxToolsRepaired} label="broken tools repaired a night" />
    </div>
  </div>
</Band>

<Band surface="paper" part="build">
  <Masthead kicker="The heartbeat" lines={['What runs,', 'and *when*']} strap={t(BACKLOG_COPY.heartbeat)} />
  <HeartbeatClock {acts} />
</Band>

<PageFoot />

<style>
  .explain { margin: 22px 0 0; font-size: clamp(17px, 1.4vw, 20px); line-height: 1.55; color: var(--fg-2); }
  .explain b { color: var(--tone-text); margin-right: 6px; }
  .budget { margin-top: clamp(36px, 5vw, 64px); padding-top: 24px; border-top: 1px solid var(--rule); }
  .b-h { font-family: var(--er-mono); font-weight: 500; font-size: var(--fs-label-xs); letter-spacing: 0.16em; text-transform: uppercase; color: var(--fg-3); margin: 0 0 18px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 18px 24px; }
</style>
