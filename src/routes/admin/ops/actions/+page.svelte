<svelte:head><title>Run log — Admin</title></svelte:head>
<script lang="ts">
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const KIND_LABEL: Record<string, string> = {
    research: 'research',
    workflow: 'workflow',
    chat: 'chat',
    unresolved: 'no object',
  };

  function money(n: number): string {
    if (n >= 1) return `$${n.toFixed(2)}`;
    if (n > 0) return `${(n * 100).toFixed(2)}¢`;
    return '—';
  }

  function when(d: Date | string | null): string {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-GB', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  }

  const attributedPct = $derived(
    data.totals.calls ? Math.round((data.totals.attributedCalls / data.totals.calls) * 100) : 0,
  );
</script>

<PageWrap width="wide">
  <PageHeader
    kicker="Ops"
    title="Run log"
    sub="Every LLM call the site makes, grouped by the thing that caused it. What could not be attributed is named below rather than padded into the list."
  >
    {#snippet actions()}
      <span class="nm-pill">{data.totals.calls.toLocaleString()} calls · {money(data.totals.costUsd)}</span>
    {/snippet}
  </PageHeader>

  <!--
    The honest header. 47% of the ledger carries neither an activity tag nor an
    origin fingerprint, and the untagged bucket is the LARGEST single line of
    spend on the site. A page that does not say so is the reason nobody could
    see it.
  -->
  <section class="nm-sec">
    <div class="attrib">
      <div class="bar" role="img"
           aria-label="{attributedPct}% of calls carry an attribution tag">
        <span class="known" style="width:{attributedPct}%"></span>
      </div>
      <p class="line">
        <strong>{attributedPct}%</strong> of calls say what spent them.
        The other {data.totals.anonymousCalls.toLocaleString()} carry neither an activity
        nor an origin — <strong>{money(data.totals.anonymousCostUsd)}</strong> that cannot be
        assigned to a feature. Tagging a call site is a one-line change in
        <code>$lib/context/activity</code>; this figure is the backlog.
      </p>
    </div>
  </section>

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Runs</span>
      <span class="nm-pill">page {data.page + 1}</span>
    </div>
    {#if data.runs.length === 0}
      <div class="nm-empty">No runs on this page.</div>
    {:else}
      <div class="nm-table-scroll">
        <table class="nm-table">
          <thead>
            <tr>
              <th>What ran</th><th>Kind</th><th class="num">Calls</th><th class="num">Cost</th>
              <th class="num">Tokens</th><th>Models</th><th>Last</th>
            </tr>
          </thead>
          <tbody>
            {#each data.runs as r (r.id)}
              <tr>
                <td class="what">
                  {#if r.href}
                    <a class="nm-link-btn" href={r.href}>{r.label ?? r.id.slice(0, 12)}</a>
                  {:else}
                    <span class="orphan" title={r.id}>{r.label ?? r.id.slice(0, 12)}</span>
                  {/if}
                  {#if r.activities.length}
                    <span class="acts">{r.activities.join(' ')}</span>
                  {/if}
                </td>
                <td><span class="kind" data-k={r.kind}>{KIND_LABEL[r.kind]}</span></td>
                <td class="num">{r.calls}</td>
                <td class="num">{money(r.costUsd)}</td>
                <td class="num dim">{(r.tokensIn + r.tokensOut).toLocaleString()}</td>
                <td class="dim mono">{r.models.join(' ') || '—'}</td>
                <td class="dim nowrap">{when(r.endedAt)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <div class="pager">
        {#if data.page > 0}
          <a class="nm-btn-ghost" href="?page={data.page - 1}">← newer</a>
        {/if}
        {#if data.hasMore}
          <a class="nm-btn-ghost" href="?page={data.page + 1}">older →</a>
        {/if}
      </div>
    {/if}
  </section>

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Spend with no run attached</span>
      <span class="nm-pill">{data.unattached.length} buckets</span>
    </div>
    <p class="note">
      These calls carry no session id, so there is no run to open. Rolled up by where they came
      from — a short list rather than twenty-four thousand rows.
    </p>
    <div class="nm-table-scroll">
      <table class="nm-table">
        <thead><tr><th>Source</th><th>Attribution</th><th class="num">Calls</th><th class="num">Cost</th></tr></thead>
        <tbody>
          {#each data.unattached as u (u.source + (u.attribution ?? ''))}
            <tr>
              <td class="mono">{u.source}</td>
              <td class="mono dim">
                {#if u.attribution}{u.attribution}{:else}<span class="none">nothing</span>{/if}
              </td>
              <td class="num">{u.calls.toLocaleString()}</td>
              <td class="num">{money(u.costUsd)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
</PageWrap>

<style>
  .attrib { display: flex; flex-direction: column; gap: 0.6rem; }
  .bar {
    height: 8px;
    background: color-mix(in srgb, var(--warn) 30%, transparent);
    overflow: hidden;
  }
  .known { display: block; height: 100%; background: var(--success); }
  .line { margin: 0; font-size: 0.84rem; line-height: 1.6; color: var(--text-muted); max-width: 72ch; }
  .line strong { color: var(--text); }

  .what { display: flex; flex-direction: column; gap: 0.15rem; min-width: 18rem; }
  .orphan { color: var(--text-muted); }
  .acts {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    letter-spacing: 0.04em;
  }
  .kind {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    padding: 0.1rem 0.4rem;
    white-space: nowrap;
    background: var(--surface-2, transparent);
    color: var(--accent-ink);
  }
  .kind[data-k='unresolved'] { color: var(--text-ghost); }
  .none { font-style: italic; color: var(--warn); }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .dim { color: var(--text-muted); }
  .nowrap { white-space: nowrap; }
  .mono { font-family: var(--font-mono); font-size: max(0.82em, var(--fs-label-xs)); }
  .note { margin: 0 0 0.75rem; font-size: 0.8rem; line-height: 1.55; color: var(--text-muted); max-width: 70ch; }
  .pager { display: flex; gap: 0.5rem; margin-top: 0.8rem; }
</style>
