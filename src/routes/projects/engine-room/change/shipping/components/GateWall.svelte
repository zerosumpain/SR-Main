<script lang="ts">
  // GateWall — why a red gate is a wall rather than a warning.
  //
  // The deploy job DECLARES the gate as a dependency, so a failing gate does not make the
  // deploy fail: it makes the deploy unreachable. Flip the switch and the second half of the
  // chain is not marked bad, it is marked never-started. Stage names are read from PIPELINE
  // so the diagram cannot drift from the pipeline it is drawing.
  //
  // The green caption says only what PIPELINE.live states — it must not claim the deploy job
  // is the ONLY thing that can reach production, because SAFETY records a hand-rolled one.
  import { PIPELINE } from '../../../lib/shipping';

  interface Props { tone?: string }
  let { tone = '#8a2d3a' }: Props = $props();

  const at = (id: string) => PIPELINE.find((p) => p.id === id)!;
  let red = $state(false);

  const alt = $derived(
    red
      ? 'A chain of three: the gate, then deploy, then live. The gate has failed, and because deploy needs the gate, deploy and live never start.'
      : 'A chain of three: the gate, then deploy, then live. The gate has passed, so deploy runs and the new version serves.',
  );
</script>

<div class="gw" style="--tone:{tone}">
  <div class="gw-top">
    <span class="g-lab" id="gw-lab">Gate result</span>
    <div class="seg" role="group" aria-labelledby="gw-lab">
      <button class:on={!red} aria-pressed={!red} onclick={() => (red = false)}>green</button>
      <button class="danger" class:on={red} aria-pressed={red} onclick={() => (red = true)}>red</button>
    </div>
  </div>

  <div class="chain" class:red role="img" aria-label={alt}>
    <div class="node first">
      <span class="n-mark" aria-hidden="true">{red ? '✕' : '✓'}</span>
      <span class="n-name">{at('gate').name}</span>
    </div>
    <div class="edge"><span class="e-lab">needs</span></div>
    <div class="node">
      <span class="n-name">{at('build').name}</span>
    </div>
    <div class="edge"><span class="e-lab" aria-hidden="true">→</span></div>
    <div class="node">
      <span class="n-name">{at('live').name}</span>
    </div>
  </div>

  <p class="say" aria-live="polite">
    {red ? 'Deploy never starts.' : 'Deploy starts, then the new version serves.'}
  </p>
</div>

<style>
  .gw { display: flex; flex-direction: column; gap: 10px; min-width: 0; }

  .gw-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .g-lab { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.14em;
    text-transform: uppercase; color: rgba(28,22,17,0.5); }
  .seg { display: flex; border: 1px solid rgba(28,22,17,0.2); border-radius: var(--radius-pill); overflow: hidden; }
  .seg button { font-family: var(--font-body); font-size: var(--fs-label-xs); line-height: 1.2;
    padding: 5px 12px; border: none; background: rgba(255,255,255,0.6); color: var(--text-primary);
    cursor: pointer; transition: background 0.12s, color 0.12s; }
  .seg button + button { border-left: 1px solid rgba(28,22,17,0.2); }
  .seg button:hover { background: rgba(28,22,17,0.07); }
  .seg button.on { background: var(--tone); color: #fff; }
  .seg button.danger.on { background: #c44; }

  .chain { display: flex; align-items: stretch; min-width: 0; }
  .node { flex: 1 1 0; min-width: 0; display: flex; align-items: center; justify-content: center; gap: 7px;
    padding: 12px 10px; border: 1px solid rgba(28,22,17,0.2); border-radius: var(--radius-sharp);
    background: rgba(255,255,255,0.6); transition: opacity 0.15s, background 0.15s, border-color 0.15s; }
  .n-name { font-family: var(--font-body); font-size: var(--fs-label); font-weight: 600;
    color: var(--text-primary); line-height: 1.2; text-align: center; }
  .n-mark { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: #2d7a3a; }

  .node.first { border-color: #2d7a3a; background: rgba(45,122,58,0.09); }
  .chain.red .node.first { border-color: #c44; background: rgba(196,68,68,0.1); }
  .chain.red .n-mark { color: #c44; }
  .chain.red .node:not(.first) { opacity: 0.34; border-style: dashed;
    background: repeating-linear-gradient(135deg, rgba(28,22,17,0.05) 0 6px, transparent 6px 12px); }

  .edge { flex: 0 0 62px; position: relative; display: flex; align-items: center; justify-content: center; }
  .edge::before { content: ''; position: absolute; left: 4px; right: 4px; top: 50%;
    border-top: 1px solid rgba(28,22,17,0.3); }
  .chain.red .edge::before { border-top-style: dashed; border-top-color: rgba(196,68,68,0.6); }
  .e-lab { position: relative; padding: 1px 5px; background: var(--bg, #fff);
    font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.1em;
    text-transform: uppercase; color: rgba(28,22,17,0.55); }
  .chain.red .e-lab { color: #c44; }

  .say { margin: 0; font-family: var(--font-mono); font-size: var(--fs-label-xs);
    letter-spacing: 0.03em; color: rgba(28,22,17,0.6); }

  @media (max-width: 520px) {
    .chain { flex-direction: column; align-items: stretch; }
    .edge { flex: 0 0 26px; }
    .edge::before { left: 50%; right: auto; top: 0; bottom: 0; width: 0; border-top: none;
      border-left: 1px solid rgba(28,22,17,0.3); }
    .chain.red .edge::before { border-left-style: dashed; border-left-color: rgba(196,68,68,0.6); border-top: none; }
  }
</style>
