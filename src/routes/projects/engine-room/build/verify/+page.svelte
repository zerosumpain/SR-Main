<script lang="ts">
  // Verification — the chain a repo build walks, and the gates it runs. Phases come from the
  // RepoVerificationPhase type (VERIFY_COPY is checked against it) and gate names from
  // codegraph/gates.ts.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import Steps from '../../components/viz/Steps.svelte';
  type StepState = 'idle' | 'running' | 'done' | 'failed' | 'skipped';
  import { BUILD_COPY as C, VERIFY_COPY, GATE_COPY } from '../../lib/build';
  import { app } from '../../lib/appState.svelte';
  import type { RepoVerificationPhase } from '$lib/verification/repo';
  import type { GateName } from '$lib/codegraph/gates';

  let { data } = $props();
  const f = $derived(data.facts.build);
  const eli = $derived(app.narrative === 'eli5');
  const t = (x: { plain: string; eng: string }) => (eli ? x.plain : x.eng);

  const phases = Object.keys(VERIFY_COPY) as RepoVerificationPhase[];
  let phase = $state<RepoVerificationPhase>('feedback_gate');
  // "Break it here": every phase after a failure never runs.
  let failAt = $state<RepoVerificationPhase | null>(null);
  const stateOf = (p: RepoVerificationPhase): StepState => {
    if (!failAt) return 'done';
    const i = phases.indexOf(p), j = phases.indexOf(failAt);
    return i < j ? 'done' : i === j ? 'failed' : 'skipped';
  };
</script>

<svelte:head><title>Verification — Build — The Engine Room</title></svelte:head>

<section class="pe-route">
  <LeafHead part="build" title="Verification" line={C.verify.line.eng} lineEli5={C.verify.line.plain} />

  <Instrument
    kicker="The proof chain"
    title="Break it anywhere"
    reading="Select a phase to read it, or fail it to see what never runs."
    takeaway="A failure anywhere stops everything after it. Nothing reaches the live site on a red check."
  >
    {#snippet controls()}
      <button class="fail" onclick={() => (failAt = failAt === phase ? null : phase)}>{failAt === phase ? 'Pass it again' : 'Fail this phase'}</button>
    {/snippet}
    <Steps items={phases.map((p) => ({ id: p, label: VERIFY_COPY[p].label, state: stateOf(p) }))} selected={phase} onselect={(id) => (phase = id as RepoVerificationPhase)} />
    <p class="explain">{t(VERIFY_COPY[phase])}</p>
  </Instrument>

  <Instrument kicker="The gate" title="What “passing” means" reading="The checks a build’s failures are filed under, so the next build can look up what broke last time.">
    <ul class="gates">
      {#each f.gates as g (g)}<li><code>{g}</code> {GATE_COPY[g as GateName]}</li>{/each}
    </ul>
  </Instrument>

  <Instrument kicker="Hands off" title="What it may never touch alone" takeaway={t(C.verify.rails)}>
    <p class="explain">{eli ? 'Every criterion in a brief is judged against the exact version I was shown. A reviewer model gives its own verdict beside mine, and it’s recorded whether that reviewer was a different model from the one that wrote the code.' : 'Criteria carry a verdict per revision. An adversary assessment records whether its model differs from the author’s, so a build marking its own homework is visible rather than assumed.'}</p>
  </Instrument>

  <PageFoot />
</section>

<style>
  .explain { margin: 12px 0 0; font-size: var(--fs-body-sm); line-height: 1.55; color: rgba(28,22,17,0.8); }
  .gates { margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 6px; font-size: var(--fs-label); }
  .gates code { font-family: var(--font-mono); font-size: var(--fs-label-xs); background: rgba(28,22,17,0.06); padding: 1px 5px; border-radius: var(--radius-sharp); margin-right: 4px; }
  .fail { font-family: var(--font-mono); font-size: var(--fs-label-xs); padding: 5px 10px; border: 1px solid #8a2d3a; color: #8a2d3a; background: transparent; border-radius: var(--radius-sharp); cursor: pointer; }
</style>
