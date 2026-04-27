<svelte:head><title>Agent Costs — Admin</title></svelte:head>
<script lang="ts">
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<PageWrap width="wide">
  <PageHeader
    kicker="Agent"
    title="Cost Tracking"
    sub="Spend across agents and models. Token totals, per-model breakdowns, per-tool latency."
  />

  <div class="stat-grid">
    <div class="stat-card">
      <div class="stat-card-label">Today</div>
      <div class="stat-card-value">${(data.today?.cost ?? 0).toFixed(4)}</div>
      <div class="stat-card-meta">{data.today?.count ?? 0} actions</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-label">This Week</div>
      <div class="stat-card-value">${(data.week?.cost ?? 0).toFixed(4)}</div>
      <div class="stat-card-meta">{data.week?.count ?? 0} actions</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-label">30 Days</div>
      <div class="stat-card-value">${(data.month?.cost ?? 0).toFixed(4)}</div>
      <div class="stat-card-meta">{data.month?.count ?? 0} actions</div>
    </div>
  </div>

  {#if (data.today?.tokensIn ?? 0) > 0}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Today's Tokens</span>
      </div>
      <div class="token-row">
        <div>
          <div class="big-num">{(data.today?.tokensIn ?? 0).toLocaleString()}</div>
          <div class="big-num-label">input</div>
        </div>
        <div>
          <div class="big-num">{(data.today?.tokensOut ?? 0).toLocaleString()}</div>
          <div class="big-num-label">output</div>
        </div>
      </div>
    </section>
  {/if}

  {#if data.byModel.length > 0}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">By Model · 30 days</span>
      </div>
      <table class="nm-table">
        <thead>
          <tr><th>Provider</th><th>Model</th><th>Calls</th><th>Tokens</th><th>Cost</th></tr>
        </thead>
        <tbody>
          {#each data.byModel as m}
            <tr>
              <td>{m.provider ?? '?'}</td>
              <td><code>{m.model ?? '?'}</code></td>
              <td>{m.count}</td>
              <td>{(m.tokensIn + m.tokensOut).toLocaleString()}</td>
              <td>${m.cost.toFixed(4)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  {/if}

  {#if data.byTool.length > 0}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">By Tool · 30 days</span>
      </div>
      <table class="nm-table">
        <thead>
          <tr><th>Tool</th><th>Calls</th><th>Avg latency</th></tr>
        </thead>
        <tbody>
          {#each data.byTool as t}
            <tr>
              <td><code>{t.toolName ?? 'unknown'}</code></td>
              <td>{t.count}</td>
              <td>{Math.round(t.avgMs)}ms</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  {/if}

  {#if data.byModel.length === 0 && data.byTool.length === 0}
    <div class="nm-empty">No cost data yet. Interact with the agent to start tracking.</div>
  {/if}
</PageWrap>

<style>
  .token-row { display: flex; gap: 2.5rem; padding: 0.4rem 0; }
  .big-num {
    font-family: var(--font-brand);
    font-size: 1.5rem;
    font-weight: 500;
    text-transform: lowercase;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    line-height: 1;
  }
  .big-num-label {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-ghost);
    margin-top: 0.3rem;
  }
  code {
    font-family: var(--font-mono);
    font-size: 0.85em;
    background: var(--code-bg);
    color: var(--code-text);
    padding: 0.08rem 0.38rem;
  }
</style>
