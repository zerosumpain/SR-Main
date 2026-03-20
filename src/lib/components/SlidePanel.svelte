<script lang="ts">
  import type { Snippet } from 'svelte';

  let { open = false, onclose, title = '', children }: {
    open: boolean;
    onclose: () => void;
    title?: string;
    children: Snippet;
  } = $props();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!-- Backdrop -->
  <button
    class="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
    onclick={onclose}
    aria-label="Close panel"
    style="cursor: default;"
  ></button>

  <!-- Panel -->
  <div
    class="fixed top-0 right-0 bottom-0 z-50 w-full sm:w-[420px] overflow-y-auto"
    style="background: var(--bg); border-left: 1px solid var(--card-border); animation: slideIn 0.25s ease-out;"
  >
    <!-- Header -->
    <div class="sticky top-0 z-10 flex items-center justify-between p-5" style="background: var(--bg); border-bottom: 1px solid var(--card-border);">
      <h2 class="text-[10px] uppercase tracking-[0.3em]" style="color: var(--text-ghost); font-family: var(--font-mono);">
        {title}
      </h2>
      <button
        onclick={onclose}
        class="text-lg leading-none px-2 py-1 rounded hover:bg-black/5 transition-colors"
        style="color: var(--text-ghost);"
        aria-label="Close"
      >×</button>
    </div>

    <!-- Content -->
    <div class="p-5">
      {@render children()}
    </div>
  </div>
{/if}

<style>
  @keyframes slideIn {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
  }
</style>
