<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { LIBRARY_TYPES, type LibraryPage, type LibraryContent } from '$lib/policy-incentives-lab/library';
  let { busy = false, choose }: { busy?: boolean; choose: (content: LibraryContent) => void } = $props();
  let q = $state(''); let kind = $state('policy'); let organisation = $state(''); let result = $state<LibraryPage>();
  let selected = $state<LibraryContent>(); let loading = $state(false); let message = $state(''); let generation = 0; let previewElement = $state<HTMLElement>();
  async function search(start = 0) {
    const request = ++generation; loading = true; message = ''; selected = undefined;
    try { const response = await fetch(`/api/policy-incentives-lab/library?${new URLSearchParams({ q, kind, organisation, start: String(start) })}`); const data = await response.json(); if (!response.ok) throw new Error(data.error); if (generation === request) result = data; }
    catch (e) { if (generation === request) { message = (e as Error).message; result = undefined; } } finally { if (generation === request) loading = false; }
  }
  async function inspect(path: string, document = 0) {
    const request = ++generation; loading = true; message = ''; selected = undefined;
    try { const response = await fetch(`/api/policy-incentives-lab/library/content?${new URLSearchParams({ path, document: String(document) })}`); const data = await response.json(); if (!response.ok) throw new Error(data.error); if (generation === request) { selected = data; await tick(); previewElement?.scrollIntoView({ block: 'start' }); } }
    catch (e) { if (generation === request) message = (e as Error).message; } finally { if (generation === request) loading = false; }
  }
  onMount(() => { void search(); return () => { generation++; }; });
</script>
<section aria-label="GOV.UK policy library" class="library">
  <h2>GOV.UK policy library</h2>
  <p>Search the full live index of policy papers, or widen to consultations, guidance and regulation. Choose a publication to load its details and policy text.</p>
  <p class="scope">Coverage is GOV.UK’s indexed publications, including historical editions—not a register of every policy in force or material published only on other government sites.</p>
  <form onsubmit={e => { e.preventDefault(); void search(); }}>
    <label>Search policies <input bind:value={q} maxlength="300" placeholder="For example, housing or transport" /></label>
    <label>Publication type <select bind:value={kind}>{#each Object.entries(LIBRARY_TYPES) as [value, type]}<option {value}>{type.label}</option>{/each}</select></label>
    <details><summary>Filter by department</summary><label>GOV.UK organisation slug <input bind:value={organisation} placeholder="department-for-transport" pattern="[a-z0-9-]*" maxlength="150" /></label><p>Use the last part of its GOV.UK organisation URL. Leave blank for all publishers.</p></details>
    <button disabled={loading || busy}>Search library</button>
  </form>
  {#if busy}<p role="status">Importing the selected policy and preparing its first look…</p>{/if}
  {#if loading}<p role="status">Loading official publication content… PDF documents can take longer.</p>{/if}
  {#if message}<p role="alert">{message}</p><button disabled={busy || loading} onclick={() => search()}>Retry library</button><p>You can still paste or upload a public document below.</p>{/if}
  {#if selected}
    <section class="preview" aria-label="Selected policy content" bind:this={previewElement}>
      <h3>{selected.title}</h3>
      <p>{selected.publisher} · published {selected.publication_date ?? 'date unknown'} · updated {selected.updated?.slice(0, 10) ?? 'date unknown'}</p>
      <a href={selected.source_url} target="_blank" rel="noreferrer">Open publication on GOV.UK</a>
      {#if selected.documents.length > 1}<label>Policy document to load <select value={selected.selected} disabled={loading || busy} onchange={e => selected && inspect(selected.path, Number(e.currentTarget.value))}>{#each selected.documents as doc, i}<option value={i}>{doc.title} ({doc.format}{doc.supported ? '' : '; manual upload required'})</option>{/each}</select></label>{/if}
      {#each selected.warnings as warning}<p role="note">{warning}</p>{/each}
      <p>{selected.sections.reduce((n, s) => n + s.text.length, 0).toLocaleString()} characters loaded · retrieved {new Date(selected.retrieved_at).toLocaleString()}</p>
      <details open><summary>Policy text loaded from the selected document</summary><div class="source-text">{#each selected.sections as section}<h4>{section.location}</h4><pre>{section.text}</pre>{/each}</div></details>
      <button disabled={loading || busy || !selected.sections.length} onclick={() => selected && choose(selected)}>Use this policy and its text</button>
      <p>This saves the selected public document and starts an unreviewed first look. Check the document and edition before modelling it.</p>
    </section>
  {/if}
  {#if result}
    <p role="status">{result.total.toLocaleString()} publications · showing {result.total ? result.start + 1 : 0}–{Math.min(result.start + result.entries.length, result.total)} · live search {new Date(result.retrieved_at).toLocaleString()}</p>
    {#each result.entries as entry}<article><h3>{entry.title}</h3><p>{entry.publisher} · {entry.type.replaceAll('_', ' ')} · updated {entry.updated?.slice(0, 10) ?? 'unknown'}</p><p>{entry.description}</p><div class="actions"><button disabled={busy || loading} onclick={() => inspect(entry.path)}>Load policy details and text</button><a href={`https://www.gov.uk${entry.path}`} target="_blank" rel="noreferrer">GOV.UK publication ↗</a></div></article>{:else}<p>No publications match. Try fewer keywords or a broader publication type.</p>{/each}
    <div class="actions"><button disabled={loading || busy || !result.start} onclick={() => result && search(Math.max(0, result.start - result.count))}>Previous publications</button><button disabled={loading || busy || result.start + result.count >= result.total} onclick={() => result && search(result.start + result.count)}>Next publications</button></div>
  {/if}
</section>
<style>
  .library { border-block: 2px solid var(--line-strong); padding-block: 1rem; margin-block: 1rem 2rem; min-width: 0; }
  form, .actions { display: flex; flex-wrap: wrap; gap: 1rem; align-items: end; }
  form label { flex: 1; min-width: min(100%, 220px); } article { padding-block: 1rem; border-top: 1px solid var(--line); }
  .scope { color: var(--text-secondary); } .preview { padding: 1rem; background: var(--surface-sunken); border: 2px solid var(--accent-ink); margin-block: 1rem; }
  .source-text { max-height: 350px; overflow: auto; } pre { white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--font-body); }
  h3, h4, a { overflow-wrap: anywhere; } input, select { max-width: 100%; }
</style>
