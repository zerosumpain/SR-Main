<script lang="ts">
  import { page } from '$app/state';
  import { POLICY_EXAMPLES, type PolicyExample } from '$lib/policy-incentives-lab/examples';
  import SectionGuide from '$lib/components/policy-incentives-lab/SectionGuide.svelte';
  import PolicyExamples from '$lib/components/policy-incentives-lab/PolicyExamples.svelte';
  import FirstLookDashboard from '$lib/components/policy-incentives-lab/FirstLookDashboard.svelte';
  import { invalidateAll, goto } from '$app/navigation';
  import GuidedModel from '$lib/components/policy-incentives-lab/GuidedModel.svelte';
  import ScenarioInputs from '$lib/components/policy-incentives-lab/ScenarioInputs.svelte';
  import ActorMap from '$lib/components/policy-incentives-lab/ActorMap.svelte';
  import ReviewList from '$lib/components/policy-incentives-lab/ReviewList.svelte';
  import ChartArtifact from '$lib/components/jkai/artifacts/ChartArtifact.svelte';
  import { reviewItems, validateModel } from '$lib/policy-incentives-lab/validation';
  import { syntheticCandidate } from '$lib/policy-incentives-lab/synthetic';
  import type { Candidate, RunConfig } from '$lib/policy-incentives-lab/schemas';
  import type { Draft } from '$lib/policy-incentives-lab/server/store';
  import type { Result } from '$lib/policy-incentives-lab/server/engine';
  import type { ChartArtifact as Chart } from '$lib/workflows/site-tools/artifact-types';

  let { data } = $props();
  const project = $derived(data.project);
  const draft = $derived(project.payload);
  const game = $derived(draft.candidate?.game);
  const step = $derived(page.url.searchParams.get('step') ?? 'overview');
  const tabs = [['overview', 'First look'], ['evidence', 'Policy evidence'], ['actors', 'People and organisations'], ['builder', 'Choices and trade-offs'], ['runner', 'Try a scenario'], ['results', 'Results'], ['audit', 'Audit and export']];
  let busy = $state(false); let message = $state(''); let success = $state('');
  let sourceTitle = $state(''); let publisher = $state(''); let publicationDate = $state(''); let sourceUrl = $state(''); let sourceText = $state(''); let publicMaterial = $state(false); let synthetic = $state(false); let upload = $state<HTMLInputElement>();
  function chooseExample(example: PolicyExample) { sourceTitle = example.title; publisher = example.publisher; publicationDate = example.publication_date; sourceUrl = example.source_url; synthetic = false; success = 'Publication details filled in. Paste or upload its text below; check that the edition matches.'; }
  let appliedExample = $state('');
  $effect(() => { const example = POLICY_EXAMPLES.find(e => e.id === page.url.searchParams.get('example')); if (example && appliedExample !== example.id) { appliedExample = example.id; chooseExample(example); } });
  let modelText = $state(''); let selectedActor = $state(''); let selectedVersion = $state(''); let selectedRun = $state('');
  let simulationType = $state<RunConfig['simulation_type']>('normal-form'); let scenario = $state<RunConfig['scenario']>('baseline'); let seed = $state(42); let rounds = $state(20); let parameterText = $state('{}'); let scenarioName = $state(''); let distributionOpen = $state(false);
  let sensitivityText = $state('[]');
  const runnerGame = $derived((data.versions.find(v => v.id === selectedVersion)?.payload as Draft | undefined)?.candidate?.game ?? (data.versions[0]?.payload as Draft | undefined)?.candidate?.game);
  const base = $derived(`/api/policy-incentives-lab/projects/${project.id}`);
  const items = $derived(game ? reviewItems(game) : []);
  const errors = $derived(game && draft.source && draft.candidate ? validateModel(game, draft.candidate.evidence, draft.source) : ['Add a source and candidate model']);
  const relevantItems = $derived(step === 'actors' ? items.filter(i => game?.actors.some(a => a.id === i.id || [...a.objectives, ...a.constraints, ...a.resources, ...a.information_available, ...a.information_hidden].some(s => s.id === i.id))) : step === 'evidence' ? items.filter(i => game && [...game.objectives, ...game.operative_mechanisms, ...game.intended_outcomes].some(s => s.id === i.id)) : items);
  const run = $derived(data.runs.find(r => r.id === selectedRun) ?? data.runs[0]);
  const payload = $derived(run?.payload as { result: Result & { samples?: { assumption_id: string; points: { value: number; result: Result }[]; outcome_ranges: unknown; changes_terminal_profiles: boolean }[]; base?: Result }; config: unknown; result_hash: string; hypotheses?: typeof draft.hypotheses } | undefined);
  const result = $derived(payload?.result.base ?? payload?.result);
  const savedModel = $derived((data.versions.find(v => v.id === run?.versionId)?.payload as Draft | undefined)?.candidate?.game);
  const chartRows = $derived(result ? (result.rounds.length ? result.rounds : result.terminal_outcomes.map((r, i) => ({ ...r, round: i + 1 }))).flatMap(r => Object.entries(r.outcomes).map(([metric, value]) => ({ step: r.round, metric, value }))) : []);
  const chart = $derived({ type: 'chart', title: 'Calculated outcome values', spec: { mark: { type: result?.rounds.length ? 'line' : 'bar', point: true }, encoding: { x: { field: 'step', type: 'ordinal', title: result?.rounds.length ? 'Round' : 'Equilibrium terminal profile' }, y: { field: 'value', type: 'quantitative', title: 'Approved metric units' }, color: { field: 'metric', type: 'nominal' }, row: { field: 'metric', type: 'nominal' } }, resolve: { scale: { y: 'independent' } } }, data: chartRows } as unknown as Chart);
  const distribution = $derived({ type: 'chart', data: chartRows, spec: { mark: 'bar', encoding: { x: { field: 'value', type: 'quantitative', bin: { maxbins: 10 }, title: 'Calculated metric value' }, y: { aggregate: 'count', type: 'quantitative', title: 'Count of rounds/profiles' }, row: { field: 'metric', type: 'nominal' } }, resolve: { scale: { x: 'independent' } } } } satisfies Chart);
  const sensitivityRows = $derived((payload?.result.samples ?? []).flatMap(s => s.points.flatMap(p => p.result.terminal_outcomes.flatMap(r => Object.entries(r.outcomes).map(([metric, value]) => ({ assumption: s.assumption_id, parameter: p.value, metric, value }))))));
  const sensitivityChart = $derived({ type: 'chart', data: sensitivityRows, spec: { mark: { type: 'point', filled: true }, encoding: { x: { field: 'parameter', type: 'quantitative', title: 'Approved parameter value' }, y: { field: 'value', type: 'quantitative', title: 'Calculated outcome' }, color: { field: 'assumption', type: 'nominal' }, row: { field: 'metric', type: 'nominal' } }, resolve: { scale: { y: 'independent' } } } } satisfies Chart);
  function friendlyIssue(issue: string) {
    let text = issue.replace('Approval required:', 'Review and approve:').replace('Assumption not approved by user:', 'Confirm this assumption:').replace('Unknown numerical value:', 'A value is still unknown:').replace('Missing numerical assumption', 'A value is still needed for');
    for (const item of [...items].sort((a, b) => b.id.length - a.id.length)) text = text.replaceAll(item.id, String(item.name ?? item.statement ?? item.id));
    return text;
  }
  async function action(resource: string, body: Record<string, unknown>) {
    busy = true; message = ''; success = '';
    try {
      const response = await fetch(`${base}/${resource}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, revision: project.revision }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error + (value.errors ? '\n' + value.errors.join('\n') : ''));
      success = ['sources', 'uploads'].includes(resource) ? 'Policy saved. Your unreviewed first look is ready.' : 'Saved.'; await invalidateAll(); if (resource === 'sources') await goto('?step=overview'); return value;
    } catch (e) { message = (e as Error).message; await invalidateAll(); return null; } finally { busy = false; }
  }
  async function addSource() {
    const metadata = { title: sourceTitle, publisher, publication_date: publicationDate || null, source_url: sourceUrl, synthetic };
    const file = upload?.files?.[0];
    if (!file) { await action('sources', { metadata, text: sourceText, public_material: publicMaterial }); return; }
    busy = true; message = '';
    try {
      const form = new FormData(); form.set('file', file); form.set('metadata', JSON.stringify(metadata)); form.set('public_material', String(publicMaterial)); form.set('revision', String(project.revision));
      const response = await fetch(`${base}/uploads`, { method: 'POST', body: form }); const result = await response.json();
      if (!response.ok) throw new Error(result.error); await invalidateAll(); success = 'Source saved. Your first look is ready.'; await goto('?step=overview');
    } catch (e) { message = (e as Error).message; } finally { busy = false; }
  }
  async function editItem(id: string, raw: string) {
    try {
      const value = JSON.parse(raw); if (value.id !== id) throw new Error('Keep the item ID when amending. Use the full model editor to restructure.');
      const copy = structuredClone(draft.candidate) as Candidate;
      function replace(v: unknown): void {
        if (!v || typeof v !== 'object') return;
        if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) { if (v[i]?.id === id) v[i] = value; else replace(v[i]); } }
        else Object.values(v).forEach(replace);
      }
      replace(copy.game); await action('model', { candidate: copy });
    } catch (e) { message = (e as Error).message; }
  }
  async function saveModel() { try { await action('model', { candidate: JSON.parse(modelText) }); } catch (e) { message = (e as Error).message; } }
  async function runModel(sweep = false) {
    try {
      const config = { simulation_type: simulationType, scenario, scenario_name: scenarioName, seed, rounds, parameters: JSON.parse(parameterText) };
      const value = await action(sweep ? 'sensitivity' : 'runs', { version_id: selectedVersion || data.versions[0]?.id, ...(sweep ? { sensitivity: { config, ranges: JSON.parse(sensitivityText) } } : { config }) });
      if (value) selectedRun = value.id;
    } catch (e) { message = (e as Error).message; }
  }
</script>

<h1>{project.title}</h1>
<p>Draft revision {project.revision} · {items.filter(i => i.approval_status.status === 'approved').length}/{items.length} items approved · {data.versions.length} immutable model versions · {data.runs.length} saved runs</p>
{#if draft.source?.synthetic}<p class="synthetic"><strong>SYNTHETIC EXAMPLE</strong> — fictional policy, actors and illustrative assumptions.</p>{/if}
<nav aria-label="Analysis workflow">{#each tabs as [key, label]}<a href={`?step=${key}`} aria-current={step === key ? 'page' : undefined}>{label}</a>{/each}</nav>
{#if message}<p role="alert" class="error">{message}</p>{/if}
{#if busy}<p role="status">Saving and preparing your review. A model-assisted first look can take up to a minute.</p>{/if}
{#if success}<p role="status">{success}</p>{/if}

<SectionGuide section={step} />
{#if step === 'overview'}
  {#if draft.first_look}<FirstLookDashboard report={draft.first_look} {base} />{:else}<p>No first look yet. <a href="?step=evidence">Load a policy to start</a>.</p>{/if}
  {#if draft.source}<button disabled={busy} onclick={() => action('first-look', {})}>Refresh first look</button>{/if}
{:else if step === 'evidence'}
  <h2>Policy source</h2>
  <details><summary>Choose a published GOV.UK example</summary><PolicyExamples {busy} choose={chooseExample} /></details>
  <button disabled={busy} onclick={() => action('sources', { synthetic: true })}>Load synthetic Lantern example</button>
  <details open={!draft.source}><summary>Paste or upload a public policy (replaces the draft source)</summary>
    <form onsubmit={e => { e.preventDefault(); void addSource(); }} class="nm-sec">
      <label>Publication title <input bind:value={sourceTitle} required /></label><label>Publisher <input bind:value={publisher} required /></label>
      <label>Publication date (optional) <input type="date" bind:value={publicationDate} /></label><label>Source URL (metadata only; never fetched) <input type="url" bind:value={sourceUrl} /></label>
      <label>Policy text <textarea rows="8" bind:value={sourceText} maxlength="250000"></textarea></label>
      <label>Or upload PDF, DOCX or UTF-8 TXT (5 MiB maximum) <input type="file" accept=".pdf,.docx,.txt" bind:this={upload} /></label>
      <label><input type="checkbox" bind:checked={synthetic} /> This source is synthetic</label>
      <label><input type="checkbox" bind:checked={publicMaterial} required /> I confirm this is public or synthetic material with no personal or operationally sensitive content.</label>
      <button disabled={busy || !publicMaterial}>Save policy source</button>
    </form>
  </details>
  {#if draft.source}
    <p><a href="?step=overview">Read the first-look dashboard →</a></p>
    <p>{draft.source.title} · {draft.source.publisher} · {draft.source.publication_date ?? 'Publication date unknown'}</p>
    {#each draft.source.input_flags as flag}<p class="error">{flag}</p>{/each}
    <button disabled={busy} onclick={() => action('extraction-jobs', { task: 'extract-objectives' })}>Suggest a starting model</button>
    <button disabled={busy} onclick={() => action('extraction-jobs', { task: 'extract-mechanisms' })}>Suggest how the policy changes the rules</button>
    <p>Proposals are unapproved. The offline mock supports only the labelled fixture. Other sources can use the manual model editor or an optional configured provider.</p>
    <details><summary>Original source text</summary>{#each draft.source.text_sections as s}<section id={`source-${s.id}`}><h3>{s.location}</h3><pre>{s.text}</pre></section>{/each}</details>
    <h2>Evidence register</h2>
    {#each draft.candidate?.evidence ?? [] as e}<article id={`evidence-${e.id}`}><h3>{e.id} · {e.location}</h3><p>{e.explicit_or_inferred} · extraction confidence {e.confidence} · {e.extraction_method}</p><blockquote>{e.quotation}</blockquote></article>{:else}<p>No extracted evidence yet.</p>{/each}
    {#if draft.candidate}<ReviewList allItems={items} items={relevantItems} evidence={draft.candidate.evidence} {busy} approve={ids => action('approvals', { item_ids: ids })} edit={editItem} />{/if}
  {/if}
{:else if step === 'actors'}
  <h2>Who is involved and what matters to them</h2>
  {#if game && draft.candidate}
    <button disabled={busy} onclick={() => action('extraction-jobs', { task: 'propose-actors' })}>Suggest people and organisations</button>
    <button disabled={busy} onclick={() => action('extraction-jobs', { task: 'actor-objectives-constraints' })}>Suggest what they want and what limits them</button>
    <button disabled={busy} onclick={() => action('extraction-jobs', { task: 'information-asymmetries' })}>Check who knows what</button>
    <ActorMap {game} onSelect={id => selectedActor = id} />
    {#if selectedActor}<p>Selected actor: {selectedActor}. <a href={`#item-${selectedActor}`}>Review actor and evidence</a></p>{/if}
    <ReviewList allItems={items} items={relevantItems} evidence={draft.candidate.evidence} {busy} approve={ids => action('approvals', { item_ids: ids })} edit={editItem} />
  {:else}<p>Add a source and candidate model first.</p>{/if}
{:else if step === 'builder'}
  <h2>Choices, consequences and things to check</h2>
  {#if !game && draft.source}<GuidedModel {busy} save={outline => { void action('guided-model', { outline }); }} />{/if}
  <p>Every numerical outcome and payoff weight references a labelled numerical assumption. Unknown values block simulation. Qualitative statements explain the model; only the approved payoff table and configured decision rules execute.</p>
  {#if game}
    <button disabled={busy} onclick={() => action('extraction-jobs', { task: 'propose-strategies' })}>Suggest possible choices</button>
    <button disabled={busy} onclick={() => action('extraction-jobs', { task: 'causal-relationships' })}>Suggest how choices could affect outcomes</button>
    <h3>What each combination of choices could change</h3>
    <div class="table-wrap"><table><thead><tr><th>Combination of choices</th>{#each game.outcome_metrics as metric}<th>{metric.name} ({metric.unit})</th>{/each}</tr></thead><tbody>{#each game.payoff_table as row}<tr><td>{Object.values(row.profile).map(id => game.strategies.find(s => s.id === id)?.name ?? id).join(' / ')}</td>{#each game.outcome_metrics as metric}{@const a = game.assumptions.find(a => a.id === row.outcome_values[metric.id])}<td>{a?.value_or_range == null ? 'Unknown' : JSON.stringify(a.value_or_range)}<br />Assumption: {a?.statement ?? 'Not yet supplied'}</td>{/each}</tr>{/each}</tbody></table></div>
  {/if}
  <details><summary>Advanced: restructure the full model as JSON</summary>
    <p>Use the shared domain schema. Adding actors, strategies or relationships also requires corresponding assumptions and a complete payoff table. Existing IDs must remain unique.</p>
    <button onclick={() => modelText = JSON.stringify(draft.candidate ?? syntheticCandidate(), null, 2)}>Load current model or synthetic editing template</button>
    <label>Model and evidence JSON <textarea rows="24" bind:value={modelText}></textarea></label><button disabled={busy || !modelText} onclick={saveModel}>Save model (clears draft approvals)</button>
  </details>
  {#if draft.candidate}<ReviewList allItems={items} items={relevantItems} evidence={draft.candidate.evidence} {busy} approve={ids => action('approvals', { item_ids: ids })} edit={editItem} />{/if}
{:else if step === 'runner'}
  <h2>Is everything ready?</h2>
  {#if errors.length}<details open><summary>{errors.length} blocking validation issues</summary><ul>{#each errors as issue}<li>{friendlyIssue(issue)}</li>{/each}</ul></details>{:else}<p>All draft items are approved and the payoff table is complete.</p>{/if}
  <button disabled={busy || errors.length > 0} onclick={() => action('versions', {})}>Save approved model snapshot</button>
  <h2>Scenario configuration</h2>
  <label>Approved model version <select bind:value={selectedVersion}><option value="">Latest approved version</option>{#each data.versions as version}<option value={version.id}>Version {version.version} · {new Date(version.createdAt).toLocaleString()}</option>{/each}</select></label>
  <p>Runs use the selected saved version, independent of later draft edits.</p>
  <label>What would you like to explore? <select bind:value={simulationType}><option value="normal-form">Which choices stay stable if others keep theirs?</option><option value="sequential">What changes when someone chooses first?</option><option value="repeated">What happens if the same choices repeat?</option><option value="agent-based">What happens under different simple decision rules?</option></select></label>
  <label>Scenario label <select bind:value={scenario}><option>baseline</option><option>optimistic</option><option>adverse</option><option>custom</option></select></label>
  <label>Scenario name (optional) <input bind:value={scenarioName} maxlength="200" /></label>
  <p>Scenario labels do not invent values. Configure parameter overrides within approved ranges; omitted values use approved central values.</p>
  <p>Keep the same seed and inputs to repeat exactly the same calculation. It is not a probability or confidence score.</p>
  <label>Repeatable random sequence (seed) <input type="number" min="0" max="4294967295" bind:value={seed} /></label><label>How many times do choices repeat? <input type="number" min="1" max="1000" bind:value={rounds} /></label>
  <ScenarioInputs game={runnerGame} bind:parameters={parameterText} bind:ranges={sensitivityText} />
  <button disabled={busy || !data.versions.length} onclick={() => runModel()}>Run approved scenario</button>
  <h2>Which uncertain values change the answer?</h2>
  <p>Use the range controls above. All values are checked against the saved snapshot on the server.</p>
  <button disabled={busy || !data.versions.length || sensitivityText === '[]'} onclick={() => runModel(true)}>Try a range of values</button>
  <p><a href="?step=results">View saved results</a></p>
{:else if step === 'results'}
  <h2>Calculated scenarios</h2>
  <label>Saved run <select bind:value={selectedRun}><option value="">Latest run</option>{#each data.runs as r}<option value={r.id}>{new Date(r.createdAt).toLocaleString()} · {r.engineVersion}</option>{/each}</select></label>
  {#if result && run}
    <p>Engine {result.engine_version} · {result.simulation_type} · result SHA-256 {payload?.result_hash}</p>
    {#each result.notices as notice}<p>{notice}</p>{/each}
    <h3>Intended behaviour</h3><ul>{#each savedModel?.intended_outcomes ?? [] as intended}<li>{intended.statement}</li>{/each}</ul><p>Compare the saved model’s intended outcomes in the audit export with the calculated profiles below. Approval is not evidence that actors will behave this way.</p>
    {#if chartRows.length}{#key run.id}<ChartArtifact artifact={chart} />{/key}
      <div class="table-wrap"><table><thead><tr><th>Round/profile</th><th>Metric</th><th>Calculated value</th></tr></thead><tbody>{#each chartRows as row}<tr><td>{row.step}</td><td>{row.metric}</td><td>{row.value}</td></tr>{/each}</tbody></table></div>
    {:else}<p>No terminal outcomes calculated. Read the equilibrium or information-structure limitation above.</p>{/if}
    <details><summary>Actor behaviour and payoff calculations by round/profile</summary><pre>{JSON.stringify(result.rounds.length ? result.rounds : result.terminal_outcomes, null, 2)}</pre></details>
    {#if payload?.result.samples}<h3>Sensitivity ranges</h3>{#each payload.result.samples as sample}<p>{sample.assumption_id}: terminal profiles {sample.changes_terminal_profiles ? 'change' : 'do not change'} relative to baseline.</p><pre>{JSON.stringify(sample.outcome_ranges, null, 2)}</pre>{/each}<p>Outcome ranges are scenario ranges, not confidence intervals. No probability distribution is assumed.</p>{/if}
    <details ontoggle={e => distributionOpen = e.currentTarget.open}><summary>Distribution of calculated round/profile values</summary><p>Empirical counts within this run, not probabilities of real outcomes.</p>{#if distributionOpen}{#key run.id}<ChartArtifact artifact={distribution} />{/key}{/if}</details>
    {#if sensitivityRows.length}{#key run.id}<ChartArtifact artifact={sensitivityChart} />{/key}{/if}
    <h3>Unintended behaviour and gaming hypotheses</h3>
    <p>Review whether individually preferred strategies conflict with intended outcomes. These are hypotheses requiring evidence; equilibrium existence is not a behavioural prediction.</p>
    <h3>Fiscal/resource, distributional and operational effects</h3><p>Only effects represented by approved metrics are calculated. Effects on unmodelled groups, actual budgets and delivery operations are unknown.</p>
    <h3>Safeguards to test</h3><p>Consider reward caps, verification of outcomes and cost-shifting controls. Represent each proposed safeguard in a revised model and approve its assumptions before comparing results.</p>
    <button disabled={busy} onclick={() => action('extraction-jobs', { task: 'red-team', run_id: run.id })}>Propose red-team hypotheses for saved run</button>
    <button disabled={busy} onclick={() => action('extraction-jobs', { task: 'explain-results', run_id: run.id })}>Explain saved deterministic results</button>
    {#each payload?.hypotheses ?? [] as h}<blockquote><strong>Unapproved hypothesis:</strong> {h.statement}<p>{h.limitation}</p><p>References: {[...h.evidence_refs, ...h.assumption_refs].join(', ')}</p></blockquote>{/each}
    <p>Explanations create a new annotated run record linked to the original. The model and deterministic results remain unchanged.</p>
  {:else}<p>No runs yet. Approve the model and run a scenario.</p>{/if}
{:else if step === 'audit'}
  <h2>Evidence, assumptions and versions</h2>
  {#if draft.first_look}<p><a href={`${base}/first-look-report?format=markdown`}>Export first look (Markdown)</a> · <a href={`${base}/first-look-report?format=json`}>Export first look (JSON)</a></p>{/if}
  <p>Source hash: {draft.source?.document_hash ?? 'No source'}</p>
  <p>All original source sections, per-item approvals, engine version, configuration, prompt versions and raw responses are retained. Revising a draft does not mutate a run’s saved model.</p>
  {#each data.versions as version}<p>Version {version.version} · {version.modelHash} · {new Date(version.createdAt).toLocaleString()}</p>{/each}
  <h3>Export auditable runs</h3>
  {#each data.runs as r}<p>{r.id} <a href={`${base}/reports?run=${r.id}&format=json`}>JSON report</a> · <a href={`${base}/reports?run=${r.id}&format=markdown`}>Markdown report</a></p>{:else}<p>No saved runs to export.</p>{/each}
  <details><summary>Evidence and assumptions register</summary><pre>{JSON.stringify({ evidence: draft.candidate?.evidence, assumptions: game?.assumptions }, null, 2)}</pre></details>
  <details><summary>Extraction attempts and raw model responses</summary><pre>{JSON.stringify(draft.attempts, null, 2)}</pre></details>
  <h3>Audit timeline</h3><ol>{#each draft.activity as a}<li>{a.at} — {a.action}{#if a.item_ids.length}: {a.item_ids.join(', ')}{/if}</li>{/each}</ol>
{/if}
<style>
  nav { display: flex; flex-wrap: wrap; border-block: 1px solid var(--line-strong); gap: 2px; margin: 20px 0; }
  nav a { padding: 10px 14px; }
  nav a[aria-current='page'] { background: var(--text-primary); color: var(--bg); }
  textarea { width: 100%; font-family: var(--font-code); }
  .synthetic { padding: 12px; border: 2px solid var(--accent-ink); }
  table { width: 100%; border-collapse: collapse; }
  td, th { text-align: left; border-bottom: 1px solid var(--line); padding: 10px; vertical-align: top; }
  .table-wrap { overflow-x: auto; }
  blockquote { border-left: 2px solid var(--accent-ink); padding: 12px; }
</style>
