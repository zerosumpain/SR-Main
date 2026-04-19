<script lang="ts">
  import type { Snippet } from 'svelte';
  let { children }: { children: Snippet } = $props();
</script>

<div class="min-h-screen bg-gray-950 text-gray-100">
  {@render children()}
</div>
