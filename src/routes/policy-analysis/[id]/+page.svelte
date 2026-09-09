<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import type { PageData } from './$types';
  import type { Kind } from '$lib/policy-analysis/contracts';
  import ArtefactValue from '$lib/components/policy-analysis/ArtefactValue.svelte';
  import PolicyGraph from '$lib/components/policy-analysis/PolicyGraph.svelte';
  let { data }: { data: PageData } = $props();
  const sections: { name: string; kinds: Kind[] }[] = [
    { name: 'Overview', kinds: ['finding'] }, { name: 'Findings', kinds: ['finding', 'assumption'] },
    { name: 'Claims and mechanisms', kinds: ['claim', 'mechanism', 'passage'] },
    { name: 'Actors and incentives', kinds: ['actor', 'profile', 'alias', 'resolution_candidate'] },
    { name: 'Knowledge graph', kinds: ['node', 'edge'] }, { name: 'Evidence', kinds: ['evidence', 'research_question', 'research_source'] },
    { name: 'Game-theoretic models', kinds: ['model'] }, { name: 'Automated tests', kinds: ['test'] },
    { name: 'Scenarios', kinds: ['scenario'] }, { name: 'Recommendations', kinds: ['recommendation'] },
    { name: 'Run log and provenance', kinds: [] },
  ];
  let tab = $state('Overview'); let search = $state(''); let selectedId = $state<string | null>(null);
  let busy = $state(false); let message = $state(''); let refreshError = $state(''); let now = $state(Date.now());
  let audit = $state<unknown>(null);
  const active = $derived(['queued', 'running'].includes(data.analysis.status));
  const completed = $derived(data.stages.filter((s) => s.status === 'completed').length);
  const selected = $derived(data.artefacts.find((a) => a.id === selectedId));
  const provenance = $derived(data.artefactMetadata.find((a) => a.id === selectedId));
  const warnings = $derived(data.stages.flatMap((s) => s.warnings.map((w) => `${s.ordinal + 1}. ${w}`)));
  const reportOrder = ['executive_assessment', 'scope_methodology', 'objectives', 'actors', 'mechanisms', 'high_risk_assumptions', 'test_results', 'strategic_responses', 'scenarios', 'evidence_gaps', 'confidence_uncertainty', 'distribution', 'unresolved_questions'];
  const filtered = $derived(data.artefacts.filter((a) => sections.find((s) => s.name === tab)?.kinds.includes(a.kind) && (!search || `${a.label} ${a.statement}`.toLowerCase().includes(search.toLowerCase()))).sort((a, b) => tab === 'Overview' ? reportOrder.indexOf(String(a.data.section)) - reportOrder.indexOf(String(b.data.section)) : 0));
  const fmt = (v: Date | string | null) => v ? new Date(v).toLocaleString() : 'Not yet';
  function inspect(id: string) { selectedId = id; window.history.replaceState(null, '', `#${encodeURIComponent(id)}`); void tick().then(() => { document.getElementById('policy-inspector')?.scrollIntoView({ block: 'start' }); document.getElementById('policy-inspector')?.focus({ preventScroll: true }); }); }
  async function refresh() { try { await invalidateAll(); refreshError = ''; } catch { refreshError = 'Progress could not refresh. The background run is independent of this connection.'; } }
  onMount(() => {
    selectedId = decodeURIComponent(window.location.hash.slice(1)) || null;
    let stopped = false;
    const timer = setInterval(() => { now = Date.now(); }, 1000);
    async function poll() { if (stopped) return; if (active && !document.hidden) await refresh(); if (!stopped) polling = setTimeout(poll, 6000); }
    let polling = setTimeout(poll, 6000);
    return () => { stopped = true; clearInterval(timer); clearTimeout(polling); };
  });
  async function control(action: 'cancel' | 'resume') {
    busy = true; message = '';
    try {
      const response = await fetch(`/api/policy-analysis/${data.analysis.id}/${action}`, { method: 'POST' });
      if (!response.ok) { message = (await response.json()).error ?? 'Could not update this run.'; return; }
      await refresh();
    } catch { message = 'Connection interrupted. Refresh to check the saved run state.'; }
    finally { busy = false; }
  }
  async function showAudit(id: string) {
    try {
      const response = await fetch(`/api/policy-analysis/${data.analysis.id}/audit?call=${id}`);
      if (!response.ok) throw new Error();
      audit = await response.json();
    } catch { message = 'Could not load this model call.'; }
  }
</script>
<svelte:head><title>{data.analysis.title} — Policy analysis</title><meta name="robots" content="noindex,nofollow" /></svelte:head>
<a href="/policy-analysis">← All policy analyses</a>
<h1>{data.analysis.title}</h1>
<p class="eyebrow">{data.analysis.jurisdiction ?? 'Jurisdiction not specified'} · {data.analysis.policyArea ?? 'Policy assessment'}</p>
<section class="progress" aria-label="Analysis progress">
  <div class="toolbar"><strong role="status">{data.analysis.status.replaceAll('_', ' ')}</strong><span>{completed} / {data.stages.length} stages complete</span><button class="nm-save-btn" onclick={refresh}>Refresh</button>
    {#if active}<button class="nm-save-btn" disabled={busy} onclick={() => control('cancel')}>Cancel run</button>{/if}
    {#if ['failed', 'cancelled'].includes(data.analysis.status)}<button class="nm-save-btn" disabled={busy} onclick={() => control('resume')}>Resume incomplete stages</button>{/if}
  </div>
  <progress max={data.stages.length} value={completed} aria-label="Completed stages"></progress>
  <p class="muted">Elapsed {Math.max(0, Math.floor(((data.analysis.completedAt ? new Date(data.analysis.completedAt).getTime() : now) - new Date(data.analysis.createdAt).getTime()) / 60000))} min · Last update {fmt(data.heartbeat ?? data.analysis.updatedAt)}</p>
  {#if active}<p>You can leave this page. Progress is saved between stages and recovers after worker restarts. This page refreshes while visible.</p>{/if}
  {#if completed < data.stages.length}<p class="warning">Partial work: the assessment is incomplete until all stages finish. Available artefacts are shown below.</p>{/if}
  {#if data.analysis.error}<p class="warning" role="alert">{data.analysis.error}</p>{/if}
  {#if message || refreshError}<p class="warning" role="alert">{message || refreshError}</p>{/if}
  <details open={completed < data.stages.length}><summary>Stage progress and timing</summary>
    <ol class="stages">{#each data.stages as stage}<li><strong>{stage.name}</strong><span>{stage.status === 'pending' ? 'Not yet completed' : stage.status} · attempts {stage.attempts}</span>{#if stage.startedAt}<span class="muted">Started {fmt(stage.startedAt)}{#if stage.completedAt} · finished {fmt(stage.completedAt)}{/if}</span>{/if}{#if stage.error}<span class="warning">{stage.error}</span>{/if}</li>{/each}</ol>
  </details>
  {#if warnings.length}<details open><summary>{warnings.length} extraction or evidence warnings</summary><ul>{#each warnings as warning}<li>{warning}</li>{/each}</ul></details>{/if}
</section>
<nav class="tabs" aria-label="Assessment sections">{#each sections as section}<button class:current={tab === section.name} aria-pressed={tab === section.name} onclick={() => { tab = section.name; search = ''; }}>{section.name}</button>{/each}</nav>
{#if selected}
  <aside id="policy-inspector" tabindex="-1" class="inspector" aria-label="Artefact and evidence inspector">
    <div class="toolbar"><strong>{selected.label}</strong><button class="nm-save-btn" onclick={() => selectedId = null}>Close inspector</button></div>
    <div class="eyebrow">{selected.kind.replaceAll('_', ' ')} · {selected.origin.replaceAll('_', ' ')}</div>
    <p>{selected.statement}</p>
    {#if provenance}<p class="muted">Created in stage {provenance.stage + 1} · updated {fmt(provenance.updatedAt)}</p>{/if}<p class="muted">Confidence: {selected.confidence === null ? 'unknown' : `${Math.round(selected.confidence * 100)}% (model or extraction confidence; not a calibrated probability)`} · {selected.id}</p>
    {#if selected.page || selected.section}<p class="muted">{selected.page ? `Page ${selected.page} · ` : ''}{selected.section ?? ''}{selected.startOffset !== null ? ` · text offsets ${selected.startOffset}–${selected.endOffset}` : ''}</p>{/if}
    {#if selected.sourceQuote}<blockquote>{selected.sourceQuote}</blockquote>{/if}
    {#if selected.url}<a href={selected.url} target="_blank" rel="noopener noreferrer">Open external source</a>{/if}
    <div class="toolbar">{#each selected.refs as ref}<button class="reference" onclick={() => inspect(ref)}>↗ {data.artefacts.find((a) => a.id === ref)?.label ?? ref}</button>{/each}</div>
    <details><summary>Structured fields</summary><ArtefactValue value={selected.data} all={data.artefacts} {inspect} /></details>
  </aside>
{/if}
<h2>{tab}</h2>
{#if tab === 'Knowledge graph'}<PolicyGraph artefacts={data.artefacts} {inspect} />
{:else if tab === 'Run log and provenance'}
  <p>Every completed stage has an immutable execution record. Model calls retain prompt version, inputs, outputs, provider and reported usage. Provider secrets and raw errors are excluded.</p>
  {#each data.documents as document}<div class="ruled"><a href={`/api/policy-analysis/${data.analysis.id}/document`}>Download {document.filename}</a><p class="muted">{document.mimeType} · {document.size.toLocaleString()} bytes · SHA-256 {document.sha256}</p><details><summary>Document structure and extraction metadata</summary><ArtefactValue value={document.metadata} all={data.artefacts} {inspect} /></details></div>{/each}
  {#each data.executions as execution}<div class="ruled"><strong>{data.stages.find((s) => s.id === execution.stageId)?.name}</strong><p class="muted">{execution.status} · {fmt(execution.startedAt)} → {fmt(execution.completedAt)}</p>{#if execution.error}<p>{execution.error}</p>{/if}</div>{/each}
  {#each data.calls as call}<div class="ruled"><button class="reference" onclick={() => showAudit(call.id)}>{call.callKey} · {call.status}</button><p class="muted">{call.promptVersion} · {call.provider ?? 'Provider not reported'} · {call.model ?? 'Model not resolved'} · {fmt(call.startedAt)}</p><details><summary>Token and cost accounting</summary><pre>{JSON.stringify(call.usage, null, 2)}</pre></details></div>{/each}
  {#if audit}<details open><summary>Model call audit</summary><pre>{JSON.stringify(audit, null, 2)}</pre></details>{/if}
{:else}
  {#if tab === 'Overview'}<p class="muted">This assessment separates paper statements, external evidence, structural inferences, behavioural hypotheses, model results and normative recommendations. Confidence values describe extraction or analyst judgement, not measured probabilities.</p>{/if}
  <label for="artefact-search" class="muted">Search this section</label><input id="artefact-search" class="nm-text-input" type="search" bind:value={search} />
  {#each filtered as item}
    <article class="ruled">
      <div class="eyebrow">{item.origin.replaceAll('_', ' ')}{#if item.kind === 'finding'} · {String(item.data.section).replaceAll('_', ' ')}{/if}</div>
      <h3>{item.label}</h3>
      {#if item.kind === 'test'}<strong>{String(item.data.result).replaceAll('_', ' ')}</strong>{/if}
      <p>{item.statement}</p>
      <div class="toolbar"><button class="reference" onclick={() => inspect(item.id)}>Inspect artefact and evidence ({item.refs.length})</button><span class="muted">Confidence {item.confidence === null ? 'unknown' : `${Math.round(item.confidence * 100)}%`}</span></div>
      {#if ['profile', 'model', 'test', 'scenario', 'recommendation', 'evidence'].includes(item.kind)}<details><summary>Details</summary><ArtefactValue value={item.data} all={data.artefacts} {inspect} /></details>{/if}
    </article>
  {:else}<p class="muted">{search ? 'No matching artefacts.' : 'No artefacts in this section yet. Follow stage progress above.'}</p>{/each}
{/if}
<style>
  .progress { border-top: 2px solid var(--text-primary); border-bottom: 2px solid var(--text-primary); padding: .5rem 0 1rem; }
  progress::-webkit-progress-bar { background: var(--surface-sunken); }
  progress::-webkit-progress-value { background: var(--accent); }
  progress::-moz-progress-bar { background: var(--accent); }
  progress { width: 100%; height: .65rem; accent-color: var(--accent); }
  summary { cursor: pointer; padding: .7rem 0; font-weight: 600; }
  .stages { padding-left: 1.5rem; } .stages li { border-bottom: 1px solid var(--line); padding: .6rem 0; } .stages span { display: block; margin-top: .3rem; }
  .tabs { display: flex; flex-wrap: wrap; margin-top: 1.5rem; border-bottom: 1px solid var(--line-strong); }
  .tabs button { font: inherit; font-size: var(--fs-label); background: var(--surface-sunken); border: 1px solid var(--line); padding: .7rem .9rem; cursor: pointer; }
  .tabs .current { background: var(--text-primary); color: var(--bg); }
  .inspector { margin-top: 1.5rem; padding: 1.2rem; border: 2px solid var(--accent-ink); background: var(--surface-sunken); overflow-wrap: anywhere; }
  .reference { font: inherit; color: var(--accent-ink); text-decoration: underline; background: none; border: 0; cursor: pointer; text-align: left; padding: .2rem 0; overflow-wrap: anywhere; }
  h3 { font-size: var(--fs-body-lg); font-weight: 700; margin: .5rem 0; }
  blockquote { border-left: 2px solid var(--accent); padding-left: 1rem; white-space: pre-wrap; }
  pre { max-height: 32rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--font-code); font-size: var(--fs-label); }
</style>
