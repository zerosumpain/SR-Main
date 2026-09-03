<!-- src/lib/canvas/intelligence/desk/PhaseStepper.svelte -->
<!-- Compact horizontal phase stepper showing the ordered research pipeline. -->
<script lang="ts">
  import { PHASES, phaseStateFor } from './phases';
  import type { DeskStatus } from './deskControls';

  let { status, dark = false }: { status: DeskStatus; dark?: boolean } = $props();

  let states = $derived(phaseStateFor(status));
</script>

<nav class="stepper" class:dark aria-label="Research phases">
  {#each PHASES as phase, i}
    {@const state = states[phase.key]}
    {#if i > 0}
      <span class="connector connector-{state === 'done' || (i > 0 && states[PHASES[i - 1].key] === 'done') ? 'done' : 'dim'}" aria-hidden="true"></span>
    {/if}
    <span
      class="step step-{state}"
      title="{phase.label}{state === 'current' ? ' (current)' : state === 'done' ? ' (done)' : ''}"
      aria-current={state === 'current' ? 'step' : undefined}
    >
      {#if state === 'done'}
        <span class="dot dot-done" aria-hidden="true">✓</span>
      {:else}
        <span class="dot dot-{state}" aria-hidden="true">{i + 1}</span>
      {/if}
      <span class="label">{phase.shortLabel}</span>
    </span>
  {/each}
</nav>

<style>
  .stepper {
    display: flex;
    align-items: center;
    gap: 0;
    /* Keep it tight — this lives inside the 56px cmdbar */
  }

  .connector {
    display: block;
    width: 14px;
    height: 1px;
    flex-shrink: 0;
  }
  .connector-done { background: var(--success); }
  .connector-dim  { background: var(--card-border); }
  .dark .connector-done { background: var(--good-on-dark); }
  .dark .connector-dim { background: rgba(237, 228, 212, 0.2); }

  .step {
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: default;
  }

  .dot {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 700;
    line-height: 1;
    flex-shrink: 0;
    transition: background 0.2s, border-color 0.2s, color 0.2s;
  }

  .dot-done {
    background: var(--success);
    color: var(--bg);
    border: 1.5px solid var(--success);
    font-size: var(--fs-label-xs);
  }
  .dark .dot-done { background: var(--good-on-dark); color: var(--text-primary); border-color: var(--good-on-dark); }

  .dot-current {
    background: var(--accent);
    color: var(--bg);
    border: 1.5px solid var(--accent);
  }
  .dark .dot-current { background: var(--accent-on-dark); color: var(--text-primary); border-color: var(--accent-on-dark); }

  .dot-upcoming {
    background: transparent;
    color: var(--text-ghost, var(--text-muted));
    border: 1.5px solid var(--card-border);
  }
  .dark .dot-upcoming { color: rgba(237, 228, 212, 0.42); border-color: rgba(237, 228, 212, 0.2); }

  .label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.03em;
    transition: color 0.2s;
  }

  .step-done    .label { color: var(--text-muted); }
  .step-current .label { color: var(--accent); font-weight: 700; }
  .step-upcoming .label { color: var(--text-ghost, var(--text-muted)); opacity: 0.5; }
  .dark .step-done .label { color: rgba(237, 228, 212, 0.56); }
  .dark .step-current .label { color: var(--accent-on-dark); }
  .dark .step-upcoming .label { color: rgba(237, 228, 212, 0.4); }
</style>
