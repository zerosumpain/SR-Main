<script lang="ts">
  import { onMount } from 'svelte';

  let visible = $state(true);

  onMount(() => {
    const stored = localStorage.getItem('biome-visible');
    if (stored === 'false') visible = false;
  });

  function toggle() {
    visible = !visible;
    localStorage.setItem('biome-visible', String(visible));
    // Dispatch custom event so layout can hide/show the background
    window.dispatchEvent(new CustomEvent('biome-toggle', { detail: { visible } }));
  }
</script>

<button
  onclick={toggle}
  class="fixed top-16 right-6 sm:right-10 md:right-16 z-30 flex items-center gap-2 transition-opacity"
  style="opacity: 0.6;"
  title={visible ? 'Hide biome background' : 'Show biome background'}
  aria-label={visible ? 'Hide biome background' : 'Show biome background'}
>
  <span class="text-[9px] uppercase tracking-[0.15em]" style="color: var(--text-ghost); font-family: var(--font-mono);">Biome {visible ? 'on' : 'off'}</span>
  <span class="w-6 h-6 rounded-full flex items-center justify-center" style="background: var(--card-bg); border: 1px solid var(--card-border);">
    <span class="text-[10px]" style="color: var(--text-ghost);">{visible ? '◉' : '○'}</span>
  </span>
</button>
