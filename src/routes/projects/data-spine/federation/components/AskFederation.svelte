<script lang="ts">
  // AskFederation — central government puts a question to the federation.
  // Pick a question (mandated or voluntary), set which suppliers have opted
  // out, run it on the network above, and read the full anatomy below.
  // The anatomy is live: it recomputes as the participation toggles change.
  import { untrack } from 'svelte';
  import { QUERIES, runQuery, buildQueryScenario, queryById, type FedQuery } from '../lib/queries';
  import { SUPPLIERS } from '../lib/topology';
  import type { Scenario } from '../lib/engine';
  import QueryExplorer from './QueryExplorer.svelte';

  let {
    onRunScenario,
    externalQuery = null,
  }: {
    /** hands the generated scenario to the sim to play */
    onRunScenario?: (s: Scenario) => void;
    /** when a scripted catalogue scenario with a linked query runs, mirror it
     * here — a fresh object per run, so replays re-fire even for the same id */
    externalQuery?: { id: string } | null;
  } = $props();

  let selectedId = $state(QUERIES[0].id);
  let optOuts = $state<ReadonlySet<string>>(new Set());
  let hasRun = $state(false);

  // a scripted scenario with a linked query selects that question here, so the
  // drill-down below always matches what just played on the network
  $effect(() => {
    const incoming = externalQuery; // tracked read: the prop only
    untrack(() => {
      if (incoming && queryById(incoming.id)) {
        selectedId = incoming.id;
        hasRun = true;
      }
    });
  });

  const query = $derived<FedQuery>(queryById(selectedId) ?? QUERIES[0]);
  const run = $derived(runQuery(query, [...optOuts]));
  const statutoryQs = QUERIES.filter((q) => q.basis === 'statutory');
  const voluntaryQs = QUERIES.filter((q) => q.basis === 'voluntary');
  const optedCount = $derived(optOuts.size);

  function toggleOptOut(id: string) {
    const next = new Set(optOuts);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    optOuts = next;
  }

  function playOnNetwork() {
    hasRun = true;
    onRunScenario?.(buildQueryScenario(run));
  }
</script>

<div class="ask">
  <div class="ask-top">
    <!-- the question -->
    <div class="ask-qs">
      <span class="p-lab">The question</span>
      <div class="q-group">
        <span class="q-g mand">Mandated — statutory basis, gateways must answer</span>
        {#each statutoryQs as q (q.id)}
          <button class="q-item" class:on={selectedId === q.id} onclick={() => (selectedId = q.id)}>
            <b>{q.question}</b>
            <span>{q.instrument}</span>
          </button>
        {/each}
        <span class="q-g vol">Voluntary — no statute, every gateway may decline</span>
        {#each voluntaryQs as q (q.id)}
          <button class="q-item" class:on={selectedId === q.id} onclick={() => (selectedId = q.id)}>
            <b>{q.question}</b>
            <span>{q.instrument}{q.needsEdtech ? ' · answered by the edtech tendrils' : ''}</span>
          </button>
        {/each}
      </div>
    </div>

    <!-- participation / opt-outs -->
    <div class="ask-part">
      <span class="p-lab">Federation participation</span>
      {#if query.needsEdtech}
        <p class="part-note">This question is answered by the edtech tendrils, which contribute voluntarily by construction — the MIS opt-out list doesn’t apply. Toggle the edtech ring on the model to watch them.</p>
      {:else}
        <p class="part-note">
          {#if query.basis === 'statutory'}
            This ask is <b>mandated</b>. A supplier can lodge an objection, but the gateway answers anyway — and the objection goes on the ledger. That is the guardrail: opting out exists only inside what the law leaves optional.
          {:else}
            This ask is <b>voluntary</b>. Any gateway that opts out simply doesn’t answer; coverage drops and the result is labelled partial. Try switching a major off.
          {/if}
        </p>
        <div class="part-list">
          {#each SUPPLIERS as s (s.id)}
            <button
              class="part-chip"
              class:out={optOuts.has(s.id)}
              class:overridden={optOuts.has(s.id) && query.basis === 'statutory'}
              onclick={() => toggleOptOut(s.id)}
              title={optOuts.has(s.id) ? (query.basis === 'statutory' ? 'Objection lodged — overridden by statute' : 'Opted out of voluntary asks') : 'Participating'}
            >
              <i></i>{s.label}<em>{s.sharePct}%</em>
            </button>
          {/each}
        </div>
        {#if optedCount > 0}
          <p class="part-sum">
            {optedCount} supplier{optedCount > 1 ? 's' : ''} opting out ·
            {#if query.basis === 'statutory'}overridden by statute — coverage stays 100%, objections logged{:else}coverage falls to {run.assembled.coveragePct}%{/if}
          </p>
        {/if}
      {/if}
      <button class="ask-run" onclick={playOnNetwork}>▶ Put it to the federation</button>
    </div>
  </div>

  {#if hasRun}
    <QueryExplorer {run} />
  {:else}
    <p class="ask-hint">Pick a question and put it to the federation — the full anatomy (query → partials → return) appears here.</p>
  {/if}
</div>

<style>
  .ask { display: flex; flex-direction: column; gap: 18px; }
  .p-lab { display: block; font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(28,22,17,0.5); margin-bottom: 8px; }

  .ask-top { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 18px; align-items: start; }

  .q-g { display: block; font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.1em; text-transform: uppercase; margin: 10px 0 6px; }
  .q-g.mand { color: var(--accent-ink); }
  .q-g.vol { color: #8a6a1e; }
  .q-item { display: block; width: 100%; text-align: left; background: rgba(255,255,255,0.5); border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-round); color: var(--ink); padding: 9px 12px; margin: 4px 0; cursor: pointer; }
  .q-item:hover { border-color: rgba(28,22,17,0.45); }
  .q-item.on { background: var(--ink); border-color: var(--ink); color: var(--paper, #f1ead6); }
  .q-item b { display: block; font-family: 'Fraunces', serif; font-weight: 600; font-size: 14.5px; line-height: 1.25; }
  .q-item span { display: block; font-family: 'JetBrains Mono', monospace; font-size: 9px; margin-top: 3px; color: rgba(28,22,17,0.5); }
  .q-item.on span { color: rgba(241,234,214,0.65); }

  .part-note { font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.7); margin: 0 0 10px; }
  .part-note b { color: var(--ink); }
  .part-list { display: flex; flex-wrap: wrap; gap: 6px; }
  .part-chip { display: inline-flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.55); border: 1px solid rgba(28,22,17,0.2); border-radius: var(--radius-pill); font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 500; color: var(--ink); padding: 5px 11px 5px 8px; cursor: pointer; }
  .part-chip i { width: 8px; height: 8px; border-radius: var(--radius-pill); background: #2f7d4f; flex: 0 0 8px; }
  .part-chip em { font-style: normal; font-family: 'JetBrains Mono', monospace; font-size: 9px; color: rgba(28,22,17,0.45); }
  .part-chip:hover { border-color: rgba(28,22,17,0.5); }
  .part-chip.out { background: rgba(138,45,58,0.07); border-color: rgba(138,45,58,0.4); }
  .part-chip.out i { background: #8a2d3a; }
  .part-chip.out { text-decoration: line-through; text-decoration-color: rgba(138,45,58,0.55); }
  .part-chip.overridden { background: rgba(176,137,42,0.1); border-color: rgba(176,137,42,0.5); text-decoration: none; }
  .part-chip.overridden i { background: #b0892a; }
  .part-sum { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; color: rgba(28,22,17,0.65); margin: 10px 0 0; }

  .ask-run { margin-top: 14px; display: inline-flex; align-items: center; gap: 8px; font-family: 'DM Sans', sans-serif; font-size: 14.5px; font-weight: 600; color: var(--paper, #f1ead6); background: var(--ink); border: 1.5px solid var(--ink); padding: 11px 20px; border-radius: var(--radius-round); cursor: pointer; }
  .ask-run:hover { background: #000; }

  .ask-hint { font-size: 13px; font-style: italic; color: rgba(28,22,17,0.55); border: 1px dashed rgba(28,22,17,0.25); border-radius: var(--radius-round); padding: 14px 16px; margin: 0; }

  @media (max-width: 860px) {
    .ask-top { grid-template-columns: 1fr; }
  }
</style>
