<script lang="ts">
  import { goto } from '$app/navigation';
  import SectionGuide from '$lib/components/policy-incentives-lab/SectionGuide.svelte';
  import PolicyExamples from '$lib/components/policy-incentives-lab/PolicyExamples.svelte';
  import type { PolicyExample } from '$lib/policy-incentives-lab/examples';
  let { data } = $props();
  let title = $state(''); let busy = $state(false); let message = $state('');
  async function create(example?: PolicyExample) {
    busy = true; message = '';
    try {
      const response = await fetch('/api/policy-incentives-lab/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: example?.title ?? title }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      await goto(`/policy-incentives-lab/${result.id}?step=evidence${example ? `&example=${example.id}` : ''}`);
    } catch (e) { message = (e as Error).message; } finally { busy = false; }
  }
</script>
<h1>Policy Incentives Lab</h1>
<p>Explore how approved assumptions about incentives change the outcome of a policy model. Evidence, assumptions and calculated results remain separate.</p>
<SectionGuide section="projects" />
<PolicyExamples {busy} choose={example => { void create(example); }} />
<h2>Or start your own analysis</h2>
<form onsubmit={(e) => { e.preventDefault(); void create(); }} class="nm-sec">
  <label>Analysis title <input class="nm-text-input" bind:value={title} maxlength="200" required /></label>
  <button disabled={busy || !title.trim()}>Create private analysis</button>
</form>
{#if message}<p role="alert" class="error">{message}</p>{/if}
<h2>Saved analyses</h2>
{#each data.projects as project}
  <p><a href={`/policy-incentives-lab/${project.id}`}>{project.title}</a> · {project.model_status}<br />{project.source_title ?? "No policy source"} · draft revision {project.revision} · updated {new Date(project.updatedAt).toLocaleString()}</p>
{:else}<p>No analyses yet. Create one and load the clearly labelled synthetic example to explore the full workflow offline.</p>{/each}
