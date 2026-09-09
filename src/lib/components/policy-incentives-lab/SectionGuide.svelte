<script lang="ts">
  import { SECTION_GUIDES } from '$lib/policy-incentives-lab/onboarding';
  let { section }: { section: string } = $props();
  const guide = $derived(SECTION_GUIDES[section]);
</script>
{#if guide}<aside class="guide" aria-label="Section guidance">
  <h2>{guide.title}</h2><p>{guide.explanation}</p>
  <p><strong>Your next step:</strong> {guide.task}</p>
  <details><summary>Show a simple example and what comes next</summary><p><strong>Fictional example:</strong> {guide.example}</p><p>{guide.next}</p></details>
</aside>{/if}
<style>.guide { border-left: 3px solid var(--accent-ink); background: var(--surface-sunken); padding: 16px 20px; margin-block: 20px; } h2 { margin-top: 0; } p { max-width: 80ch; line-height: 1.6; } summary { cursor: pointer; color: var(--accent-ink); }</style>
