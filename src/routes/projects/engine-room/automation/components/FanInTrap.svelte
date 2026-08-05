<script lang="ts">
  // FanInTrap — wire two branches into one node three ways and watch what survives.
  // Straight in: collision. Through a merge node: the same collision, because a merge is a
  // flat spread. Wrapped first: everything arrives.
  import { BRANCHES } from '../../lib/automation';

  type Wiring = 'straight' | 'merge' | 'wrapped';
  let wiring = $state<Wiring>('straight');

  const OPTIONS: Array<{ k: Wiring; label: string; sub: string }> = [
    { k: 'straight', label: 'Straight in', sub: 'both branches → one node' },
    { k: 'merge', label: 'Through a merge node', sub: 'the obvious fix' },
    { k: 'wrapped', label: 'Wrapped first', sub: 'a transform on each branch' },
  ];

  /** What the target node actually receives. */
  const received = $derived.by(() => {
    if (wiring === 'wrapped') {
      return BRANCHES.map((b) => ({ key: b.wrapped!, from: b.label, lost: false }));
    }
    // flat assign, last writer wins — both wiring modes collapse identically
    const last = BRANCHES[BRANCHES.length - 1];
    return BRANCHES[0].keys.map((k) => ({ key: k, from: last.label, lost: false }));
  });

  const lost = $derived(wiring === 'wrapped' ? [] : BRANCHES.slice(0, -1));
  const broken = $derived(wiring !== 'wrapped');
</script>

<div class="fi">
  <div class="fi-opts" role="group" aria-label="How the branches are wired">
    {#each OPTIONS as o}
      <button class:on={wiring === o.k} onclick={() => (wiring = o.k)}>
        <b>{o.label}</b><span>{o.sub}</span>
      </button>
    {/each}
  </div>

  <div class="graph">
    <div class="col branches">
      {#each BRANCHES as b}
        <div class="node up">
          <span class="n-lab">{b.label}</span>
          <span class="n-keys">{b.keys.join(' · ')}</span>
        </div>
      {/each}
    </div>

    <div class="col wires">
      {#if wiring === 'wrapped'}
        <div class="wrapper">transform<em>{'{ accounts: … }'}</em></div>
        <div class="wrapper">transform<em>{'{ cards: … }'}</em></div>
      {:else if wiring === 'merge'}
        <div class="mergebox">merge<em>{'{ ...input }'}</em></div>
      {:else}
        <div class="plain">→</div>
      {/if}
    </div>

    <div class="col target">
      <div class="node down" class:broken>
        <span class="n-lab">Summarise</span>
        <ul class="got">
          {#each received as r}
            <li><code>{r.key}</code><em>from {r.from}</em></li>
          {/each}
        </ul>
      </div>
    </div>
  </div>

  <div class="verdict" class:bad={broken}>
    {#if broken}
      <span class="v-lab">✕ {BRANCHES[0].keys.length} keys collided</span>
      <p>Every key the target receives came from <b>{BRANCHES[BRANCHES.length - 1].label}</b>.
        {#each lost as l}<b>{l.label}</b>{/each}'s data was overwritten before the node ever ran.
        {#if wiring === 'merge'}
          A merge node did not help: it is a flat spread of its input, so it collapses in exactly the same way.
          Reaching for the node named after the problem is the natural move, and it is the wrong one.
        {:else}
          Nothing errors. The downstream transform finds nothing where it expected data and emits empty strings, and
          the run fails several nodes later with something that looks unrelated.
        {/if}</p>
    {:else}
      <span class="v-lab">✓ Both branches arrived</span>
      <p>Each branch was given its own key <b>before</b> the branches converged, so nothing overlaps and nothing is
        lost. This is the only fix — and it costs one tiny transform per branch.</p>
    {/if}
  </div>
</div>

<style>
  .fi { border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-round); background: rgba(255,255,255,0.45); padding: 14px 16px; margin: 14px 0; }
  .fi-opts { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 13px; }
  .fi-opts button { display: flex; flex-direction: column; gap: 1px; text-align: left; cursor: pointer;
    background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.2); border-radius: var(--radius-round); padding: 7px 12px; }
  .fi-opts b { font-family: 'DM Sans', sans-serif; font-size: 12.5px; font-weight: 600; color: var(--text-primary); }
  .fi-opts span { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; color: rgba(28,22,17,0.55); }
  .fi-opts button:hover { background: rgba(28,22,17,0.07); border-color: rgba(28,22,17,0.36); }
  .fi-opts button.on { background: var(--accent-ink); border-color: var(--accent-ink); }
  .fi-opts button.on b, .fi-opts button.on span { color: #fff; }

  .graph { display: grid; grid-template-columns: 1.1fr 0.7fr 1.1fr; gap: 10px; align-items: center; }
  .col { display: flex; flex-direction: column; gap: 9px; }
  .col.wires { align-items: center; }
  .node { border: 1px solid rgba(28,22,17,0.2); border-radius: var(--radius-round); background: rgba(255,255,255,0.7); padding: 9px 12px; }
  .node.down { border-width: 1.5px; }
  .node.down.broken { border-color: rgba(196,68,68,0.5); background: rgba(196,68,68,0.05); }
  .n-lab { display: block; font-family: 'DM Sans', sans-serif; font-size: 12.5px; font-weight: 600; color: var(--text-primary); }
  .n-keys { display: block; font-family: 'JetBrains Mono', monospace; font-size: 8.5px; line-height: 1.5; color: rgba(28,22,17,0.5); margin-top: 3px; word-break: break-word; }

  .plain { font-size: 18px; color: rgba(28,22,17,0.35); text-align: center; }
  .mergebox, .wrapper { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--text-primary);
    background: rgba(28,22,17,0.06); border: 1px dashed rgba(28,22,17,0.3); border-radius: var(--radius-round);
    padding: 6px 10px; text-align: center; width: 100%; }
  .mergebox em, .wrapper em { display: block; font-style: normal; font-size: 8.5px; color: rgba(28,22,17,0.5); margin-top: 2px; }
  .wrapper { border-style: solid; border-color: rgba(45,122,58,0.45); background: rgba(45,122,58,0.09); }
  .mergebox { border-color: rgba(196,68,68,0.45); background: rgba(196,68,68,0.07); }

  .got { margin: 6px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; }
  .got li { display: flex; align-items: baseline; gap: 6px; }
  .got code { font-family: 'JetBrains Mono', monospace; font-size: 10px; background: rgba(28,22,17,0.07); padding: 1px 5px; border-radius: var(--radius-sharp); color: var(--text-primary); }
  .got em { font-style: normal; font-family: 'JetBrains Mono', monospace; font-size: 8.5px; color: rgba(28,22,17,0.5); }

  .verdict { margin-top: 13px; border-left: 3px solid #2d7a3a; background: rgba(45,122,58,0.08);
    border-radius: 0 var(--radius-round) var(--radius-round) 0; padding: 10px 14px; }
  .verdict.bad { border-left-color: #c44; background: rgba(196,68,68,0.07); }
  .v-lab { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.09em; color: #2d7a3a; }
  .verdict.bad .v-lab { color: #c44; }
  .verdict p { margin: 5px 0 0; font-size: 13px; line-height: 1.58; color: rgba(28,22,17,0.78); max-width: 88ch; }
  .verdict b { color: var(--text-primary); }

  @media (max-width: 700px) {
    .graph { grid-template-columns: 1fr; }
    .col.wires { flex-direction: row; }
  }
</style>
