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
  class="fixed bottom-4 left-4 z-30 flex items-center gap-2 rounded-full px-3 py-1.5 transition-opacity hover:opacity-100"
  style="background: var(--card-bg); border: 1px solid var(--card-border); opacity: 0.7;"
  title={visible ? 'Hide biome background' : 'Show biome background'}
  aria-label={visible ? 'Hide biome background' : 'Show biome background'}
>
  <span class="text-[9px] uppercase tracking-[0.15em]" style="color: var(--text-ghost); font-family: var(--font-mono);">Biome {visible ? 'on' : 'off'}</span>
  <span class="text-[10px]" style="color: var(--text-ghost);">{visible ? '◉' : '○'}</span>
</button>
