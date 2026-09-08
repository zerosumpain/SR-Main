<script lang="ts">
  import DevelopmentModelSelect from './DevelopmentModelSelect.svelte';
  let modelId = $state('');
  // The Pi builder wrapper's workspace, wearing the /health editorial system.
  //
  // Chrome is `DaydreamShell` — the ink cover with a tile deck, the sticky
  // rail, the mono footer — for the same reason the portfolio page uses it and
  // not `HealthShell`: /jkai already mounts `HubHeader` outside the scroll
  // container, and a second site bar plus a fixed grain layer would fight it.
  // `/jkai/agents` is the precedent for the shell with in-page `ontab` tabs.
  //
  // The build controls sit in the shell's `actions` slot, INSIDE the sticky
  // rail. They are the only thing on this page a reader needs at every scroll
  // position: a run takes minutes, and Pause and Stop carried away by the
  // cover band is the whole reason that slot exists.
  //
  // Everything below the rail is paper. The system's rule is that ink is for
  // chrome and thin bands — a tall solid ink area reads as intensity, not as
  // editorial — so the transcript, the forms and the evidence ledger stay on
  // cream and only the cover and foot are dark.
  import { onMount } from 'svelte';
  import DevelopmentBuildProgress from './DevelopmentBuildProgress.svelte';
  import DevelopmentBuildActivity from './DevelopmentBuildActivity.svelte';
  import DaydreamShell from '$lib/components/jkai/daydream/hub/DaydreamShell.svelte';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import StatDeck from '$lib/components/jkai/daydream/hub/StatDeck.svelte';
  import type { DeckTile, ShellTab } from '$lib/components/jkai/daydream/hub/types';
  import { featurePreviewUrl, developmentTone } from '$lib/builds/development-progress';
  import type { DevelopmentProgress } from '$lib/builds/development-progress';
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
  const briefFields = () => ({ outcome, constraints, routes, criteria, area, scope, dependencies, assumptions, questions, validation, modelId });
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
        modelId = snapshot.build.modelId;
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

  // ── the chrome's copy ───────────────────────────────────────────────────
  const stage = $derived(deliveryState && snapshot ? visibleDevelopmentStage(deliveryState, snapshot.build.status, snapshot.build.outcome) : 'loading');
  const openDecisions = $derived(deliveryState?.decisions.filter((d) => !d.answer).length ?? 0);
  const evidencedCount = $derived(deliveryState?.criteria.filter((c) => c.verdict === 'passed' && !!deliveryState.candidate && c.revision === deliveryState.candidate).length ?? 0);
  // Two lines at most: the fold is a typographic decision everywhere else in
  // this system, and a build title is arbitrary length, so it is split on
  // whole words near the middle rather than at a fixed character count.
  const titleLines = $derived.by(() => {
    const words = (snapshot?.build.title ?? 'Development workspace').trim().split(/\s+/);
    if (words.length < 4) return [words.join(' ')];
    const half = Math.ceil(words.length / 2);
    return [words.slice(0, half).join(' '), words.slice(half).join(' ')];
  });
  // The API derives the build title FROM the outcome, so the two usually say
  // the same thing. Printing it twice — once at 44px, once as the standfirst —
  // is not a summary, so the standfirst falls back to what the page is for.
  const standfirst = $derived.by(() => {
    const outcome = deliveryState?.brief.outcome?.trim() ?? '';
    const title = (snapshot?.build.title ?? '').trim();
    if (!snapshot) return 'Loading the saved brief, decisions and instructions for this feature.';
    const same = outcome.toLowerCase().replace(/[.\s]+$/, '') === title.toLowerCase().replace(/[.\s]+$/, '');
    if (outcome && !same) return outcome;
    const routes = deliveryState?.brief.routes.filter(Boolean) ?? [];
    return `Accept the brief, guide the build, then try the candidate in an isolated preview${routes.length ? ` on ${routes.join(', ')}` : ''}. Nothing here publishes a pull request or deploys production.`;
  });
  const tabs = $derived<ShellTab[]>([
    { id: 'Brief', label: 'Brief', tone: 'quiet' },
    { id: 'Build', label: 'Build', count: openDecisions, tone: 'action' },
    { id: 'Preview', label: 'Preview', tone: 'quiet' },
    { id: 'Delivery', label: 'Delivery', tone: 'quiet' },
  ]);
  const tiles = $derived<DeckTile[]>(!deliveryState || !snapshot ? [] : [
    { key: 'stage', label: 'Stage', value: stage, tone: developmentTone(stage), lit: openDecisions > 0,
      sub: deliveryState.brief.acceptedAt ? `brief revision ${deliveryState.brief.revision}, accepted` : `brief revision ${deliveryState.brief.revision}, draft` },
    { key: 'criteria', label: 'Criteria evidenced', value: String(evidencedCount), suffix: `/${deliveryState.criteria.length}`,
      tone: deliveryState.criteria.length && evidencedCount === deliveryState.criteria.length ? 'good' : 'steady',
      sub: deliveryState.candidate ? 'against the current candidate' : 'no candidate prepared yet' },
    { key: 'candidate', label: 'Candidate', value: deliveryState.candidate?.slice(0, 8) ?? '—', tone: deliveryState.candidate ? 'steady' : 'quiet',
      sub: deliveryState.gate?.passed ? 'repository checks passed' : 'no passing repository gate' },
    { key: 'preview', label: 'Preview', value: deliveryState.preview.status, tone: deliveryState.preview.status === 'ready' ? 'good' : deliveryState.preview.status === 'failed' ? 'urgent' : 'quiet',
      sub: `${snapshot.build.iterationsCompleted} iterations completed` },
  ]);
</script>

<DaydreamShell
  path="/jkai/develop"
  kicker={deliveryState ? `${deliveryState.area} · Pi site development` : 'Pi site development'}
  title={titleLines}
  compactTitle
  {standfirst}
  readout={[
    { label: 'Stage', value: stage },
    { label: 'Worker', value: connection === 'Connected' ? (snapshot?.build.status ?? '—') : connection },
    { label: 'Iterations', value: String(snapshot?.build.iterationsCompleted ?? 0) },
  ]}
  {tabs}
  active={tab}
  ontab={(id) => (tab = id)}
  footer={[
    `strangeramblings.com/jkai/develop/${buildId.slice(0, 8)}`,
    snapshot ? `${snapshot.build.modelId} · ${snapshot.build.iterationsCompleted} iterations` : 'loading',
    'preview only · no PR, no production deploy',
  ]}
>
  {#snippet masthead()}
    {#if tiles.length}<StatDeck {tiles} dark min={215} />{/if}
  {/snippet}

  {#snippet actions()}
    <a class="wk-back" href="/jkai/develop">← Portfolio</a>
    <button class="wk-run" disabled={busy || running || deliveryState?.preview.status === 'starting' || !deliveryState?.brief.acceptedAt} onclick={() => act(deliveryState?.session.id ? 'resume' : 'start')}>{deliveryState?.session.id ? 'Continue iteration' : 'Build first working page'}</button>
    <button class="wk-ghost" disabled={busy || !running} onclick={() => act('pause')}>Pause</button>
    <button class="wk-ghost" disabled={busy || !running} onclick={() => act('stop')}>Stop</button>
  {/snippet}

  <div class="wk">
    {#if deliveryState && !deliveryState.brief.acceptedAt}
      <p class="wk-note">Accept the brief below to build the first working page. Remaining questions do not prevent acceptance.</p>
    {/if}
    {#if error}<p class="wk-alert wk-alert-bad" role="alert">{error}</p>{/if}
    {#if openDecisions}
      <div class="wk-alert wk-alert-act">
        <strong>A decision is waiting</strong>
        <button class="wk-inline" onclick={() => (tab = 'Build')}>Open decisions →</button>
      </div>
    {/if}

    {#if snapshot && deliveryState?.brief.acceptedAt}
      {#if snapshot.progress && tab === 'Build'}<DevelopmentBuildProgress {buildId} {busy} progress={snapshot.progress} build={snapshot.build} delivery={deliveryState} connected={connection === 'Connected'} navigate={(name) => tab = name} inspect={() => act('inspect_preview')} prepare={() => act('preview')} />{/if}
      {#key buildId}<DevelopmentBuildActivity {buildId} build={snapshot.build} needsOwner={openDecisions > 0} showOutput={tab === 'Build'} />{/key}
    {/if}

    {#if !snapshot}
      <p class="wk-empty">{connection === 'Loading' ? 'Loading saved work…' : connection}</p>
    {:else if deliveryState}
      {#if tab === 'Brief'}
        <SectionHead
          kicker="01 / The brief"
          title={['What this', 'feature must do']}
          strap="The accepted brief records what the feature must achieve. Implementation, preview and release are three separate decisions."
        />
        {#if !deliveryState.brief.acceptedAt}
          <aside class="wk-groom" aria-busy={grooming}>
            <h2 class="wk-eyebrow">{deliveryState.grooming ? 'Proposed brief' : 'Let’s shape your ask'}</h2>
            <p class="wk-lede">{deliveryState.grooming?.summary ?? 'The model will propose acceptance criteria, scope, dependencies and a validation plan. Review its assumptions before accepting.'}</p>
            {#if deliveryState.grooming}<p class="wk-stamp">Proposed by {deliveryState.grooming.model} · {new Date(deliveryState.grooming.at).toLocaleString()}</p>{/if}
            {#if questions.trim()}
              <p class="wk-eyebrow">Questions to consider</p>
              <ul class="wk-questions">{#each questions.split('\n').filter(Boolean) as pending (pending)}<li>{pending}</li>{/each}</ul>
            {/if}
            <label class="wk-field"><span class="wk-label">Answers or changes for the model</span><textarea bind:value={feedback} rows="3" placeholder="Answer the questions below, or explain what you want changed." disabled={busy}></textarea></label>
            <button class="wk-run" disabled={busy || running} onclick={() => refine()}>{grooming ? 'Refining your brief…' : deliveryState.grooming ? 'Refine with my answers' : 'Propose a brief'}</button>
            {#if grooming}<p class="wk-stamp" role="status">Drafting criteria and checking the supplied site context. Your original ask is saved.</p>{/if}
          </aside>
        {/if}

        <details class="wk-fold"><summary>Original ask</summary><p class="wk-pre">{deliveryState.originalAsk ?? snapshot.build.prompt}</p></details>

        <form class="wk-form" onsubmit={(e) => { e.preventDefault(); void act('brief', briefFields()); }}>
          <fieldset disabled={busy || running}>
            <label class="wk-field wk-narrow"><span class="wk-label">Product area</span><select aria-label="Product area" bind:value={area}>{#each PRODUCT_AREAS as value (value)}<option>{value}</option>{/each}</select></label>
            <DevelopmentModelSelect bind:value={modelId} disabled={busy || running} />
            <label class="wk-field"><span class="wk-label">Intended outcome</span><textarea required bind:value={outcome} rows="4"></textarea></label>
            <div class="wk-cols">
              <label class="wk-field"><span class="wk-label">Constraints</span><textarea bind:value={constraints} rows="4" placeholder="Behaviour, audience, design and data constraints"></textarea></label>
              <label class="wk-field"><span class="wk-label">Target routes</span><textarea bind:value={routes} rows="4" placeholder="One site path per line, for example /health"></textarea></label>
            </div>
            <label class="wk-field"><span class="wk-label">Acceptance criteria</span><textarea required bind:value={criteria} rows="5" placeholder="One observable outcome per line"></textarea></label>
            <label class="wk-field"><span class="wk-label">Scope and exclusions</span><textarea bind:value={scope} rows="3"></textarea></label>
            <div class="wk-cols">
              <label class="wk-field"><span class="wk-label">Dependencies to verify</span><textarea bind:value={dependencies} rows="3"></textarea></label>
              <label class="wk-field"><span class="wk-label">Assumptions</span><textarea bind:value={assumptions} rows="3"></textarea></label>
            </div>
            <label class="wk-field"><span class="wk-label">Validation plan</span><textarea bind:value={validation} rows="4"></textarea></label>
            <label class="wk-field"><span class="wk-label">Open questions</span><textarea bind:value={questions} rows="3" placeholder="Answer these with the model, or accept the brief and retain them for the builder."></textarea></label>
            <p class="wk-muted">You can accept this brief now. Remaining questions travel with it; the builder will ask if a decision blocks implementation.</p>
            <div class="wk-actions">
              <button class="wk-run" disabled={busy || running || !outcome.trim() || !criteria.trim()}>{questions.trim() ? 'Accept brief with open questions' : 'Accept brief'}</button>
              <span class="wk-stamp">Revision {deliveryState.brief.revision}{deliveryState.brief.acceptedAt ? ' · accepted' : ' · draft'}</span>
            </div>
          </fieldset>
        </form>

        <details class="wk-fold"><summary>Verified repository knowledge</summary>{#each snapshot.lessons as item (item.id)}<p class="wk-lesson">{item.lesson}<span class="wk-stamp">{item.evidence} · recheck after {new Date(item.expiresAt).toLocaleDateString()}</span></p>{:else}<p class="wk-muted">No accepted lessons for this product area yet.</p>{/each}</details>

      {:else if tab === 'Build'}
        <SectionHead
          kicker="02 / Steering"
          title={['Guide the', 'worker mid-run']}
          strap="Instructions are saved before dispatch and survive a restart. {snapshot.build.modelId} is answering."
        />
        {#if deliveryState.session.recovery}<p class="wk-alert wk-alert-act">{deliveryState.session.recovery}</p>{/if}
        <form class="wk-form" onsubmit={async (e) => { e.preventDefault(); if (await act('steer', { content: instruction })) instruction = ''; }}>
          <label class="wk-field"><span class="wk-label">Guide this build</span><textarea bind:value={instruction} required rows="3" placeholder="For example: keep the date controls visible while scrolling."></textarea></label>
          <button class="wk-run" disabled={busy}>Send instruction</button>
        </form>
        <p class="wk-muted">Acknowledged means Pi queued the message; included means it reached the session. Acceptance checks prove the resulting behaviour.</p>
        {#if snapshot.instructions.length}
          <div class="wk-rows">
            {#each [...snapshot.instructions].reverse() as item (item.id)}
              <div class="wk-row">
                <p class="wk-row-mark">{item.cancelledAt ? 'Cancelled' : item.consumedAt ? 'Included in session' : item.acknowledgedAt ? 'Acknowledged by Pi' : item.dispatchedAt ? 'Dispatched · awaiting receipt' : 'Saved · waiting for Pi'}</p>
                <p class="wk-pre">{item.content}</p>
              </div>
            {/each}
          </div>
        {/if}

        <h2 class="wk-h2">Decisions</h2>
        {#each deliveryState.decisions as decision (decision.id)}
          <form class="wk-form" onsubmit={(e) => { e.preventDefault(); void act('answer', { decisionId: decision.id, answer: answers[decision.id] }); }}>
            <label class="wk-field"><span class="wk-label">{decision.question}</span>{#if decision.answer}<p class="wk-answer">{decision.answer}</p>{:else}<textarea required bind:value={answers[decision.id]} rows="2"></textarea>{/if}</label>
            {#if !decision.answer}<button class="wk-ghost" disabled={busy}>Save answer</button>{/if}
          </form>
        {:else}<p class="wk-muted">No pending decisions.</p>{/each}

        <details class="wk-fold"><summary>Record a decision or pin a constraint</summary>
          <form class="wk-form" onsubmit={async (e) => { e.preventDefault(); if (await act('decision', { question })) question = ''; }}><label class="wk-field"><span class="wk-label">Decision needed</span><input required bind:value={question} /></label><button class="wk-ghost" disabled={busy}>Record decision</button></form>
          <form class="wk-form" onsubmit={async (e) => { e.preventDefault(); if (await act('note', { content: note })) note = ''; }}><label class="wk-field"><span class="wk-label">Pinned constraint</span><input required bind:value={note} /></label><button class="wk-ghost" disabled={busy}>Pin constraint</button></form>
          {#each snapshot.notes as item (item.id)}<p class="wk-lesson">{item.content} <button class="wk-inline" disabled={busy} onclick={() => act('remove_note', { noteId: item.id })}>Remove</button></p>{/each}
        </details>
        <details class="wk-fold"><summary>Advanced build controls and logs</summary><p><a class="wk-link" href={`/jkai/builds/${buildId}`}>Open the existing build console →</a></p></details>

      {:else if tab === 'Preview'}
        <SectionHead
          kicker="03 / The preview"
          title={['Try it before', 'you accept it']}
          strap="An isolated full-site preview of one candidate revision. Working preview before release candidate — a preview of saved work verifies nothing on its own."
        />
        {#if !deliveryState.gate?.passed}
          <div class="wk-alert wk-alert-act">
            <div><strong>Working preview before release candidate</strong><p class="wk-muted">Try the first useful page while iteration continues. Full repository checks and acceptance evidence are still required.</p></div>
            {#if !deliveryState.candidate}<button class="wk-ghost" disabled={busy || running || !snapshot.progress?.iterations.some(i => i.tokensUsed > 0)} onclick={() => act('inspect_preview')}>Prepare inspection preview</button>{/if}
          </div>
        {/if}
        <div class="wk-actions">
          <button class="wk-ghost" disabled={busy || running || !deliveryState.candidate} onclick={() => act('preview')}>Prepare preview</button>
          <button class="wk-ghost" aria-pressed={phone} onclick={() => phone = !phone}>{phone ? 'Desktop width' : 'Phone width'}</button>
          {#if previewHref}<a class="wk-link" href={previewHref} target="_blank" rel="noopener noreferrer">Open site preview ↗</a><button class="wk-ghost" disabled={busy || running} onclick={() => act('close_preview')}>Close preview</button>{/if}
        </div>
        {#if deliveryState.preview.url}<p class="wk-stamp"><strong>{deliveryState.preview.kind === 'working' ? `Working preview ${deliveryState.preview.number ?? 1}` : deliveryState.preview.kind === 'release' ? 'Release candidate' : 'Inspection preview'}</strong> · revision {deliveryState.preview.revision?.slice(0, 12) ?? 'legacy'}</p>{/if}
        {#if deliveryState.preview.lastError}<p class="wk-alert wk-alert-bad" role="alert">{deliveryState.preview.lastError}</p>{/if}
        {#if deliveryState.preview.evidence?.length}<details class="wk-fold"><summary>Feature browser checks</summary>{#each deliveryState.preview.evidence as evidence}<p>{evidence}</p>{/each}</details>{/if}
        {#if deliveryState.preview.url?.startsWith('http://127.0.0.1:')}<p class="wk-muted">This preview uses a loopback port on the build host. When reviewing from another computer, forward that port before opening it here.</p>{:else if deliveryState.preview.url}<p class="wk-muted">Preview access lasts eight hours. Use Prepare preview to refresh an expired link.</p>{/if}
        <p class="wk-stamp" role="status">{deliveryState.preview.status} · {deliveryState.preview.detail}</p>
        {#if deliveryState.brief.routes.length}
          <div class="wk-actions" aria-label="Feature routes">{#each deliveryState.brief.routes as route (route)}<button class="wk-chip" class:on={chosenRoute === route} aria-pressed={chosenRoute === route} onclick={() => previewRoute = route}>{route}</button>{/each}</div>
        {/if}
        {#if previewHref}<div class:phone class="wk-preview"><iframe title="Isolated feature preview" src={previewHref} sandbox="allow-scripts allow-forms allow-same-origin allow-downloads"></iframe></div>{/if}

        <h2 class="wk-h2">Acceptance evidence</h2>
        <p class="wk-muted">Candidate {deliveryState.candidate?.slice(0, 12) ?? 'not prepared'}. Record what you actually exercised, including data or provider limitations.</p>
        <div class="wk-rows">
          {#each deliveryState.criteria as criterion (criterion.id)}
            <form class="wk-row wk-criterion" onsubmit={(e) => { e.preventDefault(); void act('criterion', { criterionId: criterion.id, verdict: verdicts[criterion.id] ?? 'unverified', evidence: evidence[criterion.id] ?? '' }); }}>
              <p class="wk-criterion-text">{criterion.text}</p>
              <div class="wk-criterion-controls">
                <label class="wk-field wk-narrow"><span class="wk-label">Verdict</span><select aria-label="Verdict for {criterion.text}" bind:value={verdicts[criterion.id]}><option value="unverified">Not exercised</option><option value="passed">Passed</option><option value="failed">Failed</option><option value="blocked">Blocked</option></select></label>
                <label class="wk-field"><span class="wk-label">Evidence</span><textarea aria-label="Evidence for {criterion.text}" bind:value={evidence[criterion.id]} rows="2" placeholder="What was tested, observed or blocked"></textarea></label>
              </div>
              <div class="wk-actions"><button class="wk-ghost" disabled={busy || running || !deliveryState.candidate || (!!deliveryState.preview.revision && deliveryState.preview.revision !== deliveryState.candidate)}>Save evidence</button><span class="wk-stamp">Recorded: {criterion.verdict}</span></div>
            </form>
          {/each}
        </div>

      {:else}
        <SectionHead
          kicker="04 / Delivery"
          title={['Into the', 'cumulative batch']}
          strap="The candidate joins previously accepted local work after integration checks. A pull request and a production release remain separate actions."
        />
        {#if deliveryState.changes}
          <details class="wk-fold"><summary>Review {deliveryState.changes.files.length} changed files</summary>
            <ul class="wk-files">{#each deliveryState.changes.files as file (file)}<li>{file}</li>{/each}</ul>
            <pre class="wk-patch">{deliveryState.changes.patch}</pre>
            <p class="wk-muted">Diff excerpt limited to 20,000 characters. The advanced build console provides the workspace files.</p>
          </details>
        {/if}
        <p class="wk-lede">{snapshot.blocker ?? 'The current candidate has the required acceptance evidence.'}</p>
        <div class="wk-actions">
          <button class="wk-run" disabled={busy || !!snapshot.blocker || !!deliveryState.acceptedAt} onclick={() => act('accept')}>{busy ? 'Working…' : deliveryState.acceptedAt ? 'Accepted into batch' : 'Accept into batch'}</button>
          {#if deliveryState.batch}<span class="wk-stamp">Batch revision {deliveryState.batch.slice(0, 12)}</span>{/if}
        </div>

        <details class="wk-fold"><summary>Save a reusable repository lesson</summary>
          <form class="wk-form" onsubmit={(e) => { e.preventDefault(); void act('lesson', { lesson, evidence: lessonEvidence }); }}>
            <label class="wk-field"><span class="wk-label">Verified lesson</span><textarea required bind:value={lesson} rows="3"></textarea></label>
            <label class="wk-field"><span class="wk-label">Supporting evidence</span><textarea required bind:value={lessonEvidence} rows="3"></textarea></label>
            <button class="wk-ghost" disabled={busy || !deliveryState.acceptedAt}>Save lesson for 90 days</button>
          </form>
        </details>

        <h2 class="wk-h2">Delivery history</h2>
        <div class="wk-rows">
          {#each snapshot.events as event (event.id)}
            <div class="wk-row wk-event"><span>{event.kind.replaceAll('_', ' ')}</span><time>{new Date(event.createdAt).toLocaleString()}</time></div>
          {:else}<div class="wk-row"><p class="wk-muted">Nothing recorded yet.</p></div>{/each}
        </div>
      {/if}
    {/if}
  </div>
</DaydreamShell>

<style>
  .wk {
    max-width: 1500px;
    margin: 0 auto;
    padding: clamp(28px, 3.4vw, 52px) clamp(18px, 3vw, 44px) clamp(34px, 4vw, 60px);
    min-width: 0;
  }

  /* ——— rail controls ——— */
  .wk-back {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
    text-decoration: none;
    white-space: nowrap;
    margin-right: 6px;
  }
  .wk-back:hover { color: var(--accent); }

  .wk-run,
  .wk-ghost,
  .wk-chip {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    white-space: nowrap;
    padding: 8px 15px;
    border-radius: 0;
    cursor: pointer;
    transition:
      background-color var(--t-fast) var(--ease-out),
      border-color var(--t-fast) var(--ease-out),
      color var(--t-fast) var(--ease-out);
  }
  .wk-run {
    color: var(--bg);
    background: var(--accent);
    border: 1px solid var(--accent);
  }
  .wk-run:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }
  .wk-ghost,
  .wk-chip {
    color: var(--text-primary);
    background: transparent;
    border: 1px solid var(--line-strong);
  }
  .wk-ghost:hover:not(:disabled),
  .wk-chip:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .wk-chip.on {
    background: var(--text-primary);
    border-color: var(--text-primary);
    color: var(--bg);
  }
  .wk-run:disabled,
  .wk-ghost:disabled,
  .wk-chip:disabled {
    opacity: 0.45;
    cursor: default;
  }

  /* ——— notices ——— */
  .wk-note,
  .wk-alert {
    font-size: var(--fs-nav);
    line-height: 1.5;
    margin: 0 0 16px;
  }
  .wk-note { color: var(--text-secondary); }
  .wk-alert {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    flex-wrap: wrap;
    border-left: 3px solid var(--accent-ink);
    background: var(--surface-sunken);
    padding: 13px 16px;
  }
  .wk-alert-act { border-left-color: var(--accent); }
  .wk-alert-bad { border-left-color: var(--error); color: var(--error); }
  .wk-alert p { margin: 5px 0 0; }

  /* ——— type ——— */
  .wk-h2 {
    font-family: var(--font-display);
    font-size: var(--fs-display-xs);
    line-height: 1.05;
    letter-spacing: -0.01em;
    text-transform: uppercase;
    margin: 34px 0 14px;
  }
  .wk-eyebrow {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0 0 9px;
  }
  .wk-lede {
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: var(--text-secondary);
    max-width: 82ch;
    text-wrap: pretty;
    margin: 0 0 12px;
  }
  .wk-muted,
  .wk-empty {
    font-size: var(--fs-nav);
    line-height: 1.5;
    color: var(--text-secondary);
    max-width: 88ch;
    margin: 10px 0;
  }
  .wk-stamp {
    display: inline-block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .wk-link { color: var(--accent-ink); font-size: var(--fs-nav); }
  .wk-inline {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent);
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
  }
  .wk-pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--fs-nav); line-height: 1.5; margin: 0; }
  .wk-answer { font-size: var(--fs-nav); color: var(--text-secondary); margin: 4px 0 0; white-space: pre-wrap; }

  /* ——— grooming ——— */
  .wk-groom {
    border-left: 3px solid var(--accent);
    background: var(--surface-sunken);
    padding: 18px 20px;
    margin: 0 0 22px;
  }
  .wk-questions {
    font-size: var(--fs-nav);
    line-height: 1.55;
    color: var(--text-secondary);
    margin: 0 0 14px;
    padding-left: 20px;
  }

  /* ——— forms ——— */
  .wk-form { margin: 0 0 18px; }
  fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
  .wk-field {
    display: flex;
    flex-direction: column;
    gap: 7px;
    margin-bottom: 14px;
    min-width: 0;
  }
  .wk-narrow { max-width: 280px; }
  .wk-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  input,
  textarea,
  select {
    font: inherit;
    font-size: var(--fs-body);
    color: var(--text-primary);
    background: var(--surface-elevated);
    border: 1px solid var(--line-strong);
    border-radius: 0;
    padding: 10px 12px;
    width: 100%;
    box-sizing: border-box;
    line-height: 1.5;
  }
  textarea { resize: vertical; }
  .wk-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0 22px; }
  .wk-actions {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
    margin: 12px 0;
  }

  /* ——— ledgers: one hairline between rows, drawn as the container's ground ——— */
  .wk-rows {
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: var(--card-border);
    border: 1px solid var(--card-border);
    margin: 14px 0;
  }
  .wk-row {
    background: var(--bg);
    padding: 16px 18px;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .wk-row-mark {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0 0 8px;
  }
  .wk-event {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    font-size: var(--fs-nav);
    color: var(--text-secondary);
  }
  .wk-event time { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }
  .wk-criterion-text {
    font-family: var(--font-display);
    font-size: var(--fs-body-sm);
    line-height: 1.25;
    text-transform: uppercase;
    margin: 0 0 12px;
  }
  .wk-criterion-controls { display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 0 22px; align-items: start; }
  .wk-criterion .wk-actions { margin-bottom: 0; }
  .wk-lesson { font-size: var(--fs-nav); line-height: 1.5; margin: 0 0 12px; }
  .wk-lesson .wk-stamp { display: block; margin-top: 5px; }

  /* ——— folds ——— */
  .wk-fold {
    border-top: 1px solid var(--line);
    padding: 12px 0;
    margin: 14px 0;
    font-size: var(--fs-nav);
  }
  summary {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
    cursor: pointer;
  }
  summary:hover { color: var(--accent); }
  .wk-fold > :not(summary) { margin-top: 12px; }
  .wk-files { font-family: var(--font-code); font-size: var(--fs-label); color: var(--text-secondary); padding-left: 20px; }
  .wk-patch {
    max-height: 500px;
    overflow: auto;
    white-space: pre;
    font-family: var(--font-code);
    font-size: var(--fs-label);
    padding: 14px;
    background: var(--surface-sunken);
    border: 1px solid var(--line);
  }

  /* ——— preview ——— */
  .wk-preview {
    width: 100%;
    height: 650px;
    margin: 18px 0;
    border: 1px solid var(--line-strong);
    background: var(--surface-elevated);
  }
  .wk-preview.phone { max-width: 390px; }
  iframe { width: 100%; height: 100%; border: 0; }

  a:focus-visible,
  button:focus-visible,
  input:focus-visible,
  select:focus-visible,
  textarea:focus-visible,
  summary:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }

  @media (max-width: 760px) {
    /* The rail's controls take one row on a phone and the four of them are
       430px wide against a 390px screen. The way back is the first thing to
       go: jkai's own header already carries `← Develop` two rows above this. */
    .wk-back { display: none; }
    .wk-cols,
    .wk-criterion-controls { grid-template-columns: 1fr; gap: 0; }
    .wk-narrow { max-width: none; }
    .wk-preview { height: 550px; }
    .wk-event { flex-direction: column; gap: 4px; }
  }
</style>
