<script lang="ts">
  import { onMount } from 'svelte';
  import DevelopmentBuildProgress from './DevelopmentBuildProgress.svelte';
  import { featurePreviewUrl } from './development-progress';
  import type { DevelopmentProgress } from './development-progress';
  import DevelopmentBuildActivity from './DevelopmentBuildActivity.svelte';
  import { replaceState } from '$app/navigation';
  import { PRODUCT_AREAS, visibleDevelopmentStage, type DeliveryState } from '$lib/jkai/development';
  let { buildId }: { buildId: string } = $props();
  type Snapshot = {
    progress?: DevelopmentProgress;
    delivery: { revision: number; state: DeliveryState };
    build: { outcome?: string | null; heartbeatAt?: string | null; updatedAt?: string; failure?: { message?: string; kind?: string } | null; prompt: string; title: string; status: string; modelId: string; modelProvider?: string; iterationsCompleted: number; costUsd: string | null; budgetConfig: { maxCostUsd?: number; maxTotalMinutes?: number; maxIterations?: number; maxTokensPerIteration?: number } };
    instructions: Array<{ id: number; content: string; consumedAt: string | null; acknowledgedAt: string | null; dispatchedAt: string | null; cancelledAt: string | null }>;
    notes: Array<{ id: number; content: string }>;
    events: Array<{ id: number; kind: string; createdAt: string }>;
    lessons: Array<{ id: number; lesson: string; evidence: string; expiresAt: string }>;
    blocker: string | null;
  };
  let snapshot = $state<Snapshot | null>(null);
  let tab = $state('Brief'); let busy = $state(false); let error = $state(''); let connection = $state('Loading');
  let outcome = $state(''); let constraints = $state(''); let routes = $state(''); let criteria = $state(''); let area = $state('Platform');
  let scope = $state(''); let dependencies = $state(''); let assumptions = $state(''); let questions = $state(''); let validation = $state('');
  let feedback = $state(''); let grooming = $state(false);
  const briefFields = () => ({ outcome, constraints, routes, criteria, area, scope, dependencies, assumptions, questions, validation });
  let instruction = $state(''); let question = $state(''); let answers = $state<Record<string, string>>({});
  let evidence = $state<Record<string, string>>({}); let verdicts = $state<Record<string, string>>({});
  let lesson = $state(''); let lessonEvidence = $state(''); let note = $state(''); let phone = $state(false);
  let previewRoute = $state('');
  let evidenceCandidate: string | null = null; let briefRevision = 0; let loadedBrief = ''; let initialized = false; let refreshing = false;
  const deliveryState = $derived(snapshot?.delivery.state);
  const chosenRoute = $derived(deliveryState?.brief.routes.includes(previewRoute) ? previewRoute : deliveryState?.brief.routes[0] ?? '/');
  const previewHref = $derived(featurePreviewUrl(deliveryState?.preview.url ?? null, chosenRoute));
  const running = $derived(snapshot?.build.status === 'running' || snapshot?.build.status === 'queued');
  async function refresh() {
    if (refreshing) return; refreshing = true;
    try {
      const response = await fetch(`/api/jkai/development/${buildId}`);
      if (!response.ok) throw new Error('Workspace unavailable');
      snapshot = await response.json(); connection = 'Connected';
      if (!initialized && snapshot?.delivery.state.brief.acceptedAt) tab = 'Build';
      if (snapshot && (!initialized || (snapshot.delivery.state.brief.revision !== briefRevision && JSON.stringify(briefFields()) === loadedBrief))) {
        const s = snapshot.delivery.state; briefRevision = s.brief.revision; outcome = s.brief.outcome; constraints = s.brief.constraints; routes = s.brief.routes.join('\n');
        scope = s.brief.scope ?? ''; dependencies = s.brief.dependencies ?? ''; assumptions = s.brief.assumptions ?? ''; questions = s.brief.questions ?? ''; validation = s.brief.validation ?? '';
        criteria = s.criteria.map((c) => c.text).join('\n'); area = s.area;
        for (const c of s.criteria) { evidence[c.id] = c.evidence; verdicts[c.id] = c.verdict; }
        evidenceCandidate = s.candidate;
        loadedBrief = JSON.stringify(briefFields());
        initialized = true;
      }
      if (snapshot && snapshot.delivery.state.candidate !== evidenceCandidate) {
        evidenceCandidate = snapshot.delivery.state.candidate;
        evidence = {}; verdicts = {};
        if (!busy) error = 'The candidate changed. Review its new preview before recording fresh evidence.';
      }
    } catch { connection = 'Disconnected — saved work is retained'; }
    finally { refreshing = false; }
  }
  onMount(() => { void (async () => {
    const auto = new URL(location.href).searchParams.get('refine') === '1';
    if (auto) replaceState(location.pathname, {});
    await refresh();
    if (auto && snapshot && !snapshot.delivery.state.grooming && !snapshot.delivery.state.brief.acceptedAt) await refine();
  })(); const timer = setInterval(() => { void refresh(); }, 3000); return () => clearInterval(timer); });
  async function act(action: string, fields: Record<string, unknown> = {}) {
    if (!snapshot) return false; busy = true; error = '';
    if (action === 'inspect_preview' || action === 'preview') tab = 'Preview';
    try {
      const response = await fetch(`/api/jkai/development/${buildId}`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, revision: snapshot.delivery.revision, briefRevision, candidate: snapshot.delivery.state.candidate, ...fields }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'Operation failed');
      if (action === 'inspect_preview' || action === 'preview') tab = 'Preview';
      if (action === 'start' || action === 'resume') tab = 'Build';
      if (action === 'brief' || action === 'groom') initialized = false;
      await refresh(); return true;
    } catch (e) { error = e instanceof Error ? e.message : 'Operation failed'; await refresh(); return false; }
    finally { busy = false; }
  }
  async function refine() {
    grooming = true;
    try { if (await act('groom', { ...briefFields(), message: feedback })) feedback = ''; }
    finally { grooming = false; }
  }
</script>
<section class="workspace">
  <header><div class="workspace-title"><a href="/jkai/develop">← Site development</a><h1>{snapshot?.build.title ?? 'Development workspace'}</h1></div>
    <div class="status" role="status"><strong>{deliveryState && snapshot ? visibleDevelopmentStage(deliveryState, snapshot.build.status, snapshot.build.outcome) : 'Loading'}</strong><span>{connection}</span>
      {#if snapshot}<span>{snapshot.build.iterationsCompleted} iterations completed</span>{/if}</div>
    <div class="actions">
      <button class="nm-save-btn" disabled={busy || running || deliveryState?.preview.status === 'starting' || !deliveryState?.brief.acceptedAt} onclick={() => act(deliveryState?.session.id ? 'resume' : 'start')}>{deliveryState?.session.id ? 'Continue to preview' : 'Build to preview'}</button>
      <button class="nm-btn-ghost" disabled={busy || !running} onclick={() => act('pause')}>Pause</button>
      <button class="nm-btn-ghost" disabled={busy || !running} onclick={() => act('stop')}>Stop</button>
    </div>
    {#if deliveryState && !deliveryState.brief.acceptedAt}<p class="muted">Accept the brief below to enable Build to preview. Remaining questions do not prevent acceptance.</p>{/if}
  </header>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if deliveryState?.decisions.some((d) => !d.answer)}<aside class="attention"><strong>A decision is waiting</strong><button onclick={() => tab = 'Build'}>Open decisions</button></aside>{/if}
  <nav aria-label="Development views">{#each ['Brief', 'Build', 'Preview', 'Delivery'] as name}<button disabled={!snapshot} class:active={tab === name} aria-pressed={tab === name} onclick={() => tab = name}>{name}</button>{/each}</nav>
  {#if snapshot && deliveryState?.brief.acceptedAt}
    {#if snapshot.progress && tab === 'Build'}<DevelopmentBuildProgress {buildId} {busy} progress={snapshot.progress} build={snapshot.build} delivery={deliveryState} connected={connection === 'Connected'} navigate={(name) => tab = name} inspect={() => act('inspect_preview')} prepare={() => act('preview')} />{/if}
    {#key buildId}<DevelopmentBuildActivity {buildId} build={snapshot.build} needsOwner={deliveryState.decisions.some(d => !d.answer)} showOutput={tab === 'Build'} />{/key}
  {/if}
  {#if !snapshot}<p>{connection === 'Loading' ? 'Loading saved work…' : connection}</p>
  {:else if deliveryState}
    <div class="pane">
      {#if tab === 'Brief'}
        {#if !deliveryState.brief.acceptedAt}
          <aside class="grooming" aria-busy={grooming}>
            <h2>{deliveryState.grooming ? 'Proposed brief' : 'Let’s shape your ask'}</h2>
            <p>{deliveryState.grooming?.summary ?? 'The model will propose acceptance criteria, scope, dependencies and a validation plan. Review its assumptions before accepting.'}</p>
            {#if deliveryState.grooming}<small>Proposed by {deliveryState.grooming.model} · {new Date(deliveryState.grooming.at).toLocaleString()}</small>{/if}
            {#if questions.trim()}<p><strong>Questions to consider</strong></p><ul>{#each questions.split('\n').filter(Boolean) as pending}<li>{pending}</li>{/each}</ul>{/if}
            <label>Answers or changes for the model<textarea bind:value={feedback} rows="3" placeholder="Answer the questions below, or explain what you want changed." disabled={busy}></textarea></label>
            <button class="nm-save-btn" disabled={busy || running} onclick={() => refine()}>{grooming ? 'Refining your brief…' : deliveryState.grooming ? 'Refine with my answers' : 'Propose a brief'}</button>
            {#if grooming}<p role="status">Drafting criteria and checking the supplied site context. Your original ask is saved.</p>{/if}
          </aside>
        {/if}
        <details><summary>Original ask</summary><p class="original-ask">{deliveryState.originalAsk ?? snapshot.build.prompt}</p></details>
        <p>The accepted brief records what this feature must achieve. Implementation, preview and release are separate decisions.</p>
        <form onsubmit={(e) => { e.preventDefault(); void act('brief', briefFields()); }}>
          <fieldset disabled={busy || running}><label>Product area<select aria-label="Product area" bind:value={area}>{#each PRODUCT_AREAS as value}<option>{value}</option>{/each}</select></label>
          <label>Intended outcome<textarea required bind:value={outcome} rows="4"></textarea></label>
          <div class="columns"><label>Constraints<textarea bind:value={constraints} rows="4" placeholder="Behaviour, audience, design and data constraints"></textarea></label>
          <label>Target routes<textarea bind:value={routes} rows="4" placeholder="One site path per line, for example /health"></textarea></label></div>
          <label>Acceptance criteria<textarea required bind:value={criteria} rows="5" placeholder="One observable outcome per line"></textarea></label>
          <label>Scope and exclusions<textarea bind:value={scope} rows="3"></textarea></label>
          <div class="columns"><label>Dependencies to verify<textarea bind:value={dependencies} rows="3"></textarea></label><label>Assumptions<textarea bind:value={assumptions} rows="3"></textarea></label></div>
          <label>Validation plan<textarea bind:value={validation} rows="4"></textarea></label>
          <label>Open questions<textarea bind:value={questions} rows="3" placeholder="Answer these with the model, or accept the brief and retain them for the builder."></textarea></label>
          <p class="muted">You can accept this brief now. Remaining questions travel with it; the builder will ask if a decision blocks implementation.</p>
          <button class="nm-save-btn" disabled={busy || running || !outcome.trim() || !criteria.trim()}>{questions.trim() ? 'Accept brief with open questions' : 'Accept brief'}</button><span class="muted">Revision {deliveryState.brief.revision}{deliveryState.brief.acceptedAt ? ' · accepted' : ' · draft'}</span></fieldset>
        </form>
        <details><summary>Verified repository knowledge</summary>{#each snapshot.lessons as item}<p>{item.lesson}<small>{item.evidence} · recheck after {new Date(item.expiresAt).toLocaleDateString()}</small></p>{:else}<p>No accepted lessons for this product area yet.</p>{/each}</details>
      {:else if tab === 'Build'}
        <div class="section-label">Steering / decisions <small>{snapshot.build.modelId}</small></div>
        {#if deliveryState.session.recovery}<p class="attention">{deliveryState.session.recovery}</p>{/if}
        <form onsubmit={async (e) => { e.preventDefault(); if (await act('steer', { content: instruction })) instruction = ''; }}>
          <label>Guide this build<textarea bind:value={instruction} required rows="3" placeholder="For example: keep the date controls visible while scrolling."></textarea></label>
          <button class="nm-save-btn" disabled={busy}>Send instruction</button>
        </form>
        <p class="muted">Instructions are saved first. Acknowledged means Pi queued the message; included means it reached the session. Acceptance checks prove the resulting behaviour.</p>
        {#each [...snapshot.instructions].reverse() as item}<div class="receipt"><strong>{item.cancelledAt ? 'Cancelled' : item.consumedAt ? 'Included in session' : item.acknowledgedAt ? 'Acknowledged by Pi' : item.dispatchedAt ? 'Dispatched · awaiting receipt' : 'Saved · waiting for Pi'}</strong><p>{item.content}</p></div>{/each}
        <h2>Decisions</h2>
        {#each deliveryState.decisions as decision}<form onsubmit={(e) => { e.preventDefault(); void act('answer', { decisionId: decision.id, answer: answers[decision.id] }); }}>
          <label>{decision.question}{#if decision.answer}<p>{decision.answer}</p>{:else}<textarea required bind:value={answers[decision.id]} rows="2"></textarea>{/if}</label>
          {#if !decision.answer}<button disabled={busy}>Save answer</button>{/if}
        </form>{:else}<p>No pending decisions.</p>{/each}
        <details><summary>Record a decision or pin a constraint</summary>
          <form onsubmit={async (e) => { e.preventDefault(); if (await act('decision', { question })) question = ''; }}><label>Decision needed<input required bind:value={question} /></label><button disabled={busy}>Record decision</button></form>
          <form onsubmit={async (e) => { e.preventDefault(); if (await act('note', { content: note })) note = ''; }}><label>Pinned constraint<input required bind:value={note} /></label><button disabled={busy}>Pin constraint</button></form>
          {#each snapshot.notes as item}<p>{item.content} <button disabled={busy} onclick={() => act('remove_note', { noteId: item.id })}>Remove</button></p>{/each}
        </details>
        <details><summary>Advanced build controls and logs</summary><a href={`/jkai/builds/${buildId}`}>Open the existing build console →</a></details>
      {:else if tab === 'Preview'}
        {#if !deliveryState.gate?.passed}<aside class="attention"><div><strong>Inspection is not acceptance</strong><p>Failed or missing repository checks remain blocking. Previewing saved work does not verify the feature.</p></div>{#if !deliveryState.candidate}<button disabled={busy || running || !snapshot.progress?.iterations.some(i => i.tokensUsed > 0)} onclick={() => act('inspect_preview')}>Prepare inspection preview</button>{/if}</aside>{/if}
        <div class="actions"><button disabled={busy || running || !deliveryState.candidate} onclick={() => act('preview')}>Prepare preview</button><button aria-pressed={phone} onclick={() => phone = !phone}>{phone ? 'Desktop width' : 'Phone width'}</button>
          {#if previewHref}<a href={previewHref} target="_blank" rel="noopener noreferrer">Open site preview ↗</a><button disabled={busy || running} onclick={() => act('close_preview')}>Close preview</button>{/if}</div>
        {#if deliveryState.preview.url?.startsWith('http://127.0.0.1:')}<p class="muted">This preview uses a loopback port on the build host. When reviewing from another computer, forward that port before opening it here.</p>{:else if deliveryState.preview.url}<p class="muted">Preview access lasts eight hours. Use Prepare preview to refresh an expired link.</p>{/if}
        <p role="status">{deliveryState.preview.status} · {deliveryState.preview.detail}</p>
        {#if deliveryState.brief.routes.length}<div class="actions" aria-label="Feature routes">{#each deliveryState.brief.routes as route}<button aria-pressed={chosenRoute === route} onclick={() => previewRoute = route}>{route}</button>{/each}</div>{/if}
        {#if previewHref}<div class:phone class="preview"><iframe title="Isolated feature preview" src={previewHref} sandbox="allow-scripts allow-forms allow-same-origin allow-downloads"></iframe></div>{/if}
        <h2>Acceptance evidence</h2><p class="muted">Candidate {deliveryState.candidate?.slice(0, 12) ?? 'not prepared'}. Record what you actually exercised, including data or provider limitations.</p>
        {#each deliveryState.criteria as criterion}<form class="criterion" onsubmit={(e) => { e.preventDefault(); void act('criterion', { criterionId: criterion.id, verdict: verdicts[criterion.id] ?? 'unverified', evidence: evidence[criterion.id] ?? '' }); }}>
          <strong>{criterion.text}</strong><label>Verdict for {criterion.text}<select bind:value={verdicts[criterion.id]}><option value="unverified">Not exercised</option><option value="passed">Passed</option><option value="failed">Failed</option><option value="blocked">Blocked</option></select></label>
          <label>Evidence for {criterion.text}<textarea bind:value={evidence[criterion.id]} rows="2" placeholder="What was tested, observed or blocked"></textarea></label>
          <button disabled={busy || !deliveryState.candidate}>Save evidence</button><small>Recorded: {criterion.verdict}</small>
        </form>{/each}
      {:else}
        {#if deliveryState.changes}<details><summary>Review {deliveryState.changes.files.length} changed files</summary><ul>{#each deliveryState.changes.files as file}<li><code>{file}</code></li>{/each}</ul><pre class="patch">{deliveryState.changes.patch}</pre><p class="muted">Diff excerpt limited to 20,000 characters. The advanced build console provides the workspace files.</p></details>{/if}
        <h2>Accept into the cumulative batch</h2><p>The candidate joins previously accepted local work after integration checks. A pull request and production release remain separate actions.</p>
        <p>{snapshot.blocker ?? 'The current candidate has the required acceptance evidence.'}</p>
        <button class="nm-save-btn" disabled={busy || !!snapshot.blocker || !!deliveryState.acceptedAt} onclick={() => act('accept')}>{busy ? 'Working…' : deliveryState.acceptedAt ? 'Accepted into batch' : 'Accept into batch'}</button>
        {#if deliveryState.batch}<p>Batch revision <code>{deliveryState.batch.slice(0, 12)}</code></p>{/if}
        <details><summary>Save a reusable repository lesson</summary><form onsubmit={(e) => { e.preventDefault(); void act('lesson', { lesson, evidence: lessonEvidence }); }}><label>Verified lesson<textarea required bind:value={lesson}></textarea></label><label>Supporting evidence<textarea required bind:value={lessonEvidence}></textarea></label><button disabled={busy || !deliveryState.acceptedAt}>Save lesson for 90 days</button></form></details>
        <h2>Delivery history</h2>{#each snapshot.events as event}<div class="event"><span>{event.kind.replaceAll('_', ' ')}</span><time>{new Date(event.createdAt).toLocaleString()}</time></div>{/each}
      {/if}
    </div>
  {/if}
</section>
<style>
  .section-label { display: flex; justify-content: space-between; gap: 12px; text-transform: uppercase; letter-spacing: .06em; font-size: var(--fs-label-xs); border-bottom: 1px solid var(--line-strong); padding: 8px 0; } .section-label small { margin: 0; text-transform: none; }
  .original-ask { white-space: pre-wrap; overflow-wrap: anywhere; }
  fieldset { border: 0; padding: 0; margin: 0; min-width: 0; } .grooming { border-left: 3px solid var(--accent); padding: 4px 16px 16px; background: var(--surface-sunken); }
  .workspace { width: min(1440px, 100%); margin: 0 auto; padding: 16px 20px; box-sizing: border-box; min-width: 0; }
  header { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 6px 16px; border-bottom: 2px solid var(--line-strong); padding-bottom: 10px; } .workspace-title a { font-size: var(--fs-label); color: var(--accent-ink); } .workspace-title { grid-column: 1; } header > .status { grid-column: 1; margin: 0; } header > .actions { grid-column: 2; grid-row: 1 / 3; margin: 0; align-self: center; } header > p { grid-column: 1 / -1; } h1 { font: clamp(1.1rem, 2vw, 1.5rem) var(--font-display); overflow-wrap: anywhere; margin: 6px 0 2px; }
  .status, .actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 8px; } .status { color: var(--text-secondary); font-size: var(--fs-nav); }
  nav { display: flex; border-bottom: 1px solid var(--line-strong); margin: 8px 0; } nav button { flex: 1; border: 0; border-bottom: 3px solid transparent; background: transparent; padding: 8px 6px; } nav button.active { border-color: var(--accent); color: var(--accent); }
  button, input, select, textarea { font: inherit; color: var(--text-primary); } button { cursor: pointer; padding: 8px 12px; border: 1px solid var(--line-strong); background: var(--surface-elevated); } button:disabled { opacity: .5; cursor: default; }
  label { display: flex; flex-direction: column; gap: 5px; margin-bottom: 10px; font-size: var(--fs-nav); min-width: 0; }
  input, textarea, select { border: 1px solid var(--line-strong); background: var(--surface-elevated); padding: 10px; width: 100%; box-sizing: border-box; } textarea { resize: vertical; }
  form { margin: 12px 0; } .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; } .muted, small { color: var(--text-secondary); font-size: var(--fs-label); } small { display: block; margin-top: 8px; }
  .patch { max-height: 500px; overflow: auto; white-space: pre; font-size: var(--fs-label); padding: 12px; background: var(--surface-sunken); }
  .error { color: var(--error); } .attention { border-left: 3px solid var(--accent); padding: 12px; background: var(--surface-sunken); display: flex; gap: 16px; align-items: center; }
  .receipt, .criterion, .event { border-bottom: 1px solid var(--line); padding: 9px 0; overflow-wrap: anywhere; } .receipt p { white-space: pre-wrap; }
  .preview { width: 100%; height: 650px; margin: 16px auto; border: 1px solid var(--line-strong); background: var(--surface-elevated); } .preview.phone { max-width: 390px; } iframe { width: 100%; height: 100%; border: 0; }
  details { margin: 12px 0; padding: 9px 0; border-top: 1px solid var(--line); } summary { cursor: pointer; } .event { display: flex; justify-content: space-between; gap: 12px; } time { color: var(--text-secondary); font-size: var(--fs-label); }
  a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  @media (max-width: 700px) { .workspace { padding: 12px; } header { display: block; } header > .actions { margin-top: 10px; } .columns { grid-template-columns: 1fr; gap: 0; } .event { flex-direction: column; } .preview { height: 550px; } }
</style>
