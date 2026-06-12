<script lang="ts">
  import { app } from '../lib/appState.svelte';
  let { open, onClose }: { open: boolean; onClose: () => void } = $props();

  let step = $state(0);
  const STEPS = [
    {
      icon: '⌗',
      title: 'Design a data standard worth adopting',
      body: 'This workbench helps you design and publish a dataset standard, grounded in the standards government already runs. You capture what the data is for, the engine proposes a schema, and you see the impact on interoperability, assurance and adoption — live.',
    },
    {
      icon: '👥',
      title: 'Two ways to work',
      body: 'Switch between Analyst mode (plain language, business-first) and Architect mode (field-level types, identifiers, codelists, conformance) using the toggle, top-right. The same design, two lenses.',
    },
    {
      icon: '✦',
      title: 'Start however suits you',
      body: 'Describe the dataset in plain English and let AI draft a first pass, open a worked Example from the menu, or build by hand. Everything the AI proposes stays fully editable.',
    },
    {
      icon: '↻',
      title: 'A registry that watches government',
      body: 'The Registry tab is a continuously-refreshed list of newly published data standards across government — discovered from official indexes, not guessed — so your design stays aware of what already exists.',
    },
    {
      icon: '🧪',
      title: 'Test before it is real',
      body: 'Generate synthetic data that conforms to your schema (up to 10,000 rows) on the Test data tab, then export the standard in publish-grade formats. Your work saves automatically in this browser.',
    },
  ];
  const last = $derived(step === STEPS.length - 1);

  function done() {
    try { localStorage.setItem('dsd-onboarded', '1'); } catch { /* ignore */ }
    step = 0;
    onClose();
  }
</script>

{#if open}
  <div class="scrim" role="presentation" onclick={done}></div>
  <div class="modal" role="dialog" aria-modal="true" aria-label="Getting started">
    <button class="x" onclick={done} aria-label="Close">✕</button>
    <div class="icon">{STEPS[step].icon}</div>
    <span class="step-no">Step {step + 1} of {STEPS.length}</span>
    <h2>{STEPS[step].title}</h2>
    <p>{STEPS[step].body}</p>
    <div class="dots">{#each STEPS as _, i}<span class="d" class:on={i === step}></span>{/each}</div>
    <div class="actions">
      <button class="skip" onclick={done}>{last ? '' : 'Skip'}</button>
      <div class="nav">
        {#if step > 0}<button class="dsd-btn sm" onclick={() => (step -= 1)}>Back</button>{/if}
        {#if last}
          <button class="dsd-btn primary sm" onclick={done}>Start designing →</button>
        {:else}
          <button class="dsd-btn primary sm" onclick={() => (step += 1)}>Next</button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 200; background: rgba(26, 16, 8, 0.45); backdrop-filter: blur(2px); }
  .modal { position: fixed; z-index: 201; top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(460px, 92vw);
    background: var(--surface-elevated); border: 2px solid var(--text-primary); border-radius: var(--radius-round); box-shadow: var(--shadow-lg); padding: 26px 26px 18px; }
  .x { position: absolute; top: 12px; right: 12px; background: none; border: none; font-size: 15px; color: var(--text-muted); cursor: pointer; }
  .x:hover { color: var(--text-primary); }
  .icon { font-size: 30px; line-height: 1; color: var(--accent); margin-bottom: 10px; }
  .step-no { font-family: var(--font-mono); font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--text-ghost); }
  h2 { font-family: var(--font-display); text-transform: uppercase; font-size: 22px; line-height: 1.05; letter-spacing: -0.01em; margin: 6px 0 10px; color: var(--text-primary); }
  p { font-size: 14px; line-height: 1.6; color: var(--text-secondary); margin: 0 0 16px; }
  .dots { display: flex; gap: 6px; margin-bottom: 16px; }
  .dots .d { width: 7px; height: 7px; border-radius: 50%; background: var(--card-border); }
  .dots .d.on { background: var(--accent); }
  .actions { display: flex; align-items: center; justify-content: space-between; }
  .skip { background: none; border: none; color: var(--text-muted); font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; cursor: pointer; }
  .skip:hover { color: var(--text-primary); }
  .nav { display: flex; gap: 8px; margin-left: auto; }
</style>
