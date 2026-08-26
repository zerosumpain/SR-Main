<script lang="ts">
  import { Marked } from 'marked';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';
  import { sanitizeChatHtml } from '$lib/security/sanitize-chat';

  let { data } = $props();
  const marked = new Marked({ gfm: true, breaks: true });

  const audit = $derived(data.audit);
  const topTools = $derived((audit?.tools ?? []).slice(0, 15));
  const topMax = $derived(Math.max(1, ...topTools.map((t) => t.calls)));
  const perDay = $derived(audit?.perDay ?? []);
  const dayPeak = $derived(Math.max(1, ...perDay.map((d) => d.calls)));
  const byHour = $derived(audit?.byHour ?? []);
  const hourMap = $derived(new Map(byHour.map((h) => [h.hour, h.calls])));
  const hourPeak = $derived(Math.max(1, ...byHour.map((h) => h.calls)));

  // ── Derived analysis ──
  const busiestTool = $derived(audit?.tools?.[0] ?? null);
  const concentration = $derived(
    audit && audit.totalCalls > 0 && busiestTool ? Math.round((busiestTool.calls / audit.totalCalls) * 100) : 0,
  );
  const coverage = $derived(
    data.registryCount > 0 ? Math.round(((data.registryCount - data.neverUsed.length) / data.registryCount) * 100) : 0,
  );
  const busiestHour = $derived(
    byHour.length ? byHour.reduce((a, b) => (b.calls > a.calls ? b : a)) : null,
  );

  function fmtNum(n: number): string {
    return (n ?? 0).toLocaleString();
  }
  function shortTool(t: string): string {
    return t.replace(/^mcp_jkai_/, '').replace(/^mcp_/, '');
  }

  // ── Error rates (separate source: jkai_tool_traces in Postgres) ──
  const errs = $derived(data.errorRates);
  /** Only tools that actually failed lead the table; the rest are the tail. */
  const failing = $derived((errs?.tools ?? []).filter((t) => t.errors > 0));
  const clean = $derived((errs?.tools ?? []).filter((t) => t.errors === 0));

  /**
   * How much of the selected window the trace table can actually speak for.
   * Recording began on deploy day, so a 90d window can be backed by hours of
   * evidence — an unqualified "0% errors" would be a false all-clear.
   */
  const coverageNote = $derived.by(() => {
    if (!errs) return null;
    if (!errs.coverageFrom) return 'No turns recorded yet — recording starts with the next tool-using chat turn.';
    const from = new Date(errs.coverageFrom);
    const windowStart = Date.now() - errs.days * 86_400_000;
    const shortfall = from.getTime() > windowStart;
    const label = from.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    return shortfall
      ? `Recording began ${label}, so this covers less than the ${errs.days}-day window.`
      : `Covers the full ${errs.days}-day window.`;
  });

  function pct(rate: number): string {
    if (rate <= 0) return '0%';
    if (rate < 0.01) return '<1%';
    return `${Math.round(rate * 100)}%`;
  }
  /** Banding drives the colour: a fifth of calls failing is a different problem
   *  from the occasional transient. */
  function rateBand(rate: number): 'bad' | 'warn' | 'ok' {
    if (rate >= 0.2) return 'bad';
    if (rate >= 0.05) return 'warn';
    return 'ok';
  }
  function fmtWhen(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  // ── AI suggestions ──
  let suggestions = $state<string | null>(null);
  let loadingSuggestions = $state(false);
  let suggestError = $state<string | null>(null);
  const renderedSuggestions = $derived(
    suggestions ? sanitizeChatHtml(marked.parse(suggestions) as string) : '',
  );

  async function genSuggestions() {
    loadingSuggestions = true;
    suggestError = null;
    try {
      const res = await fetch('/api/admin/tool-usage/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: data.days }),
      });
      if (res.ok) {
        suggestions = (await res.json()).suggestions;
      } else {
        suggestError = `Request failed (${res.status})`;
      }
    } catch (err) {
      suggestError = err instanceof Error ? err.message : 'Request failed';
    } finally {
      loadingSuggestions = false;
    }
  }
</script>

<svelte:head><title>Tool usage — Admin</title></svelte:head>

<PageWrap width="wide">
  <PageHeader
    kicker="Ops"
    title="Tool usage"
    sub={data.audit?.storeNewestAt
      ? `Forensic audit of jkai tool calls, read from jkai_tool_traces. Newest turn recorded ${new Date(data.audit.storeNewestAt).toLocaleString('en-GB')}.`
      : "Forensic audit of jkai tool calls — frequency, trends, and how the toolset is actually used."}
  />

  <!-- Date filter -->
  <div class="filter-row">
    <span class="tele-days">
      {#each [7, 30, 90] as d (d)}
        <a class="day-pill" class:active={data.days === d} href={`?days=${d}`} data-sveltekit-noscroll>{d}d</a>
      {/each}
    </span>
    <span class="host-note">
      {data.audit?.coverageFrom
        ? `recording since ${new Date(data.audit.coverageFrom).toLocaleDateString('en-GB')}`
        : 'no traces recorded yet'}
    </span>
  </div>

  {#if !audit}
    <section class="nm-sec">
      <p class="empty-note">No tool calls recorded in this window.</p>
    </section>
  {:else}
    <!-- Stat tiles -->
    <div class="stat-grid">
      <div class="stat"><span class="stat-v">{fmtNum(audit.totalCalls)}</span><span class="stat-l">tool calls</span></div>
      <div class="stat"><span class="stat-v">{fmtNum(audit.uniqueTools)}</span><span class="stat-l">distinct tools</span></div>
      <div class="stat"><span class="stat-v mono">{busiestTool ? shortTool(busiestTool.tool) : '—'}</span><span class="stat-l">busiest ({concentration}%)</span></div>
      <div class="stat"><span class="stat-v">{coverage}%</span><span class="stat-l">registry used ({data.registryCount - data.neverUsed.length}/{data.registryCount})</span></div>
    </div>

    <!-- Top tools -->
    <section class="nm-sec">
      <div class="nm-sec-hd"><span class="sr-label-tight">Most-called tools</span><span class="nm-sec-meta">last {data.days}d</span></div>
      {@render hbars(topTools, topMax)}
    </section>

    <!-- Trends -->
    <section class="nm-sec">
      <div class="nm-sec-hd"><span class="sr-label-tight">Tool calls per day</span><span class="nm-sec-meta">last {data.days}d</span></div>
      {#if perDay.length}
        <div class="spark" role="img" aria-label="tool calls per day">
          {#each perDay as d (d.day)}
            <div class="spark-col" title={`${d.day}: ${d.calls} calls`}>
              <div class="spark-bar" style={`height:${Math.max(4, Math.round((d.calls / dayPeak) * 100))}%`}></div>
            </div>
          {/each}
        </div>
        <div class="spark-cap mono">{perDay[0]?.day} → {perDay[perDay.length - 1]?.day}</div>
      {:else}
        <p class="empty-note">No daily data.</p>
      {/if}
    </section>

    <section class="nm-sec">
      <div class="nm-sec-hd"><span class="sr-label-tight">By hour of day</span><span class="nm-sec-meta">{busiestHour ? `peak ${String(busiestHour.hour).padStart(2, '0')}:00` : ''}</span></div>
      <div class="hours" role="img" aria-label="tool calls by hour">
        {#each Array.from({ length: 24 }) as _, h (h)}
          {@const c = hourMap.get(h) ?? 0}
          <div class="hour-col" title={`${String(h).padStart(2, '0')}:00 — ${c} calls`}>
            <div class="hour-bar" style={`height:${Math.max(2, Math.round((c / hourPeak) * 100))}%`} class:zero={c === 0}></div>
            <span class="hour-lbl">{h % 6 === 0 ? String(h).padStart(2, '0') : ''}</span>
          </div>
        {/each}
      </div>
    </section>

    <!-- Never-used registered tools -->
    <section class="nm-sec">
      <div class="nm-sec-hd"><span class="sr-label-tight">Never called this window</span><span class="nm-sec-meta">{data.neverUsed.length} of {data.registryCount} registered</span></div>
      {#if data.neverUsed.length === 0}
        <p class="empty-note">Every registered tool was used — no dead weight.</p>
      {:else}
        <div class="chips">
          {#each data.neverUsed.slice(0, 60) as name (name)}
            <span class="chip mono">{name}</span>
          {/each}
          {#if data.neverUsed.length > 60}<span class="chip more">+{data.neverUsed.length - 60} more</span>{/if}
        </div>
        <p class="empty-note small">Candidates for review — registered but unused. Some are situational (deploy, delete), so judge before pruning.</p>
      {/if}
    </section>

    <!-- AI suggestions -->
    <section class="nm-sec">
      <div class="nm-sec-hd"><span class="sr-label-tight">Self-improvement suggestions</span><span class="nm-sec-meta">AI analysis</span></div>
      {#if renderedSuggestions}
        <div class="suggestions chat-markdown">{@html renderedSuggestions}</div>
        <button class="nm-save-btn ghost" onclick={genSuggestions} disabled={loadingSuggestions}>
          {loadingSuggestions ? 'Analysing…' : 'Regenerate'}
        </button>
      {:else}
        <p class="empty-note">Ask the model to read this window's usage and suggest how to improve the toolset and how it's used.</p>
        <button class="nm-save-btn" onclick={genSuggestions} disabled={loadingSuggestions}>
          {loadingSuggestions ? 'Analysing…' : 'Generate suggestions'}
        </button>
      {/if}
      {#if suggestError}<p class="empty-note small err">{suggestError}</p>{/if}
    </section>
  {/if}

  <!-- Error rates. OUTSIDE the audit branch on purpose: this comes from
       jkai_tool_traces in the app's own Postgres, so it still answers when the
       Hermes session store above is unreachable. -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Error rates</span>
      <span class="nm-sec-meta">
        {errs ? `${fmtNum(errs.traceCount)} recorded turn${errs.traceCount === 1 ? '' : 's'} · jkai chat` : 'unavailable'}
      </span>
    </div>

    {#if !errs}
      <p class="empty-note">Could not read the tool-trace table.</p>
    {:else if errs.totalCalls === 0}
      <p class="empty-note">{coverageNote}</p>
      <p class="empty-note small">
        Error rates are counted from recorded chat turns, not from the engine store above — tool
        results there are tag-wrapped, so failure is not a field that can be tested.
      </p>
    {:else}
      <div class="err-summary">
        <span class="err-headline" data-band={rateBand(errs.errorRate)}>{pct(errs.errorRate)}</span>
        <span class="err-headline-l">
          {fmtNum(errs.totalErrors)} failed of {fmtNum(errs.totalCalls)} recorded calls
        </span>
      </div>
      <p class="empty-note small">{coverageNote} Covers jkai chat turns only — a tool run by a workflow node outside a chat is not recorded here.</p>

      {#if failing.length === 0}
        <p class="empty-note">No failures recorded in this window.</p>
      {:else}
        <div class="nm-table-scroll">
          <table class="nm-table">
            <thead>
              <tr><th>Tool</th><th class="num">Calls</th><th class="num">Failed</th><th class="num">Rate</th><th>Last failure</th><th class="when">When</th></tr>
            </thead>
            <tbody>
              {#each failing as t (t.tool)}
                <tr>
                  <td class="mono">{shortTool(t.tool)}</td>
                  <td class="num mono">{fmtNum(t.calls)}</td>
                  <td class="num mono">{fmtNum(t.errors)}</td>
                  <td class="num mono rate" data-band={rateBand(t.errorRate)}>{pct(t.errorRate)}</td>
                  <td class="err-msg" title={t.lastError ?? ''}>{t.lastError ?? '—'}</td>
                  <td class="when mono">{fmtWhen(t.lastErrorAt)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

      {#if clean.length > 0}
        <details class="clean-toggle">
          <summary class="sr-label-tight">{clean.length} tool{clean.length === 1 ? '' : 's'} with no failures</summary>
          <div class="chips">
            {#each clean.slice(0, 60) as t (t.tool)}
              <span class="chip mono">{shortTool(t.tool)} <span class="chip-n">{t.calls}</span></span>
            {/each}
            {#if clean.length > 60}<span class="chip more">+{clean.length - 60} more</span>{/if}
          </div>
        </details>
      {/if}
    {/if}
  </section>
</PageWrap>

{#snippet hbars(rows: Array<{ tool: string; calls: number }>, max: number)}
  <div class="hbars">
    {#each rows as r (r.tool)}
      <div class="hbar-row" title={`${r.tool}: ${r.calls}`}>
        <span class="hbar-name mono">{shortTool(r.tool)}</span>
        <span class="hbar-track"><span class="hbar-fill" style={`width:${Math.max(2, Math.round((r.calls / max) * 100))}%`}></span></span>
        <span class="hbar-val mono">{r.calls}</span>
      </div>
    {/each}
  </div>
{/snippet}

<style>
  .filter-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.2rem; gap: 1rem; }
  .tele-days { display: inline-flex; gap: 0.3rem; }
  .day-pill { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.05em; padding: 0.2rem 0.55rem; border: 1px solid var(--card-border); border-radius: var(--radius-round); color: var(--text-secondary); text-decoration: none; }
  .day-pill.active { color: var(--bg); background: var(--accent); border-color: var(--accent); }
  .host-note { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }

  .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.6rem; margin-bottom: 1.2rem; }
  .stat { display: flex; flex-direction: column; gap: 0.2rem; padding: 0.7rem 0.85rem; border: 1px solid var(--card-border); border-radius: var(--radius-round); background: var(--bg-section); }
  .stat-v { font-family: var(--font-mono); font-size: 1.2rem; color: var(--text-primary); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .stat-v.mono { font-size: 0.95rem; }
  .stat-l { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }

  .nm-sec { border: 1px solid var(--card-border); border-radius: var(--radius-round); padding: 0.9rem 1rem 1rem; margin-bottom: 1.2rem; background: var(--bg); }
  .nm-sec-hd { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 0.8rem; }
  .nm-sec-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .two-col { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1.2rem; }
  .two-col .nm-sec { margin-bottom: 1.2rem; }

  /* horizontal bars */
  .hbars { display: flex; flex-direction: column; gap: 5px; }
  .hbar-row { display: grid; grid-template-columns: 130px 1fr 40px; align-items: center; gap: 8px; }
  .hbar-name { font-size: var(--fs-label-xs); color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hbar-track { height: 14px; background: var(--bg-section); border-radius: 2px; overflow: hidden; }
  .hbar-fill { display: block; height: 100%; background: var(--accent); border-radius: 0 2px 2px 0; }
  .hbar-val { font-size: var(--fs-label-xs); color: var(--text-primary); text-align: right; }

  /* per-day spark */
  .spark { display: flex; align-items: flex-end; gap: 2px; height: 70px; }
  .spark-col { flex: 1; height: 100%; display: flex; align-items: flex-end; min-width: 3px; }
  .spark-bar { width: 100%; background: var(--accent); border-radius: 2px 2px 0 0; opacity: 0.85; }
  .spark-cap { font-size: var(--fs-label-xs); color: var(--text-ghost); margin-top: 0.4rem; }

  /* hour histogram */
  .hours { display: flex; align-items: flex-end; gap: 3px; height: 80px; }
  .hour-col { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; }
  .hour-bar { width: 100%; background: var(--accent-ink); border-radius: 2px 2px 0 0; opacity: 0.85; }
  .hour-bar.zero { background: var(--card-border); opacity: 0.5; }
  .hour-lbl { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); margin-top: 3px; height: 10px; }

  /* chips */
  .chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .chip { font-size: var(--fs-label-xs); color: var(--text-secondary); border: 1px solid var(--card-border); border-radius: var(--radius-round); padding: 2px 7px; background: var(--bg-section); }
  .chip.more { color: var(--text-ghost); }

  .empty-note { font-size: var(--fs-label); color: var(--text-muted); margin: 0.2rem 0 0.8rem; }
  .empty-note.small { font-size: var(--fs-label-xs); margin-top: 0.6rem; }
  .empty-note.err { color: var(--error); }

  .mono { font-family: var(--font-mono); }

  .nm-save-btn { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; padding: 7px 13px; background: var(--accent); color: #fff; border: 1px solid var(--accent); border-radius: var(--radius-round); cursor: pointer; }
  .nm-save-btn.ghost { background: transparent; color: var(--text-secondary); border-color: var(--card-border); }
  .nm-save-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .suggestions { font-size: var(--fs-label); line-height: 1.55; color: var(--text-primary); margin-bottom: 0.9rem; }
  .suggestions :global(h2), .suggestions :global(h3) { font-size: 0.95rem; margin: 0.9em 0 0.3em; }
  .suggestions :global(ul) { padding-left: 1.2em; margin: 0.4em 0; }
  .suggestions :global(li) { margin: 0.25em 0; }
  .suggestions :global(code) { font-family: var(--font-mono); font-size: max(0.9em, var(--fs-label-xs)); background: var(--card-bg); padding: 0.05em 0.3em; border-radius: 2px; }
  .suggestions :global(strong) { font-weight: 700; }

  /* Error rates. `.nm-table` comes from admin.css, which IS loaded under
     /admin (unlike /jkai) — so the table needs no local base styling. */
  .err-summary { display: flex; align-items: baseline; gap: 0.6rem; margin-bottom: 0.15rem; }
  .err-headline { font-family: var(--font-mono); font-size: 1.4rem; line-height: 1; color: var(--success); }
  .err-headline[data-band='warn'] { color: var(--warn); }
  .err-headline[data-band='bad'] { color: var(--error); }
  .err-headline-l { font-size: var(--fs-label); color: var(--text-muted); }

  .nm-table .num { text-align: right; white-space: nowrap; }
  .nm-table .rate[data-band='ok'] { color: var(--text-secondary); }
  .nm-table .rate[data-band='warn'] { color: var(--warn); }
  .nm-table .rate[data-band='bad'] { color: var(--error); font-weight: 500; }
  .nm-table .err-msg {
    max-width: 380px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-primary);
  }
  .nm-table .when { white-space: nowrap; color: var(--text-ghost); }

  .clean-toggle { margin-top: 0.7rem; }
  .clean-toggle summary { cursor: pointer; color: var(--text-ghost); }
  .clean-toggle .chips { margin-top: 0.5rem; }
  .chip-n { color: var(--text-ghost); }
</style>
