<svelte:options css="injected" />

<script lang="ts">
  // A small reading's figure: the number, or a pencilled dash that a screen
  // reader skips in favour of the words said instead.
  import type { Fig } from '$lib/landing/showcase-notes';

  let { f }: { f: Fig } = $props();
</script>

{#if f.n != null}<span class="sn-n">{f.value}</span>{:else}<span class="sn-n sn-dash" aria-hidden="true">—</span><span class="vh">{f.spoken}</span>{/if}

<style>
  .sn-dash {
    font-family: var(--fs-serif);
    font-weight: 400;
    color: var(--text-muted);
  }
</style>
