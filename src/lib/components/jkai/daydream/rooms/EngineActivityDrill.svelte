<script lang="ts">
  // One instrument, opened. What the activity is for, how it works (reads,
  // writes, gates, model), how it is scheduled and configured, what the
  // effort dial reaches inside it, and its last ten pulses with their cost.
  // Loaded on demand through the thoughts endpoint.
  import DrillPanel from '$lib/components/jkai/daydream/hub/DrillPanel.svelte';
  import FactList from '$lib/components/jkai/daydream/hub/FactList.svelte';
  import type { FactRow } from '$lib/components/jkai/daydream/hub/types';
  import { jobTone } from '$lib/daydream/priority';
  import { postThought } from '$lib/daydream/feed-client';
  import { ago, cadence, stamp, when } from '$lib/daydream/format';

  interface Mechanics {
    stage: string;
    how: string;
    reads: string[];
    writes: string[];
    gates: string[];
    model: string | null;
    effort: string[];
    config: Record<string, string>;
  }
  interface Detail {
    name: string;
    short: string;
    row: {
      description: string;
      status: string;
      cadenceSeconds: number | null;
      activeHours: { start: string | null; end: string | null; tz: string | null };
      config: Record<string, unknown>;
      totalRuns: number;
      totalCostUsd: number;
      consecutiveFailures: number;
      lastError: string | null;
      lastRunAt: string | null;
      nextRunAt: string | null;
    } | null;
    handler: { description: string; defaultCadenceSeconds: number; defaultConfig: Record<string, unknown>; defaultActiveHours: { start: string; end: string; tz: string } | null } | null;
    mechanics: Mechanics | null;
    spendsQuota: boolean;
    pulses: Array<{ ts: string; outcome: string; summary: string; costUsd: number; details: Record<string, unknown> | null }>;
    cost7dUsd: number;
    cost30dUsd: number;
    ledger: {
      calls7: number;
      calls30: number;
      cashUsd7: number;
      cashUsd30: number;
      quota7: number;
      quota30: number;
      unpriced30: number;
      models: string[];
    } | null;
  }

  interface Props {
    name: string;
    stageMark?: string | null;
    onclose: () => void;
  }
  let { name, stageMark = null, onclose }: Props = $props();

  let detail = $state<Detail | null>(null);
  let error = $state<string | null>(null);
  let showDetails = $state(false);

  $effect(() => {
    const n = name;
    detail = null;
    error = null;
    void postThought<{ detail?: Detail }>({ action: 'activity_detail', name: n }).then((r) => {
      if (!r.ok) error = r.error ?? 'could not read the activity';
      else detail = r.out.detail ?? null;
    });
  });

  const tone = $derived(
    detail?.row
      ? jobTone({ consecutiveFailures: detail.row.consecutiveFailures, pulse: detail.pulses[0] ? { outcome: detail.pulses[0].outcome } : null })
      : 'quiet',
  );

  const money = (n: number) => (n > 0 ? (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`) : '—');

  // The ledger is what the usage capture recorded under this activity's tag:
  // the provider's own price per call, and "quota" for a Codex call.
  const ledgerLine = (d: Detail): string => {
    const l = d.ledger;
    if (!l || l.calls30 === 0) return d.mechanics?.model ? 'no call tagged in 30 days — tagging starts with this release' : 'no model calls — rules only';
    const models = l.models.length ? ` on ${l.models.join(', ')}` : '';
    const cash = l.cashUsd30 > 0 ? `cash ${money(l.cashUsd7)} in 7 days, ${money(l.cashUsd30)} in 30` : l.quota30 === l.calls30 ? 'subscription quota, no cash' : 'no cash recorded';
    const quota = l.quota30 && l.quota30 !== l.calls30 ? ` · ${l.quota30} on quota` : '';
    const unpriced = l.unpriced30 ? ` · ${l.unpriced30} unpriced` : '';
    return `${l.calls30} call${l.calls30 === 1 ? '' : 's'} in 30 days (${l.calls7} this week)${models} — ${cash}${quota}${unpriced}`;
  };

  const schedule = $derived.by((): FactRow[] => {
    const d = detail;
    if (!d?.row) return [];
    const rows: FactRow[] = [
      { label: 'Status', value: d.row.status, tone: d.row.status === 'active' ? 'good' : 'watch' },
      { label: 'Cadence', value: `every ${cadence(d.row.cadenceSeconds)}${d.handler && d.handler.defaultCadenceSeconds !== d.row.cadenceSeconds ? ` (shipped: ${cadence(d.handler.defaultCadenceSeconds)})` : ''}`, mono: true },
      {
        label: 'Window',
        value: d.row.activeHours.start ? `${d.row.activeHours.start}–${d.row.activeHours.end} ${d.row.activeHours.tz ?? ''}`.trim() : 'any hour',
        mono: true,
      },
      { label: 'Last run', value: d.row.lastRunAt ? `${stamp(d.row.lastRunAt)} · ${ago(d.row.lastRunAt)}` : 'never', mono: true },
      { label: 'Next run', value: d.row.nextRunAt ? `${stamp(d.row.nextRunAt)} · ${when(d.row.nextRunAt)}` : '—', mono: true },
      { label: 'Runs', value: `${d.row.totalRuns} all time`, mono: true },
      { label: 'In the ledger', value: ledgerLine(d), tone: d.ledger && d.ledger.cashUsd30 > 0.5 ? 'watch' : 'steady' },
    ];
    if (d.cost30dUsd > 0) rows.push({ label: 'On its pulses', value: `${money(d.cost7dUsd)} in 7 days, ${money(d.cost30dUsd)} in 30`, mono: true });
    if (d.row.consecutiveFailures) rows.push({ label: 'Failing', value: `${d.row.consecutiveFailures} in a row${d.row.lastError ? ` — ${d.row.lastError.slice(0, 160)}` : ''}`, tone: 'urgent' });
    return rows;
  });

  const settings = $derived.by((): FactRow[] => {
    const d = detail;
    if (!d) return [];
    const keys = new Set<string>([...Object.keys(d.row?.config ?? {}), ...Object.keys(d.handler?.defaultConfig ?? {})]);
    const rows: FactRow[] = [];
    for (const k of keys) {
      const live = d.row?.config?.[k];
      const shipped = d.handler?.defaultConfig?.[k];
      const meaning = d.mechanics?.config?.[k];
      const val = live !== undefined ? JSON.stringify(live) : shipped !== undefined ? `${JSON.stringify(shipped)} (shipped)` : '—';
      rows.push({ label: k, value: `${val}${meaning ? ` — ${meaning}` : ''}`, mono: false });
    }
    return rows;
  });
</script>

<DrillPanel label={detail ? `${detail.short} — how it works` : name} kicker={`${stageMark ? `${stageMark} · ` : ''}${name}`} {tone} {onclose}>
  {#snippet head()}
    {#if detail?.row}<span class="pill t-{tone}">{detail.pulses[0]?.outcome ?? 'never'}</span>{/if}
    {#if detail?.spendsQuota}<span class="tag t-watch">spends quota</span>{/if}
    {#if detail?.mechanics?.model}<span class="tag">model</span>{:else if detail}<span class="tag t-good">rules only</span>{/if}
  {/snippet}

  {#if error}
    <p class="err">{error}</p>
  {:else if !detail}
    <p class="lede">Reading the instrument…</p>
  {:else}
    <h3 class="title">{detail.short}</h3>
    <p class="card-body lead">{detail.handler?.description ?? detail.row?.description ?? 'No description recorded.'}</p>

    {#if detail.mechanics}
      <div class="detail">
        <div class="detail-block">
          <p class="field-label">How it works</p>
          <p class="detail-line">{detail.mechanics.how}</p>
        </div>
        <div class="detail-block cols">
          <div>
            <p class="field-label">Reads</p>
            <ul class="list">{#each detail.mechanics.reads as r (r)}<li>{r}</li>{/each}</ul>
          </div>
          <div>
            <p class="field-label">Writes</p>
            <ul class="list">{#each detail.mechanics.writes as w (w)}<li>{w}</li>{/each}</ul>
          </div>
          <div>
            <p class="field-label">Gates</p>
            <ul class="list">{#each detail.mechanics.gates as g (g)}<li>{g}</li>{/each}</ul>
          </div>
        </div>
        <div class="detail-block">
          <p class="field-label">Model</p>
          <p class="detail-line">{detail.mechanics.model ?? 'None — rules over stored rows. Costs nothing and is unit-tested.'}</p>
        </div>
        {#if detail.mechanics.effort.length}
          <div class="detail-block">
            <p class="field-label">What the effort dial reaches</p>
            <ul class="list">{#each detail.mechanics.effort as e (e)}<li>{e}</li>{/each}</ul>
          </div>
        {/if}
      </div>
    {/if}

    <div class="detail">
      <div class="detail-block">
        <p class="field-label">As scheduled</p>
        <FactList rows={schedule} columns={2} />
      </div>
      {#if settings.length}
        <div class="detail-block">
          <p class="field-label">Settings on the heartbeat row</p>
          <FactList rows={settings} />
          <p class="note">A value typed on the row wins over the effort dial.</p>
        </div>
      {/if}
      <div class="detail-block">
        <p class="field-label">Last ten runs</p>
        {#if detail.pulses.length === 0}
          <p class="detail-line">Never run.</p>
        {:else}
          <div class="tbl-wrap">
            <table class="tbl compact">
              <thead><tr><th>When</th><th>Outcome</th><th>What it said</th><th class="right">Cash</th></tr></thead>
              <tbody>
                {#each detail.pulses as p (p.ts)}
                  <tr class:dim={p.outcome === 'skipped'}>
                    <td class="nowrap">{stamp(p.ts)}</td>
                    <td><span class="pill t-{jobTone({ pulse: { outcome: p.outcome } })}">{p.outcome}</span></td>
                    <td class="cell-wrap">{p.summary}</td>
                    <td class="right num">{money(p.costUsd)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          {#if detail.pulses[0]?.details}
            <button type="button" class="btn sm" onclick={() => (showDetails = !showDetails)}>{showDetails ? 'Hide' : 'Show'} the last run’s details</button>
            {#if showDetails}
              <pre class="json">{JSON.stringify(detail.pulses[0].details, null, 2)}</pre>
            {/if}
          {/if}
        {/if}
      </div>
    </div>
  {/if}
</DrillPanel>

<style>
  .title {
    margin: 0 0 8px;
    font-family: var(--font-display);
    font-size: var(--fs-display-xs);
    line-height: 1.1;
    letter-spacing: -0.015em;
    text-transform: lowercase;
    color: var(--text-primary);
  }
  .cols {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 16px;
  }
  .list {
    margin: 0;
    padding-left: 18px;
    font-size: var(--fs-nav);
    line-height: 1.5;
    color: var(--text-secondary);
  }
  .list li + li {
    margin-top: 2px;
  }
  .json {
    margin: 10px 0 0;
    padding: 10px 12px;
    background: var(--bg-section);
    border: 1px solid var(--line-hair);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 320px;
    overflow: auto;
  }
</style>
