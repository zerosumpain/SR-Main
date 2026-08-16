<script lang="ts">
  import { onMount } from 'svelte';

  let mode = $state<'ecg' | 'biome'>('ecg');

  onMount(() => {
    const stored = localStorage.getItem('landing-bg');
    if (stored === 'biome' || stored === 'ecg') mode = stored;

    // Stay in sync when the background is switched elsewhere (e.g. the footer
    // ASCII toggle brings the ECG forward).
    function handleBgChange(e: Event) {
      mode = (e as CustomEvent<{ mode: 'ecg' | 'biome' }>).detail.mode;
    }
    window.addEventListener('landing-bg-change', handleBgChange);
    return () => window.removeEventListener('landing-bg-change', handleBgChange);
  });

  function toggle() {
    mode = mode === 'ecg' ? 'biome' : 'ecg';
    localStorage.setItem('landing-bg', mode);
    window.dispatchEvent(new CustomEvent('landing-bg-change', { detail: { mode } }));
  }
</script>

<!-- Inline in the hero's signature bar, not floating. As a fixed control it
     followed the page down onto the footer wordmark and the rail's buttons;
     absolutely positioned in the hero it landed on the signature line instead.
     The bar it belongs beside is the one that names what the background is
     doing, so it sits in that row. -->
<button onclick={toggle} class="bg-toggle" title={mode === 'ecg' ? 'Switch to biome background' : 'Switch to ECG background'} aria-label={mode === 'ecg' ? 'Switch to biome background' : 'Switch to ECG background'}>
  <span class="bg-toggle-mode">{mode === 'ecg' ? 'ECG' : 'BIOME'}</span>
  <span class="bg-toggle-glyph" aria-hidden="true">⇄</span>
</button>

<style>
  .bg-toggle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 5px 12px;
    background: var(--surface-sunken);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-pill);
    cursor: pointer;
    opacity: 0.75;
    transition:
      opacity 0.2s var(--ease-out),
      border-color 0.2s var(--ease-out);
  }
  .bg-toggle:hover {
    opacity: 1;
    border-color: var(--accent);
  }
  .bg-toggle-mode,
  .bg-toggle-glyph {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-ghost);
    line-height: 1;
  }
</style>
