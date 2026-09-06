<script lang="ts">
  import type { ImprovementDashboardData } from '$lib/dashboard/improvement.server';

  let { data, embedded = false }: { data: ImprovementDashboardData; embedded?: boolean } = $props();

  type Run = ImprovementDashboardData['runs'][number];
  type Attempt = ImprovementDashboardData['attempts'][number];
  type Capability = ImprovementDashboardData['deployedCapabilities'][number];

  interface TestResponse {
    ok?: boolean;
    data?: unknown;
    error?: string;
    recorded?: boolean;
    test?: { testedAt: string; success: boolean; ms: number; error?: string };
  }

  const deployed = $derived(data.deployedCapabilities ?? []);
  let capabilitySearch = $state('');
  let capabilityFilter = $state('all');
  let capabilityPage = $state(1);
  const filteredCapabilities = $derived(deployed.filter((c) =>
    `${c.name} ${c.description} ${c.jkaiTestPrompt}`.toLowerCase().includes(capabilitySearch.trim().toLowerCase()) &&
    (capabilityFilter === 'all' || (capabilityFilter === 'untested' ? !hasPassedLiveTest(c) : hasPassedLiveTest(c)))));
  $effect(() => { capabilitySearch; capabilityFilter; capabilityPage = 1; });

  let expandedRun = $state<string | null>(null);
  let expandedAttempt = $state<string | null>(null);
  let attemptFilter = $state<'all' | 'created' | 'rejected'>('all');
  let testArgs = $state<Record<string, string>>({});
  let testingTool = $state<string | null>(null);
  let testResults = $state<Record<string, TestResponse>>({});
  let promotingTool = $state<string | null>(null);
  let promotionErrors = $state<Record<string, string>>({});

  type StoryFilter = 'changes' | 'queued' | 'all';
  let storyFilter = $state<StoryFilter>('changes');
  let showTech = $state(false);

  const stories = $derived(data.stories ?? []);
  const storySummary = $derived(data.storySummary);
  const changeStories = $derived(stories.filter((s) => s.status !== 'queued'));
  const queuedStories = $derived(stories.filter((s) => s.status === 'queued'));
  const visibleStories = $derived(
    storyFilter === 'changes' ? changeStories : storyFilter === 'queued' ? queuedStories : stories,
  );
  // Ideas that a shipped tool appears to cover already. Surfaced on the default
  // view rather than left behind the "queued" filter, because it is a finding
  // about the ENGINE — it is not closing these out, so it may rebuild them.
  const staleQueued = $derived(queuedStories.filter((s) => s.note).length);

  /** Why a driver can be trusted — shown, never hidden. */
  const CONFIDENCE_NOTE: Record<string, string> = {
    recorded: 'The engine recorded this reason when it did the work.',
    inferred:
      'Matched to the week’s unmet needs after the fact — the engine did not record the link itself.',
    unknown: 'No reason was recorded and none could be matched.',
  };

  const stats = $derived(data.stats);
  const insights = $derived(data.insights);
  const opportunities = $derived(insights?.opportunities ?? []);

  // ── Prime outcome: tool calls per answered question ──────────────────────
  const eff = $derived(data.efficiency?.latest ?? null);
  const history = $derived(data.efficiency?.history ?? []);
  const activePolicy = $derived(data.activePolicy);

  let measuring = $state(false);
  let measureError = $state<string | null>(null);
  let reverting = $state<number | null>(null);

  async function measureNow() {
    measuring = true;
    measureError = null;
    try {
      const res = await fetch('/api/admin/improvement/efficiency', { method: 'POST' });
      if (!res.ok) {
        measureError = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'measurement failed';
      } else {
        location.reload();
      }
    } catch {
      measureError = 'measurement failed';
    } finally {
      measuring = false;
    }
  }

  async function revertTo(version: number) {
    if (!confirm(`Roll the tool-call policy back to v${version}${version === 0 ? ' (no overlay at all)' : ''}?`)) return;
    reverting = version;
    try {
      const res = await fetch('/api/admin/improvement/policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version }),
      });
      if (res.ok) location.reload();
    } finally {
      reverting = null;
    }
  }

  function argsText(capability: Capability): string {
    return testArgs[capability.name] ?? JSON.stringify(capability.sampleArgs, null, 2);
  }

  function updateArgs(name: string, event: Event) {
    testArgs[name] = (event.currentTarget as HTMLTextAreaElement).value;
  }

  async function runLiveTest(capability: Capability) {
    let args: Record<string, unknown>;
    try {
      const parsed = JSON.parse(argsText(capability)) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      args = parsed as Record<string, unknown>;
    } catch {
      testResults[capability.name] = { error: 'Arguments must be a valid JSON object.' };
      return;
    }

    testingTool = capability.name;
    testResults[capability.name] = {};
    try {
      const res = await fetch('/api/admin/improvement/test-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptKey: capability.attemptKey, name: capability.name, args }),
      });
      const payload = (await res.json().catch(() => ({}))) as TestResponse;
      testResults[capability.name] = res.ok ? payload : { error: payload.error ?? 'Live test failed.' };
    } catch {
      testResults[capability.name] = { error: 'Live test could not reach the server.' };
    } finally {
      testingTool = null;
    }
  }

  async function startPromotionTrial(capability: Capability) {
    promotingTool = capability.name;
    promotionErrors[capability.name] = '';
    try {
      const res = await fetch('/api/admin/improvement/policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rationale:
            `Promote self-improvement capability ${capability.name} after a successful deployed acceptance test ` +
            'so JKAI can reach it without a discovery round-trip.',
          promoteToEssential: [capability.name],
          targetTool: capability.name,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) promotionErrors[capability.name] = payload.error ?? 'Promotion trial could not start.';
      else location.reload();
    } catch {
      promotionErrors[capability.name] = 'Promotion trial could not reach the server.';
    } finally {
      promotingTool = null;
    }
  }

  function jkaiHref(capability: Capability): string {
    return `/jkai?new=1&q=${encodeURIComponent(capability.jkaiTestPrompt)}`;
  }

  function hasPassedLiveTest(capability: Capability): boolean {
    return capability.lastLiveTest?.success === true || testResults[capability.name]?.ok === true;
  }

  /** Sparkline path over the persisted daily means. */
  function sparkPath(points: Array<{ meanCalls: number }>, w = 220, h = 34): string {
    if (points.length < 2) return '';
    const vals = points.map((p) => p.meanCalls);
    const max = Math.max(...vals, 1);
    const min = Math.min(...vals, 0);
    const span = max - min || 1;
    return vals
      .map((v, i) => {
        const x = (i / (vals.length - 1)) * w;
        const y = h - ((v - min) / span) * h;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }

  function trialLabel(p: NonNullable<typeof activePolicy>): string {
    if (!p.trial) return 'no trial';
    if (p.trial.status === 'running') return `on trial · ${p.trial.turnsObserved}/30 turns`;
    return p.trial.status;
  }

  const visibleAttempts = $derived(
    attemptFilter === 'all'
      ? data.attempts
      : data.attempts.filter((a: Attempt) => a.data.status === attemptFilter),
  );

  function toggleRun(id: string) {
    expandedRun = expandedRun === id ? null : id;
  }
  function toggleAttempt(id: string) {
    expandedAttempt = expandedAttempt === id ? null : id;
  }

  function fmtDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString('en-GB', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  }
  function fmtMs(ms: number | undefined): string {
    if (!ms) return '—';
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  }
  function fmtCost(n: number): string {
    return `$${(n ?? 0).toFixed(n < 1 ? 4 : 2)}`;
  }
  /** "30 Jul" — the story arc wants a date, not a timestamp. */
  function fmtDay(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? '—'
      : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  // Action-kind chips shown in the breakdown, in a sensible reading order.
  const KIND_LABELS: Record<string, string> = {
    insight: 'insights',
    api_registered: 'APIs registered',
    api_verified: 'APIs verified',
    tool_created: 'tools built',
    tool_rejected: 'tools rejected',
    proposal: 'proposals',
  };
  const kindOrder = ['insight', 'api_verified', 'api_registered', 'tool_created', 'tool_rejected', 'proposal'];
</script>

<svelte:head><title>{embedded ? 'Daydreams — JKAI' : 'Self-Improvement — JKAI'}</title></svelte:head>

<div class="wrap" class:embedded>
  {#if !embedded}<header class="page-hdr">
    <div>
      <div class="kicker">JKAI · Self-Improvement</div>
      <h1>The Ledger</h1>
      <p class="sub">
        Every change the nightly engine has made to itself, in plain English: what
        <strong>drove</strong> it, what it <strong>did</strong> about it, and what
        <strong>came of it</strong>. The raw runs, rejected code and phase timings are still here,
        under Technical detail.
      </p>
    </div>
    <div class="hdr-links">
      <a class="back-link" href="/jkai">JKAI</a>
      <a class="back-link" href="/admin/ai/improvement">Controls →</a>
    </div>
  </header>{/if}

  <section class="prime">
    <div class="prime-hd">
      <div>
        <div class="sr-label-tight">Call efficiency · tool calls per answered question</div>
        <p class="prime-sub">
          Tool calls per ordinary chat answer, measured nightly. New capabilities take priority
          over efficiency experiments. Agentic work is tracked separately.
        </p>
      </div>
      <button class="measure-btn" onclick={measureNow} disabled={measuring}>
        {measuring ? 'Measuring…' : 'Measure now'}
      </button>
    </div>

    {#if measureError}
      <div class="empty err">{measureError}</div>
    {/if}

    {#if !eff}
      <div class="empty">
        Not measured yet — run the nightly engine or press <strong>Measure now</strong>.
      </div>
    {:else}
      <div class="prime-grid">
        <div class="stat-tile prime-tile">
          <div class="stat-num">{eff.chat.meanCalls}</div>
          <div class="stat-label">calls / chat turn</div>
          <div class="stat-sub">
            median {eff.chat.medianCalls} · p90 {eff.chat.p90Calls} · {eff.chat.turns} turns
          </div>
        </div>
        <div class="stat-tile prime-tile">
          <div class="stat-num">{eff.chat.repeatCalls}</div>
          <div class="stat-label">repeat calls</div>
          <div class="stat-sub">
            same tool twice in one turn · {eff.chat.duplicateCalls} byte-identical
          </div>
        </div>
        <div class="stat-tile prime-tile muted">
          <div class="stat-num">{eff.agentic.meanCalls}</div>
          <div class="stat-label">calls / agentic turn</div>
          <div class="stat-sub">{eff.agentic.turns} turns · tracked, not optimised</div>
        </div>
        <div class="stat-tile prime-tile muted">
          <div class="stat-num">{eff.discoveryCalls}</div>
          <div class="stat-label">discovery calls</div>
          <div class="stat-sub">jkai_extended list/schema round-trips</div>
        </div>
      </div>

      {#if history.length >= 2}
        <div class="spark-row">
          <svg class="spark" viewBox="0 0 220 34" preserveAspectRatio="none" aria-hidden="true">
            <path d={sparkPath(history)} fill="none" stroke="var(--accent)" stroke-width="1.5" />
          </svg>
          <span class="spark-meta mono">
            {history[0].day} → {history[history.length - 1].day} ·
            {history[0].meanCalls} → {history[history.length - 1].meanCalls} calls/turn
          </span>
        </div>
      {/if}

      {#if eff.patterns?.length}
        <div class="patterns">
          <div class="sr-label-tight">Biggest repeat patterns (chat turns) — the engine's work list</div>
          <div class="rows tight">
            {#each eff.patterns.slice(0, 6) as pat (pat.tool)}
              <div class="pat-row">
                <span class="pat-tool mono">{pat.tool}</span>
                <span class="pat-track">
                  <span class="pat-bar" style="--w:{Math.min(100, (pat.repeatCalls / (eff.patterns[0].repeatCalls || 1)) * 100)}%"></span>
                </span>
                <span class="pat-num mono">
                  {pat.repeatCalls} wasted · {pat.turns} turn{pat.turns === 1 ? '' : 's'} · worst {pat.worstInOneTurn}×
                </span>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    {/if}
  </section>

  <!-- ── DEPLOYED ACCEPTANCE ──────────────────────────────────────────────
       Smoke tests happened before deployment. These controls exercise the
       handler that is registered now, then hand the same outcome to JKAI to
       prove the assistant can discover it from an ordinary request. -->
  <section class="block acceptance-block">
    <div class="block-hd">
      <span class="sr-label-tight">Prove what shipped</span>
      <span class="block-meta">{deployed.length} deployed {deployed.length === 1 ? 'capability' : 'capabilities'}</span>
    </div>
    <p class="acceptance-lede">Find a shipped example, expand it, then test the handler or try its prompt in JKAI.</p>
    <div class="example-toolbar">
      <input class="nm-text-input" aria-label="Search shipped examples" placeholder="Search names, descriptions or example prompts…" bind:value={capabilitySearch} />
      <select class="nm-text-input" aria-label="Filter live test status" bind:value={capabilityFilter}>
        <option value="all">All examples</option><option value="untested">Needs live test</option><option value="tested">Live-tested</option>
      </select>
      <span class="block-meta" role="status">{filteredCapabilities.length} matches</span>
    </div>

    {#if deployed.length === 0}
      <div class="empty">No self-improvement tools are currently deployed.</div>
    {:else}
      <div class="acceptance-list">
        {#each filteredCapabilities.slice((capabilityPage - 1) * 8, capabilityPage * 8) as capability (capability.name)}
          <details class="acceptance-card" class:accepted={hasPassedLiveTest(capability)}>
            <summary class="acceptance-hd">
              <div>
                <span class="story-title mono">{capability.name}</span>
                <span class="story-sub">{capability.description}</span>
              </div>
              <span class="story-pill">
                {capability.promoted
                  ? 'direct in JKAI'
                  : capability.promotionTrial
                    ? 'promotion trial'
                    : hasPassedLiveTest(capability)
                      ? 'live-tested'
                      : 'needs live test'}
              </span>
            </summary>

            <div class="acceptance-grid">
              <div class="acceptance-step">
                <div class="step-label mono"><span>1</span> Test the deployed handler</div>
                <p>These are the generated smoke arguments. Edit them to exercise a useful real case.</p>
                <textarea
                  class="args-editor mono"
                  aria-label="Live test arguments for {capability.name}"
                  value={argsText(capability)}
                  oninput={(event) => updateArgs(capability.name, event)}
                  rows="5"
                ></textarea>
                <button
                  type="button"
                  class="measure-btn"
                  disabled={testingTool === capability.name || !capability.enabled}
                  onclick={() => runLiveTest(capability)}
                >
                  {testingTool === capability.name ? 'Running live…' : 'Run live test'}
                </button>
                {#if !capability.enabled}<span class="inline-note bad">disabled — cannot test</span>{/if}
                {#if testResults[capability.name]?.error}
                  <pre class="test-result fail">{testResults[capability.name].error}</pre>
                {:else if testResults[capability.name]?.test}
                  <pre class="test-result" class:pass={testResults[capability.name].ok}>
{testResults[capability.name].ok ? 'PASS' : 'FAIL'} · {testResults[capability.name].test?.ms ?? 0}ms
{JSON.stringify(testResults[capability.name].data ?? testResults[capability.name].error ?? null, null, 2)}</pre>
                {:else if capability.lastLiveTest}
                  <p class="last-test mono" class:pass={capability.lastLiveTest.success}>
                    Last live test {fmtDate(capability.lastLiveTest.testedAt)} ·
                    {capability.lastLiveTest.success ? 'passed' : `failed: ${capability.lastLiveTest.error ?? 'unknown'}`}
                  </p>
                {/if}
              </div>

              <div class="acceptance-step">
                <div class="step-label mono"><span>2</span> Test discovery in JKAI</div>
                <p>Send this unchanged in a fresh chat. Check that the answer uses live data and names this capability.</p>
                <blockquote class="jkai-prompt">{capability.jkaiTestPrompt}</blockquote>
                <a class="measure-btn button-link" href={jkaiHref(capability)}>Open test in JKAI →</a>
                <p class="usage mono">
                  {capability.jkaiRuns} estimated JKAI/ambient run{capability.jkaiRuns === 1 ? '' : 's'} ·
                  {capability.errorCount} error{capability.errorCount === 1 ? '' : 's'}
                </p>
              </div>

              <div class="acceptance-step promotion-step">
                <div class="step-label mono"><span>3</span> Promotion</div>
                {#if capability.promoted}
                  <p>Directly visible to JKAI. Its policy remains measured and reversible.</p>
                {:else if capability.promotionTrial}
                  <p>Direct access is on trial. Use a fresh JKAI chat so the refreshed manifest is tested.</p>
                {:else}
                  <p>
                    Promotion removes the discovery round-trip, but adds this schema to every chat. Start only after
                    the live result is useful; the trial will keep or revert it against calls per answer.
                  </p>
                  <button
                    type="button"
                    class="measure-btn"
                    disabled={!hasPassedLiveTest(capability) || promotingTool === capability.name || activePolicy?.trial?.status === 'running'}
                    onclick={() => startPromotionTrial(capability)}
                  >
                    {promotingTool === capability.name ? 'Starting…' : 'Start promotion trial'}
                  </button>
                  {#if activePolicy?.trial?.status === 'running'}
                    <span class="inline-note">wait for policy v{activePolicy.version}</span>
                  {:else if !hasPassedLiveTest(capability)}
                    <span class="inline-note">pass step 1 first</span>
                  {/if}
                {/if}
                {#if promotionErrors[capability.name]}
                  <p class="inline-error">{promotionErrors[capability.name]}</p>
                {/if}
              </div>
            </div>
          </details>
        {:else}<p class="empty">No examples match these filters.</p>{/each}
      </div>
      {#if filteredCapabilities.length > 8}
        <div class="example-toolbar">
          <button class="measure-btn" disabled={capabilityPage === 1} onclick={() => capabilityPage--}>Previous</button>
          <span class="block-meta">Page {capabilityPage} of {Math.ceil(filteredCapabilities.length / 8)}</span>
          <button class="measure-btn" disabled={capabilityPage * 8 >= filteredCapabilities.length} onclick={() => capabilityPage++}>Next</button>
        </div>
      {/if}
    {/if}
  </section>

  {#if opportunities.length > 0}
    <section class="block frontier-block">
      <div class="block-hd">
        <span class="sr-label-tight">Value beyond more tools</span>
        <span class="block-meta">latest portfolio audit</span>
      </div>
      <p class="acceptance-lede">
        The cycle now audits missing data, online services and site functionality as separate investment choices.
        A tool is only one delivery shape; each opportunity names who benefits and why it is worth connecting.
      </p>
      <div class="frontier-grid">
        {#each opportunities as opportunity}
          <article class="frontier-card">
            <div class="frontier-meta mono">{opportunity.kind.replace(/_/g, ' ')} · {opportunity.consumer}</div>
            <strong>{opportunity.title}</strong>
            <p>{opportunity.value}</p>
            {#if opportunity.integrationHint}<small>{opportunity.integrationHint}</small>{/if}
          </article>
        {/each}
      </div>
    </section>
  {/if}

  <!-- ── WHAT CHANGED AND WHY ────────────────────────────────────────────
       The lead. One card per improvement, each answering the same three
       questions in the same order, so the page can be read top to bottom
       without knowing what a "phase" or an "overlay" is. -->
  <section class="block stories-block">
    <div class="block-hd">
      <span class="sr-label-tight">What changed and why</span>
      <div class="seg" role="group" aria-label="Filter improvements">
        <button type="button" class="seg-btn" class:on={storyFilter === 'changes'}
          aria-pressed={storyFilter === 'changes'} onclick={() => (storyFilter = 'changes')}>
          changes ({changeStories.length})
        </button>
        <button type="button" class="seg-btn" class:on={storyFilter === 'queued'}
          aria-pressed={storyFilter === 'queued'} onclick={() => (storyFilter = 'queued')}>
          queued ({queuedStories.length})
        </button>
        <button type="button" class="seg-btn" class:on={storyFilter === 'all'}
          aria-pressed={storyFilter === 'all'} onclick={() => (storyFilter = 'all')}>
          all ({stories.length})
        </button>
      </div>
    </div>

    {#if storySummary && stories.length > 0}
      <p class="stories-lede">
        <strong>{storySummary.live}</strong> new {storySummary.live === 1 ? 'capability' : 'capabilities'} live ·
        <strong>{storySummary.fixed}</strong> repaired ·
        <strong>{storySummary.onTrial}</strong> on trial ·
        <strong>{storySummary.queued}</strong> queued ·
        <strong>{storySummary.rejected}</strong> tried and dropped
      </p>
    {/if}

    {#if staleQueued > 0}
      <p class="stale-warn">
        <strong>{staleQueued}</strong> queued {staleQueued === 1 ? 'idea looks' : 'ideas look'} already
        served by a tool that has shipped, but {staleQueued === 1 ? 'it is' : 'they are'} still marked
        open — so the engine may build the same thing twice.
        <button type="button" class="link-btn" onclick={() => (storyFilter = 'queued')}>Show them</button>
      </p>
    {/if}

    {#if visibleStories.length === 0}
      <div class="empty">
        {stories.length === 0
          ? 'Nothing yet. After the first nightly run this is where each improvement is explained.'
          : storyFilter === 'changes'
            ? 'Nothing has changed yet — only queued ideas so far.'
            : 'No queued ideas.'}
      </div>
    {:else}
      <div class="story-grid">
        {#each visibleStories as s (s.id)}
          <article class="story st-{s.status}">
            <header class="story-hd">
              <div class="story-id">
                <span class="story-title mono">{s.title}</span>
                {#if s.subtitle}<span class="story-sub">{s.subtitle}</span>{/if}
              </div>
              <span class="story-pill">{s.statusLabel}</span>
            </header>

            <dl class="story-body">
              <dt>Driver</dt>
              <dd>
                <p>{s.driver}</p>
                {#if s.driverEvidence}
                  <p class="evidence mono">{s.driverEvidence}</p>
                {/if}
                {#if s.driverQuotes?.length}
                  <ul class="quotes">
                    {#each s.driverQuotes as q}<li>“{q}”</li>{/each}
                  </ul>
                {/if}
                <span class="conf conf-{s.linkConfidence}" title={CONFIDENCE_NOTE[s.linkConfidence]}>
                  {s.linkConfidence}
                </span>
              </dd>

              <dt>Solution</dt>
              <dd><p>{s.solution}</p></dd>

              <dt>Outcome</dt>
              <dd>
                <p>{s.outcome}</p>
                <span class="okind ok-{s.outcomeKind}">
                  {s.outcomeKind === 'measured'
                    ? 'measured'
                    : s.outcomeKind === 'expected'
                      ? 'expected — not yet proven'
                      : 'too early to tell'}
                </span>
              </dd>
            </dl>

            {#if s.note}
              <p class="story-note">{s.note}</p>
            {/if}

            <footer class="story-arc mono">
              {#each s.events as e, i}
                {#if i > 0}<span class="arc-sep">→</span>{/if}
                <span class="arc-step">{fmtDay(e.at)} {e.label}</span>
              {/each}
            </footer>
          </article>
        {/each}
      </div>
    {/if}
  </section>

  <!-- ── Technical detail ─────────────────────────────────────────────────
       Everything below is the raw audit trail. Collapsed by default: it is
       still the truth of record, but it is not how you find out what changed. -->
  <button class="tech-toggle" onclick={() => (showTech = !showTech)} aria-expanded={showTech}>
    <span class="chevron">{showTech ? '▾' : '▸'}</span>
    <span class="sr-label-tight">Technical detail</span>
    <span class="tech-meta mono">runs, phases, generated code, policy versions, raw insights</span>
  </button>

  {#if showTech}
  <!-- ── Tool-call policy: the non-destructive lever + its history ───────── -->
  <section class="block">
    <div class="block-hd">
      <span class="sr-label-tight">Tool-call policy</span>
      <span class="block-meta">
        {activePolicy ? `v${activePolicy.version} live` : 'no overlay'} · {data.policyVersions.length} version{data.policyVersions.length === 1 ? '' : 's'}
      </span>
    </div>
    <p class="policy-note">
      Description overlays the engine publishes to make tools cheaper to call. These are
      <strong>data, not code</strong> — no deploy to apply, no revert to undo. Each change goes live on
      trial against the baseline above and rolls itself back if it doesn't beat it.
    </p>
    {#if data.policyVersions.length === 0}
      <div class="empty">No policy versions yet — the base tool descriptions are in force.</div>
    {:else}
      <div class="rows">
        {#each data.policyVersions as v (v.version)}
          <div class="row policy-row" class:live={activePolicy?.version === v.version}>
            <div class="policy-head">
              <span class="ver mono">v{v.version}</span>
              <span class="status-pill s-{v.trial?.status ?? 'none'}">{trialLabel(v)}</span>
              <span class="row-title">{v.targetTool ?? '—'}</span>
              <span class="row-tags mono">
                <span>{fmtDate(v.createdAt)}</span>
                <span>{v.createdBy}</span>
              </span>
              {#if activePolicy?.version !== v.version}
                <button class="revert-btn" onclick={() => revertTo(v.version)} disabled={reverting === v.version}>
                  {reverting === v.version ? '…' : 'Revert to this'}
                </button>
              {:else}
                <span class="live-tag mono">LIVE</span>
              {/if}
            </div>
            <div class="policy-body">
              <div class="rationale">{v.rationale}</div>
              {#if v.trial?.verdict}<div class="verdict mono">{v.trial.verdict}</div>{/if}
              {#each Object.entries(v.overrides) as [tool, o] (tool)}
                <div class="ovr">
                  <span class="ovr-tool mono">{tool}</span>
                  <span class="ovr-text">{o.description ?? ''}{o.guidance ? ` ${o.guidance}` : ''}</span>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
      {#if activePolicy && activePolicy.version > 0}
        <button class="revert-btn base" onclick={() => revertTo(0)} disabled={reverting === 0}>
          Remove all overlays (back to base descriptions)
        </button>
      {/if}
    {/if}
  </section>

  <!-- ── Summary statistics ─────────────────────────────────────────────── -->
  <section class="stats">
    <div class="stat-tile">
      <div class="stat-num">{stats.totalRuns}</div>
      <div class="stat-label">runs logged</div>
      <div class="stat-sub">{stats.lastRunAt ? `last ${fmtDate(stats.lastRunAt)}` : 'none yet'}</div>
    </div>
    <div class="stat-tile">
      <div class="stat-num">
        {stats.toolSuccessRate === null ? '—' : `${stats.toolSuccessRate}%`}
      </div>
      <div class="stat-label">tool build success</div>
      <div class="stat-sub">{stats.toolsCreated} built · {stats.toolsRejected} rejected</div>
    </div>
    <div class="stat-tile">
      <div class="stat-num">{stats.apisTotal}</div>
      <div class="stat-label">APIs catalogued</div>
      <div class="stat-sub">{stats.apisAddedByEngine} added by engine</div>
    </div>
    <div class="stat-tile">
      <div class="stat-num">{fmtCost(stats.totalCostUsd)}</div>
      <div class="stat-label">total spend</div>
      <div class="stat-sub">{fmtCost(stats.avgCostUsd)}/run · {stats.totalLlmCalls} calls</div>
    </div>
    <div class="stat-tile">
      <div class="stat-num">{stats.insightsLogged}</div>
      <div class="stat-label">insights</div>
      <div class="stat-sub">{stats.proposals} proposals</div>
    </div>
    <div class="stat-tile schedule">
      <div class="stat-num sched-time">{data.schedule.display.split(' ')[0]}</div>
      <div class="stat-label">nightly schedule</div>
      <div class="stat-sub">
        {#if data.running}<span class="live-dot"></span> running now{:else}Europe/London{/if}
      </div>
    </div>
  </section>

  <!-- Action-kind breakdown -->
  <section class="breakdown">
    <div class="sr-label-tight">Activity breakdown (across {stats.totalRuns} run{stats.totalRuns === 1 ? '' : 's'})</div>
    <div class="chips">
      {#each kindOrder as k}
        <span class="chip" class:zero={(stats.actionKindCounts[k] ?? 0) === 0}>
          <span class="chip-num">{stats.actionKindCounts[k] ?? 0}</span>
          <span class="chip-label">{KIND_LABELS[k]}</span>
        </span>
      {/each}
    </div>
  </section>

  <!-- ── Runs ───────────────────────────────────────────────────────────── -->
  <section class="block">
    <div class="block-hd">
      <span class="sr-label-tight">Runs</span>
      <span class="block-meta">{data.runs.length} shown</span>
    </div>
    {#if data.runs.length === 0}
      <div class="empty">No runs yet — the first nightly run is at {data.schedule.display}, or trigger one from Controls.</div>
    {:else}
      <div class="rows">
        {#each data.runs as run (run.runId)}
          <div class="row">
            <button class="row-head" onclick={() => toggleRun(run.runId)} aria-expanded={expandedRun === run.runId}>
              <span class="status-pill s-{run.data.status}">{run.data.status.replace(/_/g, ' ')}</span>
              <span class="row-title">{fmtDate(run.createdAt)}</span>
              <span class="row-tags mono">
                <span>{run.data.trigger}</span>
                <span>{run.data.actions?.length ?? 0} actions</span>
                <span>{fmtCost(run.data.costUsd ?? 0)}</span>
              </span>
              <span class="chevron">{expandedRun === run.runId ? '▾' : '▸'}</span>
            </button>
            {#if expandedRun === run.runId}
              <div class="row-body">
                <div class="phases">
                  {#each Object.entries(run.data.phases ?? {}) as [name, p]}
                    <span class="phase p-{p.status}" title={p.detail ?? ''}>
                      {name} · {p.status}{#if p.ms} · {fmtMs(p.ms)}{/if}
                    </span>
                  {/each}
                </div>
                {#if (run.data.actions?.length ?? 0) === 0}
                  <div class="empty compact">No actions recorded.</div>
                {:else}
                  <ul class="actions">
                    {#each run.data.actions ?? [] as a}
                      <li><span class="action-kind ak-{a.kind}">{a.kind}</span><span class="action-detail">{a.detail}</span></li>
                    {/each}
                  </ul>
                {/if}
                {#if run.data.report}
                  <div class="report-label">Report</div>
                  <pre class="report">{run.data.report}</pre>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <!-- ── Tool attempts ──────────────────────────────────────────────────── -->
  <section class="block">
    <div class="block-hd">
      <span class="sr-label-tight">Tool build attempts</span>
      <div class="seg" role="group" aria-label="Filter attempts">
        {#each ['all', 'created', 'rejected'] as f}
          <button type="button" class="seg-btn" class:on={attemptFilter === f}
            aria-pressed={attemptFilter === f} onclick={() => (attemptFilter = f as typeof attemptFilter)}>{f}</button>
        {/each}
      </div>
    </div>
    {#if visibleAttempts.length === 0}
      <div class="empty">
        {data.attempts.length === 0
          ? 'No tool build attempts yet. When the engine tries to author a tool, both successes and rejections land here with their code.'
          : `No ${attemptFilter} attempts.`}
      </div>
    {:else}
      <div class="rows">
        {#each visibleAttempts as att (att.key)}
          <div class="row">
            <button class="row-head" onclick={() => toggleAttempt(att.key)} aria-expanded={expandedAttempt === att.key}>
              <span class="status-pill s-{att.data.status === 'created' ? 'complete' : 'failed'}">{att.data.status}</span>
              <span class="row-title mono">{att.data.name}</span>
              <span class="row-tags"><span class="att-desc">{att.data.description}</span></span>
              <span class="chevron">{expandedAttempt === att.key ? '▾' : '▸'}</span>
            </button>
            {#if expandedAttempt === att.key}
              <div class="row-body">
                <div class="att-meta mono">
                  <span>toolset: {att.data.toolset}</span>
                  <span>{fmtDate(att.data.attemptedAt)}</span>
                </div>
                {#if att.data.status === 'rejected' && att.data.reason}
                  <div class="reject-reason"><span class="rr-label">Rejected:</span> {att.data.reason}</div>
                {/if}
                <div class="code-label">Generated handler</div>
                <pre class="code"><code>{att.data.handlerCode}</code></pre>
                <div class="code-label">Sample args (smoke test)</div>
                <pre class="code small"><code>{JSON.stringify(att.data.sampleArgs, null, 2)}</code></pre>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <!-- ── Question insights ──────────────────────────────────────────────── -->
  <section class="block">
    <div class="block-hd">
      <span class="sr-label-tight">Latest question insights</span>
      {#if insights?.period}<span class="block-meta">{insights.period}</span>{/if}
    </div>
    {#if !insights || ((insights.intents?.length ?? 0) === 0 && (insights.topUnmet?.length ?? 0) === 0)}
      <div class="empty">No insights yet — they’re learned on the first run.</div>
    {:else}
      {#if insights.summary}<p class="ins-summary">{insights.summary}</p>{/if}
      {#if (insights.intents?.length ?? 0) > 0}
        <table class="intents">
          <thead><tr><th>Intent</th><th class="num">Count</th><th>Served</th><th>Missing capability</th></tr></thead>
          <tbody>
            {#each insights.intents as it}
              <tr>
                <td>{it.intent}</td>
                <td class="num mono">{it.count}</td>
                <td>{it.servedWell === false ? '⚠︎ gap' : it.servedWell ? 'yes' : '—'}</td>
                <td class="muted">{it.missingCapability ?? ''}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
      {#if (insights.topUnmet?.length ?? 0) > 0}
        <div class="unmet-label">Top unmet needs</div>
        <ul class="unmet">{#each insights.topUnmet as u}<li>{u}</li>{/each}</ul>
      {/if}
    {/if}
  </section>
  {/if}
</div>

<style>
  /* Deployed acceptance: three explicit gates, all against the live registry. */
  .acceptance-block { margin-top: 1.5rem; }
  .acceptance-lede { max-width: 76ch; margin: 0 0 0.9rem; color: var(--text-secondary); font-size: var(--fs-body-sm); line-height: 1.6; }
  .acceptance-lede strong { color: var(--text-primary); }
  .acceptance-list { display: flex; flex-direction: column; gap: 0.7rem; }
  .acceptance-card { border: 1px solid var(--line-strong); border-left: 3px solid var(--warn, #b0892a); background: var(--surface-sunken); padding: 0.9rem 1rem 1rem; }
  .acceptance-card.accepted { border-left-color: var(--success, #2d7a3a); }
  .acceptance-hd { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; margin-bottom: 0.8rem; }
  .acceptance-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-top: 1px solid var(--line-hair); }
  .acceptance-step { min-width: 0; padding: 0.8rem 0.85rem 0 0; }
  .acceptance-step + .acceptance-step { border-left: 1px solid var(--line-hair); padding-left: 0.85rem; }
  .step-label { display: flex; align-items: center; gap: 0.45rem; font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-primary); }
  .step-label span { display: inline-grid; place-items: center; width: 1.25rem; height: 1.25rem; border: 1px solid var(--accent); color: var(--accent); }
  .acceptance-step > p { margin: 0.55rem 0; color: var(--text-muted); font-size: var(--fs-label); line-height: 1.5; }
  .args-editor { display: block; box-sizing: border-box; width: 100%; resize: vertical; margin: 0.55rem 0; padding: 0.55rem; border: 1px solid var(--line-strong); border-radius: 0; background: var(--bg); color: var(--text-primary); font-size: var(--fs-label-xs); line-height: 1.45; }
  .jkai-prompt { margin: 0.55rem 0; padding: 0.55rem 0.65rem; border-left: 2px solid var(--accent); background: var(--bg); color: var(--text-secondary); font-size: var(--fs-label); line-height: 1.5; }
  .button-link { display: inline-block; box-sizing: border-box; text-decoration: none; }
  .inline-note { margin-left: 0.45rem; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .inline-note.bad, .inline-error { color: var(--error, #c44); }
  .inline-error { margin: 0.5rem 0 0; font-size: var(--fs-label); line-height: 1.45; }
  .test-result { max-height: 12rem; overflow: auto; margin: 0.55rem 0 0; padding: 0.55rem; border: 1px solid var(--error, #c44); background: var(--bg); color: var(--error, #c44); font: var(--fs-label-xs)/1.45 var(--font-mono); white-space: pre-wrap; overflow-wrap: anywhere; }
  .test-result.pass { border-color: var(--success, #2d7a3a); color: var(--success, #2d7a3a); }
  .last-test, .usage { font-size: var(--fs-label-xs) !important; color: var(--text-ghost) !important; }
  .last-test.pass { color: var(--success, #2d7a3a) !important; }

  .frontier-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 0.55rem; }
  .frontier-card { padding: 0.75rem 0.8rem; border: 1px solid var(--line-strong); background: var(--surface-sunken); }
  .frontier-meta { margin-bottom: 0.4rem; color: var(--accent); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; }
  .frontier-card strong { display: block; color: var(--text-primary); font-size: var(--fs-body-sm); }
  .frontier-card p { margin: 0.35rem 0; color: var(--text-secondary); font-size: var(--fs-label); line-height: 1.5; }
  .frontier-card small { color: var(--text-ghost); font-size: var(--fs-label-xs); line-height: 1.45; }

  @media (max-width: 820px) {
    .acceptance-grid { grid-template-columns: 1fr; }
    .acceptance-step { padding-right: 0; }
    .acceptance-step + .acceptance-step { border-left: 0; border-top: 1px solid var(--line-hair); margin-top: 0.8rem; padding-left: 0; }
  }

  /* ── Plain-English improvement cards ──────────────────────────────────────
     A card is a three-row definition list so Driver / Solution / Outcome line
     up down the page and can be scanned column-wise. The status colour lives on
     the left rule only — the SR system has no shadows and no filled cards. */
  .stories-block { margin-bottom: 1.5rem; }
  .stories-lede { margin: 0 0 0.9rem; font-size: var(--fs-nav); line-height: 1.6; color: var(--text-secondary); }
  .stories-lede strong { color: var(--text-primary); font-weight: 700; }

  .stale-warn { margin: 0 0 0.9rem; padding: 0.55rem 0.7rem; border-left: 2px solid var(--warn, #b0892a); background: var(--card-bg); font-size: var(--fs-label); line-height: 1.55; color: var(--text-secondary); }
  .stale-warn strong { color: var(--text-primary); font-weight: 700; }
  .link-btn { background: none; border: none; padding: 0; font: inherit; color: var(--accent); text-decoration: underline; cursor: pointer; }

  .story-grid { display: flex; flex-direction: column; gap: 0.5rem; }
  .story { border: 1px solid var(--line-strong); border-left: 3px solid var(--text-muted); background: var(--surface-sunken); padding: 0.85rem 1rem 0.75rem; }
  .story.st-live { border-left-color: var(--success, #2d7a3a); }
  .story.st-fixed { border-left-color: var(--success, #2d7a3a); }
  .story.st-kept { border-left-color: var(--success, #2d7a3a); }
  .story.st-trial { border-left-color: var(--accent); }
  .story.st-catalogued { border-left-color: var(--accent-ink); }
  .story.st-reverted { border-left-color: var(--warn, #b0892a); }
  .story.st-rejected { border-left-color: var(--error, #c44); }
  .story.st-queued { border-left-color: var(--text-ghost); }

  .story-hd { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 0.7rem; }
  .story-id { min-width: 0; }
  .story-title { display: block; font-size: var(--fs-body-sm); font-weight: 700; color: var(--text-primary); overflow-wrap: anywhere; }
  .story-sub { display: block; margin-top: 0.2rem; font-size: var(--fs-label); line-height: 1.45; color: var(--text-muted); }
  .story-pill { flex: none; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; padding: 0.15rem 0.45rem; border: 1px solid var(--line-strong); color: var(--text-secondary); white-space: nowrap; }
  .st-live .story-pill, .st-fixed .story-pill, .st-kept .story-pill { color: var(--success, #2d7a3a); border-color: var(--success, #2d7a3a); }
  .st-trial .story-pill { color: var(--accent); border-color: var(--accent); }
  .st-rejected .story-pill { color: var(--error, #c44); border-color: var(--error, #c44); }
  .st-reverted .story-pill { color: var(--warn, #b0892a); border-color: var(--warn, #b0892a); }

  .story-body { display: grid; grid-template-columns: 5.5rem 1fr; gap: 0.35rem 0.9rem; margin: 0; }
  .story-body dt { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted); padding-top: 0.1rem; }
  .story-body dd { margin: 0; min-width: 0; }
  .story-body dd p { margin: 0; font-size: var(--fs-body-sm); line-height: 1.55; color: var(--text-secondary); }
  .story-body dd p.evidence { margin-top: 0.25rem; font-size: var(--fs-label-xs); color: var(--text-ghost); }

  .quotes { margin: 0.35rem 0 0; padding-left: 0.9rem; list-style: none; }
  .quotes li { position: relative; font-size: var(--fs-label); line-height: 1.5; color: var(--text-muted); font-style: italic; }
  .quotes li::before { content: ''; position: absolute; left: -0.9rem; top: 0.35em; bottom: 0.35em; width: 2px; background: var(--line); }

  .conf, .okind { display: inline-block; margin-top: 0.3rem; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-ghost); border-bottom: 1px dotted var(--line-strong); cursor: help; }
  .conf-recorded { color: var(--success, #2d7a3a); }
  .conf-inferred { color: var(--warn, #b0892a); }
  .okind { cursor: default; }
  .ok-measured { color: var(--success, #2d7a3a); }
  .ok-expected { color: var(--accent); }

  .story-note { margin: 0.7rem 0 0; padding: 0.5rem 0.65rem; border-left: 2px solid var(--warn, #b0892a); background: var(--card-bg); font-size: var(--fs-label); line-height: 1.5; color: var(--text-secondary); }
  .story-arc { margin-top: 0.7rem; padding-top: 0.55rem; border-top: 1px solid var(--line-hair); display: flex; flex-wrap: wrap; gap: 0.4rem; font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .arc-sep { color: var(--card-border); }

  /* Technical detail toggle */
  .tech-toggle { display: flex; align-items: center; gap: 0.6rem; width: 100%; padding: 0.7rem 0.85rem; margin-bottom: 1.25rem; background: none; border: 1px dashed var(--line-strong); cursor: pointer; text-align: left; color: inherit; font: inherit; }
  .tech-toggle:hover { border-color: var(--accent); }
  .tech-meta { margin-left: auto; font-size: var(--fs-label-xs); color: var(--text-ghost); }

  @media (max-width: 560px) {
    .story-body { grid-template-columns: 1fr; gap: 0.15rem; }
    .story-body dt { padding-top: 0.5rem; }
    .tech-meta { display: none; }
  }

  /* Prime outcome */
  .prime { border: 2px solid var(--text-primary); padding: 1rem 1.1rem 1.1rem; margin-bottom: 1.25rem; background: var(--surface-sunken); }
  .prime-hd { display: flex; justify-content: space-between; align-items: flex-start; gap: 1.25rem; margin-bottom: 0.9rem; }
  .prime-sub { margin: 0.5rem 0 0; font-size: 0.88rem; line-height: 1.5; color: var(--text-secondary); max-width: 62ch; }
  .prime-sub strong { color: var(--text-primary); font-weight: 700; }
  .prime-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.6rem; }
  .prime-tile { background: var(--bg); }
  .prime-tile.muted .stat-num { color: var(--text-muted); }
  .measure-btn, .revert-btn { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.12em; padding: 0.5rem 0.8rem; border: 1px solid var(--line-strong); background: var(--bg); color: var(--text-primary); cursor: pointer; white-space: nowrap; }
  .measure-btn:hover:not(:disabled), .revert-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .measure-btn:disabled, .revert-btn:disabled { opacity: 0.5; cursor: default; }
  .revert-btn.base { margin-top: 0.6rem; }
  .empty.err { color: var(--accent); }

  .spark-row { display: flex; align-items: center; gap: 0.75rem; margin-top: 0.8rem; }
  .spark { width: 220px; height: 34px; flex: none; }
  .spark-meta { font-size: var(--fs-label-xs); color: var(--text-ghost); }

  .patterns { margin-top: 1rem; }
  .rows.tight { margin-top: 0.4rem; }
  /* The BAR takes the spare width, not the label.
     It was `minmax(140px, 1fr) 90px`, so in a 1461px row the tool name — which
     needs about 120px — was given 1172 and the bar, the only thing on the row
     carrying a quantity, was left with 90. The mark should get the room; the
     label only needs to fit. */
  .pat-row { display: grid; grid-template-columns: minmax(140px, 260px) minmax(0, 1fr) minmax(180px, auto); align-items: center; gap: 0.6rem; padding: 0.35rem 0; border-bottom: 1px solid var(--line-hair); }
  /* A track behind the bar, so six lengths are read against one baseline
     rather than floating in the gap between two columns. */
  .pat-track { height: 6px; background: var(--card-border); min-width: 0; }
  /* On a phone the three fixed minimums add up to more than the row, and the
     middle column is the one that loses — the track measured 0px at 430px, so
     the chart simply was not there. Same fold as /health's ranked-moves row:
     the label and the figures share a line, the mark gets its own beneath. */
  @media (max-width: 620px) {
    .pat-row { grid-template-columns: minmax(0, 1fr) auto; row-gap: 0.35rem; }
    .pat-track { grid-column: 1 / -1; }
    .pat-num { text-align: right; }
  }
  .pat-tool { font-size: var(--fs-label); color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pat-bar { display: block; height: 6px; background: var(--accent); width: var(--w); min-width: 2px; }
  .pat-num { font-size: var(--fs-label-xs); color: var(--text-ghost); text-align: right; }

  /* Policy history */
  .policy-note { margin: 0.5rem 0 0.9rem; font-size: 0.88rem; line-height: 1.5; color: var(--text-secondary); max-width: 66ch; }
  .policy-note strong { color: var(--text-primary); font-weight: 700; }
  .policy-row.live { border-left: 3px solid var(--accent); }
  .policy-head { display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.75rem; flex-wrap: wrap; }
  .ver { font-size: var(--fs-label); font-weight: 700; color: var(--accent); }
  .live-tag { font-size: var(--fs-label-xs); letter-spacing: 0.14em; color: var(--accent); }
  .policy-body { padding: 0 0.75rem 0.7rem; }
  .rationale { font-size: 0.88rem; line-height: 1.45; color: var(--text-secondary); }
  .verdict { font-size: var(--fs-label-xs); color: var(--text-ghost); margin-top: 0.3rem; }
  .ovr { display: flex; gap: 0.5rem; margin-top: 0.45rem; font-size: 0.82rem; line-height: 1.4; }
  .ovr-tool { flex: none; font-size: var(--fs-label-xs); color: var(--accent); padding-top: 0.15rem; }
  .ovr-text { color: var(--text-secondary); }
  .status-pill.s-running { background: var(--accent-tint-25, rgba(196,87,10,0.18)); }
  .status-pill.s-kept { background: rgba(40, 120, 60, 0.18); }
  .status-pill.s-reverted { background: rgba(150, 40, 40, 0.18); }
  .status-pill.s-none { background: var(--line); }

  .wrap { max-width: 980px; margin: 2rem auto 4rem; padding: 0 1.5rem; color: var(--text-primary); font-family: var(--font-body); }
  .wrap.embedded { max-width: none; margin: 0; padding: 0; }
  .page-hdr { display: flex; justify-content: space-between; align-items: flex-end; gap: 1.5rem; margin-bottom: 1.75rem; padding-bottom: 1rem; border-bottom: 2px solid var(--text-primary); }
  .kicker { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.18em; color: var(--accent); margin-bottom: 0.35rem; }
  .page-hdr h1 { margin: 0; font-family: var(--font-display); font-size: 2.2rem; font-weight: 900; line-height: 1.05; }
  .sub { margin: 0.6rem 0 0; font-size: 0.95rem; line-height: 1.5; color: var(--text-secondary); max-width: 64ch; }
  .sub strong { color: var(--text-primary); font-weight: 700; }
  .hdr-links { display: flex; flex-direction: column; gap: 0.4rem; align-items: flex-end; flex-shrink: 0; }
  .back-link { font-family: var(--font-mono); font-size: var(--fs-label); text-transform: uppercase; letter-spacing: 0.12em; color: var(--accent); text-decoration: none; white-space: nowrap; }
  .back-link:hover { text-decoration: underline; }
  .mono { font-family: var(--font-mono); }

  /* Stat tiles */
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.6rem; margin-bottom: 1.25rem; }
  .stat-tile { border: 1px solid var(--line-strong); padding: 0.85rem 0.95rem; background: var(--surface-sunken); }
  .stat-num { font-family: var(--font-display); font-size: 1.9rem; font-weight: 900; line-height: 1; color: var(--text-primary); }
  .stat-num.sched-time { font-size: 1.5rem; }
  .stat-label { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted); margin-top: 0.4rem; }
  .stat-sub { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); margin-top: 0.25rem; }
  .live-dot { display: inline-block; width: 7px; height: 7px; border-radius: 100px; background: var(--accent); animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

  /* Breakdown chips */
  .breakdown { margin-bottom: 2rem; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.6rem; }
  .chip { display: inline-flex; align-items: baseline; gap: 0.4rem; border: 1px solid var(--line-strong); padding: 0.3rem 0.6rem; background: var(--surface-sunken); }
  .chip.zero { opacity: 0.45; }
  .chip-num { font-family: var(--font-display); font-weight: 900; font-size: 0.95rem; }
  .chip-label { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); }

  .sr-label-tight { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.16em; color: var(--text-muted); }

  .block { margin-bottom: 2rem; }
  .block-hd { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
  .block-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .empty { padding: 1.5rem; text-align: center; font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-ghost); font-style: italic; border: 1px dashed var(--line-strong); line-height: 1.5; }
  .empty.compact { padding: 0.75rem; }

  .rows { display: flex; flex-direction: column; gap: 0.4rem; }
  .row { border: 1px solid var(--line-strong); background: var(--surface-sunken); }
  .row-head { display: flex; align-items: center; gap: 0.75rem; width: 100%; padding: 0.65rem 0.85rem; background: none; border: none; cursor: pointer; text-align: left; color: inherit; font: inherit; }
  .row-head:hover { background: var(--card-bg); }
  .row-title { font-weight: 700; font-size: 0.9rem; }
  .row-tags { margin-left: auto; display: flex; gap: 0.85rem; font-size: var(--fs-label); color: var(--text-muted); align-items: center; }
  .att-desc { max-width: 42ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chevron { color: var(--text-ghost); font-size: 0.8rem; }

  .status-pill { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; padding: 0.15rem 0.4rem; border: 1px solid var(--line-strong); white-space: nowrap; }
  .s-complete { color: var(--accent); border-color: var(--accent); }
  .s-partial, .s-budget_exceeded { color: #b0821f; border-color: #b0821f; }
  .s-failed, .s-aborted_user_active { color: #b3452f; border-color: #b3452f; }
  .s-running { color: var(--text-secondary); }

  .row-body { padding: 0 0.85rem 0.85rem; border-top: 1px solid var(--line-strong); }
  .phases { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0.75rem 0; }
  .phase { font-family: var(--font-mono); font-size: var(--fs-label-xs); padding: 0.2rem 0.45rem; border: 1px solid var(--line-strong); color: var(--text-muted); }
  .p-ok { color: var(--accent); }
  .p-failed { color: #b3452f; }
  .p-skipped { opacity: 0.55; }

  .actions { list-style: none; margin: 0.5rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; }
  .actions li { display: flex; gap: 0.6rem; align-items: baseline; font-size: 0.85rem; }
  .action-kind { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; padding: 0.1rem 0.35rem; border: 1px solid var(--line-strong); color: var(--text-muted); flex-shrink: 0; min-width: 92px; text-align: center; }
  .ak-tool_created { color: var(--accent); border-color: var(--accent); }
  .ak-tool_rejected { color: #b3452f; border-color: #b3452f; }
  .ak-api_verified, .ak-api_registered { color: #2f7fb3; border-color: #2f7fb3; }
  .action-detail { color: var(--text-secondary); }

  .report-label, .code-label, .unmet-label { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted); margin: 0.9rem 0 0.35rem; }
  .report { margin: 0; padding: 0.75rem; background: var(--card-bg); border: 1px solid var(--line-strong); font-family: var(--font-body); font-size: 0.85rem; white-space: pre-wrap; line-height: 1.5; color: var(--text-secondary); }
  .att-meta { display: flex; gap: 1rem; font-size: var(--fs-label-xs); color: var(--text-ghost); margin: 0.75rem 0 0; }
  .reject-reason { margin: 0.6rem 0; padding: 0.55rem 0.7rem; border-left: 2px solid #b3452f; background: var(--card-bg); font-size: 0.85rem; color: var(--text-secondary); }
  .rr-label { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; color: #b3452f; }
  .code { margin: 0; padding: 0.75rem; background: var(--card-bg); border: 1px solid var(--line-strong); overflow-x: auto; font-family: var(--font-code); font-size: var(--fs-label); line-height: 1.5; color: var(--text-primary); }
  .code.small { font-size: var(--fs-label); }
  .code code { font: inherit; }

  .seg { display: inline-flex; border: 1px solid var(--line-strong); }
  .seg-btn { background: none; border: none; padding: 0.25rem 0.6rem; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); cursor: pointer; }
  .seg-btn.on { background: var(--accent); color: var(--bg); }

  .ins-summary { font-size: 0.9rem; line-height: 1.55; color: var(--text-secondary); margin: 0 0 0.9rem; }
  .intents { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  .intents th { text-align: left; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); padding: 0.35rem 0.5rem; border-bottom: 1px solid var(--line-strong); }
  .intents td { padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--line-strong); color: var(--text-secondary); }
  .intents .num { text-align: right; }
  .intents .muted { color: var(--text-ghost); }
  .unmet { margin: 0.4rem 0 0; padding-left: 1.1rem; font-size: 0.85rem; color: var(--text-secondary); line-height: 1.6; }

  @media (max-width: 640px) {
    .row-tags { display: none; }
    .page-hdr { flex-direction: column; align-items: flex-start; }
    .hdr-links { flex-direction: row; align-items: flex-start; }
  }
  .example-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
  .example-toolbar input { flex: 1 1 260px; width: auto; }
  .example-toolbar select { width: auto; }
  .acceptance-hd { cursor: pointer; }
  .acceptance-hd:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
  .acceptance-hd::before { content: '+'; color: var(--accent); font-weight: bold; }
  details[open] > .acceptance-hd::before { content: '−'; }
  .acceptance-hd > div { flex: 1; min-width: 0; }
  .acceptance-card:not([open]) .story-sub { display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
  .acceptance-grid { border-top: 1px solid var(--line); padding-top: 14px; }
  .args-editor { font-family: var(--font-code); }
  @media (max-width: 640px) { .prime-hd { flex-wrap: wrap; } .prime-hd > div { flex-basis: 100%; } .acceptance-hd { flex-wrap: wrap; } .acceptance-hd > div { flex-basis: 80%; } }
</style>
