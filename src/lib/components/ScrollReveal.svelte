<script lang="ts">
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();

  let element: HTMLElement;
  let revealed = $state(false);

  onMount(() => {
    // Start revealed immediately if already in viewport
    const rect = element.getBoundingClientRect();
    if (rect.top < window.innerHeight) {
      revealed = true;
      return;
    }

    function onScroll() {
      const rect = element.getBoundingClientRect();
      if (rect.top < window.innerHeight - 50) {
        revealed = true;
        window.removeEventListener('scroll', onScroll);
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  });
</script>

<div
  bind:this={element}
  class={revealed ? 'sr-visible' : 'sr-hidden'}
>
  {@render children()}
</div>

<style>
  .sr-hidden {
    opacity: 0;
    transform: translateY(20px);
    transition: opacity 0.8s ease-out, transform 0.8s ease-out;
  }
  .sr-visible {
    opacity: 1;
    transform: translateY(0);
    transition: opacity 0.8s ease-out, transform 0.8s ease-out;
  }
</style>
