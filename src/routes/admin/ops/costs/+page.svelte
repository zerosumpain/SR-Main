<svelte:head><title>LLM Spend — Admin</title></svelte:head>
<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';
  import WorkloadModelSwitch from '$lib/components/admin/WorkloadModelSwitch.svelte';
  import { allActivities, activityLabel } from '$lib/costs/activities';
  import { describeMix } from '$lib/costs/analysis';
  import type { WorkloadState } from '$lib/models/workloads';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const activityIndex = new Map(allActivities().map((a) => [a.key, a]));

  // ── Formatting ────────────────────────────────────────────────────────────
  /** Sub-cent figures are the norm here, so a 2dp currency format would round
   *  most of the page to $0.00 and imply nothing was spent. */
  const usd = (v: number | null | undefined, dp = 4) => {
    if (v == null) return '—';
    // A real embedding call bills ~$0.000001. At 4dp that prints $0.0000, which
    // is indistinguishable from "this role spent nothing" — and the whole point
    // of the row is that it spent something the ledger used to miss entirely.
    if (v > 0 && v < 0.0001) return '<$0.0001';
    return `$${v.toFixed(v >= 100 ? 2 : dp)}`;
  };
  const num = (v: number | null | undefined) => (v ?? 0).toLocaleString();
  const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`);
  const tokens = (v: number) =>
    v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `${Math.round(v / 1_000)}k` : String(v);
  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

  // ── Derived ───────────────────────────────────────────────────────────────
  const win = $derived(data.totals.window);
  const runRateMonthly = $derived((win.cost / Math.max(data.days, 1)) * 30);
  const dayPeak = $derived(Math.max(0.0000001, ...data.perDay.map((d) => d.cost)));
  const activityPeak = $derived(Math.max(0.0000001, ...data.byActivity.map((a) => a.costUsd)));
  const modelPeak = $derived(Math.max(0.0000001, ...data.byModel.map((m) => m.cost)));
  const hermesModelPeak = $derived(
    Math.max(0.0000001, ...(data.hermesSpend?.byModel ?? []).map((m) => m.costUsd)),
  );

  /**
   * The engine counts cache reads BESIDE input tokens, not inside them — 163 of
   * 269 sessions in a 30-day sample had more cache reads than input tokens, so
   * `cacheRead / input` read 433% before this. The site ledger is the other way
   * round: OpenRouter's `prompt_tokens` already includes `cached_tokens`, so the
   * two cards genuinely need different arithmetic to mean the same thing —
   * "what share of the prompt came from cache".
   */
  const hermesPromptTokens = $derived(
    (data.hermesSpend?.overview.inputTokens ?? 0) + (data.hermesSpend?.overview.cacheReadTokens ?? 0),
  );

  /** Every LLM role on the site, spending or not, with its spend attached.
   *  A role with no spend is not noise — it is either genuinely idle or not
   *  reaching the ledger, and both are worth seeing next to the ones that are. */
  interface RouteRow {
    key: string;
    label: string;
    blurb: string;
    workload: WorkloadState | null;
    effectiveModelId: string;
    source: string;
    scope: string;
    reason: string | null;
    costUsd: number;
    calls: number;
    tokensIn: number;
    tokensOut: number;
    switchable: boolean;
    /** False for the site default, which has no spend of its own — the roles
     *  that inherit it are what appear in the ledger. A $0.0000 there would read
     *  as "the default costs nothing", which is the opposite of true. */
    hasSpend: boolean;
  }

  const spendByKey = $derived(new Map(data.byActivity.map((a) => [a.key, a])));

  const routes = $derived.by<RouteRow[]>(() => {
    const rows: RouteRow[] = [];

    // The site default first — it is what every unpinned role inherits, so it
    // is the single biggest lever on the page.
    const def = spendByKey.get('source:gateway');
    rows.push({
      key: 'site-default',
      label: 'Site default',
      blurb: 'What every LLM task runs on unless its role is pinned to something else.',
      workload: null,
      effectiveModelId: data.workloads.siteDefaultModelId,
      source: 'default',
      scope: 'site',
      reason: null,
      costUsd: 0,
      calls: 0,
      // The untagged-gateway mix, so the switcher prices its options for the
      // shape of work the default actually does.
      tokensIn: def?.tokensIn ?? 0,
      tokensOut: def?.tokensOut ?? 0,
      switchable: true,
      hasSpend: false,
    });

    for (const w of [...data.workloads.site, ...data.workloads.hermes]) {
      const s = spendByKey.get(w.id);
      rows.push({
        key: w.id,
        label: w.label,
        blurb: w.blurb,
        workload: w,
        effectiveModelId: w.effectiveModelId,
        source: w.source,
        scope: w.scope,
        reason: w.reason,
        costUsd: s?.costUsd ?? 0,
        calls: s?.calls ?? 0,
        tokensIn: s?.tokensIn ?? 0,
        tokensOut: s?.tokensOut ?? 0,
        switchable: true,
        hasSpend: true,
      });
    }

    // Spend that is not inside a named role. Reported, never offered a switch:
    // the model for a chat turn or a canvas node is chosen per conversation and
    // per node, so a control here would be a button that lies.
    for (const a of data.byActivity) {
      if (!a.key.startsWith('source:')) continue;
      const def2 = activityIndex.get(a.key);
      rows.push({
        key: a.key,
        label: activityLabel(a.key, activityIndex),
        blurb: def2?.blurb ?? 'Spend recorded before activity tagging shipped.',
        workload: null,
        effectiveModelId: a.models[0]?.model ?? '—',
        source: 'per-call',
        scope: 'n/a',
        reason: null,
        costUsd: a.costUsd,
        calls: a.calls,
        tokensIn: a.tokensIn,
        tokensOut: a.tokensOut,
        switchable: false,
        hasSpend: true,
      });
    }

    return rows.sort((a, b) => {
      if (a.key === 'site-default') return -1;
      if (b.key === 'site-default') return 1;
      return b.costUsd - a.costUsd || a.label.localeCompare(b.label);
    });
  });

  /** How much of the ledger can name what spent it. The honest headline for a
   *  page whose whole premise is coverage. */
  const attributed = $derived.by(() => {
    const named = data.byActivity
      .filter((a) => !a.key.startsWith('source:'))
      .reduce((s, a) => s + a.costUsd, 0);
    return win.cost > 0 ? named / win.cost : null;
  });

  /** Null when no call in the window carries a cache figure — the card then says
   *  "cache not measured" rather than "0% cached", which are different facts. */
  const cacheHit = $derived(win.cacheMeasuredIn > 0 ? win.cacheRead / win.cacheMeasuredIn : null);

  let expanded = $state<string | null>(null);
  const toggle = (k: string) => (expanded = expanded === k ? null : k);
</script>

<PageWrap width="wide">
  <PageHeader
    kicker="Agent"
    title="LLM Spend"
    sub="Every LLM call the site and the engine make, what each activity costs, how much of the provider's bill it accounts for — and what to change."
  />

  <div class="filter-row">
    <span class="win-pills">
      {#each data.windows as d (d)}
        <a class="day-pill" class:active={data.days === d} href={`?days=${d}`} data-sveltekit-noscroll>
          {d === 1 ? 'today' : `${d}d`}
        </a>
      {/each}
    </span>
    {#if data.taggingSince}
      <span class="host-note">Activity tagging since {when(data.taggingSince)}</span>
    {:else}
      <span class="host-note">Activity tagging starts with the next call after deploy</span>
    {/if}
  </div>

  <!-- ── Headline ───────────────────────────────────────────────────────── -->
  <div class="stat-grid">
    <div class="stat-card">
      <div class="stat-card-label">{data.days === 1 ? 'Today' : `Last ${data.days} days`}</div>
      <div class="stat-card-value">{usd(data.reconciliation.combinedWindowUsd ?? win.cost)}</div>
      <div class="stat-card-meta">
        {#if data.reconciliation.combinedWindowUsd != null}
          site {usd(win.cost)} + engine {usd(data.hermesSpend!.overview.costUsd)}, overlap removed
        {:else}
          {num(win.calls)} calls · site only
        {/if}
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-card-label">Run rate</div>
      <div class="stat-card-value">{usd(runRateMonthly, 2)}</div>
      <div class="stat-card-meta">per 30 days at this pace</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-label">Attributed</div>
      <div class="stat-card-value">{pct(attributed)}</div>
      <div class="stat-card-meta">
        of spend names the role that made it
        <!-- A window that mostly predates tagging reads near 0%, which looks
             like a bug rather than a start date. Say which it is. -->
        {#if data.taggingSince}<br />tagging began {when(data.taggingSince)}{/if}
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-card-label">Tokens</div>
      <div class="stat-card-value">{tokens(win.tokensIn + win.tokensOut)}</div>
      <div class="stat-card-meta">
        {tokens(win.tokensIn)} in · {tokens(win.tokensOut)} out
        {#if cacheHit != null} · {pct(cacheHit)} cached{:else if win.tokensIn > 0} · cache not measured{/if}
        {#if win.reasoning > 0} · {tokens(win.reasoning)} reasoning{/if}
      </div>
    </div>
  </div>

  <!-- ── Coverage. First, because every figure above depends on it. ──────── -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Coverage</span>
      <span class="nm-sec-meta">
        {data.provider.key ? `OpenRouter key ${data.provider.key.label ?? ''}` : 'OpenRouter unreachable'}
      </span>
    </div>
    <p class="sec-lede">
      The ledger is the site's own account of its spend, and an account kept by the thing being
      measured cannot report what it missed. These rows compare it against what OpenRouter actually
      billed this key — the same key the Hermes engine uses, so the comparison covers both.
    </p>

    {#if !data.provider.key}
      <p class="empty-note">
        OpenRouter did not answer, so there is nothing to reconcile against. The recorded figures below
        still stand; only the completeness check is missing.
      </p>
    {:else}
      <div class="nm-table-scroll">
        <table class="nm-table">
          <thead>
            <tr><th>Window</th><th>Billed by OpenRouter</th><th>Recorded here</th><th>Unaccounted</th><th>Coverage</th></tr>
          </thead>
          <tbody>
            {#each [["OpenRouter's day (site ledger)", data.reconciliation.day], ["OpenRouter's week (site ledger)", data.reconciliation.week], ["OpenRouter's month (site ledger)", data.reconciliation.month], [`Last ${data.days} days — site + engine`, data.reconciliation.window]] as const as [label, r] (label)}
              <tr>
                <td>{label}</td>
                <td class="num">{usd(r.billedUsd)}</td>
                <td class="num">{usd(r.recordedUsd)}</td>
                <td class="num" class:gap={(r.gapUsd ?? 0) > 0.005}>{usd(r.gapUsd)}</td>
                <td class="num">
                  {#if r.coverage == null}
                    —
                  {:else}
                    <span class="cov">
                      <span class="cov-bar" aria-hidden="true">
                        <span class="cov-fill" style={`width:${Math.min(100, r.coverage * 100)}%`}></span>
                      </span>
                      {pct(r.coverage)}
                    </span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <div class="cov-legend">
        <span><span class="swatch recorded" aria-hidden="true"></span>Recorded in the ledger</span>
        <span><span class="swatch unaccounted" aria-hidden="true"></span>Billed but unattributed</span>
      </div>

      <ul class="notes">
        <li>
          The first three rows are the <strong>site ledger alone</strong>, against OpenRouter's own
          day / week / month counters. OpenRouter does not say whether those are rolling or
          period-to-date, and the ledger side is rolling — so early in a calendar period coverage may
          read high. It does not read falsely low, which would be the dangerous direction for a
          completeness check. The last adds the Hermes engine's separate store and removes the
          overlap between them — /jkai web-chat turns are Hermes sessions that the chat endpoint also
          back-fills into the site ledger, {usd(data.reconciliation.jkaiChatOverlapUsd)} of this window.
          {#if data.reconciliation.window.billedUsd == null}
            OpenRouter publishes day, week and month and nothing else, so a {data.days}-day window has
            no counterpart to check against — pick 1d, 7d or 30d for the combined check.
          {/if}
        </li>
        <li>
          <strong>Over 100% is possible and is not a bug.</strong> Codex calls are priced and recorded
          here but billed to a ChatGPT subscription, not to OpenRouter, so a Codex-heavy window
          legitimately records more than OpenRouter charged.
        </li>
        {#if data.provider.credits}
          <li>
            Account lifetime <strong>{usd(data.provider.credits.usedUsd, 2)}</strong> of
            {usd(data.provider.credits.totalUsd, 2)} credits;
            {usd(data.provider.credits.remainingUsd, 2)} left.
            {#if data.provider.key}
              This key has spent {usd(data.provider.key.lifetime, 2)} of that.
            {/if}
            {#if data.provider.otherKeysUsd != null && data.provider.otherKeysUsd > 0.01}
              The remaining <strong>{usd(data.provider.otherKeysUsd, 2)}</strong> was spent on other or
              retired keys — no instrumentation in this codebase can see it.
            {/if}
          </li>
        {/if}
        {#if win.unpriced > 0}
          <li>
            <strong>{num(win.unpriced)}</strong> call{win.unpriced === 1 ? '' : 's'} in this window
            carry no cost — the model was not in the OpenRouter catalogue when it was priced. They are
            recorded as null, never as zero, so every total here is a floor.
          </li>
        {/if}
      </ul>
    {/if}
  </section>

  <!-- ── The engine's own ledger ─────────────────────────────────────────── -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Hermes engine</span>
      <span class="nm-sec-meta">the engine's own store · last {data.days} days</span>
    </div>
    <p class="sec-lede">
      The engine is a separate runtime that never goes through the site's LLM gateway, so none of this
      appears in the table above — but it bills to the same OpenRouter key. Read as a second source,
      not merged, because the two stores have different coverage and different clocks.
    </p>

    {#if !data.hermesSpend}
      <p class="empty-note">{data.hermesSpendError ?? 'The engine store did not answer.'}</p>
    {:else}
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-card-label">Engine spend</div>
          <div class="stat-card-value">{usd(data.hermesSpend.overview.costUsd)}</div>
          <div class="stat-card-meta">{num(data.hermesSpend.overview.sessions)} sessions</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-label">Tokens</div>
          <div class="stat-card-value">{tokens(data.hermesSpend.overview.inputTokens + data.hermesSpend.overview.outputTokens)}</div>
          <div class="stat-card-meta">
            {tokens(data.hermesSpend.overview.inputTokens)} new in · {tokens(
              data.hermesSpend.overview.outputTokens,
            )} out
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-card-label">Cached</div>
          <div class="stat-card-value">
            {hermesPromptTokens > 0
              ? pct(data.hermesSpend.overview.cacheReadTokens / hermesPromptTokens)
              : '—'}
          </div>
          <div class="stat-card-meta">
            {tokens(data.hermesSpend.overview.cacheReadTokens)} of {tokens(hermesPromptTokens)} prompt tokens
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-card-label">Reasoning</div>
          <div class="stat-card-value">{tokens(data.hermesSpend.overview.reasoningTokens)}</div>
          <div class="stat-card-meta">output tokens before the answer</div>
        </div>
      </div>

      {#if data.hermesSpend.byModel.length}
        <div class="nm-table-scroll">
          <table class="nm-table">
            <thead><tr><th>Model</th><th class="num">Spend</th><th class="num">Sessions</th><th class="num">In</th><th class="num">Out</th></tr></thead>
            <tbody>
              {#each data.hermesSpend.byModel as m (m.model)}
                <tr>
                  <td><code>{m.model}</code></td>
                  <td class="num">
                    <span class="bar-cell">
                      <span class="bar" aria-hidden="true">
                        <span class="bar-fill" style={`width:${Math.round((m.costUsd / hermesModelPeak) * 100)}%`}></span>
                      </span>
                      {usd(m.costUsd)}
                    </span>
                  </td>
                  <td class="num">{num(m.sessions)}</td>
                  <td class="num mono small">{tokens(m.inputTokens)}</td>
                  <td class="num mono small">{tokens(m.outputTokens)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

      {#if data.hermesSpend.byPlatform.length}
        <div class="chips">
          {#each data.hermesSpend.byPlatform as p (p.source)}
            <span class="chip mono">{p.source} · {usd(p.costUsd)} · {num(p.sessions)} sessions</span>
          {/each}
        </div>
      {/if}
    {/if}
  </section>

  <!-- ── Trend ──────────────────────────────────────────────────────────── -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Spend per day</span>
      <span class="nm-sec-meta">peak {usd(dayPeak)}</span>
    </div>
    {#if data.perDay.length}
      <div class="spark" role="img" aria-label={`Daily LLM spend over the last ${data.days} days`}>
        {#each data.perDay as d (d.day)}
          <div class="spark-col" title={`${d.day} — ${usd(d.cost)} across ${d.calls} calls`}>
            <div class="spark-bar" style={`height:${Math.max(2, Math.round((d.cost / dayPeak) * 100))}%`}></div>
          </div>
        {/each}
      </div>
      <div class="spark-cap mono">
        {data.perDay[0]?.day} → {data.perDay[data.perDay.length - 1]?.day}
      </div>
    {:else}
      <p class="empty-note">No calls recorded in this window.</p>
    {/if}
  </section>

  <!-- ── Model routes + per-activity spend + the switch ──────────────────── -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Activities and what runs them</span>
      <span class="nm-sec-meta">{routes.length} roles</span>
    </div>
    <p class="sec-lede">
      Every LLM role on the site and in the engine, dearest first. The model is changed here — a site
      role takes effect immediately, a Hermes role on the gateway restart the save performs. Rows
      marked <em>per-call</em> pick their model per conversation or per node, so there is nothing on
      them to switch.
    </p>

    <div class="nm-table-scroll">
      <table class="nm-table routes">
        <thead>
          <tr>
            <th>Activity</th>
            <th>Running on</th>
            <th class="num">Spend</th>
            <th class="num">Calls</th>
            <th class="num">Mix</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each routes as r (r.key)}
            <tr class:idle={r.costUsd === 0}>
              <td>
                <button class="row-name" onclick={() => toggle(r.key)} aria-expanded={expanded === r.key}>
                  {r.label}
                </button>
                {#if r.scope === 'hermes'}<span class="nm-pill" data-state="info">hermes</span>{/if}
                {#if r.source === 'pinned'}<span class="nm-pill" data-state="active">pinned</span>{/if}
                {#if r.source === 'code'}<span class="nm-pill" data-state="warn">code fallback</span>{/if}
              </td>
              <td><code>{r.effectiveModelId}</code></td>
              <td class="num">
                {#if r.hasSpend}
                  <span class="bar-cell">
                    <span class="bar" aria-hidden="true">
                      <span class="bar-fill" style={`width:${Math.round((r.costUsd / activityPeak) * 100)}%`}></span>
                    </span>
                    {usd(r.costUsd)}
                  </span>
                {:else}
                  <span class="per-call">inherited</span>
                {/if}
              </td>
              <td class="num">{r.hasSpend ? num(r.calls) : '—'}</td>
              <td class="num mono small">{r.tokensIn + r.tokensOut > 0 ? describeMix(r.tokensIn, r.tokensOut) : '—'}</td>
              <td>
                {#if r.switchable}
                  <WorkloadModelSwitch
                    workload={r.workload}
                    catalogue={data.catalogue}
                    tokensIn={r.tokensIn}
                    tokensOut={r.tokensOut}
                    onchanged={() => invalidateAll()}
                  />
                {:else}
                  <span class="per-call">per-call</span>
                {/if}
              </td>
            </tr>
            {#if expanded === r.key}
              <tr class="detail">
                <td colspan="6">
                  <p>{r.blurb}</p>
                  {#if r.reason}<p class="reason"><strong>Pinned off the default:</strong> {r.reason}</p>{/if}
                  {#if spendByKey.get(r.key)?.models.length}
                    <p class="mono small">
                      Models seen this window:
                      {#each spendByKey.get(r.key)!.models as m, i (`${m.provider}/${m.model}`)}{i ? ' · ' : ' '}{m.model ?? '?'} ({usd(m.costUsd)}){/each}
                    </p>
                  {/if}
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>

    {#if data.workloads.hermesError}
      <p class="empty-note small">Hermes roles unavailable: {data.workloads.hermesError}</p>
    {/if}
  </section>

  <!-- ── Cost reduction ─────────────────────────────────────────────────── -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Where the money could go instead</span>
      <span class="nm-sec-meta">{data.swaps.length} candidate{data.swaps.length === 1 ? '' : 's'}</span>
    </div>
    <p class="sec-lede">
      The cheapest catalogue model that clears the current one's quality index, keeps its tool support
      and context length, and is priced at this activity's own token mix rather than a nominal blend.
      A model that is cheaper <em>and worse</em> is not a saving, so it is not offered here — and
      neither are OpenRouter's <code class="inline">:free</code> variants, which win every price
      comparison and then rate-limit the site to a standstill by mid-morning.
    </p>

    {#if data.swaps.length === 0}
      <p class="empty-note">
        Nothing worth swapping in this window — either the roles are already on the cheapest model that
        clears their quality bar, or there is not enough spend yet to judge.
      </p>
    {:else}
      <div class="nm-table-scroll">
        <table class="nm-table">
          <thead>
            <tr><th>Activity</th><th>Now</th><th>Instead</th><th class="num">Saving</th><th>Why</th></tr>
          </thead>
          <tbody>
            {#each data.swaps as s (`${s.activity}|${s.currentModelId}|${s.candidateModelId}`)}
              <tr>
                <td>{activityLabel(s.activity, activityIndex)}</td>
                <td><code>{s.currentModelId}</code></td>
                <td><code>{s.candidateModelId}</code></td>
                <td class="num">
                  <strong>{usd(s.savingUsd)}</strong>
                  <span class="sub">{Math.round(s.savingShare * 100)}% · {usd((s.savingUsd / Math.max(data.days, 1)) * 365, 2)}/yr</span>
                </td>
                <td class="rationale">{s.rationale}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="empty-note small">
        Annualised figures extrapolate this window's volume forward unchanged. Treat them as a ranking,
        not a forecast.
      </p>
    {/if}
  </section>

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Signals</span>
      <span class="nm-sec-meta">last {data.days} days</span>
    </div>
    <div class="signals">
      {#each data.waste as w (w.id)}
        <div class="signal" data-sev={w.severity}>
          <div class="signal-hd">{w.title}</div>
          <p>{w.detail}</p>
        </div>
      {/each}
    </div>
  </section>

  <!-- ── Models ─────────────────────────────────────────────────────────── -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">By model</span>
      <span class="nm-sec-meta">last {data.days} days</span>
    </div>
    {#if data.byModel.length}
      <div class="nm-table-scroll">
        <table class="nm-table">
          <thead>
            <tr>
              <th>Provider</th><th>Model</th><th class="num">Spend</th><th class="num">Calls</th>
              <th class="num">In</th><th class="num">Out</th><th class="num">Cached</th><th class="num">Unpriced</th>
            </tr>
          </thead>
          <tbody>
            {#each data.byModel as m (`${m.provider}/${m.model}`)}
              <tr>
                <td>{m.provider ?? '?'}</td>
                <td><code>{m.model ?? '?'}</code></td>
                <td class="num">
                  <span class="bar-cell">
                    <span class="bar" aria-hidden="true">
                      <span class="bar-fill" style={`width:${Math.round((m.cost / modelPeak) * 100)}%`}></span>
                    </span>
                    {usd(m.cost)}
                  </span>
                </td>
                <td class="num">{num(m.calls)}</td>
                <td class="num mono small">{tokens(m.tokensIn)}</td>
                <td class="num mono small">{tokens(m.tokensOut)}</td>
                <td class="num mono small">{m.cacheRead > 0 ? tokens(m.cacheRead) : '—'}</td>
                <td class="num mono small" class:gap={m.unpriced > 0}>{m.unpriced || '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <p class="empty-note">No model spend recorded in this window.</p>
    {/if}
  </section>

  <!-- ── Sessions ───────────────────────────────────────────────────────── -->
  {#if data.topSessions.length}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Dearest runs</span>
        <span class="nm-sec-meta">conversations, workflow runs and research sessions</span>
      </div>
      <div class="nm-table-scroll">
        <table class="nm-table">
          <thead><tr><th>Session</th><th class="num">Spend</th><th class="num">Calls</th><th>When</th></tr></thead>
          <tbody>
            {#each data.topSessions as s (s.sessionId)}
              <tr>
                <td><code class="sess">{s.sessionId}</code></td>
                <td class="num">{usd(s.cost)}</td>
                <td class="num">{num(s.calls)}</td>
                <td class="mono small">{when(s.firstAt)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}
</PageWrap>

<style>
  .filter-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-bottom: 1.25rem;
  }
  .win-pills { display: flex; gap: 0.35rem; }
  .day-pill {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 0.3rem 0.65rem;
    border: 1px solid var(--card-border);
    color: var(--text-muted);
    text-decoration: none;
  }
  .day-pill:hover { color: var(--accent); border-color: var(--accent); }
  .day-pill.active {
    color: var(--accent);
    border-color: var(--accent);
    background: var(--accent-tint-08);
  }
  .host-note,
  .spark-cap {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    letter-spacing: 0.06em;
  }

  .sec-lede {
    font-size: var(--fs-body-sm);
    color: var(--text-muted);
    max-width: 62ch;
    margin: 0 0 0.9rem;
  }
  .notes {
    margin: 0.9rem 0 0;
    padding-left: 1.1rem;
    font-size: var(--fs-body-sm);
    color: var(--text-muted);
  }
  .notes li { margin-bottom: 0.4rem; }
  .notes strong { color: var(--text-secondary); }

  /* ── Daily bars. One series, one hue: this is magnitude over time, not
        identity, so a categorical palette would be inventing a distinction. ── */
  .spark {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 110px;
    padding: 0.3rem 0;
  }
  .spark-col { flex: 1 1 0; height: 100%; display: flex; align-items: flex-end; min-width: 3px; }
  .spark-bar {
    width: 100%;
    background: var(--accent);
    border-radius: 2px 2px 0 0;
  }
  .spark-cap { margin-top: 0.4rem; }

  /* ── In-cell magnitude bars ─────────────────────────────────────────── */
  .bar-cell {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    justify-content: flex-end;
    width: 100%;
  }
  .bar {
    flex: 0 0 68px;
    height: 6px;
    background: var(--bg-section);
    border-radius: 2px;
    overflow: hidden;
  }
  .bar-fill { display: block; height: 100%; background: var(--accent); border-radius: 2px; }

  .cov { display: inline-flex; align-items: center; gap: 0.5rem; justify-content: flex-end; }
  .cov-bar {
    flex: 0 0 64px;
    height: 6px;
    /* The track IS the "billed but unattributed" segment — a 2px gap is not
       needed because the two are separated by the fill's own edge. */
    background: var(--accent-ink-tint-22);
    border-radius: 2px;
    overflow: hidden;
  }
  .cov-fill { display: block; height: 100%; background: var(--accent); border-radius: 2px; }
  .cov-legend {
    display: flex;
    gap: 1.25rem;
    margin-top: 0.7rem;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    letter-spacing: 0.04em;
  }
  .cov-legend span { display: inline-flex; align-items: center; gap: 0.4rem; }
  .swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
  .swatch.recorded { background: var(--accent); }
  .swatch.unaccounted { background: var(--accent-ink-tint-22); border: 1px solid var(--accent-ink-tint-35); }

  /* ── Tables ─────────────────────────────────────────────────────────── */
  .num { text-align: right; white-space: nowrap; }
  .mono { font-family: var(--font-mono); }
  .small { font-size: var(--fs-label-xs); color: var(--text-muted); }
  .gap { color: var(--trend-down); font-weight: 500; }
  .sub {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    font-weight: 400;
  }
  .rationale { font-size: var(--fs-body-sm); color: var(--text-muted); max-width: 42ch; }

  .routes tr.idle td { color: var(--text-ghost); }
  .routes tr.idle code { opacity: 0.7; }
  .row-name {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
    border-bottom: 1px dotted var(--card-border);
  }
  .row-name:hover { color: var(--accent); border-bottom-color: var(--accent); }
  tr.detail td {
    background: var(--bg-section);
    font-size: var(--fs-body-sm);
    color: var(--text-muted);
  }
  tr.detail p { margin: 0 0 0.4rem; max-width: 76ch; }
  tr.detail p:last-child { margin-bottom: 0; }
  .reason strong { color: var(--text-secondary); }
  .per-call {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    letter-spacing: 0.08em;
  }

  /* ── Signals ────────────────────────────────────────────────────────── */
  .signals { display: grid; gap: 0.75rem; }
  .signal {
    border-left: 2px solid var(--card-border);
    padding: 0.55rem 0 0.55rem 0.85rem;
  }
  .signal[data-sev='warn'] { border-left-color: var(--warn); }
  .signal[data-sev='info'] { border-left-color: var(--info); }
  .signal-hd {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
    letter-spacing: 0.02em;
    margin-bottom: 0.25rem;
  }
  .signal p { margin: 0; font-size: var(--fs-body-sm); color: var(--text-muted); max-width: 72ch; }

  code {
    font-family: var(--font-mono);
    font-size: max(0.85em, var(--fs-label-xs));
    background: var(--code-bg);
    color: var(--code-text);
    padding: 0.08rem 0.38rem;
  }
  /* An inline `:free` in body copy must not wear the inverted code-block
     surface — it is a word in a sentence, not a block. */
  code.inline {
    background: var(--accent-tint-08);
    color: var(--text-secondary);
  }
  code.sess { max-width: 26rem; display: inline-block; overflow: hidden; text-overflow: ellipsis; vertical-align: bottom; }

  .chips { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.85rem; }
  .chip {
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
    padding: 0.22rem 0.5rem;
    border: 1px solid var(--card-border);
    color: var(--text-muted);
  }

  .empty-note { font-size: var(--fs-body-sm); color: var(--text-muted); margin: 0; }
  .empty-note.small { font-size: var(--fs-label-xs); margin-top: 0.6rem; }
</style>
