<script lang="ts">
  // Develop — a delivery's stages, its release policies and the unattended limits. The stage
  // list is the DeliveryStage type itself: DELIVERY_COPY is checked against it, so a stage
  // the builder grows appears here or the type check fails.
  //
  // Bands: the assembly line under the headline, the brief lanes on paper, how far it may
  // travel on ink, and autopilot's limits on paper as a strip of rounds.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Band from '../../components/kit/Band.svelte';
  import Masthead from '../../components/kit/Masthead.svelte';
  import Stat from '../../components/viz/Stat.svelte';
  import AssemblyLine from '../../components/art/build/AssemblyLine.svelte';
  import ReleaseTrack from '../../components/art/build/ReleaseTrack.svelte';
  import { BUILD_COPY as C, DELIVERY_COPY, POLICY_COPY, BRIEF_LANE_COPY, DEVELOP_COPY } from '../../lib/build';
  import { app } from '../../lib/appState.svelte';
  import { cascade, shown } from '../../lib/motion';
  import type { DeliveryStage, ReleasePolicy, BriefLaneKind } from '$lib/constants/development';

  let { data } = $props();
  const f = $derived(data.facts.build);
  const eli = $derived(app.narrative === 'eli5');
  const t = (x: { plain: string; eng: string }) => (eli ? x.plain : x.eng);

  // The stages that block on me rather than on the builder.
  const MINE = new Set<DeliveryStage>(['needs_input', 'review']);
  const stations = $derived(
    (Object.keys(DELIVERY_COPY) as DeliveryStage[]).map((s) => ({ id: s, label: DELIVERY_COPY[s].label, text: t(DELIVERY_COPY[s]), mine: MINE.has(s) })),
  );
  let policy = $state<string>('pull_request');
  const LANE_NAME: Record<BriefLaneKind, string> = { site: 'This site', studio: 'The studio', 'other-repo': 'Another repo' };
</script>

<svelte:head><title>Develop — Build — The Engine Room</title></svelte:head>

<LeafHead part="build" title="Develop" line={C.develop.line.eng} lineEli5={C.develop.line.plain}>
  {#snippet art()}
    <p class="hint">{t(DEVELOP_COPY.line)}</p>
    <AssemblyLine {stations} />
  {/snippet}
</LeafHead>

<Band surface="deep" part="build">
  <Masthead kicker="Before anything is built" lines={['Which lane', 'does it *belong* in?']} strap={t(DEVELOP_COPY.lanes)} />
  <div class="sorter" {@attach shown()}>
    <svg class="fork" viewBox="0 0 600 150" preserveAspectRatio="none" aria-hidden="true">
      <path d="M300 0 V50" pathLength="1" data-draw />
      {#each f.briefLanes as _, i}
        {@const x = ((i + 0.5) / f.briefLanes.length) * 600}
        <path d="M300 50 C 300 100, {x} 80, {x} 150" pathLength="1" data-draw style="--d:{0.4 + i * 0.15}s" />
      {/each}
    </svg>
    <span class="brief">A brief</span>
    <ul class="lanes" {@attach cascade()} style="--n:{f.briefLanes.length}">
      {#each f.briefLanes as l (l)}
        <li class:home={l === 'site'}><b>{LANE_NAME[l as BriefLaneKind] ?? l}</b><span>{BRIEF_LANE_COPY[l as BriefLaneKind]}</span></li>
      {/each}
    </ul>
  </div>
</Band>

<Band surface="ink" part="build">
  <Masthead kicker="Release policy" lines={['How far may', 'it *travel*?']} strap={t(DEVELOP_COPY.track)} />
  <ReleaseTrack policies={f.releasePolicies} selected={policy} onselect={(id) => (policy = id)} text={t(POLICY_COPY[policy as ReleasePolicy])} />
</Band>

<Band surface="paper" part="build">
  <Masthead kicker="Unattended" lines={['Autopilot', 'on a *short lead*']} strap={t(C.develop.autopilot)} />
  <div class="rounds" {@attach cascade(':scope > span', { gap: 0.05, y: 10 })} role="img"
       aria-label="{f.autopilotRounds.default} rounds by default, {f.autopilotRounds.max} at most">
    {#each Array(f.autopilotRounds.max) as _, i}<span class:def={i < f.autopilotRounds.default}>{i + 1}</span>{/each}
  </div>
  <p class="r-key">{t(DEVELOP_COPY.rounds)}</p>
  <div class="stats">
    <Stat value={f.autopilotRounds.default} label="rounds by default before it stops and asks" lead />
    <Stat value={f.autopilotRounds.max} label="rounds at most, whatever I set" />
    <Stat value={f.budget.maxIterations} label="agent iterations per build" />
    <Stat value={f.budget.maxMinutes} unit="min" label="per build, at most" />
    <Stat value={f.budget.maxIdleIterations} label="idle iterations before it gives up" />
  </div>
</Band>

<PageFoot />

<style>
  .hint { margin: 0 0 18px; font-family: var(--er-mono); font-size: var(--fs-label-xs); letter-spacing: 0.06em; color: var(--fg-3); }
  .sorter { position: relative; }
  .fork { display: block; width: 100%; height: 110px; margin-top: 36px; }
  .fork path { fill: none; stroke: var(--tone); stroke-width: 3; vector-effect: non-scaling-stroke; }
  .brief { position: absolute; top: 0; left: 50%; transform: translateX(-50%); padding: 8px 16px; background: var(--er-ink); color: var(--er-cream);
    font-family: var(--er-mono); font-size: var(--fs-label-xs); letter-spacing: 0.12em; text-transform: uppercase; }
  .lanes { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: 12px; }
  .lanes li { display: flex; flex-direction: column; gap: 6px; padding: 18px; border: 1px solid var(--rule-strong); background: var(--er-paper-hi); text-align: center; }
  .lanes li.home { border: 2px solid var(--tone); }
  .lanes b { font-family: var(--er-display); font-weight: 400; text-transform: uppercase; font-size: clamp(18px, 1.8vw, 24px); color: var(--fg); }
  .lanes span { font-size: var(--fs-label); color: var(--fg-2); line-height: 1.45; }
  .rounds { display: grid; grid-template-columns: repeat(auto-fit, minmax(44px, 1fr)); gap: 6px; max-width: 820px; }
  .rounds span { aspect-ratio: 1; display: grid; place-items: center; border: 2px solid var(--rule-strong); font-family: var(--er-mono);
    font-size: var(--fs-label); color: var(--fg-3); }
  .rounds span.def { background: var(--tone); border-color: var(--tone); color: #fff; }
  .r-key { margin: 14px 0 30px; font-size: var(--fs-body-sm); color: var(--fg-2); max-width: 70ch; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 18px 24px; }
  @media (max-width: 640px) {
    .fork, .brief { display: none; }
    .lanes { grid-template-columns: minmax(0, 1fr); }
    .lanes li { text-align: left; }
  }
</style>
