<script lang="ts">
  import type { BriefingData, BriefingSourceRow } from '$lib/briefing/types';
  import { invalidateAll } from '$app/navigation';
  import ChatMarkdown from '$lib/canvas/ChatMarkdown.svelte';
  import JkaiPageTitle from '$lib/components/jkai/JkaiPageTitle.svelte';

  let { data }: {
    data: {
      briefings: BriefingData[];
      enabled: boolean;
      topics: string[];
      workflowId: string | null;
      schedule: { display: string; expr: string | null };
    };
  } = $props();

  const briefings = $derived(data.briefings ?? []);
  const latest = $derived(briefings[0] ?? null);
  const past = $derived(briefings.slice(1));
  const detail = $derived(latest?.detail ?? null);

  const weatherHome = $derived(detail?.weather?.home ?? null);
  const weatherHere = $derived(detail?.weather?.here ?? null);
  const location = $derived(detail?.location ?? null);

  // Facts grouped into their sections, preserving the compose node's ordering.
  const factSections = $derived.by(() => {
    const out: Array<{ section: string; rows: Array<{ label: string; value: string; source: string }> }> = [];
    for (const f of detail?.facts ?? []) {
      let bucket = out.find((s) => s.section === f.section);
      if (!bucket) { bucket = { section: f.section, rows: [] }; out.push(bucket); }
      bucket.rows.push({ label: f.label, value: f.value, source: f.source });
    }
    return out;
  });

  const okCount = $derived((detail?.sources ?? []).filter((s) => s.status === 'ok').length);

  let enabled = $state(data.enabled);
  let topicsText = $state((data.topics ?? []).join(', '));
  let running = $state(false);
  let msg = $state<string | null>(null);
  let err = $state<string | null>(null);
  let showConfig = $state(false);

  async function runNow() {
    if (running || !data.workflowId) return;
    running = true; msg = null; err = null;
    try {
      const res = await fetch(`/api/workflows/${data.workflowId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: {} }),
      });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b.error || `HTTP ${res.status}`);
      msg = 'Briefing workflow started — refresh in a few seconds.';
    } catch (e) {
      err = e instanceof Error ? e.message : 'Run failed';
    } finally {
      running = false;
    }
  }

  async function saveConfig() {
    err = null; msg = null;
    const topics = topicsText.split(',').map((t) => t.trim()).filter(Boolean);
    const res = await fetch('/api/admin/briefing/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, topics }),
    });
    if (res.ok) { msg = 'Saved.'; await invalidateAll(); } else err = 'Save failed';
  }

  function fmt(iso?: string): string {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString('en-GB'); } catch { return iso; }
  }

  function num(v: unknown): number | null {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }
  function text(v: unknown): string | null {
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  }
  function factorsOf(w: Record<string, unknown> | null): string[] {
    return Array.isArray(w?.factors) ? (w.factors as unknown[]).filter((f): f is string => typeof f === 'string') : [];
  }

  const STATUS_LABEL: Record<BriefingSourceRow['status'], string> = {
    ok: 'ok', failed: 'failed', stale: 'stale', empty: 'nothing',
  };

  let voted = $state<'up' | 'down' | null>(null);
  let voteWhat = $state('');
  async function vote(v: 'up' | 'down') {
    if (!latest) return;
    voted = v;
    try {
      await fetch('/api/admin/briefing/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ briefingId: latest.id, vote: v, what: voteWhat.trim() }),
      });
    } catch {
      voted = null;
    }
  }
</script>

<svelte:head><title>Briefing · JKAI</title></svelte:head>

<JkaiPageTitle title="BRIEFING" />

<main class="br">
  <div class="br-bar">
    <p class="br-sub">
      Every claim below is traced to the source that produced it · {data.schedule.display} + WhatsApp
      {#if !enabled}<span class="br-off">paused</span>{/if}
    </p>
    <div class="br-bar-actions">
      <button class="br-run" onclick={runNow} disabled={running || !data.workflowId}>
        {running ? 'Starting…' : 'Run now'}
      </button>
      <button class="br-cfg-toggle" onclick={() => (showConfig = !showConfig)} aria-expanded={showConfig}>
        {showConfig ? 'Hide settings' : 'Settings'}
      </button>
    </div>
  </div>

  {#if msg || err}
    <p class="br-flash">{#if msg}<span class="br-ok">{msg}</span>{/if}{#if err}<span class="br-err">⚠ {err}</span>{/if}</p>
  {/if}

  {#if showConfig || !latest}
    <section class="br-sec br-config">
      <label class="br-toggle">
        <input type="checkbox" bind:checked={enabled} />
        <span>{enabled ? 'Enabled — runs on schedule' : 'Disabled — no scheduled runs'}</span>
      </label>
      <label class="br-field">
        <span class="sr-label-tight">Topics you care about (comma-separated)</span>
        <input class="br-in" bind:value={topicsText} placeholder="DfE data policy, brass & rails, home security, LLM costs" />
      </label>
      <div class="br-config-foot"><button class="br-save" onclick={saveConfig}>Save config</button></div>
    </section>
  {/if}

  {#if latest}
    <!-- ——— The summary that went to WhatsApp ——— -->
    <section class="br-sec">
      <div class="br-sec-hd">
        <span class="sr-label-tight">{latest.title}</span>
        <span class="br-when">{fmt(latest.startedAt)} · {latest.status}</span>
      </div>

      {#if detail?.headline}
        <p class="br-headline">{detail.headline}</p>
      {/if}

      {#if latest.markdown}
        <div class="br-body"><ChatMarkdown content={latest.markdown} /></div>
      {/if}

      {#if detail}
        <div class="br-trust" class:br-trust-warn={detail.gaps.length > 0}>
          {okCount} source{okCount === 1 ? '' : 's'} reported{#if detail.gaps.length} · {detail.gaps.length} unavailable — listed below and excluded from the briefing{/if}
        </div>
      {/if}

      <div class="br-meta">
        {latest.sources?.join(' · ') || 'no signals'} · {latest.llmCalls} call · ${(latest.costUsd ?? 0).toFixed(3)}
      </div>

      <div class="br-vote">
        {#if voted}
          <span class="br-vote-done">✓ noted — {voted === 'up' ? 'more like this' : 'less of this'}</span>
        {:else}
          <span class="sr-label-tight">Rate it</span>
          <input class="br-vote-what" placeholder="topic (optional — blank = whole briefing)" bind:value={voteWhat} />
          <button class="br-vote-btn" onclick={() => vote('up')}>More like this</button>
          <button class="br-vote-btn br-vote-down" onclick={() => vote('down')}>Less of this</button>
        {/if}
      </div>
    </section>

    <!-- ——— Where you are ——— -->
    {#if location}
      <section class="br-sec">
        <div class="br-sec-hd"><span class="sr-label-tight">Where you are</span></div>
        <p class="br-loc-main">
          {#if location.isHome}At home{:else}{text(location.label) ?? 'Away'}{/if}
          {#if num(location.distanceKm) !== null && !location.isHome}
            <span class="br-loc-dist">{num(location.distanceKm)} km {text(location.bearing) ?? ''} of home</span>
          {/if}
        </p>
        <dl class="br-kv">
          {#if text(location.since)}<div><dt>Since</dt><dd>{fmt(text(location.since) ?? undefined)}</dd></div>{/if}
          {#if num(location.accuracyM) !== null}<div><dt>Accuracy</dt><dd>±{num(location.accuracyM)} m</dd></div>{/if}
          {#if num(location.batteryPct) !== null}<div><dt>Phone</dt><dd>{num(location.batteryPct)}%</dd></div>{/if}
          {#if text(location.source)}<div><dt>Source</dt><dd class="br-mono">{text(location.source)}</dd></div>{/if}
        </dl>
        {#if location.stale}
          <p class="br-warn-line">⚠ This fix is {num(location.ageMins)} minutes old — the tracker has stopped reporting.</p>
        {/if}
      </section>
    {/if}

    <!-- ——— Weather: home and here ——— -->
    {#if weatherHome || weatherHere}
      <section class="br-sec">
        <div class="br-sec-hd">
          <span class="sr-label-tight">Weather</span>
          {#if detail?.weather?.sameSpot}<span class="br-when">you are at home — one forecast</span>{/if}
        </div>
        <div class="br-wx">
          {#each [{ w: weatherHome, tag: 'Home' }, { w: weatherHere, tag: 'Where you are' }] as card (card.tag)}
            {#if card.w}
              <article class="br-wx-card">
                <header>
                  <span class="sr-label-tight">{card.tag}</span>
                  <h3>{text(card.w.label) ?? '—'}</h3>
                </header>
                <p class="br-wx-now">
                  {num(card.w.nowC)}<span class="br-wx-unit">°C</span>
                  <span class="br-wx-cond">{text(card.w.condition)}</span>
                </p>
                <dl class="br-kv">
                  <div><dt>Today</dt><dd>{num(card.w.minC)}°C – {num(card.w.maxC)}°C</dd></div>
                  <div><dt>Rain</dt><dd>{num(card.w.precipProbMaxPct)}%</dd></div>
                  <div><dt>Wind</dt><dd>{Math.round(num(card.w.windKph) ?? 0)} km/h {text(card.w.windDir) ?? ''}</dd></div>
                  <div><dt>UV</dt><dd>{num(card.w.uvIndexMax)}</dd></div>
                  <div><dt>Daylight</dt><dd>{text(card.w.sunrise)} – {text(card.w.sunset)}</dd></div>
                </dl>
                {#if factorsOf(card.w).length}
                  <ul class="br-factors">
                    {#each factorsOf(card.w) as f (f)}<li>{f}</li>{/each}
                  </ul>
                {/if}
              </article>
            {/if}
          {/each}
        </div>
      </section>
    {/if}

    <!-- ——— Everything the briefing was allowed to say ——— -->
    {#if factSections.length}
      <section class="br-sec">
        <div class="br-sec-hd">
          <span class="sr-label-tight">The facts behind it</span>
          <span class="br-when">{detail?.facts.length} verified values</span>
        </div>
        {#each factSections as sec (sec.section)}
          <div class="br-facts">
            <h4 class="br-facts-hd">{sec.section}</h4>
            <dl class="br-kv br-kv-wide">
              {#each sec.rows as row (row.label + row.value)}
                <div><dt>{row.label}</dt><dd>{row.value}<span class="br-src">{row.source}</span></dd></div>
              {/each}
            </dl>
          </div>
        {/each}
      </section>
    {/if}

    <!-- ——— Knowledge graph ——— -->
    {#if detail?.knowledge}
      <section class="br-sec">
        <div class="br-sec-hd">
          <span class="sr-label-tight">From your knowledge graph</span>
          {#if detail.knowledge.query}<span class="br-when">“{detail.knowledge.query}”</span>{/if}
        </div>
        <div class="br-body br-body-sm"><ChatMarkdown content={detail.knowledge.context} /></div>
        <p class="br-meta"><a class="br-link" href="/jkai/intel">Open the intel command centre →</a></p>
      </section>
    {/if}

    <!-- ——— The source ledger ——— -->
    {#if detail?.sources?.length}
      <section class="br-sec">
        <div class="br-sec-hd">
          <span class="sr-label-tight">Source ledger</span>
          <span class="br-when">what actually reported, and what didn't</span>
        </div>
        <ul class="br-ledger">
          {#each detail.sources as s (s.key)}
            <li class="br-ledger-row br-st-{s.status}">
              <span class="br-ledger-dot" aria-hidden="true"></span>
              <span class="br-ledger-label">{s.label}</span>
              <span class="br-ledger-status">{STATUS_LABEL[s.status]}</span>
              <span class="br-ledger-detail">{s.detail}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {:else}
    <p class="br-empty">
      No briefings recorded yet. Hit “Run now” to trigger the workflow, or wait for the {data.schedule.display} run.
    </p>
  {/if}

  {#if past.length}
    <section class="br-sec">
      <div class="br-sec-hd"><span class="sr-label-tight">Earlier ({past.length})</span></div>
      <ul class="br-past">
        {#each past as b (b.id)}
          <li class="br-past-item">
            <details>
              <summary>
                <span class="br-past-title">{b.title}</span>
                <span class="br-when">
                  {fmt(b.startedAt)} · {b.detail ? `${b.detail.sources.filter((s) => s.status === 'ok').length}/${b.detail.sources.length} sources` : b.status}
                </span>
              </summary>
              {#if b.markdown}
                <div class="br-body br-body-sm"><ChatMarkdown content={b.markdown} /></div>
              {:else}
                <p class="br-empty">{b.error ?? b.status}</p>
              {/if}
              {#if b.detail?.gaps.length}
                <p class="br-meta">Unavailable that day: {b.detail.gaps.map((g) => g.section).join(', ')}</p>
              {/if}
            </details>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</main>

<style>
  .br { max-width: 900px; margin: 0 auto; padding: 24px 20px 80px; color: var(--text-primary); }
  .br-bar { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
  .br-bar-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .br-sub { margin: 0; color: var(--text-muted); font-size: var(--fs-nav); }
  .br-off { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; color: var(--warn, #b0892a); border: 1px solid currentColor; padding: 1px 5px; margin-left: 8px; }
  .br-cfg-toggle { font-family: var(--font-mono); font-size: var(--fs-label); padding: 7px 12px; background: transparent; border: 1px solid var(--card-border); color: var(--text-muted); cursor: pointer; }
  .br-cfg-toggle:hover { color: var(--text-primary); border-color: var(--text-muted); }
  .br-flash { margin: 0 0 12px; }

  .br-sec { margin-bottom: 28px; }
  .br-sec-hd { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; border-bottom: 1px dashed var(--card-border); padding-bottom: 6px; margin-bottom: 12px; }
  .sr-label-tight { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.16em; color: var(--text-muted); }
  .br-when { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }

  .br-config { border: 1px solid var(--card-border); padding: 14px; display: flex; flex-direction: column; gap: 12px; }
  .br-toggle { display: flex; align-items: center; gap: 8px; font-size: var(--fs-nav); cursor: pointer; }
  .br-toggle input { width: auto; }
  .br-run, .br-save { font-family: var(--font-mono); font-size: var(--fs-label); padding: 7px 16px; background: var(--accent-ink, var(--accent, #c4570a)); color: var(--bg, #fff); border: none; cursor: pointer; }
  .br-run:disabled { opacity: 0.5; cursor: default; }
  .br-field { display: flex; flex-direction: column; gap: 4px; }
  .br-in { background: var(--bg); border: 1px solid var(--card-border); color: var(--text-primary); font-size: var(--fs-body); padding: 8px 10px; outline: none; box-sizing: border-box; }
  .br-in:focus { border-color: var(--text-muted); }
  .br-config-foot { display: flex; align-items: center; gap: 12px; }
  .br-ok { color: var(--success, #2d7a3a); font-size: var(--fs-label); }
  .br-err { color: var(--error, #c44); font-size: var(--fs-label); }

  .br-headline { margin: 0 0 12px; font-family: var(--font-display); font-size: 1.25rem; line-height: 1.25; }
  .br-body { color: var(--text-primary); }
  .br-body-sm { margin-top: 8px; font-size: var(--fs-body-sm); }
  .br-meta { margin-top: 12px; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .br-link { color: var(--accent-ink, var(--accent)); text-decoration: none; }
  .br-link:hover { text-decoration: underline; }

  .br-trust { margin-top: 12px; font-family: var(--font-mono); font-size: var(--fs-label); color: var(--success, #2d7a3a); border-left: 2px solid currentColor; padding-left: 8px; }
  .br-trust-warn { color: var(--warn, #b0892a); }
  .br-warn-line { margin: 8px 0 0; font-size: var(--fs-label); color: var(--warn, #b0892a); }

  .br-loc-main { margin: 0 0 10px; font-size: var(--fs-body); }
  .br-loc-dist { display: block; font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-muted); margin-top: 2px; }

  /* Key/value grids — shared by location, weather and facts */
  .br-kv { margin: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px 16px; }
  .br-kv-wide { grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
  .br-kv div { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .br-kv dt { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-ghost); }
  .br-kv dd { margin: 0; font-size: var(--fs-nav); color: var(--text-primary); overflow-wrap: anywhere; }
  .br-mono { font-family: var(--font-mono); font-size: var(--fs-label); }
  .br-src { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); margin-top: 1px; }

  .br-wx { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
  .br-wx-card { border: 1px solid var(--card-border); padding: 14px; }
  .br-wx-card header { margin-bottom: 8px; }
  .br-wx-card h3 { margin: 2px 0 0; font-family: var(--font-body, var(--font-sans)); font-size: var(--fs-body-sm); font-weight: 600; overflow-wrap: anywhere; }
  .br-wx-now { margin: 0 0 12px; font-family: var(--font-display); font-size: 2rem; line-height: 1; }
  .br-wx-unit { font-size: var(--fs-body-lg); color: var(--text-muted); }
  .br-wx-cond { display: block; font-family: var(--font-body, var(--font-sans)); font-size: var(--fs-nav); font-weight: 400; color: var(--text-secondary, var(--text-muted)); margin-top: 4px; }
  .br-factors { list-style: none; margin: 12px 0 0; padding: 10px 0 0; border-top: 1px solid var(--divider, var(--card-border)); display: flex; flex-direction: column; gap: 4px; }
  .br-factors li { font-size: var(--fs-label); color: var(--accent, #c4570a); }

  .br-facts { margin-bottom: 16px; }
  .br-facts-hd { margin: 0 0 6px; font-family: var(--font-mono); font-size: var(--fs-label); font-weight: 400; color: var(--text-secondary, var(--text-muted)); }

  .br-ledger { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .br-ledger-row { display: grid; grid-template-columns: 10px 160px 68px 1fr; align-items: baseline; gap: 8px; padding: 7px 0; border-bottom: 1px solid var(--divider, var(--card-border)); font-size: var(--fs-nav); }
  .br-ledger-dot { width: 6px; height: 6px; border-radius: 100px; background: currentColor; align-self: center; }
  .br-ledger-label { overflow-wrap: anywhere; color: var(--text-primary); }
  .br-ledger-status { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; }
  .br-ledger-detail { color: var(--text-muted); font-size: var(--fs-label); overflow-wrap: anywhere; }
  .br-st-ok { color: var(--success, #2d7a3a); }
  .br-st-stale { color: var(--warn, #b0892a); }
  .br-st-failed { color: var(--error, #c44); }
  .br-st-empty { color: var(--text-ghost); }

  .br-vote { display: flex; align-items: center; gap: 8px; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--divider); flex-wrap: wrap; }
  .br-vote-what { flex: 1; max-width: 320px; font-family: var(--font-mono); font-size: var(--fs-body); padding: 4px 8px; border: 1px solid var(--card-border); background: var(--bg); color: var(--text-primary); outline: none; }
  .br-vote-what:focus { border-color: var(--accent); }
  .br-vote-btn { background: var(--bg); border: 1px solid var(--accent-ink, var(--accent)); color: var(--accent-ink, var(--accent)); padding: 4px 10px; cursor: pointer; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; }
  .br-vote-btn:hover { background: var(--accent-ink, var(--accent)); color: var(--bg); }
  .br-vote-down { border-color: var(--warn, #b0892a); color: var(--warn, #b0892a); }
  .br-vote-down:hover { background: var(--warn, #b0892a); color: var(--bg); }
  .br-vote-done { font-family: var(--font-mono); font-size: var(--fs-label); color: var(--success, #2d7a3a); }
  .br-empty { color: var(--text-ghost); font-size: var(--fs-nav); }

  .br-past { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .br-past-item summary { cursor: pointer; display: flex; justify-content: space-between; gap: 8px; padding: 6px 0; }
  .br-past-title { font-size: var(--fs-nav); color: var(--text-primary); }

  @media (max-width: 620px) {
    .br-ledger-row { grid-template-columns: 10px 1fr; row-gap: 2px; }
    .br-ledger-status, .br-ledger-detail { grid-column: 2; }
  }
</style>
