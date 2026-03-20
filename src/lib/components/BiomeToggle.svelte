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
  class="fixed bottom-4 right-4 z-30 w-8 h-8 rounded-full flex items-center justify-center transition-opacity"
  style="background: var(--card-bg); border: 1px solid var(--card-border); opacity: 0.6;"
  title={visible ? 'Hide biome background' : 'Show biome background'}
  aria-label={visible ? 'Hide biome background' : 'Show biome background'}
>
  <span class="text-[10px]" style="color: var(--text-ghost);">{visible ? '◉' : '○'}</span>
</button>
