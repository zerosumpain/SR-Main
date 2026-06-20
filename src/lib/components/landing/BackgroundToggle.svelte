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

<button
  onclick={toggle}
  class="fixed bottom-4 left-4 z-30 flex items-center gap-2 rounded-full px-3 py-1.5 transition-opacity hover:opacity-100"
  style="background: var(--card-bg); border: 1px solid var(--card-border); opacity: 0.7;"
  title={mode === 'ecg' ? 'Switch to biome background' : 'Switch to ECG background'}
  aria-label={mode === 'ecg' ? 'Switch to biome background' : 'Switch to ECG background'}
>
  <span
    class="text-[9px] uppercase tracking-[0.15em]"
    style="color: var(--text-ghost); font-family: var(--font-mono);"
  >
    {mode === 'ecg' ? 'ECG' : 'BIOME'}
  </span>
  <span class="text-[10px]" style="color: var(--text-ghost);" aria-hidden="true">⇄</span>
</button>
