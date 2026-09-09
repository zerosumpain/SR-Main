<script lang="ts">
  import { onMount } from 'svelte';
  let ready = $state(false);
  onMount(() => { ready = true; });
  import { POLICY_EXAMPLES, EXAMPLES_CHECKED, type PolicyExample } from '$lib/policy-incentives-lab/examples';
  let { choose, busy = false }: { choose: (example: PolicyExample) => void; busy?: boolean } = $props();
</script>
<section aria-label="Published policy examples">
  <h2>Start with a published GOV.UK policy</h2>
  <p>These links are real publications, not pre-approved models. Titles, dates and links were checked on {EXAMPLES_CHECKED}. Historical papers may describe rules that have since changed. Review the edition you load.</p>
  {#each POLICY_EXAMPLES as example}<article>
    <div><p class="topic">{example.topic} · {example.edition}</p><h3>{example.title}</h3><p>{example.question}</p><p>{example.publisher} · first published {example.publication_date}</p></div>
    <div class="actions"><a href={example.source_url} target="_blank" rel="noopener noreferrer">Read on GOV.UK ↗</a><button disabled={busy || !ready} onclick={() => choose(example)}>Use these publication details</button></div>
  </article>{/each}
  <p>We save the publication details first. Paste the policy text or upload the document to analyse it. The questions above are learning prompts, not findings about these policies.</p>
</section>
<style>article { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 20px; padding: 18px 0; border-top: 1px solid var(--line); } h3 { margin: 4px 0; } p { margin: 6px 0; line-height: 1.5; } .topic { font-size: var(--fs-label); color: var(--text-muted); } .actions { display: flex; flex-direction: column; justify-content: center; align-items: flex-start; gap: 10px; } @media(max-width: 700px) { article { grid-template-columns: minmax(0, 1fr); gap: 4px; } }</style>
