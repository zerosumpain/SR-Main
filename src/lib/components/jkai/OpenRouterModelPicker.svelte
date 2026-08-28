<script lang="ts">
  import { untrack } from 'svelte';
  import type { ModelContext } from '$lib/server/models/types';
  import ModelValueChart from '$lib/components/jkai/ModelValueChart.svelte';

  // Local body-portal. NOT the shared $lib/canvas/portal — that one restores the
  // node to its original parent on destroy, which *resurrects* the overlay back
  // into the chat after Svelte has already detached it (leaving it stuck open).
  // Here destroy() just removes the node, so unmount is final.
  function bodyPortal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }

  interface ModelRow {
    id: string;
    name: string;
    modality: string | null;
    promptPrice: string | null;
    completionPrice: string | null;
    throughput: string | null;
    /** The value of whichever Artificial Analysis index is selected. */
    qualityIndex: number | null;
    openWeights: boolean;
    /** Hugging Face repo behind an open-weight model — shown on the badge so a
     *  resolved override can be checked without reading the code. Null is also
     *  valid for an OPEN model whose repo isn't published. */
    huggingFaceId: string | null;
    /** Which detection layer flagged it, for the badge tooltip. */
    openWeightSource: 'openrouter' | 'override' | 'inherited' | 'description' | null;
    /** Blended USD/1M at 3:1 in:out — the compare tab's cost axis. */
    blendedPerM: number | null;
    /** Hybrid quality/price/speed score in [0,1]; null when unrated. */
    score: number | null;
  }

  type SortKey = 'name' | 'qualityIndex' | 'promptPrice' | 'completionPrice' | 'throughput';

  /** list = the sortable table; compare = the quality-vs-cost exhibits;
   *  workloads = what every LLM role on the site is actually running. */
  type Tab = 'list' | 'compare' | 'workloads';

  /** Which Artificial Analysis index feeds the quality axis. "Quality" is not
   *  one number — a model can drive tools well and code badly — so the metric
   *  is the user's to choose. Must match QUALITY_METRICS in the API route. */
  const QUALITY_METRICS = [
    {
      id: 'agentic',
      label: 'agentic',
      blurb: 'Tool-driving and multi-step task completion. What the /jkai orchestrator actually does, so it is the default.',
    },
    {
      id: 'coding',
      label: 'coding',
      blurb: 'Code generation and editing benchmarks. Pick this when the model will mostly write code.',
    },
    {
      id: 'intelligence',
      label: 'intelligence',
      blurb: "Artificial Analysis's general reasoning composite. Broadest, least specific to how this site uses models.",
    },
  ] as const;
  type MetricId = (typeof QUALITY_METRICS)[number]['id'];

  /** Starting points for the weight sliders, not a fixed menu — the sliders
   *  below are the real control. Sent to the API as wq/wp/wt. */
  const WEIGHT_PRESETS = [
    { id: 'balanced', label: 'balanced', wq: 0.5, wp: 0.3, wt: 0.2 },
    { id: 'quality', label: 'quality-led', wq: 0.75, wp: 0.15, wt: 0.1 },
    { id: 'cost', label: 'cost-led', wq: 0.35, wp: 0.55, wt: 0.1 },
  ] as const;

  /** What a row-tap applies to. 'chat' is this conversation only (the original
   *  behaviour); 'site' is the site-wide default every LLM task uses; the four
   *  profile names pin a routing profile, beating the nightly auto-selection;
   *  and `workload:<id>` points one named LLM role (see $lib/models/workloads)
   *  at a model — the roles that do NOT follow the site default. */
  /** The targets written through /api/jkai/routing/overrides. */
  type PinTarget = 'site' | 'general' | 'tool' | 'rag' | 'agentic';
  const PIN_TARGETS: PinTarget[] = ['site', 'general', 'tool', 'rag', 'agentic'];
  function isPinTarget(t: Target): t is PinTarget {
    return (PIN_TARGETS as string[]).includes(t);
  }

  type Target = 'chat' | PinTarget | `workload:${string}`;

  function workloadIdOf(t: Target): string | null {
    return t.startsWith('workload:') ? t.slice('workload:'.length) : null;
  }

  interface ProfileInfo {
    profile: string;
    label: string;
    autoModelId: string | null;
    autoReason: string | null;
    overrideModelId: string | null;
    pinnedAt: string | null;
    effectiveModelId: string;
    source: 'override' | 'auto' | 'default';
  }

  interface Picture {
    routingEnabled: boolean;
    siteDefaultModelId: string;
    profiles: ProfileInfo[];
  }

  // The parent mounts/unmounts this component (so the portaled overlay's
  // lifecycle matches the component's — see the portal note in the template).
  let {
    current,
    defaultModelId = null,
    altModel = null,
    onselect,
    onclose,
    onsitedefaultchange,
  }: {
    current: ModelContext;
    defaultModelId?: string | null;
    altModel?: ModelContext | null;
    onselect: (ctx: ModelContext) => void;
    onclose: () => void;
    /** Fired after the site default is changed here so the chat pill's "default"
     *  tag stays truthful without a page reload. */
    onsitedefaultchange?: (modelId: string) => void;
  } = $props();

  let q = $state('');
  let sortBy = $state<SortKey>('qualityIndex');
  let sortDir = $state<'asc' | 'desc'>('desc');
  let page = $state(1);
  let openOnly = $state(false);
  const pageSize = 25;

  let rows = $state<ModelRow[]>([]);
  let total = $state(0);
  let loading = $state(false);

  /** Codex models — a separate provider billed to the ChatGPT Pro subscription
   *  rather than per token, served from a static catalogue by
   *  /api/admin/models/codex. Empty when Codex is disabled or its bridge is
   *  down, which is the normal state on a host with no `codex login`. */
  interface CodexRow {
    id: string;
    name: string;
    description: string;
    proOnly: boolean;
  }
  let codexRows = $state<CodexRow[]>([]);

  /** Client-side search over the Codex group, matching the server-side `q`
   *  behaviour on the OpenRouter table so one search box filters both. */
  let tab = $state<Tab>('list');
  // Owned here, not in the chart, so Escape collapses the expanded chart before
  // it closes the whole picker.
  let chartExpanded = $state(false);
  // The chart needs the whole filtered set, not the current page of 25.
  let chartRows = $state<ModelRow[]>([]);
  let chartLoading = $state(false);

  // ── the scoring calculation, user-tunable ───────────────────────────────
  let qualityMetric = $state<MetricId>('agentic');
  let wq = $state(0.5);
  let wp = $state(0.3);
  let wt = $state(0.2);
  let explainerOpen = $state(false);
  /** Row counts behind the score in the current filter, from the API. */
  let coverage = $state<{
    total: number;
    quality: number;
    price: number;
    throughput: number;
    scored: number;
  } | null>(null);

  const metricInfo = $derived(
    QUALITY_METRICS.find((m) => m.id === qualityMetric) ?? QUALITY_METRICS[0],
  );
  /** Weights are normalised for display so the three always read as % of 100 —
   *  the API normalises by their sum too, so the sliders need no clamping. */
  const weightPct = $derived.by(() => {
    const sum = wq + wp + wt || 1;
    return {
      quality: Math.round((wq / sum) * 100),
      price: Math.round((wp / sum) * 100),
      speed: Math.round((wt / sum) * 100),
    };
  });

  function applyPreset(p: (typeof WEIGHT_PRESETS)[number]) {
    wq = p.wq;
    wp = p.wp;
    wt = p.wt;
  }

  /** Says WHY a model is badged open, so a resolved override or an inherited
   *  variant can be audited from the UI. `description` means OpenRouter says so
   *  in prose but published no repo. */
  function openBadgeTitle(m: ModelRow): string {
    const why =
      m.openWeightSource === 'override'
        ? 'mapped by our override list'
        : m.openWeightSource === 'inherited'
          ? 'inherited from the base model'
          : m.openWeightSource === 'description'
            ? "OpenRouter's description says open-weight; no repo published"
            : 'from OpenRouter';
    return m.huggingFaceId ? `Open weights — ${m.huggingFaceId} (${why})` : `Open weights — ${why}`;
  }

  /** One LLM role and what it is actually running. Mirrors `WorkloadState`
   *  server-side; kept as a local interface so the component does not import
   *  from $lib/server. */
  interface WorkloadRow {
    id: string;
    scope: 'site';
    label: string;
    blurb: string;
    key: string;
    reason: string | null;
    requires: 'tools' | 'embeddings' | 'image-input' | 'image-output' | null;
    catalogue: 'tools' | 'image-out' | 'none';
    setModelId: string | null;
    effectiveModelId: string;
    source: 'pinned' | 'code' | 'default';
    divergesFromDefault: boolean;
  }

  interface WorkloadPicture {
    siteDefaultModelId: string;
    site: WorkloadRow[];
  }

  let target = $state<Target>('chat');
  let workloads = $state<WorkloadPicture | null>(null);
  let workloadsLoading = $state(false);
  let workloadsLoaded = $state(false);
  /** Free-text slug entry, for roles whose models are not in the catalogue at
   *  all (embeddings — OpenRouter's feed carries no embedding models). */
  let manualModelId = $state('');
  let picture = $state<Picture | null>(null);
  let applying = $state<string | null>(null);
  let notice = $state<{ text: string; bad: boolean } | null>(null);
  // Plain let — a timer handle must never be $state (an effect that both reads
  // and writes it loops; see svelte5-pitfalls §1).
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;

  function flash(text: string, bad = false) {
    notice = { text, bad };
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice = null; }, 3200);
  }

  const divergingCount = $derived(
    workloads
      ? workloads.site.filter((w) => w.divergesFromDefault).length
      : 0,
  );

  /** What the source badge says. The raw `source` value is internal jargon —
   *  "code" means nothing to someone reading the tab to find out why their
   *  default is not being used. */
  const SOURCE_LABEL: Record<string, string> = {
    pinned: 'pinned',
    code: 'code default',
    default: 'site default',
  };

  /** The workload the list is currently choosing a model FOR, if any. */
  const activeWorkload = $derived.by(() => {
    const id = workloadIdOf(target);
    if (!id || !workloads) return null;
    return workloads.site.find((w) => w.id === id) ?? null;
  });

  const visibleCodexRows = $derived.by(() => {
    // Codex is text-in, text-out and has no embeddings endpoint, so for a
    // workload requiring any of those every Codex row is a guaranteed rejection.
    // The server refuses them with a reason, but offering a choice that can only
    // fail is worse than not offering it — the same rule this list already
    // applies by hiding Codex when the bridge is down.
    const needs = activeWorkload?.requires;
    if (needs === 'image-output' || needs === 'image-input' || needs === 'embeddings') return [];
    const needle = q.trim().toLowerCase();
    return needle
      ? codexRows.filter((r) => `${r.id} ${r.name}`.toLowerCase().includes(needle))
      : codexRows;
  });

  /** Filters both views share. The orchestrator is an agent — only models that
   *  support tool use can run the chat (apply/edit models like morph 404).
   *
   *  A workload target overrides that: image generation needs models that EMIT
   *  images, and almost none of those advertise tool support, so keeping
   *  toolsOnly on would show an empty table for the one role that has a
   *  perfectly good list of candidates. */
  function baseParams(): URLSearchParams {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (activeWorkload?.catalogue === 'image-out') params.set('imageOut', '1');
    else params.set('toolsOnly', '1');
    if (openOnly) params.set('openOnly', '1');
    // Both views read the same quality metric, so the Quality column and the
    // chart's y axis can never disagree about what "quality" means.
    params.set('qualityMetric', qualityMetric);
    params.set('wq', String(wq));
    params.set('wp', String(wp));
    params.set('wt', String(wt));
    return params;
  }

  /**
   * Codex models, loaded once rather than on every filter change: they come
   * from a five-row static table, not the DB query the OpenRouter rows use, so
   * there is nothing for the server to re-sort or re-score. Filtering by the
   * search box happens client-side below.
   */
  async function loadCodex() {
    try {
      const res = await fetch('/api/admin/models/codex');
      if (!res.ok) return;
      const data = await res.json();
      // Show them only when the operator has enabled Codex AND the bridge can
      // serve a call — a model you can pick but that always fails is worse
      // than one that isn't offered.
      //
      if (data.enabled && data.health?.ok) codexRows = data.rows;
    } catch {
      // A dead bridge just means no Codex group; the picker still works.
    }
  }

  async function load() {
    loading = true;
    try {
      const params = baseParams();
      params.set('sortBy', sortBy);
      params.set('sortDir', sortDir);
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      const res = await fetch(`/api/admin/models/openrouter?${params}`);
      if (res.ok) {
        const data = await res.json();
        rows = data.rows;
        total = data.total;
      }
    } finally {
      loading = false;
    }
  }

  /** The compare tab plots every match, so it asks for the full page size. The
   *  server re-scores under the active metric + weights. */
  async function loadChart() {
    chartLoading = true;
    try {
      const params = baseParams();
      params.set('sortBy', 'score');
      params.set('pageSize', '500');
      const res = await fetch(`/api/admin/models/openrouter?${params}`);
      if (res.ok) {
        const data = await res.json();
        chartRows = data.rows;
        coverage = data.coverage ?? null;
      }
    } finally {
      chartLoading = false;
    }
  }

  // Mounted only while open; (re)load on any query/sort/page/filter change.
  // qualityMetric matters here too — the Quality column follows it.
  $effect(() => {
    q;
    sortBy;
    sortDir;
    page;
    openOnly;
    qualityMetric;
    // Switching to (or away from) a workload target can change which catalogue
    // the table should show — see baseParams().
    target;
    untrack(() => load());
  });

  // Workloads are fetched the first time that tab is shown, then reused: every
  // later change refreshes the picture from its own POST response.
  $effect(() => {
    if (tab !== 'workloads' || workloadsLoaded) return;
    untrack(() => loadWorkloads());
  });

  // Chart data is fetched only while the compare tab is showing — the list tab
  // is the common case and shouldn't pay for a 500-row request.
  $effect(() => {
    const active = tab === 'compare';
    q;
    openOnly;
    qualityMetric;
    wq;
    wp;
    wt;
    if (!active) return;
    untrack(() => loadChart());
  });

  // Reads nothing reactive → runs once on mount. Fetches what is currently
  // pinned where, so the chips can show it, plus the static Codex catalogue
  // (which no filter re-queries).
  $effect(() => {
    untrack(() => loadPicture());
    untrack(() => loadCodex());
  });

  async function loadPicture() {
    try {
      const res = await fetch('/api/jkai/routing/overrides');
      if (res.ok) picture = await res.json();
    } catch {
      /* the chips fall back to showing just the target names */
    }
  }

  function sortByColumn(col: SortKey) {
    if (sortBy === col) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortBy = col;
      // Default to descending for the numeric "more is better/bigger" columns.
      sortDir = col === 'name' ? 'asc' : 'desc';
    }
    page = 1;
  }

  function indicator(col: SortKey): string {
    if (sortBy !== col) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  }

  function ariaDir(col: SortKey): 'ascending' | 'descending' | 'none' {
    if (sortBy !== col) return 'none';
    return sortDir === 'asc' ? 'ascending' : 'descending';
  }

  function perMillion(pricePerToken: string | null): string {
    if (!pricePerToken) return '—';
    const perM = Number(pricePerToken) * 1_000_000;
    if (!Number.isFinite(perM)) return '—';
    return perM === 0 ? 'free' : `$${perM.toFixed(2)}`;
  }

  function tps(v: string | null): string {
    if (!v) return '—';
    const n = Number(v);
    return Number.isFinite(n) ? `${n.toFixed(0)} t/s` : '—';
  }

  function ai(v: number | null): string {
    return v == null ? '—' : v.toFixed(0);
  }

  function shortName(id: string): string {
    return id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id;
  }

  function close() {
    onclose();
  }

  const TARGETS: Array<{ id: Target; label: string }> = [
    { id: 'chat', label: 'this chat' },
    { id: 'site', label: 'site default' },
    { id: 'general', label: 'general' },
    { id: 'tool', label: 'tool' },
    { id: 'rag', label: 'rag' },
    { id: 'agentic', label: 'agentic' },
  ];

  function profileInfo(t: Target): ProfileInfo | null {
    if (t === 'chat' || t === 'site' || workloadIdOf(t)) return null;
    return picture?.profiles.find((p) => p.profile === t) ?? null;
  }

  /** The model each chip currently resolves to — shown under its label. */
  function targetModelId(t: Target): string | null {
    if (t === 'chat') return current.modelId;
    if (t === 'site') return picture?.siteDefaultModelId ?? defaultModelId;
    const workloadId = workloadIdOf(t);
    if (workloadId) {
      const all = workloads ? workloads.site : [];
      return all.find((w) => w.id === workloadId)?.effectiveModelId ?? null;
    }
    return profileInfo(t)?.effectiveModelId ?? null;
  }

  function targetLabel(t: Target): string {
    const workloadId = workloadIdOf(t);
    if (workloadId) {
      const all = workloads ? workloads.site : [];
      return all.find((w) => w.id === workloadId)?.label ?? workloadId;
    }
    return TARGETS.find((x) => x.id === t)?.label ?? t;
  }

  /** Highlight the row that the ACTIVE target currently uses. */
  const activeModelId = $derived(targetModelId(target));

  /**
   * Load what every LLM role is running.
   *
   * Lazy — only when the Workloads tab is first opened: making the modal pay
   * for it on every open, to populate a tab most visits never look at, would be
   * a poor trade.
   */
  async function loadWorkloads() {
    if (workloadsLoading) return;
    workloadsLoading = true;
    try {
      const res = await fetch('/api/jkai/models/workloads');
      if (res.ok) {
        workloads = await res.json();
        workloadsLoaded = true;
      } else {
        flash('Could not load workloads', true);
      }
    } catch {
      flash('Network error loading workloads', true);
    } finally {
      workloadsLoading = false;
    }
  }

  /** Point one workload at a model, or clear it back to its default. Keeps the
   *  modal open so several roles can be set in one visit, exactly like the
   *  profile pins. */
  async function applyWorkload(id: string, modelId: string | null) {
    applying = `workload:${id}:${modelId ?? 'clear'}`;
    try {
      const res = await fetch('/api/jkai/models/workloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workloadId: id, modelId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The server refuses a model that cannot serve the role and says why —
        // surface that verbatim rather than a generic failure, since the reason
        // is the useful part ("gpt-oss-120b cannot accept images").
        flash(body?.message ?? 'Could not update that workload', true);
        return;
      }
      workloads = body;
      const row = (body.site ?? []).find((w: WorkloadRow) => w.id === id);
      flash(
        modelId
          ? `${row?.label ?? id} → ${shortName(modelId)}`
          : `${row?.label ?? id} back to its default`,
      );
    } catch {
      flash('Network error', true);
    } finally {
      applying = null;
    }
  }

  async function pick(modelId: string) {
    const workloadId = workloadIdOf(target);
    if (workloadId) {
      await applyWorkload(workloadId, modelId);
      return;
    }
    if (target === 'chat') {
      // Provider comes from the id prefix, not from which table the row was in
      // — the same rule coerceModelContext applies server-side, so a persisted
      // pick round-trips to the right provider.
      onselect({ provider: modelId.startsWith('codex/') ? 'codex' : 'openrouter', modelId });
      onclose();
      return;
    }
    if (isPinTarget(target)) await applyTo(target, modelId);
  }

  /** Write the site default or a profile pin. Keeps the modal open so several
   *  targets can be set in one visit. Workload targets go through
   *  `applyWorkload` instead — a different endpoint and a different mechanism. */
  async function applyTo(t: PinTarget, modelId: string | null) {
    applying = `${t}:${modelId ?? 'clear'}`;
    try {
      const res = await fetch('/api/jkai/routing/overrides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: t, modelId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        flash(body?.message ?? `Could not update ${targetLabel(t)}`, true);
        return;
      }
      picture = await res.json();
      if (t === 'site' && modelId) onsitedefaultchange?.(modelId);
      flash(
        modelId
          ? `${targetLabel(t)} → ${shortName(modelId)}`
          : `${targetLabel(t)} back to auto-selection`,
      );
    } catch {
      flash('Network error', true);
    } finally {
      applying = null;
    }
  }

  // One-tap picks for the two site-configured models (admin default + alt).
  // Deduped — when the alt IS the default only one chip renders.
  const quickPicks = $derived.by(() => {
    const siteDefault = picture?.siteDefaultModelId ?? defaultModelId;
    const picks: Array<{ id: string; tag: string }> = [];
    if (siteDefault) picks.push({ id: siteDefault, tag: 'default' });
    if (altModel && altModel.modelId !== siteDefault) {
      picks.push({ id: altModel.modelId, tag: 'alt' });
    }
    return picks;
  });

  const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));

  const activeTargetHint = $derived.by(() => {
    if (target === 'chat') return 'Applies to this conversation only — locks after the first message.';
    if (target === 'site') return 'The default every LLM task on the site uses: chats, deep research, workflow nodes, project pages, briefings.';
    const w = activeWorkload;
    if (w) {
      return `${w.blurb} Applies immediately.`;
    }
    const info = profileInfo(target);
    if (!info) return `Pins the ${targetLabel(target)} profile, overriding the nightly auto-selection.`;
    return info.overrideModelId
      ? `Pinned. Auto would pick ${info.autoModelId ? shortName(info.autoModelId) : 'the site default'}.`
      : `Auto-selected nightly${info.autoReason ? ` — ${info.autoReason}` : ''}. Tap a model to pin it.`;
  });

  const SORT_CHIPS: Array<{ key: SortKey; label: string }> = [
    { key: 'qualityIndex', label: 'quality' },
    { key: 'promptPrice', label: 'in $' },
    { key: 'completionPrice', label: 'out $' },
    { key: 'throughput', label: 't/s' },
    { key: 'name', label: 'a–z' },
  ];
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key !== 'Escape') return;
    if (chartExpanded) chartExpanded = false;
    else close();
  }}
/>

<!-- Portaled to <body> so position:fixed anchors to the viewport and the overlay
     escapes any transformed / stacking-context ancestor in the chat. The PARENT
     conditionally mounts this component, so the portaled node is torn down with
     the component (a portaled node inside an internal {#if} can't be cleanly
     removed by Svelte, which leaves the overlay stuck open). -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="picker-overlay" use:bodyPortal onclick={close}>
  <div
    class="picker-modal"
    role="dialog"
    aria-modal="true"
    aria-label="Choose a model"
    onclick={(e) => e.stopPropagation()}
  >
    <div class="sheet-handle" aria-hidden="true"></div>
    <header class="picker-head">
      <h2 class="picker-title">Choose a model</h2>
      <button type="button" class="picker-close" onclick={close} aria-label="Close">✕</button>
    </header>

    <!-- Apply-to targets: a row-tap writes to whichever of these is active. -->
    <div class="target-row" role="radiogroup" aria-label="Apply the selected model to">
      <span class="quick-label">apply to</span>
      {#each TARGETS as t (t.id)}
        {@const info = profileInfo(t.id)}
        {@const modelId = targetModelId(t.id)}
        <span class="target-wrap">
          <button
            type="button"
            class="target-chip"
            class:active={target === t.id}
            class:pinned={!!info?.overrideModelId}
            role="radio"
            aria-checked={target === t.id}
            onclick={() => (target = t.id)}
            title={modelId ?? t.label}
          >
            <span class="target-label">{t.label}</span>
            <span class="target-model">{modelId ? shortName(modelId) : '—'}</span>
          </button>
          {#if info?.overrideModelId}
            <button
              type="button"
              class="target-clear"
              aria-label={`Clear the ${t.label} pin`}
              title="Clear the pin — hand this profile back to the nightly auto-selection"
              disabled={applying === `${t.id}:clear`}
              onclick={() => applyTo(t.id as PinTarget, null)}
            >✕</button>
          {/if}
        </span>
      {/each}
      <!-- A workload target has no chip of its own in TARGETS, so it gets one
           here while it is active. Without it the whole chip row would read as
           unselected while a row-tap silently rewrote an engine role. -->
      {#if activeWorkload}
        <span class="target-wrap">
          <button type="button" class="target-chip active" title={activeWorkload.blurb}>
            <span class="target-label">{activeWorkload.label}</span>
            <span class="target-model">{shortName(activeWorkload.effectiveModelId)}</span>
          </button>
          <button
            type="button"
            class="target-clear"
            aria-label="Stop choosing a model for this workload"
            title="Back to this chat"
            onclick={() => (target = 'chat')}
          >✕</button>
        </span>
      {/if}
    </div>
    <p class="target-hint" class:is-pinned={!!profileInfo(target)?.overrideModelId}>{activeTargetHint}</p>

    {#if quickPicks.length > 0}
      <div class="quick-row" role="group" aria-label="Quick picks">
        <span class="quick-label">quick pick</span>
        {#each quickPicks as p (p.id)}
          <button
            type="button"
            class="quick-chip"
            class:active={activeModelId === p.id}
            title={p.id}
            disabled={applying !== null}
            onclick={() => pick(p.id)}
          >
            <span class="quick-chip-name">{shortName(p.id)}</span>
            <span class="quick-chip-tag">{p.tag}</span>
          </button>
        {/each}
      </div>
    {/if}

    <div class="filter-row">
      <input
        class="picker-search"
        placeholder="Filter models by name or id…"
        aria-label="Filter models"
        bind:value={q}
        oninput={() => { page = 1; }}
      />
      <button
        type="button"
        class="open-toggle"
        class:active={openOnly}
        aria-pressed={openOnly}
        title="Show only models that publish their weights"
        onclick={() => { openOnly = !openOnly; page = 1; }}
      >open only</button>
    </div>
    <p class="picker-hint">Only models that support tool use are shown — required for the chat agent. Quality = Artificial Analysis {metricInfo.label} index; change it under Compare.</p>

    <div class="picker-tabs" role="tablist" aria-label="Model views">
      <button
        type="button"
        class="picker-tab"
        class:active={tab === 'list'}
        role="tab"
        aria-selected={tab === 'list'}
        onclick={() => { tab = 'list'; chartExpanded = false; }}>List</button
      >
      <button
        type="button"
        class="picker-tab"
        class:active={tab === 'compare'}
        role="tab"
        aria-selected={tab === 'compare'}
        onclick={() => (tab = 'compare')}>Compare</button
      >
      <button
        type="button"
        class="picker-tab"
        class:active={tab === 'workloads'}
        role="tab"
        aria-selected={tab === 'workloads'}
        onclick={() => { tab = 'workloads'; chartExpanded = false; }}>Workloads</button
      >
    </div>

    {#if tab === 'compare'}
      <div class="calc-bar">
        <div class="metric-row" role="radiogroup" aria-label="Quality metric">
          <span class="quick-label">quality =</span>
          {#each QUALITY_METRICS as m (m.id)}
            <button
              type="button"
              class="preset-chip"
              class:active={qualityMetric === m.id}
              role="radio"
              aria-checked={qualityMetric === m.id}
              title={m.blurb}
              onclick={() => (qualityMetric = m.id)}>{m.label}</button
            >
          {/each}
          <button
            type="button"
            class="explain-btn"
            aria-expanded={explainerOpen}
            onclick={() => (explainerOpen = !explainerOpen)}
            >{explainerOpen ? '✕' : '?'} how this is worked out</button
          >
        </div>
        <p class="metric-blurb">{metricInfo.blurb}</p>

        <div class="preset-row" role="group" aria-label="Weighting presets">
          <span class="quick-label">weighting</span>
          {#each WEIGHT_PRESETS as p (p.id)}
            <button
              type="button"
              class="preset-chip"
              class:active={wq === p.wq && wp === p.wp && wt === p.wt}
              title={`quality ${p.wq} · price ${p.wp} · speed ${p.wt}`}
              onclick={() => applyPreset(p)}>{p.label}</button
            >
          {/each}
        </div>

        <div class="sliders">
          <label class="slider">
            <span class="slider-lab">quality<b>{weightPct.quality}%</b></span>
            <input type="range" min="0" max="1" step="0.05" bind:value={wq} />
          </label>
          <label class="slider">
            <span class="slider-lab">cheapness<b>{weightPct.price}%</b></span>
            <input type="range" min="0" max="1" step="0.05" bind:value={wp} />
          </label>
          <label class="slider">
            <span class="slider-lab">speed<b>{weightPct.speed}%</b></span>
            <input type="range" min="0" max="1" step="0.05" bind:value={wt} />
          </label>
        </div>

        {#if explainerOpen}
          <div class="explainer">
            <p>
              <b>Quality</b> is not measured here — it is the
              <b>{metricInfo.label} index</b> published by
              <a href="https://artificialanalysis.ai" target="_blank" rel="noreferrer noopener"
                >Artificial Analysis</a
              >, which OpenRouter re-serves inside each model record. A model has no quality
              number until AA has benchmarked it, and the three indices disagree — a model can
              drive tools well and code badly.
            </p>
            <p>
              <b>Score</b> combines three axes, each min-max normalised across the models
              currently on screen, then weighted by the sliders above:
            </p>
            <ul>
              <li><b>quality</b> — the selected AA index, higher is better.</li>
              <li>
                <b>cheapness</b> — blended $/1M at a 3:1 input:output ratio, log-scaled and
                inverted so cheaper scores higher.
              </li>
              <li>
                <b>speed</b> — median tokens/sec, log-scaled. Missing values score a neutral
                0.5 rather than being punished.
              </li>
            </ul>
            <p class="explainer-warn">
              Because normalisation is over the models on screen, <b
                >a score is a rank within the current filter, not an absolute rating</b
              > — the same model scores differently once you search or toggle "open only". Models
              with no quality index or no price stay unscored rather than being guessed at.
            </p>
            {#if coverage}
              <p class="explainer-cov">
                In this filter: {coverage.scored}/{coverage.total} scored · {metricInfo.label} index
                for {coverage.quality} · price for {coverage.price} · throughput for {coverage.throughput}.
              </p>
            {/if}
          </div>
        {/if}
      </div>

      <div class="chart-scroll">
        <ModelValueChart
          rows={chartRows}
          activeModelId={activeModelId}
          loading={chartLoading}
          expanded={chartExpanded}
          qualityLabel={metricInfo.label}
          onpick={pick}
          onexpandchange={(v) => (chartExpanded = v)}
        />
      </div>
    {:else if tab === 'workloads'}
      <div class="wl-wrap">
        <p class="picker-hint">
          Every LLM role on the site and what it is actually running. A role showing
          <strong>site default</strong> follows your pick above; anything else is a carve-out, and
          says why. Tap <em>Change</em> to choose a model for one.
        </p>

        {#if workloadsLoading && !workloads}
          <p class="wl-empty">Loading…</p>
        {:else if !workloads}
          <p class="wl-empty">Could not load workloads.</p>
        {:else}
          {#each [{ title: 'Site', rows: workloads.site }] as group (group.title)}
            {#if group.rows.length}
              <div class="wl-group">{group.title}</div>
              {#each group.rows as w (w.id)}
                {@const isTarget = target === `workload:${w.id}`}
                <div class="wl-row" class:active={isTarget}>
                  <div class="wl-main">
                    <div class="wl-head">
                      <span class="wl-label">{w.label}</span>
                      <span
                        class="wl-src"
                        class:diverges={w.divergesFromDefault}
                        title={`Setting: ${w.key}`}
                      >{SOURCE_LABEL[w.source] ?? w.source}</span>
                    </div>
                    <div class="wl-model" title={w.effectiveModelId}>{w.effectiveModelId}</div>
                    <p class="wl-blurb">{w.blurb}</p>
                    {#if w.reason}<p class="wl-reason">{w.reason}</p>{/if}
                  </div>
                  <div class="wl-actions">
                    {#if w.catalogue === 'none'}
                      <!-- Nothing in the OpenRouter catalogue serves this role,
                           so the table cannot offer candidates. A slug field is
                           the honest control; the save is still validated. -->
                      <input
                        class="wl-input"
                        placeholder="vendor/model"
                        bind:value={manualModelId}
                        aria-label={`Model slug for ${w.label}`}
                      />
                      <button
                        type="button"
                        class="wl-btn"
                        disabled={!manualModelId.trim() || applying !== null}
                        onclick={() => applyWorkload(w.id, manualModelId.trim())}
                      >Set</button>
                    {:else}
                      <button
                        type="button"
                        class="wl-btn"
                        class:active={isTarget}
                        disabled={applying !== null}
                        onclick={() => { target = `workload:${w.id}`; tab = 'list'; }}
                      >Change</button>
                    {/if}
                    {#if w.scope === 'site' && w.setModelId}
                      <button
                        type="button"
                        class="wl-clear"
                        title="Clear — hand this role back to its default"
                        aria-label={`Clear the ${w.label} pin`}
                        disabled={applying === `workload:${w.id}:clear`}
                        onclick={() => applyWorkload(w.id, null)}
                      >✕</button>
                    {/if}
                  </div>
                </div>
              {/each}
            {/if}
          {/each}
        {/if}
      </div>
    {:else}
    <!-- Mobile-only sort control (the sortable column headers are hidden there). -->
    <div class="sort-chips" role="group" aria-label="Sort models">
      <span class="quick-label">sort</span>
      {#each SORT_CHIPS as c (c.key)}
        <button
          type="button"
          class="sort-chip"
          class:active={sortBy === c.key}
          onclick={() => sortByColumn(c.key)}
        >{c.label}{indicator(c.key)}</button>
      {/each}
    </div>

    <div class="picker-table-wrap">
      <table class="picker-table">
        <colgroup>
          <col class="col-name" />
          <col class="col-num col-q" />
          <col class="col-num" />
          <col class="col-num" />
          <col class="col-num" />
        </colgroup>
        <thead>
          <tr>
            <th class="ta-left" aria-sort={ariaDir('name')}>
              <button class="sort-btn" onclick={() => sortByColumn('name')}>Model{indicator('name')}</button>
            </th>
            <th class="ta-right" aria-sort={ariaDir('qualityIndex')}>
              <button class="sort-btn sort-btn--right" onclick={() => sortByColumn('qualityIndex')}>{metricInfo.label}{indicator('qualityIndex')}</button>
            </th>
            <th class="ta-right" aria-sort={ariaDir('promptPrice')}>
              <button class="sort-btn sort-btn--right" onclick={() => sortByColumn('promptPrice')}>In $/1M{indicator('promptPrice')}</button>
            </th>
            <th class="ta-right" aria-sort={ariaDir('completionPrice')}>
              <button class="sort-btn sort-btn--right" onclick={() => sortByColumn('completionPrice')}>Out $/1M{indicator('completionPrice')}</button>
            </th>
            <th class="ta-right" aria-sort={ariaDir('throughput')}>
              <button class="sort-btn sort-btn--right" onclick={() => sortByColumn('throughput')}>Tokens/s{indicator('throughput')}</button>
            </th>
          </tr>
        </thead>
        <tbody>
          <!-- Codex group, pinned above the OpenRouter table. Pinned rather
               than sorted in because it has no price, quality index or
               throughput to sort on — dropping five permanently-blank rows
               into a table sorted by those columns would bury them. -->
          {#if visibleCodexRows.length}
            <tr class="group-row">
              <td colspan="5">
                Codex — billed to the ChatGPT Pro subscription, not per token
              </td>
            </tr>
            {#each visibleCodexRows as m (m.id)}
              {@const active = activeModelId === m.id}
              <tr
                class="model-row"
                class:active={active}
                class:busy={applying?.endsWith(`:${m.id}`)}
                tabindex="0"
                role="button"
                title={m.description}
                onclick={() => pick(m.id)}
                onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(m.id); } }}
              >
                <td class="cell-name" title={m.description}>
                  <span class="name-main">
                    {m.name}
                    {#if m.proOnly}<span class="open-badge" title="Requires a ChatGPT Pro plan">pro</span>{/if}
                  </span>
                  <span class="name-id">{m.id}</span>
                </td>
                <td class="ta-right cell-muted cell-q">—</td>
                <td class="ta-right cell-muted cell-in-price">sub</td>
                <td class="ta-right cell-muted cell-out-price">sub</td>
                <td class="ta-right cell-muted cell-tps">—</td>
              </tr>
            {/each}
            <tr class="group-row">
              <td colspan="5">OpenRouter — billed per token</td>
            </tr>
          {/if}
          {#each rows as m (m.id)}
            {@const active = activeModelId === m.id}
            <tr
              class="model-row"
              class:active={active}
              class:busy={applying?.endsWith(`:${m.id}`)}
              tabindex="0"
              role="button"
              onclick={() => pick(m.id)}
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(m.id); } }}
            >
              <td class="cell-name" title={m.id}>
                <span class="name-main">
                  {shortName(m.id)}
                  {#if m.openWeights}<span class="open-badge" title={openBadgeTitle(m)}>open</span
                    >{/if}
                </span>
                <span class="name-id">{m.id}</span>
              </td>
              <td class="ta-right cell-muted cell-q">{ai(m.qualityIndex)}</td>
              <td class="ta-right cell-muted cell-in-price">{perMillion(m.promptPrice)}</td>
              <td class="ta-right cell-muted cell-out-price">{perMillion(m.completionPrice)}</td>
              <td class="ta-right cell-muted cell-tps">{tps(m.throughput)}</td>
            </tr>
          {/each}
          {#if rows.length === 0 && !loading}
            <tr><td colspan="5" class="empty">No models match “{q}”{openOnly ? ' with open weights' : ''}.</td></tr>
          {/if}
        </tbody>
      </table>
    </div>
    {/if}

    <footer class="picker-foot">
      {#if notice}
        <span class="foot-notice" class:bad={notice.bad}>{notice.text}</span>
      {:else if tab === 'compare'}
        <span class="foot-info">
          {chartRows.length} models · tap a point to apply{#if chartLoading} · loading…{/if}
        </span>
      {:else if tab === 'workloads'}
        <!-- The list tab's "N models · page x/y" is meaningless here, and a
             stale count under a table of roles reads as a count OF the roles. -->
        <span class="foot-info">
          {#if workloadsLoading}
            reading roles…
          {:else if workloads}
            {divergingCount} of {workloads.site.length} roles differ from the site default
          {/if}
        </span>
      {:else}
        <span class="foot-info">
          {total} models · page {page}/{totalPages}{#if loading} · loading…{/if}
        </span>
      {/if}
      {#if tab === 'list'}
        <span class="foot-pager">
          <button type="button" class="pager-btn" disabled={page <= 1} onclick={() => page--}>Prev</button>
          <button type="button" class="pager-btn" disabled={page >= totalPages} onclick={() => page++}>Next</button>
        </span>
      {/if}
    </footer>
  </div>
</div>

<style>
  .picker-overlay {
    position: fixed;
    inset: 0;
    z-index: 9000;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }
  .picker-modal {
    position: relative;
    z-index: 9001;
    width: min(760px, 94vw);
    max-height: 86vh;
    display: flex;
    flex-direction: column;
    /* Opaque surface — the shared --card-bg token is a 7%-opacity tint meant
       to sit on the page, so it reads as transparent over the dark overlay. */
    background: var(--surface-elevated);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-round);
    overflow: hidden;
    animation: picker-in 160ms ease-out;
  }
  @keyframes picker-in {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }
  /* Bottom-sheet drag handle — mobile only. */
  .sheet-handle { display: none; }
  .picker-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid var(--line-hair);
  }
  .picker-title {
    font-size: var(--fs-nav);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
    font-family: var(--font-mono);
  }
  .picker-close {
    color: var(--text-ghost);
    font-size: var(--fs-body-sm);
    line-height: 1;
    padding: 4px 6px;
    border-radius: var(--radius-round);
  }
  .picker-close:hover { color: var(--text-primary); background: var(--surface-overlay); }

  /* ── apply-to targets ── */
  .target-row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    margin: 12px 16px 0;
  }
  .target-wrap { display: inline-flex; align-items: stretch; }
  .target-chip {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    padding: 5px 10px;
    border-radius: var(--radius-round);
    border: 1px solid var(--line-strong);
    background: var(--surface-overlay);
    color: var(--text-secondary);
    cursor: pointer;
    max-width: 160px;
  }
  .target-chip:hover { color: var(--text-primary); border-color: var(--text-ghost); }
  .target-chip.active {
    border-color: var(--accent);
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .target-chip.pinned .target-label::after {
    content: '●';
    margin-left: 4px;
    font-size: var(--fs-label-xs);
    vertical-align: middle;
    color: var(--accent);
  }
  .target-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    white-space: nowrap;
  }
  .target-model {
    font-size: var(--fs-label);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.75;
  }
  .target-clear {
    margin-left: 2px;
    padding: 0 5px;
    font-size: var(--fs-label-xs);
    border: 1px solid var(--line-strong);
    border-left: 0;
    border-radius: 0 var(--radius-round) var(--radius-round) 0;
    background: var(--surface-overlay);
    color: var(--text-ghost);
    cursor: pointer;
  }
  .target-clear:hover:not(:disabled) { color: var(--error); border-color: var(--error); }
  .target-clear:disabled { opacity: 0.4; cursor: not-allowed; }
  .target-hint {
    margin: 8px 16px 0;
    font-size: var(--fs-label);
    line-height: 1.45;
    color: var(--text-ghost);
  }
  .target-hint.is-pinned { color: var(--accent); }

  /* ── workloads tab ── */
  .wl-wrap {
    overflow-y: auto;
    padding: 0 16px 16px;
    min-height: 0;
  }
  .wl-group {
    margin: 14px 0 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-ghost);
  }
  .wl-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 10px 0;
    border-top: 1px solid var(--line-strong);
  }
  .wl-row.active { border-color: var(--accent); }
  .wl-main { flex: 1; min-width: 0; }
  .wl-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .wl-label { font-size: var(--fs-body-sm); color: var(--text-primary); }
  .wl-src {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 1px 6px;
    border-radius: var(--radius-round);
    border: 1px solid var(--line-strong);
    color: var(--text-ghost);
    white-space: nowrap;
  }
  /* The whole point of the tab: a role that is NOT on the site default should
     be legible at a glance, without reading the model id. */
  .wl-src.diverges { color: var(--accent); border-color: var(--accent); }
  .wl-model {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-secondary);
    margin-top: 2px;
    overflow-wrap: anywhere;
  }
  .wl-blurb {
    margin: 4px 0 0;
    font-size: var(--fs-label);
    line-height: 1.45;
    color: var(--text-ghost);
  }
  .wl-reason {
    margin: 4px 0 0;
    font-size: var(--fs-label);
    line-height: 1.45;
    color: var(--text-ghost);
    border-left: 2px solid var(--line-strong);
    padding-left: 8px;
  }
  .wl-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .wl-btn {
    padding: 5px 10px;
    border-radius: var(--radius-round);
    border: 1px solid var(--line-strong);
    background: var(--surface-overlay);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    cursor: pointer;
  }
  .wl-btn:hover:not(:disabled) { color: var(--text-primary); border-color: var(--text-ghost); }
  .wl-btn.active { border-color: var(--accent); color: var(--accent); }
  .wl-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .wl-clear {
    padding: 4px 7px;
    border-radius: var(--radius-round);
    border: 1px solid var(--line-strong);
    background: var(--surface-overlay);
    color: var(--text-ghost);
    font-size: var(--fs-label-xs);
    cursor: pointer;
  }
  .wl-clear:hover:not(:disabled) { color: var(--error); border-color: var(--error); }
  .wl-clear:disabled { opacity: 0.4; cursor: not-allowed; }
  .wl-input {
    /* 16px so iOS does not zoom the whole sheet on focus — the same floor the
       search box uses. */
    font-size: var(--fs-body);
    font-family: var(--font-mono);
    width: 190px;
    max-width: 42vw;
    padding: 5px 8px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--line-strong);
    background: var(--surface-overlay);
    color: var(--text-primary);
  }
  .wl-empty {
    margin: 8px 0 0;
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-ghost);
  }

  @media (max-width: 620px) {
    .wl-row { flex-direction: column; gap: 8px; }
    .wl-actions { align-self: flex-start; }
    .wl-input { max-width: 100%; }
  }

  .quick-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin: 10px 16px 0;
  }
  .quick-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-ghost);
    flex-shrink: 0;
  }
  .quick-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    border-radius: var(--radius-pill);
    border: 1px solid var(--line-strong);
    background: var(--surface-overlay);
    color: var(--text-secondary);
    font-size: var(--fs-label);
    cursor: pointer;
    max-width: 100%;
  }
  .quick-chip:hover { color: var(--text-primary); border-color: var(--text-ghost); }
  .quick-chip.active {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }
  .quick-chip:disabled { opacity: 0.5; cursor: not-allowed; }
  .quick-chip-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }
  .quick-chip-tag {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    opacity: 0.7;
    flex-shrink: 0;
  }

  .filter-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 12px 16px 4px;
  }
  .picker-search {
    flex: 1;
    min-width: 0;
    padding: 9px 12px;
    font-size: var(--fs-body);
    border-radius: var(--radius-round);
    background: var(--surface-elevated);
    border: 1px solid var(--line-strong);
    color: var(--text-primary);
  }
  .open-toggle {
    flex-shrink: 0;
    padding: 7px 12px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    border-radius: var(--radius-round);
    border: 1px solid var(--line-strong);
    background: var(--surface-overlay);
    color: var(--text-secondary);
    cursor: pointer;
    white-space: nowrap;
  }
  .open-toggle:hover { color: var(--text-primary); }
  .open-toggle.active {
    border-color: var(--accent);
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .picker-hint {
    margin: 0 16px 8px;
    font-size: var(--fs-label);
    color: var(--text-ghost);
    font-family: var(--font-mono);
  }

  /* Tabs — same shape as the admin .nm-tabs rule, restated locally because
     admin.css isn't loaded under /jkai. */
  .picker-tabs {
    display: flex;
    gap: 0;
    margin: 0 16px;
    border-bottom: 1px solid var(--line-strong);
  }
  .picker-tab {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
    background: none;
    border: none;
    padding: 8px 14px;
    margin-bottom: -1px;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    transition: color 120ms ease, border-color 120ms ease;
  }
  .picker-tab:hover { color: var(--text-primary); }
  .picker-tab.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  .calc-bar {
    margin: 10px 16px 2px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--line-hair);
    flex-shrink: 0;
  }
  .metric-row,
  .preset-row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .preset-row { margin-top: 8px; }
  .metric-blurb {
    margin: 5px 0 0;
    font-size: var(--fs-label);
    line-height: 1.45;
    color: var(--text-ghost);
  }
  .explain-btn {
    margin-left: auto;
    padding: 3px 9px;
    border-radius: var(--radius-pill);
    border: 1px solid var(--line-strong);
    background: none;
    color: var(--text-ghost);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    white-space: nowrap;
    cursor: pointer;
  }
  .explain-btn:hover { color: var(--text-primary); border-color: var(--text-ghost); }

  .sliders {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin-top: 8px;
  }
  .slider { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .slider-lab {
    display: flex;
    justify-content: space-between;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
  }
  .slider-lab b { color: var(--accent); font-weight: 500; }
  .slider input[type='range'] {
    width: 100%;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .explainer {
    margin-top: 10px;
    padding: 10px 12px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-round);
    background: var(--surface-overlay);
    font-size: var(--fs-label);
    line-height: 1.55;
    color: var(--text-secondary);
  }
  .explainer p { margin: 0 0 7px; }
  .explainer p:last-child { margin-bottom: 0; }
  .explainer ul { margin: 0 0 7px; padding-left: 16px; }
  .explainer li { margin-bottom: 2px; }
  .explainer b { color: var(--text-primary); font-weight: 500; }
  .explainer a { color: var(--accent); }
  .explainer-warn b { color: var(--accent); }
  .explainer-cov {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  .preset-chip {
    padding: 4px 10px;
    border-radius: var(--radius-pill);
    border: 1px solid var(--line-strong);
    background: var(--surface-overlay);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    white-space: nowrap;
    cursor: pointer;
  }
  .preset-chip:hover { color: var(--text-primary); }
  .preset-chip.active {
    border-color: var(--accent);
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  .chart-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-top: 6px;
  }

  /* Mobile-only sort chips (column headers do this job on desktop). */
  .sort-chips { display: none; }

  .picker-table-wrap {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    margin: 0 16px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-round);
  }
  .picker-table {
    width: 100%;
    /* Fixed layout so the name column absorbs slack and long values truncate
       instead of widening the table into a horizontal scrollbar. */
    table-layout: fixed;
    border-collapse: collapse;
    font-size: var(--fs-nav);
  }
  /* col-name (first) takes the remaining width. */
  .col-num { width: 84px; }
  .col-q { width: 62px; }
  .picker-table thead th {
    position: sticky;
    top: 0;
    z-index: 1;
    /* Opaque so scrolled rows don't show through the pinned header. */
    background: var(--bg);
    color: var(--text-ghost);
    font-family: var(--font-mono);
    text-transform: uppercase;
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    padding: 8px 10px;
    border-bottom: 1px solid var(--line-hair);
  }
  .ta-left { text-align: left; }
  .ta-right { text-align: right; }
  .sort-btn {
    background: none;
    border: 0;
    padding: 0;
    font: inherit;
    color: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    cursor: pointer;
    width: 100%;
    text-align: left;
    white-space: nowrap;
  }
  .sort-btn--right { text-align: right; }
  .sort-btn:hover { color: var(--text-secondary); }

  .model-row {
    cursor: pointer;
    border-bottom: 1px solid var(--line-hair);
    color: var(--text-primary);
  }
  .model-row:hover { background: var(--surface-overlay); }
  .model-row.active { background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .model-row.busy { opacity: 0.5; }
  .model-row td { padding: 8px 10px; vertical-align: middle; }
  /* Plain table-cell (no flex — flex would break table-layout:fixed sizing).
     Block children truncate to the fixed column width. */
  .cell-name { min-width: 0; }
  .name-main {
    display: block;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .open-badge {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 5px;
    border-radius: var(--radius-pill);
    border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    vertical-align: 1px;
  }
  .name-id {
    display: block;
    margin-top: 1px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cell-muted { color: var(--text-secondary); white-space: nowrap; }
  .cell-q { font-family: var(--font-mono); }
  .empty { text-align: center; padding: 28px 0; color: var(--text-ghost); }

  /* Provider separator inside the table. Labelled on both sides of the split
     so the pinned Codex rows can't be misread as unpriced OpenRouter ones. */
  .group-row td {
    padding: 10px 0 4px;
    color: var(--text-ghost);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    border-bottom: 1px solid var(--line-hair);
  }

  .picker-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    font-size: var(--fs-label);
    color: var(--text-ghost);
  }
  .foot-notice { color: var(--success); min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .foot-notice.bad { color: var(--error); }
  .foot-pager { display: flex; gap: 8px; flex-shrink: 0; }
  .pager-btn {
    border-radius: var(--radius-round);
    padding: 5px 12px;
    font-size: var(--fs-label);
    border: 1px solid var(--line-strong);
    background: var(--surface-overlay);
    color: var(--text-secondary);
  }
  .pager-btn:hover:not(:disabled) { color: var(--text-primary); }
  .pager-btn:disabled { opacity: 0.45; cursor: not-allowed; }

  /* ============ Mobile: full-width bottom sheet, card rows ============ */
  @media (max-width: 640px) {
    .picker-overlay {
      align-items: flex-end;
      padding: 0;
    }
    .picker-modal {
      width: 100%;
      max-height: 88dvh;
      border-radius: 4px 4px 0 0;
      border-left: 0;
      border-right: 0;
      border-bottom: 0;
      animation: sheet-in 200ms ease-out;
    }
    @keyframes sheet-in {
      from { opacity: 0; transform: translateY(24px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .sheet-handle {
      display: block;
      width: 36px;
      height: 4px;
      border-radius: var(--radius-pill);
      background: var(--card-border);
      margin: 8px auto 0;
      flex-shrink: 0;
    }
    .picker-head { padding: 10px 16px; }
    /* The target row scrolls sideways rather than stacking six chips vertically
       and eating the sheet. */
    .target-row {
      flex-wrap: nowrap;
      overflow-x: auto;
      scrollbar-width: none;
      padding-bottom: 4px;
    }
    .target-row::-webkit-scrollbar { display: none; }
    .target-chip { max-width: 140px; }
    /* 16px stops iOS Safari auto-zooming the input on focus. */
    .picker-search { font-size: var(--fs-body); padding: 10px 12px; }
    .picker-hint { display: none; }
    /* Three sliders side by side are unusable at 390px — stack them. */
    .sliders { grid-template-columns: 1fr; gap: 4px; }
    .explain-btn { margin-left: 0; }
    .calc-bar { margin-left: 12px; margin-right: 12px; }
    .sort-chips {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      margin: 0 16px 10px;
    }
    .sort-chip {
      padding: 4px 10px;
      border-radius: var(--radius-pill);
      border: 1px solid var(--line-strong);
      background: var(--surface-overlay);
      color: var(--text-secondary);
      font-family: var(--font-mono);
      font-size: var(--fs-label);
      white-space: nowrap;
    }
    .sort-chip.active {
      border-color: var(--accent);
      color: var(--accent);
      background: color-mix(in srgb, var(--accent) 10%, transparent);
    }

    /* Collapse the table into stacked cards: header row hidden (sort-chips
       replace it), each row becomes a block with name on top and the numeric
       cells inlined as labelled mono chips underneath. */
    .picker-table thead, .picker-table colgroup { display: none; }
    .picker-table, .picker-table tbody, .picker-table tr { display: block; width: 100%; }
    .model-row { padding: 10px 12px; }
    .model-row td { display: block; padding: 0; }
    .model-row td.cell-name { margin-bottom: 4px; }
    .name-main { white-space: normal; }
    .model-row td.cell-q,
    .model-row td.cell-in-price, .model-row td.cell-out-price, .model-row td.cell-tps {
      display: inline-block;
      width: auto;
      text-align: left;
      margin-right: 12px;
      font-family: var(--font-mono);
      font-size: var(--fs-label);
    }
    .cell-q::before { content: 'q '; color: var(--text-ghost); }
    .cell-in-price::before { content: 'in '; color: var(--text-ghost); }
    .cell-out-price::before { content: 'out '; color: var(--text-ghost); }
    .picker-foot { padding-bottom: calc(12px + env(safe-area-inset-bottom)); }
    .pager-btn { padding: 8px 16px; }
  }
</style>
