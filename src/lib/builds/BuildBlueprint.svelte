<script lang="ts">
  /**
   * What this build is actually running — the machinery, not the output.
   *
   * Read-only by design. The prompt, the lint rules and the gate checks live in
   * code and are shared by every build; per-build overrides would mean changing
   * the orchestrator. What a human needs here is not an edit box but an answer
   * to "why did it do that", which until now meant opening a second session and
   * reading src/lib/jkai/prompt.ts.
   *
   * The tweakable equivalents live in the Controls tab.
   */
  import ShikiCodeBlock from '$lib/canvas/nodes/ShikiCodeBlock.svelte';
  import { publishedLink } from './published-link';

  interface Config {
    mode: 'app' | 'repo' | 'studio';
    port: number;
    systemPrompt: string;
    toolsets: Array<{ toolset: string; description: string; toolCount: number }>;
    lint: {
      enabled: boolean;
      /** The linter also no-ops on a workspace with no .svelte file. */
      svelteOnly: boolean;
      rules: Array<{ rule: string; summary: string; detail: string }>;
      exemptMounts: string[];
    };
    gate: {
      applies: boolean;
      chapterCount: number;
      hasPort: boolean;
      checks: Array<{ rule: string; scope: string; summary: string }>;
    };
    sidecar: { name: string; socket: string; up: boolean; detail: string };
  }

  interface Build {
    origin: string;
    status: string;
    planStatus: string;
    researchBrief: unknown;
    chapterPlan: Array<{ n: number; title: string }> | null;
    publishedSlug: string | null;
    serveConfig: unknown;
    iterationsCompleted: number;
  }

  let {
    build,
    config,
    gateState = null,
    loading = false,
    error = null,
  }: {
    build: Build;
    config: Config | null;
    /**
     * Live gate result, read out of the log stream by cockpit-metrics. The
     * catalogue below says what the gate CHECKS; this says what it currently
     * FINDS, which is the thing you actually open a second session to look up.
     */
    gateState?: { ran: boolean; passed: boolean | null; failingTests: string[] } | null;
    loading?: boolean;
    error?: string | null;
  } = $props();

  const isStudio = $derived(build.origin === 'studio');

  type StageState = 'done' | 'active' | 'pending' | 'skipped' | 'blocked';

  /**
   * The pipeline, with each stage's state derived from the build row rather
   * than from a stored progress column — a column would say "research done"
   * long after the process behind it died.
   */
  const stages = $derived.by(() => {
    const terminal = ['completed', 'failed'].includes(build.status);
    const running = build.status === 'running';
    const out: Array<{ key: string; label: string; detail: string; state: StageState }> = [];

    if (isStudio) {
      out.push({
        key: 'research',
        label: 'Research brief',
        detail: build.researchBrief
          ? 'FACTS and GAPS written; citations resolve against its fact URLs'
          : 'not yet written',
        state: build.researchBrief ? 'done' : running ? 'active' : 'pending',
      });
    }

    out.push({
      key: 'plan',
      label: isStudio ? 'Chapter plan' : 'Delivery plan',
      detail:
        build.planStatus === 'approved'
          ? isStudio
            ? `${build.chapterPlan?.length ?? 0} chapters in the spine`
            : 'approved'
          : build.planStatus,
      state: build.planStatus === 'approved' ? 'done' : 'active',
    });

    out.push({
      key: 'iterate',
      label: isStudio ? 'Chapter loop' : 'Iteration loop',
      detail: `${build.iterationsCompleted} iteration${build.iterationsCompleted === 1 ? '' : 's'} completed`,
      state: terminal ? 'done' : running ? 'active' : 'pending',
    });

    out.push({
      key: 'lint',
      label: 'Design lint',
      detail: config?.lint.enabled
        ? `${config.lint.rules.length} rules, run over every written file`
        : 'disabled for this build',
      state: config?.lint.enabled === false ? 'skipped' : build.iterationsCompleted > 0 ? 'done' : 'pending',
    });

    if (isStudio) {
      const noSpine = (build.chapterPlan?.length ?? 0) === 0;
      const noPort = config ? !config.gate.hasPort : false;
      out.push({
        key: 'gate',
        label: 'Studio gate',
        detail: noSpine
          ? 'BLOCKED — the spine is empty, so nothing is being checked'
          : noPort
            ? 'BLOCKED — no serving port recorded; the preview never came up healthy'
            : `${config?.gate.checks.length ?? 0} checks driven in a real browser`,
        state: noSpine || noPort ? 'blocked' : build.iterationsCompleted > 0 ? 'done' : 'pending',
      });
    }

    out.push({
      key: 'publish',
      label: 'Publish',
      detail: publishedLink(build.publishedSlug)
        ? `live at ${publishedLink(build.publishedSlug)!.href}`
        : build.publishedSlug
          ? `pushed as ${build.publishedSlug}`
          : build.serveConfig
          ? 'preview serving; not published'
          : 'no preview yet',
      state: build.publishedSlug ? 'done' : 'pending',
    });

    return out;
  });

  let showPrompt = $state(false);
</script>

<div class="bb">
  {#if loading}
    <p class="bb-empty">Reading the build's configuration…</p>
  {:else if error}
    <p class="bb-err" role="alert">{error}</p>
  {/if}

  <!-- Pipeline ---------------------------------------------------------- -->
  <section class="bb-sec">
    <h3 class="sr-label-tight">Pipeline</h3>
    <ol class="bb-pipe">
      {#each stages as s (s.key)}
        <li class="bb-stage" data-state={s.state}>
          <span class="bb-stage-mark" aria-hidden="true"></span>
          <span class="bb-stage-body">
            <span class="bb-stage-label">{s.label}</span>
            <span class="bb-stage-detail">{s.detail}</span>
          </span>
          <span class="bb-stage-state">{s.state}</span>
        </li>
      {/each}
    </ol>
  </section>

  <!-- Sidecar ----------------------------------------------------------- -->
  <section class="bb-sec">
    <h3 class="sr-label-tight">Sidecar</h3>
    {#if config}
      <div class="bb-sidecar" class:down={!config.sidecar.up}>
        <span class="bb-dot" aria-hidden="true"></span>
        <span class="bb-sidecar-name">{config.sidecar.name}</span>
        <span class="bb-sidecar-state">{config.sidecar.up ? 'reachable' : 'DOWN'}</span>
        <code class="bb-sidecar-detail">{config.sidecar.detail}</code>
      </div>
      <p class="bb-help">
        Probed live over its Unix socket on every load, not read from a status column. The builder
        owns all in-flight build state and has its own systemd unit, so deploying the site does not
        kill a running build — but if this says DOWN, nothing is driving the build at all.
      </p>
      <dl class="bb-facts">
        <dt>Socket</dt>
        <dd class="bb-break">{config.sidecar.socket}</dd>
        <dt>Serving port</dt>
        <dd>{config.port > 0 ? config.port : 'not yet assigned'}</dd>
        <dt>Prompt mode</dt>
        <dd>{config.mode}</dd>
      </dl>
    {:else if !loading}
      <p class="bb-empty">Unavailable.</p>
    {/if}
  </section>

  <!-- Guardrails -------------------------------------------------------- -->
  <section class="bb-sec">
    <h3 class="sr-label-tight">Guardrails — design lint</h3>
    {#if config}
      {#if !config.lint.enabled}
        <p class="bb-empty">
          Disabled for this build. Nothing is checking written files for off-system colour, utility
          classes or untokenised fonts.
        </p>
      {/if}
      <ul class="bb-rules">
        {#each config.lint.rules as r (r.rule)}
          <li class:off={!config.lint.enabled}>
            <code class="bb-rule">{r.rule}</code>
            <span class="bb-rule-sum">{r.summary}</span>
            <span class="bb-rule-detail">{r.detail}</span>
          </li>
        {/each}
      </ul>
      {#if config.lint.enabled && config.lint.svelteOnly}
        <p class="bb-help">
          Runs only when the workspace contains at least one <code>.svelte</code> file. A plain
          HTML/CSS/JS build is skipped silently — the toggle reads "on" but nothing is checked.
        </p>
      {/if}
      <p class="bb-help">
        Exempt mounts: {#each config.lint.exemptMounts as m, i (m)}<code>{m}</code>{#if i < config.lint.exemptMounts.length - 1}, {/if}{/each} —
        read-only reference directories regenerated every iteration. A finding inside one cannot be
        fixed, and three unfixable findings in a row aborts the build.
      </p>
    {/if}
  </section>

  <!-- Gate -------------------------------------------------------------- -->
  {#if config?.gate.applies}
    <section class="bb-sec">
      <h3 class="sr-label-tight">Gate — does the explainer actually teach?</h3>
      {#if config.gate.chapterCount === 0}
        <p class="bb-warn">
          The chapter spine is empty. No reachability, interactivity, citation or kit-usage findings
          will be produced — the guardrail is off, not passing. Add chapters in Controls.
        </p>
      {:else if !config.gate.hasPort}
        <p class="bb-warn">
          No serving port is recorded, so the gate cannot drive a browser at this build. It reports
          "skipped", never "passed".
        </p>
      {/if}

      <!-- What it currently finds, not just what it checks. A harness that
           could not run reports "skipped" — never "passed" — so the three
           states are kept distinct here rather than collapsed into a boolean. -->
      <div class="bb-gate-state" data-state={!gateState?.ran ? 'unknown' : gateState.passed ? 'pass' : 'fail'}>
        <span class="bb-dot" aria-hidden="true"></span>
        {#if !gateState?.ran}
          <span>Not run yet on this build — no findings either way.</span>
        {:else if gateState.passed}
          <span>Passing: every chapter due so far is reachable, visual, interactive and cited.</span>
        {:else}
          <span>
            Failing.
            {#if gateState.failingTests.length}
              Named in the last run: {gateState.failingTests.join(', ')}.
            {:else}
              Open the Stream pane and filter to the latest iteration for the findings.
            {/if}
          </span>
        {/if}
      </div>
      <ul class="bb-rules">
        {#each config.gate.checks as c (c.rule)}
          <li>
            <code class="bb-rule">{c.rule}</code>
            <span class="bb-rule-sum">{c.summary}</span>
            <span class="bb-rule-detail">{c.scope === 'project' ? 'whole project' : 'per chapter'}</span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <!-- Prompt ------------------------------------------------------------ -->
  <section class="bb-sec">
    <div class="bb-sec-hd">
      <h3 class="sr-label-tight">System prompt</h3>
      <button class="row-link" type="button" onclick={() => (showPrompt = !showPrompt)}>
        {showPrompt ? 'hide' : 'show'}
      </button>
    </div>
    <p class="bb-help">
      The standing instruction every iteration of this build starts from, for mode
      <code>{config?.mode ?? '—'}</code>. It lives in code and is shared by every build of this
      mode — to add something specific to this one, pin a standing instruction in Controls.
    </p>
    {#if showPrompt && config}
      <ShikiCodeBlock content={config.systemPrompt} lang="markdown" collapsedLines={24} dark />
    {/if}
  </section>

  <!-- Toolsets ---------------------------------------------------------- -->
  {#if config && config.toolsets.length > 0}
    <section class="bb-sec">
      <h3 class="sr-label-tight">Tool bridge</h3>
      <p class="bb-help">
        {config.toolsets.length} toolsets registered,
        {config.toolsets.reduce((s, t) => s + t.toolCount, 0)} tools total. Which of these the agent
        can actually reach is set in Controls.
      </p>
    </section>
  {/if}
</div>

<style>
  /* Padding on the container, not on a coloured background — a padded box whose
     background is the divider colour draws that colour as a band around the
     content. Sections carry their own borders instead. */
  .bb {
    padding: 0.75rem 0 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    font-family: var(--font-body);
  }
  .bb-sec {
    background: var(--bg);
    border: 1px solid var(--card-border);
    border-top: 2px solid var(--text-primary);
    padding: 0.85rem 0.9rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    min-width: 0;
  }
  .bb-sec h3 {
    margin: 0;
    color: var(--text-secondary);
  }
  .bb-sec-hd {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
  }
  .bb-help {
    margin: 0;
    font-size: var(--fs-label-xs, 12px);
    line-height: 1.55;
    color: var(--text-ghost);
  }
  .bb-help code,
  .bb-sec code {
    font-family: var(--font-mono);
    color: var(--accent-ink);
  }
  .bb-empty {
    margin: 0;
    font-size: var(--fs-label);
    color: var(--text-ghost);
    font-style: italic;
  }
  .bb-err,
  .bb-warn {
    margin: 0;
    padding: 0.5rem 0.7rem;
    font-size: var(--fs-body-sm, 15px);
    border-left: 4px solid var(--error);
    background: var(--error-bg);
    color: var(--text-primary);
  }
  .bb-warn {
    border-left-color: var(--warn);
    background: var(--warn-bg);
  }
  .bb-break {
    word-break: break-all;
  }

  /* --- Pipeline --- */
  .bb-pipe {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .bb-stage {
    display: grid;
    grid-template-columns: 1.4rem 1fr auto;
    gap: 0.6rem;
    align-items: start;
    padding: 0.45rem 0;
    min-width: 0;
  }
  /* The connecting rule: a vertical line through the marker column. */
  .bb-stage-mark {
    position: relative;
    width: 11px;
    height: 11px;
    margin-top: 0.3rem;
    justify-self: center;
    border: 2px solid var(--text-muted);
    background: var(--bg);
    border-radius: 100px;
    flex-shrink: 0;
  }
  .bb-stage:not(:last-child) .bb-stage-mark::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 100%;
    transform: translateX(-50%);
    width: 2px;
    height: calc(100% + 0.9rem);
    background: var(--card-border);
  }
  .bb-stage[data-state='done'] .bb-stage-mark {
    background: var(--success);
    border-color: var(--success);
  }
  .bb-stage[data-state='active'] .bb-stage-mark {
    background: var(--accent);
    border-color: var(--accent);
    animation: bb-pulse 1.4s ease-in-out infinite;
  }
  .bb-stage[data-state='blocked'] .bb-stage-mark {
    background: var(--error);
    border-color: var(--error);
  }
  .bb-stage[data-state='skipped'] .bb-stage-mark {
    border-style: dashed;
  }
  @keyframes bb-pulse {
    0%, 100% { opacity: 0.45; }
    50% { opacity: 1; }
  }
  .bb-stage-body {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }
  .bb-stage-label {
    font-size: var(--fs-body-sm, 15px);
    font-weight: 600;
    color: var(--text-primary);
  }
  .bb-stage-detail {
    font-size: var(--fs-label-xs, 12px);
    color: var(--text-ghost);
    overflow-wrap: anywhere;
  }
  .bb-stage-state {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs, 12px);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    flex-shrink: 0;
  }
  .bb-stage[data-state='blocked'] .bb-stage-state {
    color: var(--error);
  }
  .bb-stage[data-state='active'] .bb-stage-state {
    color: var(--accent);
  }
  .bb-stage[data-state='done'] .bb-stage-state {
    color: var(--success);
  }

  /* --- Sidecar --- */
  .bb-sidecar {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
    padding: 0.5rem 0.7rem;
    border: 1px solid var(--card-border);
    border-left: 4px solid var(--success);
    background: var(--bg-section);
    min-width: 0;
  }
  .bb-sidecar.down {
    border-left-color: var(--error);
    background: var(--error-bg);
  }
  .bb-dot {
    width: 8px;
    height: 8px;
    border-radius: 100px;
    background: var(--success);
    flex-shrink: 0;
  }
  .bb-sidecar.down .bb-dot {
    background: var(--error);
  }
  .bb-sidecar-name {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    font-weight: 600;
    color: var(--text-primary);
  }
  .bb-sidecar-state {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs, 12px);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--success);
  }
  .bb-sidecar.down .bb-sidecar-state {
    color: var(--error);
  }
  .bb-sidecar-detail {
    font-size: var(--fs-label-xs, 12px);
    color: var(--text-muted);
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .bb-facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.3rem 0.9rem;
    margin: 0;
    font-size: var(--fs-body-sm, 15px);
  }
  .bb-facts dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs, 12px);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .bb-facts dd {
    margin: 0;
    color: var(--text-primary);
    min-width: 0;
  }

  .bb-gate-state {
    display: flex;
    align-items: baseline;
    gap: 0.55rem;
    padding: 0.5rem 0.7rem;
    border: 1px solid var(--card-border);
    border-left: 4px solid var(--text-muted);
    background: var(--bg-section);
    font-size: var(--fs-body-sm, 15px);
  }
  .bb-gate-state[data-state='pass'] { border-left-color: var(--success); }
  .bb-gate-state[data-state='fail'] {
    border-left-color: var(--error);
    background: var(--error-bg);
  }
  .bb-gate-state .bb-dot { background: var(--text-muted); align-self: center; }
  .bb-gate-state[data-state='pass'] .bb-dot { background: var(--success); }
  .bb-gate-state[data-state='fail'] .bb-dot { background: var(--error); }

  /* --- Rule lists --- */
  .bb-rules {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .bb-rules li {
    display: grid;
    grid-template-columns: minmax(0, 11rem) 1fr;
    gap: 0.2rem 0.8rem;
    padding: 0.4rem 0.5rem;
    background: var(--bg-section);
    border-left: 3px solid var(--accent);
    min-width: 0;
  }
  .bb-rules li.off {
    border-left-color: var(--card-border);
    opacity: 0.55;
  }
  .bb-rule {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs, 12px);
    color: var(--accent-ink);
    overflow-wrap: anywhere;
  }
  .bb-rule-sum {
    font-size: var(--fs-body-sm, 15px);
    color: var(--text-primary);
  }
  .bb-rule-detail {
    grid-column: 2;
    font-size: var(--fs-label-xs, 12px);
    color: var(--text-ghost);
    line-height: 1.5;
  }

  @media (max-width: 640px) {
    .bb-rules li {
      grid-template-columns: 1fr;
    }
    .bb-rule-detail {
      grid-column: 1;
    }
    .bb-stage {
      grid-template-columns: 1.4rem 1fr;
    }
    .bb-stage-state {
      grid-column: 2;
    }
  }
</style>
