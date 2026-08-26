<script lang="ts">
  import JsonBlock from '$lib/components/jkai/JsonBlock.svelte';
  import { isUniformRows, unionColumns, type TraceStep, type TraceSubAgent } from '$lib/jkai/tool-trace';
  import { categorizeTool } from '$lib/workflows/chat/tool-summary';
  import { rewriteLegacyToolLog } from '$lib/workflows/chat/legacy-tool-log';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const trace = $derived(data.trace);
  const meta = $derived(data.meta);
  const steps = $derived<TraceStep[]>(trace?.steps ?? []);
  const subAgents = $derived<TraceSubAgent[]>(trace?.subAgents ?? []);

  // ── Chain analysis ────────────────────────────────────────────────────────
  //
  // The chain was already the only durable record of a turn; it just had no
  // reader but a person. This asks a model where the calls went, and can hand
  // what it finds to the self-improvement engine's backlog.
  //
  // Findings are NOT sent automatically. One turn is one sample — the same
  // reason the by-tool rows below refuse to print a rate under five calls —
  // so a finding is a hypothesis for the backlog, never a live policy change.
  type ChainFinding = {
    kind: string; tool: string; calls: number; couldHaveBeen: number;
    cheaperRoute?: string; evidence: string; fix: string; rationale: string; steps: number[];
  };
  let analysing = $state(false);
  let analysis = $state<{ calls: number; discoveryCalls: number; discoveryShare: number } | null>(null);
  let findings = $state<ChainFinding[]>([]);
  let analysisNote = $state('');
  let analysisError = $state('');
  let sending = $state(false);
  let sendResult = $state('');

  async function runAnalysis() {
    analysing = true;
    analysisError = '';
    analysisNote = '';
    sendResult = '';
    try {
      const res = await fetch(`/api/jkai/trace/${meta.id}/analyse`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const body = await res.json();
      analysis = body.analysis ?? null;
      findings = Array.isArray(body.findings) ? body.findings : [];
      analysisNote = typeof body.note === 'string' ? body.note : '';
      // A 502 still carries the deterministic half, so show it and say the
      // model half is missing rather than blanking the measurement.
      if (body.error) analysisError = String(body.error);
    } catch (err) {
      analysisError = err instanceof Error ? err.message : 'analysis failed';
    } finally {
      analysing = false;
    }
  }

  async function sendToEngine() {
    if (!findings.length) return;
    sending = true;
    sendResult = '';
    try {
      const res = await fetch(`/api/jkai/trace/${meta.id}/analyse`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ send: findings }),
      });
      const body = await res.json();
      if (body.error) sendResult = String(body.error);
      else {
        const added = Array.isArray(body.added) ? body.added.length : 0;
        // Zero added is the normal, correct outcome once a finding has been
        // seen before — the backlog dedupes on the title slug. Saying "already
        // queued" beats a silent success that reads as a no-op.
        sendResult = added
          ? `queued ${added} idea${added === 1 ? '' : 's'} for the engine`
          : `already queued — the backlog has ${body.considered} of these`;
      }
    } catch (err) {
      sendResult = err instanceof Error ? err.message : 'send failed';
    } finally {
      sending = false;
    }
  }

  type SortKey = 'seq' | 'tool' | 'category' | 'status' | 'duration' | 'size';
  let sortKey = $state<SortKey>('seq');
  let sortDir = $state<'asc' | 'desc'>('asc');
  let filter = $state('');
  let onlyErrors = $state(false);

  // Expanded rows. Reassigned rather than mutated — a Set mutated in place is
  // not a reactive write in runes mode.
  let expanded = $state<Set<number>>(new Set());

  function toggleRow(seq: number) {
    const next = new Set(expanded);
    if (next.has(seq)) next.delete(seq);
    else next.add(seq);
    expanded = next;
  }

  function expandAll() {
    expanded = new Set(visibleSteps.map((s) => s.seq));
  }
  function collapseAll() {
    expanded = new Set();
  }

  function applySort(key: SortKey) {
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = key;
      sortDir = key === 'duration' || key === 'size' ? 'desc' : 'asc';
    }
  }

  function sortIndicator(key: SortKey): string {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  }

  const stepBytes = (s: TraceStep) => (s.argsBytes ?? 0) + (s.resultBytes ?? 0);

  /**
   * Category is recomputed at render rather than read from the stored step.
   * It is snapshotted at record time for future SQL aggregation, but the
   * categoriser gains tools over time and an old trace should not keep showing
   * a stale bucket for a tool we now classify correctly.
   */
  const catOf = (s: { displayTool: string; category: string }) =>
    categorizeTool(s.displayTool) || s.category;

  /**
   * Several tools (`web_extract` among them) return their payload as a
   * JSON *string* rather than an object, which renders as one escaped blob.
   * Parse it so the pretty-printer and the table-ifier can see the real shape;
   * the untouched original stays available under "raw json".
   */
  function maybeParse(value: unknown): { value: unknown; parsed: boolean } {
    if (typeof value !== 'string') return { value, parsed: false };
    const t = value.trim();
    if (t.length < 2 || !/^[[{]/.test(t)) return { value, parsed: false };
    try {
      const out = JSON.parse(t);
      if (out && typeof out === 'object') return { value: out, parsed: true };
    } catch {
      /* not JSON — show it as the string it is */
    }
    return { value, parsed: false };
  }

  const visibleSteps = $derived.by(() => {
    const q = filter.trim().toLowerCase();
    let rows = steps;
    if (onlyErrors) rows = rows.filter((s) => s.status === 'error');
    if (q) {
      rows = rows.filter(
        (s) =>
          s.displayTool.toLowerCase().includes(q) ||
          s.tool.toLowerCase().includes(q) ||
          (s.summary ?? '').toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q),
      );
    }
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case 'tool':
          return a.displayTool.localeCompare(b.displayTool) * dir;
        case 'category':
          return a.category.localeCompare(b.category) * dir;
        case 'status':
          return a.status.localeCompare(b.status) * dir;
        case 'duration':
          return ((a.durationMs ?? -1) - (b.durationMs ?? -1)) * dir;
        case 'size':
          return (stepBytes(a) - stepBytes(b)) * dir;
        default:
          return (a.seq - b.seq) * dir;
      }
    });
  });

  /** Longest single call, for scaling the duration bars. */
  const slowestMs = $derived(Math.max(1, ...steps.map((s) => s.durationMs ?? 0)));
  /** Turn span, for placing each call on the timeline. */
  const spanMs = $derived(Math.max(1, trace?.durationMs ?? 0));

  const totalBytes = $derived(steps.reduce((n, s) => n + stepBytes(s), 0));
  const slowest = $derived.by(() => {
    let best: TraceStep | null = null;
    for (const s of steps) if ((s.durationMs ?? 0) > (best?.durationMs ?? -1)) best = s;
    return best;
  });

  /** Tool-name frequency, so a chain that hammers one tool says so at a glance. */
  const toolCounts = $derived.by(() => {
    const m = new Map<string, { calls: number; errors: number; totalMs: number }>();
    for (const s of steps) {
      const row = m.get(s.displayTool) ?? { calls: 0, errors: 0, totalMs: 0 };
      row.calls++;
      if (s.status === 'error') row.errors++;
      row.totalMs += s.durationMs ?? 0;
      m.set(s.displayTool, row);
    }
    return [...m.entries()].sort((a, b) => b[1].totalMs - a[1].totalMs || b[1].calls - a[1].calls);
  });

  /** Scale for the by-tool bars. */
  const slowestToolMs = $derived(Math.max(1, ...toolCounts.map(([, r]) => r.totalMs)));

  /** Each tool's failure rate across all recorded turns — the "is this normal?"
   *  context a single turn cannot supply. Absent for tools with too few calls. */
  const baselines = $derived(data.baselines ?? {});

  function pct(rate: number): string {
    if (rate <= 0) return '0%';
    if (rate < 0.01) return '<1%';
    return `${Math.round(rate * 100)}%`;
  }
  /** Same bands as /admin/ops/tool-usage, so the two pages agree on what
   *  "bad" means. */
  function rateBand(rate: number): 'bad' | 'warn' | 'ok' {
    if (rate >= 0.2) return 'bad';
    if (rate >= 0.05) return 'warn';
    return 'ok';
  }

  function fmtMs(ms: number | null | undefined): string {
    if (ms === null || ms === undefined) return '—';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
    const m = Math.floor(ms / 60_000);
    const s = Math.round((ms % 60_000) / 1000);
    return `${m}m ${s}s`;
  }

  function fmtBytes(n: number | null | undefined): string {
    if (!n) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  }

  function fmtClock(ms: number | null | undefined): string {
    if (ms === null || ms === undefined) return '—';
    return new Date(ms).toLocaleTimeString('en-GB', { hour12: false });
  }

  /**
   * The "table-ified where possible" rule. A tool result is usually an
   * `{ success, data }` envelope with the interesting array one level down under
   * an inconsistent key (`hits`, `messages`, `files`, `memories`, `rows`,
   * `results`, `items`). Find the first array that reads as uniform rows; if
   * none does, the caller falls back to JSON.
   */
  function tabulate(value: unknown): { rows: Record<string, unknown>[]; cols: string[]; path: string } | null {
    const seen = new Set<unknown>();

    function search(v: unknown, path: string, depth: number): { rows: Record<string, unknown>[]; cols: string[]; path: string } | null {
      if (depth > 4 || v === null || typeof v !== 'object') return null;
      if (seen.has(v)) return null;
      seen.add(v);

      if (isUniformRows(v)) {
        const rows = v as Record<string, unknown>[];
        return { rows, cols: unionColumns(rows), path: path || 'result' };
      }
      if (Array.isArray(v)) return null;

      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        const hit = search(val, path ? `${path}.${k}` : k, depth + 1);
        if (hit) return hit;
      }
      return null;
    }

    return search(value, '', 0);
  }

  function cellText(v: unknown): string {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) return v.map((x) => cellText(x)).join(', ');
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }

  let copied = $state(false);
  async function copyJson() {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ meta, trace }, null, 2));
      copied = true;
      setTimeout(() => (copied = false), 1600);
    } catch {
      copied = false;
    }
  }

  function downloadJson() {
    const blob = new Blob([JSON.stringify({ meta, trace }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jkai-trace-${meta.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * `rewriteLegacyToolLog` turns the interleaved `⚙️ mcp_jkai_…` log lines
   * into English, but emits them wrapped in HTML because its normal consumer is
   * the markdown pipeline. This panel renders plain text, so drop the tags —
   * rendering them literally is worse than not rewriting at all.
   */
  const replyText = $derived.by(() => {
    if (!data.reply) return '';
    const rewritten = rewriteLegacyToolLog(data.reply.content).replace(/<[^>]+>/g, '');
    return rewritten.length > 2000 ? `${rewritten.slice(0, 2000)}…` : rewritten;
  });

  const backHref = $derived(
    meta.workflowId ? `/jkai/canvas` : meta.conversationId ? `/jkai?c=${meta.conversationId}` : '/jkai',
  );
</script>

<svelte:head>
  <title>Tool call chain — jkai</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">jkai · trace</div>
      <h1>Tool call chain</h1>
      {#if meta.prompt}
        <p class="sub">“{meta.prompt}”</p>
      {/if}
      <p class="crumbs">
        <a href={backHref}>← {meta.conversationTitle || (meta.workflowId ? 'canvas' : 'conversation')}</a>
        <span class="dot">·</span>
        <span class="mono">{new Date(meta.createdAt).toLocaleString('en-GB')}</span>
      </p>
    </div>
    <div class="hdr-actions">
      <button type="button" class="ghost-btn accent-btn" onclick={runAnalysis} disabled={analysing}>
        {analysing ? 'analysing…' : 'analyse chain'}
      </button>
      <button type="button" class="ghost-btn" onclick={copyJson}>{copied ? 'copied' : 'copy json'}</button>
      <button type="button" class="ghost-btn" onclick={downloadJson}>download</button>
    </div>
  </header>

  <section class="stat-grid">
    <div class="stat">
      <div class="stat-v">{trace.stepCount}</div>
      <div class="stat-l">calls</div>
    </div>
    <div class="stat" class:bad={trace.errorCount > 0}>
      <div class="stat-v">{trace.errorCount}</div>
      <div class="stat-l">failed</div>
    </div>
    <div class="stat">
      <div class="stat-v">{fmtMs(trace.durationMs)}</div>
      <div class="stat-l">chain span</div>
    </div>
    <div class="stat">
      <div class="stat-v">{fmtMs(slowest?.durationMs)}</div>
      <div class="stat-l">slowest call</div>
    </div>
    <div class="stat">
      <div class="stat-v">{fmtBytes(totalBytes)}</div>
      <div class="stat-l">payload</div>
    </div>
    {#if meta.costUsd != null}
      <div class="stat">
        <div class="stat-v">${meta.costUsd.toFixed(4)}</div>
        <div class="stat-l">turn cost</div>
      </div>
    {/if}
    {#if meta.model}
      <div class="stat wide">
        <div class="stat-v mono-sm">{meta.model}</div>
        <div class="stat-l">model</div>
      </div>
    {/if}
  </section>

  {#if analysis || analysisError}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Where the calls went</span>
        {#if analysis}
          <span class="sec-meta">
            {analysis.discoveryCalls} of {analysis.calls} were discovery ({Math.round(analysis.discoveryShare * 100)}%)
          </span>
        {/if}
      </div>

      {#if analysisError}
        <p class="note bad-note">
          The model half failed: {analysisError}
          {#if analysis}The measured counts above still stand.{/if}
        </p>
      {/if}

      {#if analysisNote}
        <p class="note">{analysisNote}</p>
      {/if}

      {#if findings.length}
        <div class="findings">
          {#each findings as f (f.tool + f.kind)}
            <article class="finding">
              <div class="finding-hd">
                <span class="fkind">{f.kind.replace(/_/g, ' ')}</span>
                <span class="ftool mono">{f.tool}</span>
                <span class="fsaved">{f.calls} → {f.couldHaveBeen} calls</span>
                <span class="ffix">{f.fix.replace(/_/g, ' ')}</span>
              </div>
              <p class="frat">{f.rationale}</p>
              {#if f.cheaperRoute}
                <p class="froute">Cheaper route: <code>{f.cheaperRoute}</code></p>
              {/if}
              <p class="fev">{f.evidence}</p>
              {#if f.steps?.length}
                <p class="fsteps mono">
                  steps
                  {#each f.steps.slice(0, 24) as s (s)}
                    <button type="button" class="steplink" onclick={() => toggleRow(s)}>#{s}</button>
                  {/each}
                  {#if f.steps.length > 24}<span class="dot">+{f.steps.length - 24} more</span>{/if}
                </p>
              {/if}
            </article>
          {/each}
        </div>

        <div class="send-row">
          <button type="button" class="ghost-btn accent-btn" onclick={sendToEngine} disabled={sending}>
            {sending ? 'sending…' : 'send to self-improvement'}
          </button>
          {#if sendResult}<span class="send-note">{sendResult}</span>{/if}
          <!-- One turn is one sample. The engine trials and reverts on its own
               measurement; nothing here changes live tool behaviour. -->
          <span class="send-hint">queues a backlog idea — it does not change any tool</span>
        </div>
      {:else if analysis && !analysisError && !analysisNote}
        <p class="note">Nothing worth reporting on this chain.</p>
      {/if}
    </section>
  {/if}

  {#if trace.droppedSteps > 0 || trace.payloadsDropped > 0}
    <p class="note">
      {#if trace.droppedSteps > 0}
        {trace.droppedSteps} call{trace.droppedSteps === 1 ? '' : 's'} past the recording cap were not stored.
      {/if}
      {#if trace.payloadsDropped > 0}
        {trace.payloadsDropped} payload{trace.payloadsDropped === 1 ? '' : 's'} were dropped to keep the trace within its size budget — the calls themselves are all here.
      {/if}
    </p>
  {/if}

  {#if steps.length === 0}
    <p class="empty">This turn recorded no tool calls.</p>
  {:else}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">By tool — time spent, and how often it fails</span>
        <span class="sec-meta">{toolCounts.length} distinct</span>
      </div>
      <!-- Bars are scaled by time, not call count: on a typical chain most tools
           are called once, so a frequency bar is a row of identical blocks. Time
           is the figure that actually varies and the one worth looking at. -->
      <div class="tool-bars">
        {#each toolCounts as [tool, row] (tool)}
          {@const base = baselines[tool]}
          <div class="tool-bar-row">
            <span class="tb-name mono" title={tool}>{tool}</span>
            <span class="tb-track">
              <span
                class="tb-fill"
                class:bad={row.errors > 0}
                style="width: {Math.max(1.5, (row.totalMs / slowestToolMs) * 100)}%"
                title="{fmtMs(row.totalMs)} across {row.calls} call{row.calls === 1 ? '' : 's'}"
              ></span>
            </span>
            <span class="tb-n mono" title="calls">×{row.calls}</span>
            <span class="tb-fail mono" class:bad={row.errors > 0} title="failed in this turn">
              {row.errors > 0 ? `${row.errors} failed` : ''}
            </span>
            <!-- The baseline is the point of this column: one call that failed is
                 100% of this turn and tells you nothing on its own. -->
            <span
              class="tb-base mono"
              data-band={base?.meaningful ? rateBand(base.errorRate) : 'ok'}
              title={base
                ? `${base.errors} of ${base.calls} recorded call${base.calls === 1 ? '' : 's'} failed in ${data.baselineDays}d`
                : 'no other recorded calls'}
            >
              {base?.meaningful ? `${pct(base.errorRate)} usually` : '—'}
            </span>
            <span class="tb-ms mono">{fmtMs(row.totalMs)}</span>
          </div>
        {/each}
      </div>
      <p class="bar-note">
        “Usually” is this tool’s failure rate across all recorded turns in the last {data.baselineDays} days —
        shown only once there are enough calls to mean something. Recording began when the trace table shipped.
      </p>
    </section>

    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">The chain</span>
        <span class="sec-meta">
          {visibleSteps.length}{visibleSteps.length !== steps.length ? ` of ${steps.length}` : ''} shown
        </span>
      </div>

      <div class="controls">
        <input
          class="nm-text-input filter"
          type="search"
          placeholder="filter by tool, category or summary…"
          bind:value={filter}
        />
        <label class="chk">
          <input type="checkbox" bind:checked={onlyErrors} />
          failures only
        </label>
        <button type="button" class="ghost-btn" onclick={expandAll}>expand all</button>
        <button type="button" class="ghost-btn" onclick={collapseAll}>collapse all</button>
      </div>

      <div class="tablewrap">
        <table>
          <colgroup>
            <col style="width: 46px" />
            <col style="width: 34px" />
            <col style="width: 74px" />
            <col style="width: 190px" />
            <col />
            <col style="width: 150px" />
            <col style="width: 86px" />
            <col style="width: 96px" />
            <col style="width: 46px" />
          </colgroup>
          <thead>
            <tr>
              <th><button type="button" onclick={() => applySort('seq')}>#{sortIndicator('seq')}</button></th>
              <th><button type="button" onclick={() => applySort('status')} title="status">•{sortIndicator('status')}</button></th>
              <th><button type="button" onclick={() => applySort('category')}>Cat{sortIndicator('category')}</button></th>
              <th><button type="button" onclick={() => applySort('tool')}>Tool{sortIndicator('tool')}</button></th>
              <th class="plain">What it did</th>
              <th class="plain">When</th>
              <th><button type="button" onclick={() => applySort('duration')}>Took{sortIndicator('duration')}</button></th>
              <th><button type="button" onclick={() => applySort('size')}>Size{sortIndicator('size')}</button></th>
              <th class="plain"></th>
            </tr>
          </thead>
          <tbody>
            {#each visibleSteps as step (step.seq)}
              {@const isOpen = expanded.has(step.seq)}
              {@const cat = catOf(step)}
              <tr class="step-row" data-status={step.status} class:open={isOpen}>
                <td class="mono num">{step.seq}</td>
                <td class="status-cell" data-status={step.status} title={step.status}>
                  {step.status === 'error' ? '✗' : step.status === 'running' ? '◌' : '✓'}
                </td>
                <td><span class="cat" data-cat={cat}>{cat}</span></td>
                <td class="mono tool-cell" title={step.tool !== step.displayTool ? `raw: ${step.tool}` : step.displayTool}>
                  {step.displayTool}
                </td>
                <td class="summary-cell">
                  {step.summary || (step.error ? step.error : '—')}
                </td>
                <td class="when-cell">
                  <span class="tl-track" title="{fmtClock(step.startedAt)} · +{fmtMs(step.offsetMs)} into the chain">
                    <span
                      class="tl-fill"
                      data-status={step.status}
                      style="left: {Math.min(99, (step.offsetMs / spanMs) * 100)}%; width: {Math.max(1.5, ((step.durationMs ?? 0) / spanMs) * 100)}%"
                    ></span>
                  </span>
                  <span class="mono tl-off">+{fmtMs(step.offsetMs)}</span>
                </td>
                <td class="mono num dur" data-slow={(step.durationMs ?? 0) >= slowestMs * 0.6 ? 'true' : 'false'}>
                  {fmtMs(step.durationMs)}
                </td>
                <td class="mono num size">{fmtBytes(stepBytes(step))}</td>
                <td class="expand-cell">
                  <button
                    type="button"
                    class="expand-btn"
                    onclick={() => toggleRow(step.seq)}
                    aria-expanded={isOpen}
                    aria-label={isOpen ? 'Collapse call detail' : 'Expand call detail'}
                  >{isOpen ? '−' : '+'}</button>
                </td>
              </tr>
              {#if isOpen}
                <tr class="detail-row">
                  <td colspan="9">
                    <div class="detail">
                      <div class="kv-grid">
                        <div class="kv"><span>call id</span><span class="mono">{step.toolCallId}</span></div>
                        <div class="kv"><span>raw tool</span><span class="mono">{step.tool}</span></div>
                        <div class="kv"><span>started</span><span class="mono">{fmtClock(step.startedAt)}</span></div>
                        <div class="kv"><span>ended</span><span class="mono">{fmtClock(step.endedAt)}</span></div>
                        {#if step.error}
                          <div class="kv err"><span>error</span><span>{step.error}</span></div>
                        {/if}
                      </div>

                      {#if step.payloadShed}
                        <p class="note inline">Payloads for this call were dropped to keep the trace within its size budget.</p>
                      {/if}

                      <div class="panes">
                        <div class="pane">
                          <div class="pane-hd">
                            <span class="sr-label-tight">args</span>
                            {#if step.argsTruncated}<span class="trunc">truncated · {fmtBytes(step.argsBytes)} original</span>{/if}
                          </div>
                          {#if Object.keys(step.args).length === 0}
                            <p class="pane-empty">no arguments</p>
                          {:else}
                            {@const argTable = tabulate(step.args)}
                            {#if argTable}
                              {@render dataTable(argTable.rows, argTable.cols, argTable.path)}
                              <details class="raw-toggle">
                                <summary class="sr-label-tight">raw json</summary>
                                <JsonBlock data={step.args} fontSize="10px" />
                              </details>
                            {:else}
                              <JsonBlock data={step.args} fontSize="10px" />
                            {/if}
                          {/if}
                        </div>

                        <div class="pane">
                          <div class="pane-hd">
                            <span class="sr-label-tight">result</span>
                            {#if step.resultTruncated}<span class="trunc">truncated · {fmtBytes(step.resultBytes)} original</span>{/if}
                          </div>
                          {#if step.result === undefined}
                            <p class="pane-empty">no result recorded — the call never completed</p>
                          {:else}
                            {@const res = maybeParse(step.result)}
                            {@const resTable = tabulate(res.value)}
                            {#if res.parsed || step.resultJsonString}
                              <p class="pane-note">the tool returned this as a JSON string — parsed for display</p>
                            {/if}
                            {#if step.resultClipped}
                              <p class="pane-note warn">
                                incomplete JSON — the runtime clipped this result before the trace saw it
                                (native tool results were previewed at 600 characters)
                              </p>
                            {/if}
                            {#if resTable}
                              {@render dataTable(resTable.rows, resTable.cols, resTable.path)}
                              <details class="raw-toggle">
                                <summary class="sr-label-tight">raw json</summary>
                                <JsonBlock data={step.result} fontSize="10px" />
                              </details>
                            {:else}
                              <JsonBlock data={res.value} fontSize="10px" />
                              {#if res.parsed}
                                <details class="raw-toggle">
                                  <summary class="sr-label-tight">raw string</summary>
                                  <JsonBlock data={step.result} fontSize="10px" />
                                </details>
                              {/if}
                            {/if}
                          {/if}
                        </div>
                      </div>

                      {#if step.artifact !== undefined}
                        <!-- Lifted out of result.data.artifact before capping so
                             the chat can re-render it verbatim; shown here too,
                             or the result pane above reads as "returned nothing". -->
                        {@const artTable = tabulate(step.artifact)}
                        <div class="pane">
                          <div class="pane-hd"><span class="sr-label-tight">artifact</span></div>
                          {#if artTable}
                            {@render dataTable(artTable.rows, artTable.cols, artTable.path)}
                          {:else}
                            <JsonBlock data={step.artifact} fontSize="10px" />
                          {/if}
                        </div>
                      {/if}

                      {#if step.ephemeral}
                        <div class="pane">
                          <div class="pane-hd">
                            <span class="sr-label-tight">ephemeral tool</span>
                            <span class="trunc">{step.ephemeral.proposedName ?? 'unnamed'}</span>
                          </div>
                          <details class="raw-toggle">
                            <summary class="sr-label-tight">handler source</summary>
                            <pre class="handler">{step.ephemeral.handlerCode}</pre>
                          </details>
                        </div>
                      {/if}

                      {#if step.children?.length}
                        <div class="pane">
                          <div class="pane-hd"><span class="sr-label-tight">sub-agents</span></div>
                          <div class="tablewrap inner">
                            <table>
                              <colgroup>
                                <col style="width: 34px" />
                                <col style="width: 66px" />
                                <col />
                                <col style="width: 170px" />
                                <col style="width: 54px" />
                                <col style="width: 58px" />
                                <col style="width: 180px" />
                              </colgroup>
                              <thead>
                                <tr><th class="plain">#</th><th class="plain">Status</th><th class="plain">Summary</th><th class="plain">Model</th><th class="plain">Calls</th><th class="plain">Took</th><th class="plain">Tools</th></tr>
                              </thead>
                              <tbody>
                                {#each step.children as child (child.index)}
                                  <tr>
                                    <td class="mono num">{child.index}</td>
                                    <td class="mono">{child.status}</td>
                                    <td>{child.summary}</td>
                                    <td class="mono">{child.model ?? '—'}</td>
                                    <td class="mono num">{child.apiCalls ?? '—'}</td>
                                    <td class="mono num">{child.durationSeconds != null ? `${child.durationSeconds}s` : '—'}</td>
                                    <td class="mono tiny">{child.toolTrace?.map((t) => t.tool).join(' · ') || '—'}</td>
                                  </tr>
                                {/each}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      {/if}
                    </div>
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}

  {#if subAgents.length > 0}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Sub-agent chains</span>
        <span class="sec-meta">{subAgents.length} agent{subAgents.length === 1 ? '' : 's'}</span>
      </div>
      {#each subAgents as sub (sub.agentId)}
        <div class="subagent">
          <div class="sa-hd">
            <span class="cat" data-cat="AGENT">{sub.status}</span>
            <span class="sa-task">{sub.task || sub.agentId}</span>
            <span class="mono sa-meta">{sub.steps.length} call{sub.steps.length === 1 ? '' : 's'} · {fmtMs(sub.durationMs)}</span>
          </div>
          {#if sub.summary}<p class="sa-summary">{sub.summary}</p>{/if}
          {#if sub.steps.length > 0}
            <div class="tablewrap inner">
              <table>
                <colgroup>
                  <col style="width: 74px" />
                  <col style="width: 170px" />
                  <col />
                  <col style="width: 76px" />
                </colgroup>
                <thead>
                  <tr><th class="plain">Cat</th><th class="plain">Tool</th><th class="plain">What it did</th><th class="plain">Took</th></tr>
                </thead>
                <tbody>
                  {#each sub.steps as s, i (i)}
                    <tr>
                      <td><span class="cat" data-cat={catOf(s)}>{catOf(s)}</span></td>
                      <td class="mono">{s.displayTool}</td>
                      <td>{s.summary || '—'}</td>
                      <td class="mono num">{fmtMs(s.durationMs)}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>
      {/each}
    </section>
  {/if}

  {#if data.reply}
    <section class="nm-sec">
      <div class="nm-sec-hd"><span class="sr-label-tight">The reply this produced</span></div>
      <p class="reply">{replyText}</p>
    </section>
  {/if}
</div>

{#snippet dataTable(rows: Record<string, unknown>[], cols: string[], path: string)}
  <div class="tablewrap inner">
    <div class="tbl-path mono">{path} · {rows.length} rows</div>
    <table>
      <thead>
        <tr>
          {#each cols as c (c)}<th class="plain">{c}</th>{/each}
        </tr>
      </thead>
      <tbody>
        {#each rows as row, i (i)}
          <tr>
            {#each cols as c (c)}
              <td class="cell" title={cellText(row[c])}>{cellText(row[c])}</td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/snippet}

<style>
  /* Shell mirrors /jkai/improvement + /jkai/doctor, widened because a call
     chain is a wide table. */
  .wrap {
    max-width: 1280px;
    margin: 2rem auto 4rem;
    padding: 0 1.5rem;
    color: var(--text-primary);
    font-family: var(--font-body);
  }
  .page-hdr {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 1.5rem;
    margin-bottom: 1.75rem;
    padding-bottom: 1rem;
    border-bottom: 2px solid var(--text-primary);
  }
  .kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--accent);
    margin-bottom: 0.35rem;
  }
  .page-hdr h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 2.2rem;
    font-weight: 900;
    line-height: 1.05;
  }
  .sub {
    margin: 0.6rem 0 0;
    font-size: 0.95rem;
    line-height: 1.5;
    color: var(--text-secondary);
    max-width: 64ch;
  }
  .crumbs {
    margin: 0.5rem 0 0;
    font-size: 0.8rem;
    color: var(--text-muted);
  }
  .crumbs a {
    color: var(--accent);
    text-decoration: none;
  }
  .crumbs a:hover {
    text-decoration: underline;
  }
  .dot {
    margin: 0 0.4rem;
    color: var(--text-ghost);
  }
  .hdr-actions {
    display: flex;
    gap: 0.5rem;
    flex: none;
  }

  .ghost-btn {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .ghost-btn:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  .stat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 0.6rem;
    margin-bottom: 1.5rem;
  }
  .stat {
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-soft, 4px);
    padding: 0.6rem 0.75rem;
    background: var(--card-bg);
  }
  .stat.wide {
    grid-column: span 2;
  }
  .stat.bad .stat-v {
    color: var(--error);
  }
  .stat-v {
    font-family: var(--font-mono);
    font-size: 1.2rem;
    color: var(--text-primary);
    line-height: 1.2;
  }
  .stat-v.mono-sm {
    font-size: 0.8rem;
    word-break: break-all;
  }
  .stat-l {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
    margin-top: 0.2rem;
  }

  .nm-sec {
    margin-bottom: 1.75rem;
  }
  .nm-sec-hd {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.6rem;
  }
  .sec-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }

  .note {
    font-size: 0.82rem;
    color: var(--warn);
    border-left: 2px solid var(--warn);
    padding-left: 0.6rem;
    margin: 0 0 1.25rem;
  }

  /* ── Chain analysis ─────────────────────────────────────────────────── */

  .accent-btn {
    color: var(--accent-ink);
    border-color: var(--accent-ink);
  }
  .accent-btn:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .bad-note {
    color: var(--error);
    border-left-color: var(--error);
  }

  .findings {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin-bottom: 0.9rem;
  }

  .finding {
    border: 1px solid var(--card-border);
    border-left: 2px solid var(--accent);
    background: var(--card-bg);
    padding: 0.7rem 0.85rem;
  }

  .finding-hd {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem 0.9rem;
    margin-bottom: 0.45rem;
  }

  .fkind,
  .ffix,
  .fsaved {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .fkind {
    color: var(--accent-ink);
  }
  .fsaved {
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }
  .ffix {
    color: var(--text-ghost);
    margin-left: auto;
  }
  .ftool {
    font-size: 0.85rem;
    color: var(--text-primary);
  }

  .frat {
    margin: 0 0 0.35rem;
    font-size: 0.87rem;
    color: var(--text-secondary);
  }
  .froute,
  .fev,
  .fsteps {
    margin: 0 0 0.3rem;
    font-size: 0.78rem;
    color: var(--text-muted);
  }
  .fsteps {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
  }

  .steplink {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    padding: 0.05rem 0.3rem;
    border: 1px solid var(--line-hair);
    border-radius: var(--radius-sharp);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .steplink:hover {
    border-color: var(--line-strong);
    color: var(--text-primary);
  }

  .send-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.8rem;
    margin-bottom: 1.25rem;
  }
  .send-note {
    font-size: 0.8rem;
    color: var(--text-secondary);
  }
  .send-hint {
    font-size: 0.75rem;
    color: var(--text-ghost);
  }
  .note.inline {
    margin: 0.5rem 0;
  }
  .empty {
    color: var(--text-muted);
    font-size: 0.9rem;
  }

  /* By-tool bars — same shape as the /admin tool-usage horizontal bars. */
  .tool-bars {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .tool-bar-row {
    display: grid;
    grid-template-columns: 190px 1fr 40px 72px 92px 60px;
    align-items: center;
    gap: 0.5rem;
  }
  @media (max-width: 900px) {
    /* Drop the baseline column before the bar becomes unreadable. */
    .tool-bar-row {
      grid-template-columns: 140px 1fr 36px 66px 56px;
    }
    .tb-base {
      display: none;
    }
  }
  .tb-fail,
  .tb-base {
    font-size: var(--fs-label-xs);
    text-align: right;
    color: var(--text-ghost);
    white-space: nowrap;
  }
  .tb-fail.bad {
    color: var(--error);
  }
  .tb-base[data-band='warn'] {
    color: var(--warn);
  }
  .tb-base[data-band='bad'] {
    color: var(--error);
  }
  .bar-note {
    margin: 0.55rem 0 0;
    font-size: 0.78rem;
    line-height: 1.45;
    color: var(--text-ghost);
  }
  .tb-name {
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tb-track {
    height: 10px;
    background: color-mix(in srgb, var(--card-border) 35%, transparent);
    position: relative;
  }
  .tb-fill {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--accent);
  }
  .tb-fill.bad {
    background: var(--error);
  }
  .tb-n,
  .tb-ms {
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    text-align: right;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 0.6rem;
    flex-wrap: wrap;
  }
  .filter {
    flex: 1;
    min-width: 220px;
    font-size: 16px; /* iOS zoom floor */
  }
  .chk {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-secondary);
    cursor: pointer;
  }

  /* Tables follow the /jkai convention (intel/entities), NOT .nm-table —
     admin.css is not loaded under /jkai. */
  .tablewrap {
    overflow-x: auto;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-soft, 4px);
    background: var(--card-bg);
  }
  .tablewrap.inner {
    margin-top: 0.35rem;
    background: var(--bg-base, transparent);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    min-width: 900px;
  }
  .tablewrap.inner table {
    min-width: 0;
  }
  th {
    text-align: left;
    padding: 0;
    border-bottom: 1px solid var(--line-strong);
  }
  th.plain,
  th button {
    width: 100%;
    text-align: left;
    border: 0;
    background: transparent;
    border-radius: 0;
    padding: 7px 9px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
    font-weight: 500;
  }
  th button {
    cursor: pointer;
  }
  th button:hover {
    color: var(--accent);
  }
  td {
    padding: 6px 9px;
    border-bottom: 1px solid var(--line-hair);
    vertical-align: middle;
    font-size: 0.82rem;
    color: var(--text-secondary);
  }
  .mono {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
  }
  .tiny {
    font-size: var(--fs-label-xs);
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .step-row:hover td {
    background: var(--surface-overlay);
  }
  .step-row.open td {
    background: var(--accent-tint-08);
  }
  .step-row[data-status='error'] .status-cell {
    color: var(--error);
  }
  .step-row[data-status='running'] .status-cell {
    color: var(--warn);
  }
  .status-cell {
    text-align: center;
    color: var(--success);
    font-size: 0.8rem;
  }
  .tool-cell {
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .summary-cell {
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 0;
  }
  .dur[data-slow='true'] {
    color: var(--accent);
    font-weight: 500;
  }
  .size {
    color: var(--text-ghost);
  }

  .cat {
    display: inline-block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 600;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    padding: 1px 5px;
    border-radius: var(--radius-sharp);
    border: 1px solid color-mix(in srgb, currentColor 45%, transparent);
    background: color-mix(in srgb, currentColor 9%, transparent);
    color: var(--text-muted);
    line-height: 1.5;
  }
  /* Same category colours as the chat's step cards, so the two views agree. */
  .cat[data-cat='WEB'],
  .cat[data-cat='MAIL'],
  .cat[data-cat='AGENT'] {
    color: var(--accent-ink);
  }
  .cat[data-cat='RUN'] {
    color: var(--accent);
  }
  .cat[data-cat='HOME'] {
    color: var(--success);
  }
  .cat[data-cat='SCHED'] {
    color: var(--warn);
  }

  /* Timeline: where in the turn this call sat, and how long it held. */
  .when-cell {
    white-space: nowrap;
  }
  .tl-track {
    display: inline-block;
    position: relative;
    width: 96px;
    height: 8px;
    background: color-mix(in srgb, var(--card-border) 35%, transparent);
    vertical-align: middle;
  }
  .tl-fill {
    position: absolute;
    top: 0;
    bottom: 0;
    background: var(--accent);
    min-width: 2px;
  }
  .tl-fill[data-status='error'] {
    background: var(--error);
  }
  .tl-fill[data-status='running'] {
    background: var(--warn);
  }
  .tl-off {
    margin-left: 0.4rem;
    color: var(--text-ghost);
    font-size: var(--fs-label-xs);
  }

  .expand-cell {
    text-align: center;
  }
  .expand-btn {
    border: 1px solid var(--line-strong);
    background: transparent;
    color: var(--text-secondary);
    font-family: var(--font-mono);
    line-height: 1;
    width: 20px;
    height: 20px;
    border-radius: var(--radius-sharp);
    cursor: pointer;
  }
  .expand-btn:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  .detail-row td {
    background: var(--surface-sunken);
    padding: 0.75rem 0.9rem 1rem;
  }
  .kv-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 0.15rem 1rem;
    margin-bottom: 0.6rem;
  }
  .kv {
    display: flex;
    gap: 0.75rem;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
  }
  .kv > span:first-child {
    color: var(--text-ghost);
    width: 74px;
    flex: none;
  }
  .kv > span:last-child {
    color: var(--text-primary);
    word-break: break-word;
  }
  .kv.err > span:last-child {
    color: var(--error);
  }

  .panes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.8rem;
  }
  @media (max-width: 900px) {
    .panes {
      grid-template-columns: 1fr;
    }
  }
  .pane {
    min-width: 0;
  }
  .pane-hd {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }
  .pane-empty {
    font-size: 0.8rem;
    color: var(--text-ghost);
    margin: 0;
    font-style: italic;
  }
  .pane-note {
    margin: 0 0 0.25rem;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
  }
  .pane-note.warn {
    color: var(--warn);
  }
  .trunc {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--warn);
  }
  .raw-toggle {
    margin-top: 0.35rem;
  }
  .handler {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    margin: 0.35rem 0 0;
    padding: 0.5rem 0.6rem;
    border-radius: var(--radius-soft, 4px);
    background: color-mix(in srgb, var(--card-border) 30%, transparent);
    color: var(--text-primary);
    max-height: 340px;
    overflow: auto;
  }
  .raw-toggle summary {
    cursor: pointer;
    color: var(--text-ghost);
  }
  .tbl-path {
    padding: 4px 9px;
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-ghost);
    border-bottom: 1px solid var(--line-hair);
  }
  .cell {
    max-width: 280px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .subagent {
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-soft, 4px);
    padding: 0.7rem 0.8rem;
    margin-bottom: 0.6rem;
    background: var(--card-bg);
  }
  .sa-hd {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .sa-task {
    font-size: 0.88rem;
    color: var(--text-primary);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sa-meta {
    color: var(--text-ghost);
    flex: none;
  }
  .sa-summary {
    margin: 0.4rem 0 0;
    font-size: 0.82rem;
    color: var(--text-secondary);
  }

  .reply {
    white-space: pre-wrap;
    font-size: 0.88rem;
    line-height: 1.6;
    color: var(--text-secondary);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-soft, 4px);
    padding: 0.8rem;
    background: var(--card-bg);
    margin: 0;
    max-height: 340px;
    overflow: auto;
  }
</style>
