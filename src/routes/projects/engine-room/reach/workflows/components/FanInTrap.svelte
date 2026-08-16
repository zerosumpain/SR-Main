<script lang="ts">
  // FanInTrap — wire two branches into one node three ways and watch what survives.
  // Straight in: collision. Through a merge node: the same collision, because a merge is a
  // flat spread. Wrapped first: everything arrives.
  //
  // All labels and keys come from BRANCHES in ../../../lib/automation.ts. No timers, no
  // observers, no animation handles — the only state here is which wiring is selected.
  import { BRANCHES } from '../../../lib/automation';

  interface Props { tone?: string }
  let { tone = 'var(--success)' }: Props = $props();

  type Wiring = 'straight' | 'merge' | 'wrapped';
  let wiring = $state<Wiring>('straight');

  const OPTIONS: Array<{ k: Wiring; label: string; sub: string }> = [
    { k: 'straight', label: 'Straight in', sub: 'both into one' },
    { k: 'merge', label: 'Merge node', sub: 'the obvious fix' },
    { k: 'wrapped', label: 'Wrapped first', sub: 'a transform on each branch' },
  ];

  const last = $derived(BRANCHES[BRANCHES.length - 1]);

  /** What the target node actually receives. */
  const received = $derived.by(() => {
    if (wiring === 'wrapped') {
      return BRANCHES.map((b) => ({ key: b.wrapped ?? b.id, from: b.label }));
    }
    // flat assign, last writer wins — straight and merge collapse identically
    return BRANCHES[0].keys.map((k) => ({ key: k, from: last.label }));
  });

  const lost = $derived(wiring === 'wrapped' ? [] : BRANCHES.slice(0, -1));
  const broken = $derived(wiring !== 'wrapped');

  const wireLabel = $derived(
    broken
      ? `Two branches converge on one node. ${BRANCHES[0].keys.length} keys collide, and the branch ${lost.map((l) => l.label).join(' and ')} is discarded before the node runs.`
      : 'Two branches converge on one node. Each carries its own key, so both arrive intact.',
  );
</script>

<div class="fi" style="--tone:{tone}">
  <div class="fi-opts" role="group" aria-label="How the branches are wired">
    {#each OPTIONS as o (o.k)}
      <button class:on={wiring === o.k} aria-pressed={wiring === o.k} onclick={() => (wiring = o.k)}>
        <b>{o.label}</b><span>{o.sub}</span>
      </button>
    {/each}
  </div>

  <div class="graph">
    <div class="col branches">
      {#each BRANCHES as b (b.id)}
        <div class="node up">
          <span class="n-lab">{b.label}</span>
          <span class="n-keys">{b.keys.join(' · ')}</span>
        </div>
      {/each}
    </div>

    <div class="col wires">
      <svg class="conn" viewBox="0 0 100 90" preserveAspectRatio="none" role="img" aria-label={wireLabel}>
        <path class="w" class:dropped={broken} d="M0 14 C42 14 56 45 100 45"
              vector-effect="non-scaling-stroke" />
        <path class="w live" d="M0 76 C42 76 56 45 100 45" vector-effect="non-scaling-stroke" />
      </svg>
      <span class="plain" aria-hidden="true">↓</span>

      {#if wiring === 'wrapped'}
        {#each BRANCHES as b (b.id)}
          <div class="wrapper">transform<em>{`{ ${b.wrapped}: … }`}</em></div>
        {/each}
      {:else if wiring === 'merge'}
        <div class="mergebox">merge<em>{'{ ...input }'}</em></div>
      {/if}
    </div>

    <div class="col target">
      <div class="node down" class:broken>
        <span class="n-lab">Summarise</span>
        <ul class="got">
          {#each received as r (r.key)}
            <li><code>{r.key}</code><em>{r.from}</em></li>
          {/each}
        </ul>
      </div>
    </div>
  </div>

  <div class="verdict" class:bad={broken} aria-live="polite">
    {#if broken}
      <span class="v-lab">✕ {BRANCHES[0].keys.length} keys collided</span>
      <p>All {BRANCHES[0].keys.length} arrived from <b>{last.label}</b>.
        {#each lost as l (l.id)}<b>{l.label}</b>{/each} was overwritten before the node ran.
        {#if wiring === 'merge'}
          A merge node is a flat spread of its input — it collapses the same way.
        {:else}
          Nothing errored: the transform downstream emits empty strings and the run dies three nodes later.
        {/if}</p>
    {:else}
      <span class="v-lab">✓ Both branches arrived</span>
      <p>Each branch got its own key <b>before</b> they converged, so nothing overlaps.</p>
    {/if}
  </div>
</div>

<style>
  .fi { --tone: var(--success); border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-sharp); background: rgba(255,255,255,0.45); padding: 14px 16px; margin: 14px 0; }
  .fi-opts { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 13px; }
  .fi-opts button { display: flex; flex-direction: column; gap: 1px; text-align: left; cursor: pointer;
    background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.2); border-radius: var(--radius-sharp); padding: 7px 12px; }
  .fi-opts b { font-family: var(--font-body); font-size: var(--fs-label); font-weight: 600; color: var(--text-primary); }
  .fi-opts span { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.55); }
  .fi-opts button:hover { background: rgba(28,22,17,0.07); border-color: rgba(28,22,17,0.36); }
  .fi-opts button.on { background: var(--tone); border-color: var(--tone); }
  .fi-opts button.on b, .fi-opts button.on span { color: #fff; }

  .graph { display: grid; grid-template-columns: 1.1fr 0.7fr 1.1fr; gap: 10px; align-items: center; }
  .col { display: flex; flex-direction: column; gap: 9px; }
  .col.wires { position: relative; align-items: center; justify-content: center; min-height: 90px; }
  .node { border: 1px solid rgba(28,22,17,0.2); border-radius: var(--radius-sharp); background: rgba(255,255,255,0.7); padding: 9px 12px; }
  .node.down { border-width: 1.5px; }
  .node.down.broken { border-color: color-mix(in srgb, var(--error) 50%, transparent);
    background: color-mix(in srgb, var(--error) 6%, transparent); }
  .n-lab { display: block; font-family: var(--font-body); font-size: var(--fs-label); font-weight: 600; color: var(--text-primary); }
  .n-keys { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.5); margin-top: 3px; word-break: break-word; }

  /* The two wires, drawn behind whatever sits in the middle column. */
  .conn { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 0; overflow: visible; }
  .w { fill: none; stroke: var(--tone); stroke-width: 1.6; opacity: 0.85; }
  .w.dropped { stroke: var(--error); stroke-dasharray: 4 4; opacity: 0.9; }
  .plain { display: none; font-size: 18px; color: rgba(28,22,17,0.35); }

  .mergebox, .wrapper { position: relative; z-index: 1;
    font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-primary);
    background: rgba(28,22,17,0.06); border: 1px dashed rgba(28,22,17,0.3); border-radius: var(--radius-sharp);
    padding: 6px 10px; text-align: center; width: 100%; }
  .mergebox em, .wrapper em { display: block; font-style: normal; font-size: var(--fs-label-xs); color: rgba(28,22,17,0.5); margin-top: 2px; }
  .wrapper { border-style: solid; border-color: color-mix(in srgb, var(--tone) 45%, transparent);
    background: color-mix(in srgb, var(--tone) 10%, transparent); }
  .mergebox { border-color: color-mix(in srgb, var(--error) 45%, transparent);
    background: color-mix(in srgb, var(--error) 8%, transparent); }

  .got { margin: 6px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; }
  .got li { display: flex; align-items: baseline; gap: 6px; }
  .got code { font-family: var(--font-mono); font-size: var(--fs-label-xs); background: rgba(28,22,17,0.07); padding: 1px 5px; border-radius: var(--radius-sharp); color: var(--text-primary); }
  .got em { font-style: normal; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.5); }

  .verdict { margin-top: 13px; border-left: 3px solid var(--tone);
    background: color-mix(in srgb, var(--tone) 9%, transparent);
    border-radius: 0 var(--radius-sharp) var(--radius-sharp) 0; padding: 10px 14px; }
  .verdict.bad { border-left-color: var(--error); background: color-mix(in srgb, var(--error) 8%, transparent); }
  .v-lab { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.09em; color: var(--tone); }
  .verdict.bad .v-lab { color: var(--error); }
  .verdict p { margin: 5px 0 0; font-size: var(--fs-label); line-height: 1.58; color: rgba(28,22,17,0.78); max-width: 88ch; }
  .verdict b { color: var(--text-primary); }

  /* Stacked: the left-to-right wires no longer describe the layout, so swap in an arrow. */
  @media (max-width: 700px) {
    .graph { grid-template-columns: 1fr; }
    .col.wires { flex-direction: row; gap: 8px; min-height: 0; }
    .conn { display: none; }
    .plain { display: block; }
  }
</style>
