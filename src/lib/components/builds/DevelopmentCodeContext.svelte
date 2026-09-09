<script lang="ts">

  let { buildId, revision = null }: { buildId: string; revision?: string | null } = $props();
  let data = $state<any>(null); let busy = $state(false); let error = $state('');
  let source = $state<{ file: string; text: string; revision: string; truncated: boolean } | null>(null);
  async function openSource(file: string) { try { const r = await fetch(`/api/jkai/development/${buildId}/context?file=${encodeURIComponent(file)}`); const value = await r.json(); if (!r.ok) throw new Error(value.message ?? 'Source unavailable'); source = value; } catch (e) { error = String(e); } }
  let target = $state(''); let verdict = $state('pin'); let reason = $state('');
  async function load(body?: Record<string, unknown>) {
    busy = true; error = '';
    try {
      const response = await fetch(`/api/jkai/development/${buildId}/context`, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
      const result = await response.json(); if (!response.ok) throw new Error(result.message ?? result.error ?? 'Code context unavailable'); data = result;
    } catch (e) { error = e instanceof Error ? e.message : String(e); } finally { busy = false; }
  }

  $effect(() => { revision; void load(); });
</script>
<details class="context">
  <summary>Code context <span>{data?.status ?? 'loading'}{data?.files?.length ? ` · ${data.files.length} files` : ''}</span></summary>
  <p class="muted">Repository evidence for this brief and candidate. Reference material must be checked against current code.</p>
  <div class="actions"><button disabled={busy} onclick={() => load()}>Reload evidence</button><button disabled={busy} onclick={() => load({ action: 'refresh' })}>Index saved workspace</button><a href="/jkai/codegraph/ask">Ask CodeGraph</a><a href="/jkai/codegraph/serves?build={buildId}">Retrieval history</a></div>
  {#if error}<p role="alert">{error}</p>{/if}
  {#if data}
    {#if data.snapshot}<p class="muted">{data.snapshot.scope} · <code>{data.snapshot.revision.slice(0, 12)}</code> · {new Date(data.snapshot.createdAt).toLocaleString()} · {data.snapshot.fileCount} files · {data.snapshot.unresolved} unresolved imports</p>{:else}<p>No structural snapshot is available. Index a saved workspace or continue with direct source inspection.</p>{/if}
    {#if data.status === 'stale'}<p role="status">This index describes a different revision. Refresh before relying on its relationships.</p>{/if}
    <div class="columns">
      <section><h3>Relevant files</h3>{#if !data.files.length}<p>No files resolved from this brief yet.</p>{/if}<ul>{#each data.files.slice(0, 20) as file}<li><a href="/jkai/codegraph/ask?q={encodeURIComponent(`file:${file} | hops 1`)}"><code>{file}</code></a><button aria-label={`Open source ${file}`} onclick={() => openSource(file)}>Source</button><button aria-label={`Pin ${file}`} onclick={() => { target = file; verdict = 'pin'; }}>Pin</button></li>{/each}</ul></section>
      <section><h3>Impact and checks</h3>{#if data.impact}<p>{data.impact.coverage}</p><p><strong>Depends on:</strong> {data.impact.uses.slice(0, 12).join(', ') || 'None indexed'}</p><p><strong>Used by:</strong> {data.impact.dependants.slice(0, 12).join(', ') || 'None indexed'}</p><p><strong>Suggested tests:</strong> {data.impact.tests.join(', ') || 'Coverage unknown'}</p><p><strong>Routes:</strong> {data.impact.routes.map((r: any) => r.route).join(', ') || 'None resolved'}</p>{#each data.impact.dependencies.slice(0, 8) as dependency}<p><code>{dependency.name}@{dependency.version ?? 'unknown'}</code> · {dependency.license ?? 'Licence not recorded'}</p>{/each}{:else}<p>Dependency and test coverage is unknown.</p>{/if}</section>
    </div>
    {#if data.overlaps.length}<section><h3>Combined batch risks</h3>{#each data.overlaps as overlap}<p><a href="/jkai/develop/{overlap.buildId}">{overlap.title}</a>: {overlap.files.join(', ')}</p>{/each}<p>Shared files are a review signal. Acceptance still requires combined-tree checks.</p></section>{/if}
    {#if data.sources.length}<details><summary>Available external references</summary>{#each data.sources.slice(0, 10) as reference}<p><a href={reference.url}>{reference.title}</a> · {reference.revision} · {reference.license} <button onclick={() => { target = reference.id; verdict = 'pin'; }}>Pin reference</button></p>{/each}<a href="/jkai/codegraph/sources">Manage sources</a></details>{/if}
    {#if source}<section aria-label="Source viewer"><h3>{source.file}</h3><p>Revision <code>{source.revision.slice(0, 12)}</code>{source.truncated ? " · excerpt limited to 24,000 characters" : ""}</p><button onclick={() => source = null}>Close source</button><pre>{source.text}</pre></section>{/if}
    <details><summary>What the agent received</summary>{#each data.history.slice(0, 5) as query}<article><p>{query.channel} · {query.outcome} · {query.charsServed} characters · {query.evidence?.revision?.slice(0, 12) ?? 'revision not recorded'}</p><pre>{query.evidence?.block ?? query.errorMessage ?? 'Exact prompt text was not recorded by this older retrieval.'}</pre><p>Lessons: {query.lessonIds.join(', ') || 'none'} · omitted: {query.evidence?.omittedLessonIds?.length ?? 'unknown'}</p><p>{query.evidence?.observation?.interpretation ?? 'Outcome not yet observed.'}</p></article>{:else}<p>No retrieval has been recorded for this build.</p>{/each}</details>
    <details><summary>Pin or assess evidence</summary><form onsubmit={(e) => { e.preventDefault(); void load({ targetId: target, verdict, evidence: reason, revision: data.candidate }); }}><label>File path or evidence ID<input bind:value={target} required maxlength="1000" /></label><label>Assessment<select bind:value={verdict}><option value="pin">Pin for this build</option><option value="unpin">Remove pin</option><option value="stale">Needs revalidation</option><option value="irrelevant">Irrelevant</option><option value="useful">Useful</option></select></label><label>Reason<textarea bind:value={reason} required maxlength="2000"></textarea></label><button disabled={busy}>Save assessment</button></form>{#each data.assessments as assessment}<p>{assessment.verdict}: <code>{assessment.targetId}</code> — {assessment.evidence}</p>{/each}</details>
  {/if}
</details>
<style>
  .context { border-block: 1px solid var(--line-strong); padding: 0.8rem 0; margin-block: 1rem; min-width: 0; }
  summary { font-weight: 600; cursor: pointer; } summary span { color: var(--text-secondary); font-weight: 400; margin-left: 0.5rem; }
  .muted { color: var(--text-secondary); } .actions { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; }
  .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; } section, article { min-width: 0; overflow-wrap: anywhere; }
  h3 { font-size: var(--fs-body); } ul { list-style: none; padding: 0; } li { display: flex; gap: 0.5rem; justify-content: space-between; padding-block: 0.4rem; border-bottom: 1px solid var(--line); }
  li a { flex: 1; min-width: 0; } li button { flex-shrink: 0; white-space: nowrap; align-self: flex-start; }
  code, pre { font-family: var(--font-code); font-size: var(--fs-label); overflow-wrap: anywhere; } pre { white-space: pre-wrap; max-height: 20rem; overflow: auto; }
  button, input, select, textarea { font: inherit; color: var(--text-primary); background: var(--surface-card); border: 1px solid var(--line-strong); padding: 0.4rem; } button { cursor: pointer; } button:disabled { opacity: 0.5; }
  form { display: grid; gap: 0.6rem; margin-block: 0.6rem; } label { display: grid; gap: 0.3rem; } input, textarea { min-width: 0; width: 100%; box-sizing: border-box; }
  a { color: var(--accent-ink); } details details { margin-block: 0.7rem; } [role=alert] { color: var(--error); }
  @media (max-width: 800px) { .columns { grid-template-columns: 1fr; } }
</style>
