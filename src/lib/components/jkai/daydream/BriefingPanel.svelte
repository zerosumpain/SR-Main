<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { untrack } from 'svelte';
  import ChatMarkdown from '$lib/canvas/ChatMarkdown.svelte';
  import JkaiPageTitle from '$lib/components/jkai/JkaiPageTitle.svelte';
  import type { BriefingData, BriefingSourceRow } from '$lib/briefing/types';
  import type {
    BriefingProfile,
    BriefingSourceDefinition,
    BriefingSourceKey,
  } from '$lib/constants/briefing';

  type SourceConnection = 'native' | 'connected' | 'available' | 'missing';
  type SourceOption = BriefingSourceDefinition & {
    preference: BriefingProfile['sources'][BriefingSourceKey];
    connection: SourceConnection;
  };
  type View = 'briefing' | 'profile';

  let { data, embedded = false }: {
    data: {
      briefings: BriefingData[];
      enabled: boolean;
      topics: string[];
      profile: BriefingProfile;
      sourceCatalog: SourceOption[];
      workflowId: string | null;
      schedule: { display: string; expr: string | null };
    };
    embedded?: boolean;
  } = $props();

  const briefings = $derived(data.briefings ?? []);
  const latest = $derived(briefings[0] ?? null);
  const past = $derived(briefings.slice(1));
  const detail = $derived(latest?.detail ?? null);
  const weatherHome = $derived(detail?.weather?.home ?? null);
  const weatherHere = $derived(detail?.weather?.here ?? null);
  const location = $derived(detail?.location ?? null);

  const memoryFacts = $derived((detail?.facts ?? []).filter((fact) => fact.section === 'New memories'));
  const learnedMemories = $derived.by(() => {
    if (detail?.memories?.length) return detail.memories;
    return memoryFacts.map((memory) => ({
      id: memory.source,
      category: memory.label,
      content: memory.value,
      confidence: '',
      createdAt: '',
    }));
  });

  // Memory has its own first-class section. Excluding it here prevents the
  // same information appearing again when the evidence drawer is opened.
  const factSections = $derived.by(() => {
    const sections: Array<{
      section: string;
      rows: Array<{ label: string; value: string; source: string }>;
    }> = [];
    for (const fact of detail?.facts ?? []) {
      if (fact.section === 'New memories') continue;
      let section = sections.find((item) => item.section === fact.section);
      if (!section) {
        section = { section: fact.section, rows: [] };
        sections.push(section);
      }
      section.rows.push({ label: fact.label, value: fact.value, source: fact.source });
    }
    return sections;
  });

  let profile = $state<BriefingProfile>(structuredClone(untrack(() => data.profile)));
  let enabled = $state(untrack(() => data.enabled));
  let topicsText = $state(untrack(() => (data.topics ?? []).join(', ')));
  let view = $state<View>(untrack(() => briefings.length ? 'briefing' : 'profile'));
  let running = $state(false);
  let saving = $state(false);
  let message = $state<string | null>(null);
  let error = $state<string | null>(null);
  let voted = $state<'up' | 'down' | null>(null);
  let voteWhat = $state('');

  const sourceGroups = $derived(
    (['Now', 'Personal', 'Knowledge', 'Daydreaming'] as const).map((group) => ({
      group,
      sources: data.sourceCatalog.filter((source) => source.group === group),
    })),
  );
  const activeSourceCount = $derived(
    Object.values(profile.sources).filter((source) => source.enabled).length,
  );
  const readySourceCount = $derived(
    data.sourceCatalog.filter(
      (source) => profile.sources[source.key].enabled
        && (source.connection === 'native' || source.connection === 'connected'),
    ).length,
  );
  const addableSourceCount = $derived(
    data.sourceCatalog.filter(
      (source) => profile.sources[source.key].enabled && source.connection === 'available',
    ).length,
  );
  const okCount = $derived((detail?.sources ?? []).filter((source) => source.status === 'ok').length);
  const issueCount = $derived((detail?.sources ?? []).filter((source) => source.status !== 'ok').length);

  const STATUS_LABEL: Record<BriefingSourceRow['status'], string> = {
    ok: 'reported',
    failed: 'failed',
    stale: 'stale',
    empty: 'no update',
  };
  const CONNECTION_LABEL: Record<SourceConnection, string> = {
    native: 'built in',
    connected: 'connected',
    available: 'available',
    missing: 'not connected',
  };

  async function runNow() {
    if (running || !data.workflowId) return;
    running = true;
    message = null;
    error = null;
    try {
      const response = await fetch(`/api/workflows/${data.workflowId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: {} }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      message = 'Briefing started. New results will appear here when the run finishes.';
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'The briefing could not be started.';
    } finally {
      running = false;
    }
  }

  async function saveProfile() {
    saving = true;
    message = null;
    error = null;
    const topics = topicsText.split(',').map((topic) => topic.trim()).filter(Boolean);
    try {
      const response = await fetch('/api/admin/briefing/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, topics, profile }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      message = 'Briefing profile saved.';
      await invalidateAll();
      if (latest) view = 'briefing';
    } catch {
      error = 'The briefing profile could not be saved.';
    } finally {
      saving = false;
    }
  }

  async function vote(voteValue: 'up' | 'down') {
    if (!latest) return;
    voted = voteValue;
    try {
      await fetch('/api/admin/briefing/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ briefingId: latest.id, vote: voteValue, what: voteWhat.trim() }),
      });
    } catch {
      voted = null;
    }
  }

  function fmt(iso?: string): string {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  }

  function num(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
  function text(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }
  function factorsOf(weather: Record<string, unknown> | null): string[] {
    return Array.isArray(weather?.factors)
      ? (weather.factors as unknown[]).filter((factor): factor is string => typeof factor === 'string')
      : [];
  }
</script>

<svelte:head><title>{embedded ? 'Daydreams · JKAI' : 'Briefing · JKAI'}</title></svelte:head>

{#if !embedded}<JkaiPageTitle title="BRIEFING" />{/if}

<main class="briefing" class:embedded>
  <header class="command-bar">
    <div class="system-state">
      <span class:paused={!enabled} class="state-dot" aria-hidden="true"></span>
      <div>
        <span class="eyebrow">Briefing system</span>
        <strong>{enabled ? data.schedule.display : 'Paused'}</strong>
      </div>
    </div>
    <div class="command-actions">
      <button class="button primary" type="button" onclick={runNow} disabled={running || !data.workflowId}>
        {running ? 'Starting…' : 'Run now'}
      </button>
      <button
        class="button secondary"
        class:active={view === 'profile'}
        type="button"
        onclick={() => (view = view === 'profile' && latest ? 'briefing' : 'profile')}
      >
        {view === 'profile' && latest ? 'Back to briefing' : 'Edit briefing'}
      </button>
    </div>
  </header>

  {#if message || error}
    <div class:error class="flash" role="status">{error ?? message}</div>
  {/if}

  {#if view === 'profile'}
    <section class="profile-view" aria-labelledby="profile-title">
      <header class="profile-head">
        <div>
          <span class="eyebrow">Briefing profile</span>
          <h2 id="profile-title">Decide what earns attention</h2>
          <p>Select the signals JKAI can use, set the editorial priorities, and choose how much recent memory should be carried into each briefing.</p>
        </div>
        <label class="master-switch">
          <input type="checkbox" bind:checked={enabled} />
          <span><b>{enabled ? 'Running' : 'Paused'}</b>{data.schedule.display}</span>
        </label>
      </header>

      <div class="profile-priorities">
        <label class="field topics-field">
          <span class="eyebrow">Editorial priorities</span>
          <span class="field-help">Comma-separated themes that should influence selection and emphasis.</span>
          <input class="input" bind:value={topicsText} placeholder="Current projects, home security, LLM costs" />
        </label>
        <div class="memory-controls">
          <label class="field">
            <span class="eyebrow">Memory window</span>
            <span class="number-input"><input class="input" type="number" min="1" max="168" bind:value={profile.memoryLookbackHours} /><span>hours</span></span>
          </label>
          <label class="field">
            <span class="eyebrow">Memory limit</span>
            <span class="number-input"><input class="input" type="number" min="1" max="20" bind:value={profile.memoryLimit} /><span>items</span></span>
          </label>
        </div>
      </div>

      <div class="source-intro">
        <div>
          <span class="eyebrow">Sources</span>
          <p><strong>{activeSourceCount} selected</strong> · {readySourceCount} ready now{#if addableSourceCount} · {addableSourceCount} available to connect{/if}</p>
        </div>
        {#if data.workflowId}<a href="/jkai/canvas/morning-briefing">Open source workflow →</a>{/if}
      </div>

      <div class="source-groups">
        {#each sourceGroups as group (group.group)}
          <section class="source-group" aria-labelledby="source-group-{group.group}">
            <h3 id="source-group-{group.group}">{group.group}</h3>
            <div class="source-grid">
              {#each group.sources as source (source.key)}
                <article class:disabled={!profile.sources[source.key].enabled} class="source-card">
                  <div class="source-card-head">
                    <label class="source-toggle">
                      <input type="checkbox" bind:checked={profile.sources[source.key].enabled} />
                      <span>{source.label}</span>
                    </label>
                    <span class="connection connection-{source.connection}">{CONNECTION_LABEL[source.connection]}</span>
                  </div>
                  <p>{source.description}</p>
                  <label
                    class:unavailable={source.connection === 'available' || source.connection === 'missing' || !profile.sources[source.key].enabled}
                    class="required-toggle"
                  >
                    <input
                      type="checkbox"
                      bind:checked={profile.sources[source.key].required}
                      disabled={source.connection === 'available' || source.connection === 'missing' || !profile.sources[source.key].enabled}
                    />
                    Required for a complete briefing
                  </label>
                </article>
              {/each}
            </div>
          </section>
        {/each}
      </div>

      <aside class="capability-note">
        <strong>Designed to grow.</strong>
        Any canvas capability that emits <code>briefingSources</code> can join the same selection, evidence, and composition flow.
      </aside>

      <footer class="profile-actions">
        <button class="button primary save" type="button" onclick={saveProfile} disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button>
        {#if latest}<button class="button quiet" type="button" onclick={() => (view = 'briefing')}>Cancel</button>{/if}
        <span>Changes apply to the next manual or scheduled run.</span>
      </footer>
    </section>
  {:else if latest}
    <div class="briefing-view">
      <article class="today" aria-labelledby="briefing-title">
        <header class="today-head">
          <div>
            <span class="eyebrow">{latest.title}</span>
            <h2 id="briefing-title">{detail?.headline ?? 'Your latest briefing'}</h2>
          </div>
          <div class="briefing-meta">
            <time datetime={latest.startedAt}>{fmt(latest.startedAt)}</time>
            <span>{latest.status}</span>
          </div>
        </header>

        {#if latest.markdown}
          <div class="briefing-copy"><ChatMarkdown content={latest.markdown} /></div>
        {:else}
          <p class="empty-copy">This briefing completed without a written summary.</p>
        {/if}

        <footer class="today-foot">
          <div class:warning={issueCount > 0} class="source-health">
            <strong>{okCount} source{okCount === 1 ? '' : 's'} contributed</strong>
            {#if issueCount > 0}<span>{issueCount} did not report and was excluded</span>{/if}
          </div>
          <span class="run-cost">{latest.llmCalls} model call{latest.llmCalls === 1 ? '' : 's'} · ${(latest.costUsd ?? 0).toFixed(3)}</span>
        </footer>

        <div class="feedback">
          {#if voted}
            <span class="feedback-done">Noted — {voted === 'up' ? 'more like this' : 'less of this'}.</span>
          {:else}
            <label for="briefing-feedback">Tune the next briefing</label>
            <input id="briefing-feedback" placeholder="Optional topic" bind:value={voteWhat} />
            <button type="button" onclick={() => vote('up')}>More like this</button>
            <button type="button" onclick={() => vote('down')}>Less like this</button>
          {/if}
        </div>
      </article>

      <section class:empty={!learnedMemories.length} class="memories" aria-labelledby="memories-title">
        <header class="section-head">
          <div>
            <span class="eyebrow">Shared back from daydreaming</span>
            <h2 id="memories-title">New memories</h2>
          </div>
          <a href="/jkai/daydreams/memory">Open shared memory →</a>
        </header>
        {#if learnedMemories.length}
          <p class="section-intro">Durable facts learned inside the {profile.memoryLookbackHours}-hour window and carried into this briefing.</p>
          <ul class="memory-list">
            {#each learnedMemories as memory (memory.id)}
              <li>
                <span class="memory-category">{memory.category}{#if memory.confidence} · {memory.confidence} confidence{/if}</span>
                <span>{memory.content}</span>
                {#if memory.createdAt}<time datetime={memory.createdAt}>{fmt(memory.createdAt)}</time>{/if}
              </li>
            {/each}
          </ul>
        {:else}
          <p class="empty-copy">No new durable memories landed inside this briefing’s window. Nothing has been padded or repeated.</p>
        {/if}
      </section>

      {#if detail}
        <details class="evidence">
          <summary>
            <span><span class="eyebrow">Trace the briefing</span><strong>Sources and evidence</strong></span>
            <span class="evidence-count">{okCount}/{detail.sources.length} reporting · {detail.facts.length} facts</span>
          </summary>

          <div class="evidence-content">
            {#if location || weatherHome || weatherHere}
              <section class="context-grid" aria-label="Current context">
                {#if location}
                  <article class="context-card">
                    <span class="eyebrow">Location</span>
                    <h3>{location.isHome ? 'At home' : (text(location.label) ?? 'Away')}</h3>
                    {#if num(location.distanceKm) !== null && !location.isHome}<p>{num(location.distanceKm)} km {text(location.bearing) ?? ''} of home</p>{/if}
                    <dl>
                      {#if text(location.since)}<div><dt>Since</dt><dd>{fmt(text(location.since) ?? undefined)}</dd></div>{/if}
                      {#if num(location.accuracyM) !== null}<div><dt>Accuracy</dt><dd>±{num(location.accuracyM)} m</dd></div>{/if}
                      {#if num(location.batteryPct) !== null}<div><dt>Phone</dt><dd>{num(location.batteryPct)}%</dd></div>{/if}
                    </dl>
                    {#if location.stale}<p class="warning-text">This location fix is stale.</p>{/if}
                  </article>
                {/if}

                {#each [{ weather: weatherHome, label: 'Weather at home' }, { weather: weatherHere, label: 'Weather where you are' }] as card (card.label)}
                  {#if card.weather}
                    <article class="context-card weather-card">
                      <span class="eyebrow">{card.label}</span>
                      <h3>{num(card.weather.nowC)}<small>°C</small></h3>
                      <p>{text(card.weather.condition) ?? text(card.weather.label) ?? 'No condition supplied'}</p>
                      <dl>
                        <div><dt>Range</dt><dd>{num(card.weather.minC)}–{num(card.weather.maxC)}°C</dd></div>
                        <div><dt>Rain</dt><dd>{num(card.weather.precipProbMaxPct)}%</dd></div>
                        <div><dt>Wind</dt><dd>{Math.round(num(card.weather.windKph) ?? 0)} km/h</dd></div>
                      </dl>
                      {#if factorsOf(card.weather).length}
                        <ul class="weather-factors">{#each factorsOf(card.weather) as factor (factor)}<li>{factor}</li>{/each}</ul>
                      {/if}
                    </article>
                  {/if}
                {/each}
              </section>
            {/if}

            {#if factSections.length}
              <section class="fact-ledger">
                <header class="drawer-heading"><span class="eyebrow">Verified inputs</span><h3>Facts used by the composer</h3></header>
                {#each factSections as section (section.section)}
                  <div class="fact-section">
                    <h4>{section.section}</h4>
                    <dl>
                      {#each section.rows as row (row.label + row.value)}
                        <div><dt>{row.label}</dt><dd>{row.value}<small>{row.source}</small></dd></div>
                      {/each}
                    </dl>
                  </div>
                {/each}
              </section>
            {/if}

            {#if detail.knowledge}
              <section class="knowledge">
                <header class="drawer-heading"><span class="eyebrow">Knowledge graph</span><h3>{detail.knowledge.query ? `Context for “${detail.knowledge.query}”` : 'Connected context'}</h3></header>
                <div class="briefing-copy compact"><ChatMarkdown content={detail.knowledge.context} /></div>
                <a href="/jkai/intel">Open the intel command centre →</a>
              </section>
            {/if}

            {#if detail.sources.length}
              <section class="source-ledger">
                <header class="drawer-heading"><span class="eyebrow">Run health</span><h3>What actually reported</h3></header>
                <ul>
                  {#each detail.sources as source (source.key)}
                    <li class="status-{source.status}">
                      <span class="ledger-dot" aria-hidden="true"></span>
                      <strong>{source.label}</strong>
                      <span>{STATUS_LABEL[source.status]}</span>
                      <small>{source.detail}</small>
                    </li>
                  {/each}
                </ul>
              </section>
            {/if}
          </div>
        </details>
      {/if}

      {#if past.length}
        <section class="history" aria-labelledby="history-title">
          <header class="section-head"><div><span class="eyebrow">Archive</span><h2 id="history-title">Earlier briefings</h2></div><span>{past.length} saved</span></header>
          <div class="history-list">
            {#each past as briefing (briefing.id)}
              <details>
                <summary>
                  <strong>{briefing.title}</strong>
                  <span>{fmt(briefing.startedAt)} · {briefing.detail ? `${briefing.detail.sources.filter((source) => source.status === 'ok').length}/${briefing.detail.sources.length} sources` : briefing.status}</span>
                </summary>
                {#if briefing.markdown}<div class="briefing-copy compact"><ChatMarkdown content={briefing.markdown} /></div>{:else}<p class="empty-copy">{briefing.error ?? briefing.status}</p>{/if}
              </details>
            {/each}
          </div>
        </section>
      {/if}
    </div>
  {:else}
    <section class="first-run">
      <span class="eyebrow">No briefing yet</span>
      <h2>Build the first one</h2>
      <p>Choose the sources that matter, save the profile, then run the workflow once.</p>
      <button class="button primary" type="button" onclick={() => (view = 'profile')}>Configure briefing</button>
    </section>
  {/if}
</main>

<style>
  .briefing { max-width: 1120px; margin: 0 auto; padding: 24px 20px 80px; color: var(--text-primary); }
  .briefing.embedded { max-width: none; padding: 0; }
  .eyebrow { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); line-height: 1.35; text-transform: uppercase; letter-spacing: 0.14em; color: var(--text-muted); }
  .command-bar { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 14px 0; margin-bottom: clamp(22px, 3vw, 38px); border-top: 1px solid var(--line-strong); border-bottom: 1px solid var(--line-strong); }
  .system-state { display: flex; align-items: center; gap: 11px; }
  .system-state strong { display: block; margin-top: 2px; font-size: var(--fs-nav); font-weight: 600; }
  .state-dot { width: 9px; height: 9px; background: var(--success, #2d7a3a); border-radius: 50%; }
  .state-dot.paused { background: var(--warn, #b0892a); }
  .command-actions { display: flex; gap: 8px; }
  .button { border: 1px solid transparent; padding: 9px 14px; font-family: var(--font-mono); font-size: var(--fs-label); cursor: pointer; }
  .button:disabled { cursor: default; opacity: 0.5; }
  .button.primary { background: var(--accent-ink, var(--accent)); color: var(--bg); }
  .button.secondary { border-color: var(--line-strong); background: transparent; color: var(--text-primary); }
  .button.secondary:hover, .button.secondary.active { border-color: var(--accent); color: var(--accent-ink, var(--accent)); }
  .button.quiet { border-color: transparent; background: transparent; color: var(--text-muted); }
  .flash { margin: -20px 0 24px; padding: 9px 12px; border-left: 3px solid var(--success, #2d7a3a); background: color-mix(in srgb, var(--success, #2d7a3a) 7%, transparent); font-size: var(--fs-label); }
  .flash.error { border-color: var(--error, #c44); color: var(--error, #c44); }

  .briefing-view { display: flex; flex-direction: column; gap: clamp(26px, 4vw, 46px); }
  .today { padding: clamp(22px, 4vw, 48px); border: 1px solid var(--line-strong); border-top: 5px solid var(--text-primary); background: color-mix(in srgb, var(--surface-elevated) 58%, transparent); }
  .today-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
  .today h2 { max-width: 22ch; margin: 8px 0 clamp(22px, 3vw, 34px); font-family: var(--font-display); font-size: clamp(30px, 4.5vw, 60px); line-height: 0.98; text-transform: uppercase; text-wrap: balance; }
  .briefing-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; color: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label-xs); white-space: nowrap; }
  .briefing-meta span { text-transform: uppercase; letter-spacing: 0.1em; }
  .briefing-copy { max-width: 78ch; font-size: var(--fs-body); line-height: 1.65; }
  .briefing-copy.compact { margin-top: 12px; font-size: var(--fs-body-sm); }
  .today-foot { display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; margin-top: 28px; padding-top: 16px; border-top: 1px solid var(--line-hair); }
  .source-health { display: flex; flex-direction: column; gap: 2px; color: var(--success, #2d7a3a); font-size: var(--fs-label); }
  .source-health.warning { color: var(--warn, #b0892a); }
  .source-health span { color: var(--text-muted); }
  .run-cost { color: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  .feedback { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
  .feedback label { margin-right: 4px; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); }
  .feedback input { min-width: 180px; flex: 1; max-width: 320px; padding: 6px 8px; border: 1px solid var(--line-strong); background: var(--bg); color: var(--text-primary); }
  .feedback button { padding: 6px 9px; border: 1px solid var(--line-strong); background: transparent; color: var(--text-muted); font-family: var(--font-mono); font-size: var(--fs-label-xs); cursor: pointer; }
  .feedback button:hover { border-color: var(--accent); color: var(--accent-ink, var(--accent)); }
  .feedback-done { color: var(--success, #2d7a3a); font-family: var(--font-mono); font-size: var(--fs-label); }

  .memories { padding: clamp(20px, 3vw, 30px); border: 1px solid var(--accent); background: var(--accent-tint-04); }
  .memories.empty { border-color: var(--line-strong); background: transparent; }
  .section-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; }
  .section-head h2 { margin: 5px 0 0; font-family: var(--font-display); font-size: clamp(25px, 3vw, 38px); line-height: 1; text-transform: uppercase; }
  .section-head > a, .knowledge > a, .source-intro > a { color: var(--accent-ink, var(--accent)); font-family: var(--font-mono); font-size: var(--fs-label); text-decoration: none; }
  .section-head > span { color: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label); }
  .section-intro { max-width: 70ch; margin: 14px 0; color: var(--text-muted); font-size: var(--fs-nav); line-height: 1.5; }
  .memory-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 9px; margin: 18px 0 0; padding: 0; list-style: none; }
  .memory-list li { display: flex; flex-direction: column; gap: 6px; padding: 13px; border: 1px solid var(--line-strong); background: var(--bg); font-size: var(--fs-nav); line-height: 1.45; }
  .memory-category { color: var(--accent-ink, var(--accent)); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; }
  .memory-list time { color: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  .empty-copy { max-width: 68ch; margin: 14px 0 0; color: var(--text-muted); line-height: 1.55; }

  .evidence { border-top: 1px solid var(--line-strong); border-bottom: 1px solid var(--line-strong); }
  .evidence > summary { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 19px 4px; cursor: pointer; list-style: none; }
  .evidence > summary::-webkit-details-marker { display: none; }
  .evidence > summary::after { content: '+'; font-family: var(--font-mono); font-size: 24px; color: var(--accent-ink, var(--accent)); }
  .evidence[open] > summary::after { content: '−'; }
  .evidence > summary > span:first-child { flex: 1; }
  .evidence > summary strong { display: block; margin-top: 3px; font-family: var(--font-display); font-size: clamp(23px, 2.8vw, 34px); line-height: 1; text-transform: uppercase; }
  .evidence-count { color: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label); }
  .evidence-content { display: flex; flex-direction: column; gap: 34px; padding: 8px 4px 28px; }
  .context-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px; }
  .context-card { padding: 16px; border: 1px solid var(--line-strong); }
  .context-card h3 { margin: 6px 0; font-size: var(--fs-body-lg); }
  .context-card > p { margin: 5px 0 12px; color: var(--text-muted); font-size: var(--fs-label); }
  .weather-card h3 { font-family: var(--font-display); font-size: 38px; line-height: 1; }
  .weather-card h3 small { font-size: 18px; color: var(--text-muted); }
  .context-card dl { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 12px 0 0; }
  .context-card dt, .fact-section dt { color: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; }
  .context-card dd { margin: 2px 0 0; font-size: var(--fs-label); }
  .warning-text { color: var(--warn, #b0892a) !important; }
  .weather-factors { margin: 12px 0 0; padding: 10px 0 0 18px; border-top: 1px solid var(--line-hair); color: var(--accent-ink, var(--accent)); font-size: var(--fs-label); }
  .drawer-heading h3 { margin: 4px 0 14px; font-family: var(--font-display); font-size: 26px; text-transform: uppercase; }
  .fact-section + .fact-section { margin-top: 18px; }
  .fact-section h4 { margin: 0 0 8px; font-family: var(--font-mono); font-size: var(--fs-label); font-weight: 600; color: var(--text-muted); }
  .fact-section dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px 18px; margin: 0; }
  .fact-section dl > div { min-width: 0; padding-top: 7px; border-top: 1px solid var(--line-hair); }
  .fact-section dd { margin: 3px 0 0; overflow-wrap: anywhere; font-size: var(--fs-nav); }
  .fact-section dd small { display: block; margin-top: 2px; color: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  .source-ledger ul { margin: 0; padding: 0; list-style: none; }
  .source-ledger li { display: grid; grid-template-columns: 9px minmax(120px, 180px) 86px 1fr; align-items: baseline; gap: 10px; padding: 9px 0; border-top: 1px solid var(--line-hair); font-size: var(--fs-label); }
  .ledger-dot { width: 6px; height: 6px; align-self: center; border-radius: 50%; background: currentColor; }
  .source-ledger li > span:nth-child(3) { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; }
  .source-ledger small { color: var(--text-muted); overflow-wrap: anywhere; }
  .status-ok { color: var(--success, #2d7a3a); }
  .status-stale { color: var(--warn, #b0892a); }
  .status-failed { color: var(--error, #c44); }
  .status-empty { color: var(--text-ghost); }
  .source-ledger strong { color: var(--text-primary); }

  .history { padding-top: 2px; }
  .history-list { margin-top: 14px; border-top: 1px solid var(--line-strong); }
  .history-list details { border-bottom: 1px solid var(--line-hair); }
  .history-list summary { display: flex; justify-content: space-between; gap: 20px; padding: 13px 2px; cursor: pointer; }
  .history-list summary span { color: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  .history-list .briefing-copy, .history-list .empty-copy { padding: 4px 2px 20px; }

  .profile-view { display: flex; flex-direction: column; gap: clamp(24px, 3.5vw, 40px); padding: clamp(20px, 3.5vw, 38px); border: 1px solid var(--line-strong); background: color-mix(in srgb, var(--surface-elevated) 55%, transparent); }
  .profile-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 30px; padding-bottom: 24px; border-bottom: 1px solid var(--line-strong); }
  .profile-head h2 { margin: 7px 0 10px; font-family: var(--font-display); font-size: clamp(30px, 4vw, 52px); line-height: 0.98; text-transform: uppercase; }
  .profile-head p { max-width: 68ch; margin: 0; color: var(--text-muted); line-height: 1.5; }
  .master-switch { display: flex; align-items: center; gap: 10px; min-width: 180px; padding: 11px 13px; border: 1px solid var(--line-strong); cursor: pointer; }
  .master-switch input, .source-toggle input, .required-toggle input { width: auto; accent-color: var(--accent); }
  .master-switch span { display: flex; flex-direction: column; gap: 2px; color: var(--text-muted); font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  .master-switch b { color: var(--text-primary); font-size: var(--fs-label); text-transform: uppercase; letter-spacing: 0.09em; }
  .profile-priorities { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 20px; }
  .field { display: flex; flex-direction: column; gap: 5px; }
  .field-help { color: var(--text-ghost); font-size: var(--fs-label); }
  .input { box-sizing: border-box; width: 100%; padding: 9px 10px; border: 1px solid var(--line-strong); background: var(--bg); color: var(--text-primary); outline: none; }
  .input:focus { border-color: var(--accent); }
  .memory-controls { display: grid; grid-template-columns: repeat(2, minmax(120px, 1fr)); gap: 10px; }
  .number-input { display: flex; align-items: center; border: 1px solid var(--line-strong); background: var(--bg); }
  .number-input .input { width: 72px; border: 0; }
  .number-input > span { padding-right: 10px; color: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  .source-intro { display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; }
  .source-intro p { margin: 5px 0 0; color: var(--text-muted); font-size: var(--fs-label); }
  .source-intro strong { color: var(--text-primary); }
  .source-groups { display: flex; flex-direction: column; gap: 26px; }
  .source-group > h3 { margin: 0 0 9px; color: var(--text-muted); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.14em; }
  .source-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 9px; }
  .source-card { display: flex; flex-direction: column; min-width: 0; padding: 14px; border: 1px solid var(--line-strong); background: var(--bg); }
  .source-card.disabled { opacity: 0.55; }
  .source-card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
  .source-toggle { display: flex; align-items: center; gap: 8px; min-width: 0; font-weight: 600; cursor: pointer; }
  .connection { flex: none; color: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; }
  .connection-native, .connection-connected { color: var(--success, #2d7a3a); }
  .connection-available { color: var(--accent-ink, var(--accent)); }
  .source-card > p { min-height: 2.7em; margin: 10px 0 14px; color: var(--text-muted); font-size: var(--fs-label); line-height: 1.4; }
  .required-toggle { display: flex; align-items: center; gap: 7px; margin-top: auto; padding-top: 10px; border-top: 1px solid var(--line-hair); color: var(--text-muted); font-family: var(--font-mono); font-size: var(--fs-label-xs); cursor: pointer; }
  .required-toggle.unavailable { color: var(--text-ghost); cursor: default; }
  .capability-note { padding: 14px 16px; border-left: 3px solid var(--accent); background: var(--accent-tint-04); color: var(--text-muted); font-size: var(--fs-label); line-height: 1.5; }
  .capability-note strong { display: block; color: var(--text-primary); }
  .capability-note code { color: var(--accent-ink, var(--accent)); font-family: var(--font-mono); }
  .profile-actions { display: flex; align-items: center; gap: 10px; padding-top: 22px; border-top: 1px solid var(--line-strong); }
  .profile-actions > span { color: var(--text-ghost); font-size: var(--fs-label); }
  .first-run { max-width: 720px; padding: clamp(24px, 4vw, 48px); border: 1px solid var(--line-strong); }
  .first-run h2 { margin: 8px 0; font-family: var(--font-display); font-size: 42px; text-transform: uppercase; }
  .first-run p { margin: 0 0 20px; color: var(--text-muted); }

  @media (max-width: 720px) {
    .command-bar, .today-head, .today-foot, .profile-head, .source-intro { align-items: stretch; flex-direction: column; }
    .command-actions { width: 100%; }
    .command-actions .button { flex: 1; }
    .briefing-meta { align-items: flex-start; }
    .today h2 { margin-bottom: 22px; }
    .section-head { align-items: flex-start; flex-direction: column; gap: 10px; }
    .evidence > summary { align-items: flex-start; flex-wrap: wrap; }
    .evidence-count { order: 3; width: 100%; }
    .source-ledger li { grid-template-columns: 9px 1fr 80px; }
    .source-ledger small { grid-column: 2 / -1; }
    .profile-priorities { grid-template-columns: 1fr; }
    .master-switch { min-width: 0; }
    .profile-actions { align-items: flex-start; flex-wrap: wrap; }
    .profile-actions > span { width: 100%; }
  }
  @media (max-width: 480px) {
    .briefing { padding-inline: 14px; }
    .command-actions, .feedback { align-items: stretch; flex-direction: column; }
    .command-actions .button, .feedback input { width: 100%; max-width: none; }
    .today, .profile-view { padding: 18px; }
    .memory-controls, .source-grid { grid-template-columns: 1fr; }
    .history-list summary { flex-direction: column; gap: 4px; }
  }
</style>
