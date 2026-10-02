<script lang="ts">
  // Develop — a delivery's stages, its release policies and the unattended limits. The stage
  // list is the DeliveryStage type itself: DELIVERY_COPY is checked against it, so a stage
  // the builder grows appears here or the type check fails.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import Steps from '../../components/viz/Steps.svelte';
  import Stat from '../../components/viz/Stat.svelte';
  import { BUILD_COPY as C, DELIVERY_COPY, POLICY_COPY, BRIEF_LANE_COPY } from '../../lib/build';
  import { app } from '../../lib/appState.svelte';
  import type { DeliveryStage, ReleasePolicy, BriefLaneKind } from '$lib/constants/development';

  let { data } = $props();
  const f = $derived(data.facts.build);
  const eli = $derived(app.narrative === 'eli5');
  const t = (x: { plain: string; eng: string }) => (eli ? x.plain : x.eng);

  const stages = Object.keys(DELIVERY_COPY) as DeliveryStage[];
  let stage = $state<DeliveryStage>('brief');
  let policy = $state<string>('pull_request');
  const policyInfo = $derived(f.releasePolicies.find((p) => p.id === policy) ?? f.releasePolicies[0]);
</script>

<svelte:head><title>Develop — Build — The Engine Room</title></svelte:head>

<section class="pe-route">
  <LeafHead part="build" title="Develop" line={C.develop.line.eng} lineEli5={C.develop.line.plain} />

  <Instrument kicker="A delivery" title="From brief to deployed" reading="Every stage a delivery can be in. Select one.">
    <Steps items={stages.map((s) => ({ id: s, label: DELIVERY_COPY[s].label }))} selected={stage} onselect={(id) => (stage = id as DeliveryStage)} />
    <p class="explain">{t(DELIVERY_COPY[stage])}</p>
  </Instrument>

  <Instrument kicker="Before anything is built" title="Which lane does it belong in?" reading="A brief is sorted first, because only one lane touches this site’s own code.">
    <ul class="lanes">
      {#each f.briefLanes as l (l)}<li><b>{l}</b> {BRIEF_LANE_COPY[l as BriefLaneKind]}</li>{/each}
    </ul>
  </Instrument>

  <Instrument kicker="How far it may go" title="Release policy" reading="Set per delivery. Choose one.">
    {#snippet controls()}
      <div class="seg" role="group" aria-label="Release policy">
        {#each f.releasePolicies as p (p.id)}
          <button class:on={policy === p.id} onclick={() => (policy = p.id)}>{p.label}</button>
        {/each}
      </div>
    {/snippet}
    <p class="explain">{t(POLICY_COPY[policyInfo.id as ReleasePolicy])}</p>
  </Instrument>

  <Instrument kicker="Unattended" title="Autopilot’s limits" takeaway={t(C.develop.autopilot)}>
    <div class="stats">
      <Stat value={f.autopilotRounds.default} label="rounds by default before it stops and asks" />
      <Stat value={f.autopilotRounds.max} label="rounds at most, whatever I set" />
      <Stat value={f.budget.maxIterations} label="agent iterations per build" />
      <Stat value={f.budget.maxMinutes} unit=" min" label="per build, at most" />
      <Stat value={f.budget.maxIdleIterations} label="idle iterations before it stops" />
    </div>
  </Instrument>

  <PageFoot />
</section>

<style>
  .explain { margin: 12px 0 0; font-size: var(--fs-body-sm); line-height: 1.55; color: rgba(28,22,17,0.8); }
  .lanes { margin: 0; padding-left: 18px; display: grid; gap: 4px; font-size: var(--fs-label); }
  .lanes b { font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
  .seg { display: inline-flex; flex-wrap: wrap; background: rgba(28,22,17,0.07); padding: 2px; border-radius: var(--radius-sharp); border: 1px solid rgba(28,22,17,0.12); }
  .seg button { background: transparent; border: none; padding: 5px 10px; border-radius: var(--radius-sharp); font-family: var(--font-mono); font-size: var(--fs-label-xs); cursor: pointer; color: var(--text-primary); }
  .seg button.on { background: var(--accent-ink); color: #fff; }
</style>
