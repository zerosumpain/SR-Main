<script lang="ts">
  // Inbox — the stages every note moves through, and the double-check state machine. Stage
  // names and the plain sentence for each are the feature's own (STAGE_LABEL and
  // STAGE_EXPLAIN); only the engineering twin is written here, keyed by the Stage type.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import Steps from '../../components/viz/Steps.svelte';
  import { DAYDREAM_COPY as C, STAGE_ENG, COMMISSION_COPY } from '../../lib/daydream';
  import { app } from '../../lib/appState.svelte';
  import type { Stage } from '$lib/daydream/think/explain';
  import type { CommissionState } from '$lib/daydream/commissioning';

  let { data } = $props();
  const f = $derived(data.facts.daydream);
  const eli = $derived(app.narrative === 'eli5');
  const t = (x: { plain: string; eng: string }) => (eli ? x.plain : x.eng);

  let stage = $state<string>('spotted');
  const current = $derived(f.stages.find((s) => s.id === stage) ?? f.stages[0]);

  let commission = $state<string | null>(null);
  const picked = $derived(f.commissions.find((c) => c.id === commission) ?? null);
  // Grouped by the feature's own nextActor(), so a state that changes hands moves column here too.
  const actors = $derived([...new Set(f.commissions.map((c) => c.actor))]);
  const ACTOR_HEAD: Record<string, string> = { You: 'Waiting on me', jkai: 'Running', Nobody: 'Finished' };
</script>

<svelte:head><title>Inbox — Daydream — The Engine Room</title></svelte:head>

<section class="pe-route">
  <LeafHead part="daydream" title="Inbox" line={C.inbox.line.eng} lineEli5={C.inbox.line.plain} />

  <Instrument kicker="A note’s journey" title="Whose move is it?" reading="Select a stage." tone="var(--accent)">
    <Steps tone="var(--accent)" items={f.stages.map((s) => ({ id: s.id, label: s.label }))} selected={stage} onselect={(id) => (stage = id)} />
    <p class="explain">{eli ? current.explain : STAGE_ENG[current.id as Stage]}</p>
  </Instrument>

  <Instrument
    kicker="The double-check"
    title="Asking it to argue with itself"
    reading="Every state a double-check can be in, grouped by who has to act next."
    takeaway={t(C.inbox.check)}
    tone="var(--accent)"
  >
    <div class="actors">
      {#each actors as actor (actor)}
        <div class="actor">
          <span class="a-who">{ACTOR_HEAD[actor] ?? actor}</span>
          {#each f.commissions.filter((c) => c.actor === actor) as c (c.id)}
            <button class="chip" class:on={commission === c.id} onclick={() => (commission = commission === c.id ? null : c.id)}>{c.label}</button>
          {/each}
        </div>
      {/each}
    </div>
    {#if picked}<p class="explain">{t(COMMISSION_COPY[picked.id as CommissionState])}</p>{/if}
  </Instrument>

  <PageFoot />
</section>

<style>
  .explain { margin: 12px 0 0; font-size: var(--fs-body-sm); line-height: 1.55; color: rgba(28,22,17,0.8); }
  .actors { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
  .actor { display: flex; flex-wrap: wrap; gap: 6px; align-content: flex-start; }
  .a-who { flex-basis: 100%; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.12em; text-transform: uppercase; color: rgba(28,22,17,0.55); }
  .chip { font-size: var(--fs-label); padding: 5px 11px; border-radius: var(--radius-pill); border: 1px solid rgba(28,22,17,0.22); background: rgba(255,255,255,0.6); cursor: pointer; color: var(--text-primary); }
  .chip.on { background: var(--accent); border-color: var(--accent); color: #fff; }
</style>
