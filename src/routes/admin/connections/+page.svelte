<svelte:head><title>Connections — Admin</title></svelte:head>
<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';
  import type { SubmitFunction } from '@sveltejs/kit';
  import type { ConnectorAction, ConnectorReport } from '$lib/connectors/types';

  let {
    data,
  }: {
    data: {
      accounts: ConnectorReport[];
      services: ConnectorReport[];
      attention: number;
      counts: Record<string, number>;
    };
  } = $props();

  let rechecking = $state(false);
  // Which row has an action in flight, and the last thing each row told us.
  let busyKey = $state<string | null>(null);
  let results = $state<Record<string, { ok: boolean; text: string }>>({});

  async function recheck() {
    if (rechecking) return;
    rechecking = true;
    try {
      await invalidateAll();
    } finally {
      rechecking = false;
    }
  }

  /**
   * One submit handler for every action button. Re-probing after a successful
   * fix is the whole point — a "Resync now" that leaves the row saying "broken"
   * teaches you to distrust the page.
   */
  function runAction(key: string): SubmitFunction {
    return () => {
      busyKey = key;
      return async ({ result, update }) => {
        busyKey = null;
        const payload = (result.type === 'success' || result.type === 'failure'
          ? (result.data ?? {})
          : {}) as { message?: string; error?: string };
        if (result.type === 'success') {
          results[key] = { ok: true, text: payload.message ?? 'done' };
          await update({ reset: false });
        } else if (result.type === 'failure') {
          results[key] = { ok: false, text: payload.error ?? 'failed' };
        } else {
          results[key] = { ok: false, text: 'the action did not complete' };
        }
      };
    };
  }

  const STATUS_TEXT: Record<ConnectorReport['status'], string> = {
    ok: 'ok',
    degraded: 'degraded',
    broken: 'broken',
    unconfigured: 'not set up',
  };

  const headline = $derived(
    data.attention > 0
      ? `${data.attention} account${data.attention === 1 ? '' : 's'} need${data.attention === 1 ? 's' : ''} resyncing`
      : data.counts.broken > 0
        ? `${data.counts.broken} service${data.counts.broken === 1 ? '' : 's'} down`
        : 'Everything reporting',
  );

  const headlineTone = $derived(
    data.attention > 0 || data.counts.broken > 0 ? 'bad' : data.counts.degraded > 0 ? 'warn' : 'good',
  );

  function when(iso: string): string {
    try {
      return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  /** Hidden fields an action needs to know which account it is acting on. */
  function actionFields(r: ConnectorReport, a: ConnectorAction): Record<string, string> {
    const parts = r.key.split(':');
    // Strava and Whoop use the bare service name as their connector key.
    if (a.target === 'resync') return { service: parts[0] };
    if (a.target === 'testOauthSecret') return { provider: parts[1] ?? '' };
    if (a.target === 'testIntegration') {
      return { integrationType: parts[1] ?? '', credentialId: parts[2] ?? '' };
    }
    return {};
  }
</script>

{#snippet row(r: ConnectorReport)}
  <li class="cn-row cn-st-{r.status}">
    <span class="cn-dot" aria-hidden="true"></span>
    <div class="cn-main">
      <div class="cn-top">
        <span class="cn-label">{r.label}</span>
        <span class="cn-status">{STATUS_TEXT[r.status]}</span>
        <span class="cn-group">{r.group}</span>
        {#if !r.live}
          <span class="cn-inferred" title="Not a live API call — inferred from stored data">stored</span>
        {/if}
      </div>
      <p class="cn-detail">{r.detail}</p>
      {#if r.impact && r.status !== 'ok'}<p class="cn-impact">{r.impact}</p>{/if}
      {#if r.fixHint}<p class="cn-hint">→ {r.fixHint}</p>{/if}
      {#if results[r.key]}
        <p class="cn-result" class:cn-result-bad={!results[r.key].ok}>
          {results[r.key].ok ? '✓' : '✗'} {results[r.key].text}
        </p>
      {/if}
    </div>
    <div class="cn-act">
      <div class="cn-btns">
        {#each r.actions ?? [] as a (a.target + a.label)}
          {#if a.kind === 'link'}
            <a
              class="cn-fix"
              class:cn-primary={a.primary}
              href={a.target}
              data-sveltekit-reload={a.target.startsWith('/api/') ? '' : undefined}
            >
              {a.label}
            </a>
          {:else}
            <form method="POST" action="?/{a.target}" use:enhance={runAction(r.key)}>
              <input type="hidden" name="key" value={r.key} />
              {#each Object.entries(actionFields(r, a)) as [name, value] (name)}
                <input type="hidden" {name} {value} />
              {/each}
              <button class="cn-fix" class:cn-primary={a.primary} disabled={busyKey === r.key}>
                {busyKey === r.key ? (a.busyLabel ?? 'Working…') : a.label}
              </button>
            </form>
          {/if}
        {/each}
        {#if !r.actions?.length && r.fixUrl}
          <a class="cn-fix" href={r.fixUrl}>{r.status === 'broken' ? 'Fix' : 'Open'}</a>
        {/if}
      </div>
      <span class="cn-ms">{when(r.checkedAt)} · {r.ms}ms</span>
    </div>
  </li>
{/snippet}

<PageWrap>
  <PageHeader
    kicker="Admin · Connections"
    title="ACCOUNT SYNCS"
    sub="Every account and service probed live, right now — never a stored status column."
  />

  <div class="cn-bar">
    <p class="cn-headline" class:cn-bad={headlineTone === 'bad'} class:cn-warn={headlineTone === 'warn'}>
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

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Accounts</span>
      <span class="cn-sec-note">Things you signed into. These lapse and need reconnecting.</span>
    </div>
    <ul class="cn-list">
      {#each data.accounts as r (r.key)}{@render row(r)}{/each}
    </ul>
  </section>

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Services &amp; keys</span>
      <span class="cn-sec-note">Infrastructure. Fixed by changing config, not by signing in again.</span>
    </div>
    <ul class="cn-list">
      {#each data.services as r (r.key)}{@render row(r)}{/each}
    </ul>
  </section>
</PageWrap>

<style>
  .cn-bar { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
  .cn-headline { margin: 0; font-family: var(--font-display); font-size: 22px; color: var(--success, #2d7a3a); }
  .cn-headline.cn-warn { color: var(--warn, #b0892a); }
  .cn-headline.cn-bad { color: var(--error, #c44); }
  .cn-note { margin: 0 0 20px; font-size: 12px; color: var(--text-muted); }
  .cn-sec-note { font-size: 11px; color: var(--text-muted); margin-left: 10px; }

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
  .cn-group { font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-ghost); }
  .cn-inferred {
    font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-ghost); border: 1px solid currentColor; padding: 0 4px;
  }
  .cn-detail { margin: 3px 0 0; font-size: 12px; color: var(--text-muted); overflow-wrap: anywhere; }
  .cn-impact { margin: 3px 0 0; font-size: 12px; color: var(--text-muted); font-style: italic; }
  .cn-hint { margin: 3px 0 0; font-size: 12px; color: var(--accent, #c4570a); overflow-wrap: anywhere; }
  .cn-result { margin: 6px 0 0; font-family: var(--font-mono); font-size: 11px; color: var(--success, #2d7a3a); overflow-wrap: anywhere; }
  .cn-result-bad { color: var(--error, #c44); }

  .cn-act { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0; }
  .cn-btns { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
  .cn-fix {
    font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em;
    padding: 4px 10px; border: 1px solid currentColor; text-decoration: none;
    background: transparent; color: inherit; cursor: pointer; white-space: nowrap;
  }
  .cn-fix:hover:not(:disabled) { background: var(--surface-overlay); }
  .cn-fix:disabled { opacity: 0.5; cursor: default; }
  .cn-primary { font-weight: 600; }
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
