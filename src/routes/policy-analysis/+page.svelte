<script lang="ts">
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  let busy = $state(false); let message = $state('');
  async function submit(event: SubmitEvent) {
    event.preventDefault(); if (busy) return;
    const form = event.currentTarget as HTMLFormElement;
    busy = true; message = '';
    try {
      const response = await fetch('/api/policy-analysis', { method: 'POST', body: new FormData(form) });
      const result = await response.json();
      if (!response.ok) { message = result.error ?? 'Could not submit the policy.'; return; }
      await goto(`/policy-analysis/${result.id}`);
    } catch { message = 'Connection interrupted. Check recent analyses before submitting again.'; }
    finally { busy = false; }
  }
</script>
<svelte:head><title>Policy analysis — Strange Ramblings</title><meta name="robots" content="noindex,nofollow" /></svelte:head>
<div class="eyebrow">Policy · Evidence · Strategic behaviour</div>
<h1>What happens when<br />the policy meets its actors?</h1>
<p>Submit a policy paper for an autonomous game-theoretic assessment of its mechanisms, incentives and assumptions. Inspect the evidence, actor profiles, knowledge graph, policy tests, adversarial scenarios and redesign options behind every conclusion.</p>
<p class="muted">Your document stays private to your account. Analysis uses the site’s configured model provider and targeted public web research. Extracted claims, external evidence and model hypotheses are labelled separately. You can leave and return while it runs.</p>
<form onsubmit={submit} class="submission">
  <label for="title">Policy title</label><input class="nm-text-input" id="title" name="title" required maxlength="240" />
  <label for="document">Upload a policy document</label><input class="nm-text-input" id="document" name="document" type="file" accept=".pdf,.docx,.txt" />
  <span class="muted">PDF, DOCX or UTF-8 TXT · up to 10 MB, 400 PDF pages and 600,000 extracted characters. Scanned PDFs may need OCR before submission.</span>
  <label for="text">Or paste the policy text</label><textarea class="nm-text-input" id="text" name="text" rows="9" maxlength="600000"></textarea>
  <details><summary>Jurisdiction, policy area and context (optional)</summary>
    <div class="optional">
      <label for="jurisdiction">Jurisdiction</label><input class="nm-text-input" id="jurisdiction" name="jurisdiction" maxlength="200" />
      <label for="policyArea">Policy area</label><input class="nm-text-input" id="policyArea" name="policyArea" maxlength="200" />
      <label for="context">Context for the assessment</label><textarea class="nm-text-input" id="context" name="context" maxlength="5000" rows="3"></textarea>
    </div>
  </details>
  {#if message}<p class="warning" role="alert">{message}</p>{/if}
  {#if !data.enabled}<p class="warning">New analyses are currently disabled.</p>{/if}
  <div><button class="nm-save-btn" disabled={busy || !data.enabled}>{busy ? 'Submitting…' : 'Start analysis'}</button></div>
</form>
<h2>Your analyses</h2>
{#each data.analyses as analysis}
  <div class="ruled"><a href={`/policy-analysis/${analysis.id}`}>{analysis.title}</a><div class="muted">{analysis.status.replaceAll('_', ' ')} · {new Date(analysis.createdAt).toLocaleString()}</div></div>
{:else}<p class="muted">Your first assessment will appear here. Completed work and interrupted runs remain available.</p>{/each}
<style>
  .submission { display: grid; gap: .75rem; border-top: 2px solid var(--text-primary); margin-top: 2rem; padding-top: 1.5rem; max-width: 900px; }
  label { font-weight: 600; margin-top: .5rem; } .optional { display: grid; gap: .6rem; margin-top: 1rem; }
  summary { cursor: pointer; padding: .5rem 0; } textarea { resize: vertical; }
</style>
