<script lang="ts">
  import { app } from '../lib/appState.svelte';
  let { open, onClose }: { open: boolean; onClose: () => void } = $props();

  let step = $state(0);
  const STEPS = [
    {
      icon: 'grid',
      title: 'Design a data standard worth adopting',
      body: 'This workbench helps you design and publish a dataset standard, grounded in the standards government already runs. You capture what the data is for, the engine proposes a schema, and you see the impact on interoperability, assurance and adoption — live.',
    },
    {
      icon: 'people',
      title: 'Two ways to work',
      body: 'Switch between Analyst mode (plain language, business-first) and Architect mode (field-level types, identifiers, codelists, conformance) using the toggle, top-right. The same design, two lenses.',
    },
    {
      icon: 'spark',
      title: 'Start however suits you',
      body: 'Describe the dataset in plain English and let AI draft a first pass, open a worked Example from the menu, or build by hand. Everything the AI proposes stays fully editable.',
    },
    {
      icon: 'refresh',
      title: 'A registry that watches government',
      body: 'The Registry tab is a continuously-refreshed list of newly published data standards across government — discovered from official indexes, not guessed — so your design stays aware of what already exists.',
    },
    {
      icon: 'flask',
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
    <div class="icon" aria-hidden="true">
      <svg width="30" height="30" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        {#if STEPS[step].icon === 'grid'}
          <line x1="7" y1="3" x2="5.5" y2="17" /><line x1="13" y1="3" x2="11.5" y2="17" /><line x1="3" y1="7.5" x2="17" y2="7.5" /><line x1="3" y1="12.5" x2="17" y2="12.5" />
        {:else if STEPS[step].icon === 'people'}
          <circle cx="7" cy="7" r="2.4" /><circle cx="13.5" cy="8" r="1.9" /><path d="M3 16c0-2.2 1.8-3.6 4-3.6s4 1.4 4 3.6" /><path d="M12 12.6c1.9 0 3.5 1.2 3.5 3.4" />
        {:else if STEPS[step].icon === 'spark'}
          <path d="M10 2.5l1.6 5.9 5.9 1.6-5.9 1.6L10 17.5l-1.6-5.9L2.5 10l5.9-1.6z" />
        {:else if STEPS[step].icon === 'refresh'}
          <path d="M16 7a6.5 6.5 0 1 0 1.2 4.5" /><polyline points="16.5 3 16.5 7 12.5 7" />
        {:else}
          <path d="M8 2.5h4M9 2.5v5l-4 7.5a1.6 1.6 0 0 0 1.4 2.4h7.2a1.6 1.6 0 0 0 1.4-2.4l-4-7.5v-5" /><line x1="6.6" y1="12.5" x2="13.4" y2="12.5" />
        {/if}
      </svg>
    </div>
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
    background: var(--surface-elevated); border: 2px solid var(--text-primary); border-radius: var(--radius-round); padding: 26px 26px 18px; }
  .x { position: absolute; top: 12px; right: 12px; background: none; border: none; font-size: 15px; color: var(--text-muted); cursor: pointer; }
  .x:hover { color: var(--text-primary); }
  .icon { line-height: 1; color: var(--accent); margin-bottom: 10px; }
  .step-no { font-family: var(--font-mono); font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--text-ghost); }
  h2 { font-family: var(--font-display); text-transform: uppercase; font-size: 22px; line-height: 1.05; letter-spacing: -0.01em; margin: 6px 0 10px; color: var(--text-primary); }
  p { font-size: 14px; line-height: 1.6; color: var(--text-secondary); margin: 0 0 16px; }
  .dots { display: flex; gap: 6px; margin-bottom: 16px; }
  .dots .d { width: 7px; height: 7px; border-radius: var(--radius-pill); background: var(--card-border); }
  .dots .d.on { background: var(--accent); }
  .actions { display: flex; align-items: center; justify-content: space-between; }
  .skip { background: none; border: none; color: var(--text-muted); font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; cursor: pointer; }
  .skip:hover { color: var(--text-primary); }
  .nav { display: flex; gap: 8px; margin-left: auto; }
</style>
