<script lang="ts">
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();

  let element: HTMLElement;
  let visible = $state(false);

  onMount(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          visible = true;
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(element);
    return () => observer.disconnect();
  });
</script>

<div
  bind:this={element}
  class="transition-all duration-700 ease-out {visible
    ? 'opacity-100 translate-y-0'
    : 'opacity-0 translate-y-5'}"
>
  {@render children()}
</div>
