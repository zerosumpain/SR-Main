<svelte:head><title>Connections — Admin</title></svelte:head>
<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';
  import type { ConnectorReport } from '$lib/connectors/types';

  let { data }: { data: { reports: ConnectorReport[]; counts: Record<string, number> } } = $props();

  let rechecking = $state(false);
  async function recheck() {
    if (rechecking) return;
    rechecking = true;
    try {
      await invalidateAll();
    } finally {
      rechecking = false;
    }
  }

  const STATUS_TEXT: Record<ConnectorReport['status'], string> = {
    ok: 'ok',
    degraded: 'degraded',
    broken: 'broken',
    unconfigured: 'not set up',
  };

  // Preserve the server's worst-first ordering, but keep groups together.
  const groups = $derived.by(() => {
    const out: Array<{ group: string; rows: ConnectorReport[] }> = [];
    for (const r of data.reports) {
      let g = out.find((x) => x.group === r.group);
      if (!g) { g = { group: r.group, rows: [] }; out.push(g); }
      g.rows.push(r);
    }
    return out;
  });

  const headline = $derived(
    data.counts.broken > 0
      ? `${data.counts.broken} connector${data.counts.broken === 1 ? '' : 's'} down`
      : data.counts.degraded > 0
        ? `${data.counts.degraded} needing attention`
        : 'Everything reporting',
  );

  function when(iso: string): string {
    try { return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
    catch { return ''; }
  }
</script>

<PageWrap>
  <PageHeader
    kicker="Admin · Connections"
    title="CONNECTIONS"
    sub="Every connector probed live, right now — never a stored status column."
  />

  <div class="cn-bar">
    <p class="cn-headline" class:cn-bad={data.counts.broken > 0} class:cn-warn={data.counts.broken === 0 && data.counts.degraded > 0}>
      {headline}
    </p>
    <button class="nm-save-btn" onclick={recheck} disabled={rechecking}>
      {rechecking ? 'Probing…' : 'Re-check now'}
    </button>
  </div>

  <p class="cn-note">
    Checked at page load. A daily check at 06:45 WhatsApps you if anything is <strong>down</strong> —
    degraded items show here but don't send alerts.
  </p>

  {#each groups as g (g.group)}
    <section class="nm-sec">
      <div class="nm-sec-hd"><span class="sr-label-tight">{g.group}</span></div>
      <ul class="cn-list">
        {#each g.rows as r (r.key)}
          <li class="cn-row cn-st-{r.status}">
            <span class="cn-dot" aria-hidden="true"></span>
            <div class="cn-main">
              <div class="cn-top">
                <span class="cn-label">{r.label}</span>
                <span class="cn-status">{STATUS_TEXT[r.status]}</span>
                {#if !r.live}<span class="cn-inferred" title="Not a live API call — inferred from stored data">inferred</span>{/if}
              </div>
              <p class="cn-detail">{r.detail}</p>
              {#if r.fixHint}<p class="cn-hint">→ {r.fixHint}</p>{/if}
            </div>
            <div class="cn-act">
              {#if r.fixUrl}
                <a class="cn-fix" href={r.fixUrl} data-sveltekit-reload={r.fixUrl.startsWith('/api/') ? '' : undefined}>
                  {r.status === 'broken' ? 'Fix' : 'Open'}
                </a>
              {/if}
              <span class="cn-ms">{when(r.checkedAt)} · {r.ms}ms</span>
            </div>
          </li>
        {/each}
      </ul>
    </section>
  {/each}
</PageWrap>

<style>
  .cn-bar { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
  .cn-headline { margin: 0; font-family: var(--font-display); font-size: 22px; color: var(--success, #2d7a3a); }
  .cn-headline.cn-warn { color: var(--warn, #b0892a); }
  .cn-headline.cn-bad { color: var(--error, #c44); }
  .cn-note { margin: 0 0 20px; font-size: 12px; color: var(--text-muted); }

  .cn-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .cn-row {
    display: grid; grid-template-columns: 10px 1fr auto; gap: 10px; align-items: start;
    padding: 10px 0; border-bottom: 1px solid var(--divider, var(--card-border));
  }
  .cn-dot { width: 7px; height: 7px; border-radius: 100px; background: currentColor; margin-top: 6px; }
  .cn-main { min-width: 0; }
  .cn-top { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .cn-label { font-size: 14px; color: var(--text-primary); }
  .cn-status { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; }
  .cn-inferred {
    font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-ghost); border: 1px solid currentColor; padding: 0 4px;
  }
  .cn-detail { margin: 3px 0 0; font-size: 12px; color: var(--text-muted); overflow-wrap: anywhere; }
  .cn-hint { margin: 3px 0 0; font-size: 12px; color: var(--accent, #c4570a); overflow-wrap: anywhere; }

  .cn-act { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0; }
  .cn-fix {
    font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
    padding: 4px 10px; border: 1px solid currentColor; text-decoration: none;
  }
  .cn-fix:hover { background: currentColor; }
  .cn-ms { font-family: var(--font-mono); font-size: 9px; color: var(--text-ghost); }

  .cn-st-ok { color: var(--success, #2d7a3a); }
  .cn-st-degraded { color: var(--warn, #b0892a); }
  .cn-st-broken { color: var(--error, #c44); }
  .cn-st-unconfigured { color: var(--text-ghost); }

  @media (max-width: 620px) {
    .cn-row { grid-template-columns: 10px 1fr; }
    .cn-act { grid-column: 2; align-items: flex-start; flex-direction: row; gap: 10px; }
  }
</style>
