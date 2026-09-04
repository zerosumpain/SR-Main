<script lang="ts">
  import { getActivityOnboardingGuide } from '$lib/activity/onboarding';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const groups = [
    { id: 'games', label: 'Games' },
    { id: 'music_podcasts', label: 'Music & podcasts' },
    { id: 'social', label: 'Social' },
    { id: 'work', label: 'Work' },
    { id: 'health', label: 'Health' },
    { id: 'home', label: 'Home' },
  ] as const;

  function availability(value: string): string {
    return {
      available: 'Available',
      beta: 'Beta',
      approval_required: 'Approval required',
      planned: 'Planned',
      disabled: 'Disabled',
    }[value] ?? value;
  }

  function mode(value: string): string {
    return {
      oauth: 'Live account',
      openid: 'Live account',
      api_key: 'API key',
      import: 'Archive import',
      device: 'Device bridge',
    }[value] ?? value;
  }

  function relative(value: Date | string | null): string {
    if (!value) return 'Never synced';
    const ms = Date.now() - new Date(value).getTime();
    if (ms < 60_000) return 'Just now';
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
    return `${Math.floor(ms / 86_400_000)}d ago`;
  }

  function actionLabel(provider: PageData['providers'][number]): string {
    if (provider.canStart) return 'Choose this source →';
    if (provider.startBlocker === 'not_launched') return 'Prepare this source →';
    return 'Review this source →';
  }

  function onboardingProviderName(id: string | null): string {
    return data.providers.find((provider) => provider.id === id)?.name ?? 'your next source';
  }

  function onboardingStatus(value: string): string {
    return {
      choosing_source: 'Choose a recommended source',
      preparing: 'Continue preparation',
      waiting_export: 'Waiting for your export',
      connecting: 'Finish connecting',
      verifying: 'Review the first evidence',
      choosing_uses: 'Choose permissions',
      syncing: 'Finish the initial sync',
      paused: 'Setup paused',
    }[value] ?? 'Continue setup';
  }
</script>

<svelte:head><title>Sources — JKAI</title></svelte:head>

<main class="sources-shell">
  <header class="sources-head">
    <p class="eyebrow">JKAI · Personal data</p>
    <div class="title-row">
      <div>
        <h1>Sources</h1>
        <p class="lede">Connect accounts and archives once. Decide separately what JKAI, Daydream and workflows may learn from them.</p>
      </div>
      <div class="head-actions">
        <a class="primary-action" href="/jkai/sources/onboard?restart=1">Start guided setup →</a>
        <a class="audit-link" href="/jkai/activity">Open activity audit</a>
      </div>
    </div>
  </header>

  {#if !data.enabled}
    <aside class="fabric-state" aria-label="Activity fabric status">
      <span class="state-mark">STAGED</span>
      <p><strong>The fabric is off.</strong> The catalogue is visible, but no provider can connect or sync until the owner enables the fabric and that provider.</p>
    </aside>
  {/if}

  {#if data.onboarding}
    <a class="resume-card" href={data.onboarding.connectionId
      ? `/jkai/sources/connections/${data.onboarding.connectionId}?journey=${data.onboarding.id}`
      : `/jkai/sources/onboard?session=${data.onboarding.id}`}>
      <span class="resume-mark">Resume</span>
      <span><strong>{onboardingStatus(data.onboarding.status)}</strong><small>{onboardingProviderName(data.onboarding.selectedProvider)} · your choices are saved</small></span>
      <span aria-hidden="true">→</span>
    </a>
  {/if}

  <section class="section" aria-labelledby="connected-title">
    <div class="section-head">
      <div>
        <p class="section-code">A / Connected</p>
        <h2 id="connected-title">Your accounts and archives</h2>
      </div>
      <span class="count">{data.connections.length}</span>
    </div>

    {#if data.connections.length === 0}
      <div class="empty">
        <p>No activity sources yet.</p>
        <span>A connection appears after you choose its evidence boundary. Every downstream use remains off until you grant it separately.</span>
      </div>
    {:else}
      <ul class="connections">
        {#each data.connections as connection (connection.id)}
          <li>
            <a href="/jkai/sources/connections/{connection.id}">
              <span class="connection-provider">{connection.label}</span>
              <span class="connection-mode">{mode(connection.mode)}</span>
              <span class="connection-health state-{connection.status}">{connection.status.replaceAll('_', ' ')}</span>
              <span class="connection-time">{relative(connection.lastSyncSucceededAt)}</span>
              <span aria-hidden="true">→</span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="section catalogue" aria-labelledby="catalogue-title">
    <div class="section-head">
      <div>
        <p class="section-code">B / Add a source</p>
        <h2 id="catalogue-title">What reflects your days?</h2>
      </div>
      <p class="section-note">The badge says how evidence really arrives.</p>
    </div>

    {#each groups as group (group.id)}
      {@const providers = data.providers.filter((provider) => provider.category === group.id)}
      {#if providers.length > 0}
        <div class="provider-group">
          <h3>{group.label}</h3>
          <div class="provider-grid">
            {#each providers as provider (provider.id)}
              {@const guide = getActivityOnboardingGuide(provider.id, provider.modes[0])}
              <article class="provider-card">
                <div class="provider-top">
                  <span class="provider-code">{provider.name.slice(0, 3).toUpperCase()}</span>
                  <span class="availability state-{provider.availability}">{availability(provider.availability)}</span>
                </div>
                <h4>{provider.name}</h4>
                <p class="provider-description">{provider.description}</p>
                <dl class="setup-summary">
                  <div><dt>Connect with</dt><dd>{guide.method}</dd></div>
                  <div><dt>Typical setup</dt><dd>{guide.estimatedTime}</dd></div>
                </dl>
                <div class="mode-row">
                  {#each provider.modes as providerMode (providerMode)}
                    <span>{mode(providerMode)}</span>
                  {/each}
                </div>
                <p class="provider-note">{provider.availabilityNote}</p>
                {#if provider.policyGate}
                  <p class="policy-note">Policy gate · {provider.policyGate}</p>
                {/if}
                <div class="card-action">
                  <a class:ready={provider.canStart} href="/jkai/sources/onboard?provider={provider.id}&restart=1">{actionLabel(provider)}</a>
                </div>
              </article>
            {/each}
          </div>
        </div>
      {/if}
    {/each}
  </section>

  <section class="section uses" aria-labelledby="uses-title">
    <div class="section-head">
      <div>
        <p class="section-code">C / Uses</p>
        <h2 id="uses-title">One source, separate permissions</h2>
      </div>
      <a href="/jkai/settings/data-access">Open data access →</a>
    </div>
    <div class="use-grid">
      <div><strong>JKAI</strong><span>Searches bounded event metadata when your question needs it.</span></div>
      <div><strong>Daydream</strong><span>Receives daily aggregates with coverage and evidence quality.</span></div>
      <div><strong>Briefing</strong><span>May surface small changes without exposing raw account content.</span></div>
      <div><strong>Workflows & Intel</strong><span>Stay off until you explicitly grant a category and data class.</span></div>
    </div>
  </section>
</main>

<style>
  .sources-shell { width: min(1120px, calc(100% - 32px)); margin: 0 auto; padding: 48px 0 80px; color: var(--text-primary); }
  .sources-head { padding-bottom: 28px; border-bottom: 2px solid var(--line-strong); }
  .eyebrow, .section-code { margin: 0 0 8px; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent, #c4570a); }
  .title-row { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; }
  h1 { margin: 0; font-family: var(--font-display); font-size: clamp(42px, 7vw, 76px); font-weight: 500; line-height: 0.95; }
  .lede { max-width: 720px; margin: 14px 0 0; font-size: var(--fs-body); line-height: 1.55; color: var(--text-muted); }
  .audit-link, .section-head a { color: var(--accent, #c4570a); font-family: var(--font-mono); font-size: var(--fs-label); text-decoration: none; white-space: nowrap; }
  .audit-link:hover, .section-head a:hover { text-decoration: underline; text-underline-offset: 3px; }
  .fabric-state { display: grid; grid-template-columns: auto 1fr; gap: 14px; align-items: start; margin: 22px 0 0; padding: 14px; border: 1px solid var(--line-strong); background: color-mix(in srgb, var(--accent, #c4570a) 7%, transparent); }
  .fabric-state p { margin: 0; color: var(--text-muted); line-height: 1.5; }
  .fabric-state strong { color: var(--text-primary); }
  .head-actions { display: grid; justify-items: end; gap: 9px; }
  .head-actions .primary-action { padding: 9px 12px; border: 1px solid var(--accent, #c4570a); color: var(--accent, #c4570a); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-decoration: none; text-transform: uppercase; white-space: nowrap; }
  .resume-card { display: grid; grid-template-columns: auto 1fr auto; gap: 16px; align-items: center; margin-top: 22px; padding: 16px; border: 1px solid var(--success, #2d7a3a); background: color-mix(in srgb, var(--success, #2d7a3a) 6%, transparent); color: inherit; text-decoration: none; }
  .resume-card:hover strong { color: var(--success, #2d7a3a); }
  .resume-mark { padding: 3px 6px; border: 1px solid currentColor; color: var(--success, #2d7a3a); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; }
  .resume-card > span:nth-child(2) { display: grid; gap: 3px; }
  .resume-card small { color: var(--text-muted); }
  .state-mark, .availability { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.09em; text-transform: uppercase; }
  .state-mark { padding: 2px 6px; border: 1px solid currentColor; color: var(--accent, #c4570a); }
  .section { padding: 34px 0; border-bottom: 1px solid var(--line-strong); }
  .section-head { display: flex; align-items: end; justify-content: space-between; gap: 20px; margin-bottom: 18px; }
  .section-head h2 { margin: 0; font-family: var(--font-display); font-size: clamp(24px, 4vw, 38px); font-weight: 500; }
  .count { min-width: 36px; height: 36px; display: inline-grid; place-items: center; border: 1px solid var(--line-strong); font-family: var(--font-mono); }
  .section-note { margin: 0; color: var(--text-ghost); font-size: var(--fs-label); }
  .empty { padding: 22px; border: 1px dashed var(--line-strong); }
  .empty p { margin: 0 0 6px; font-size: var(--fs-body); }
  .empty span { color: var(--text-muted); font-size: var(--fs-label); }
  .connections { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line-strong); }
  .connections a { display: grid; grid-template-columns: minmax(160px, 1fr) auto auto auto 20px; gap: 16px; align-items: center; padding: 13px 0; color: inherit; text-decoration: none; border-bottom: 1px solid var(--line-strong); }
  .connections a:hover .connection-provider { color: var(--accent, #c4570a); }
  .connection-provider { font-weight: 600; }
  .connection-mode, .connection-health, .connection-time { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); text-transform: uppercase; }
  .connection-health { padding: 2px 5px; border: 1px solid currentColor; }
  .state-active, .state-available { color: var(--success, #2d7a3a); }
  .state-action_required, .state-error { color: var(--error, #a33); }
  .provider-group + .provider-group { margin-top: 28px; }
  .provider-group h3 { margin: 0 0 10px; font-family: var(--font-mono); font-size: var(--fs-label); letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); }
  .provider-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-top: 1px solid var(--line-strong); border-left: 1px solid var(--line-strong); }
  .provider-card { min-height: 330px; display: flex; flex-direction: column; padding: 18px; border-right: 1px solid var(--line-strong); border-bottom: 1px solid var(--line-strong); }
  .provider-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .provider-code { width: 44px; height: 32px; display: grid; place-items: center; border: 1px solid var(--line-strong); font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  .availability { color: var(--text-ghost); }
  .provider-card h4 { margin: 22px 0 5px; font-family: var(--font-display); font-size: 25px; font-weight: 500; }
  .provider-description { margin: 0; min-height: 44px; color: var(--text-muted); font-size: var(--fs-label); line-height: 1.45; }
  .setup-summary { display: grid; gap: 6px; margin: 14px 0 0; }
  .setup-summary div { display: grid; grid-template-columns: 90px 1fr; gap: 8px; }
  .setup-summary dt, .setup-summary dd { margin: 0; font-size: var(--fs-label-xs); line-height: 1.4; }
  .setup-summary dt { color: var(--text-ghost); font-family: var(--font-mono); text-transform: uppercase; }
  .setup-summary dd { color: var(--text-muted); }
  .mode-row { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 14px; }
  .mode-row span { padding: 2px 5px; border: 1px solid var(--line-strong); font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }
  .provider-note, .policy-note { margin: 12px 0 0; font-size: var(--fs-label-xs); line-height: 1.45; color: var(--text-ghost); }
  .policy-note { color: var(--accent, #c4570a); }
  .card-action { margin-top: auto; padding-top: 18px; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; }
  .card-action a { color: var(--accent, #c4570a); text-decoration: none; }
  .card-action a:not(.ready) { color: var(--text-muted); }
  .card-action a:hover { text-decoration: underline; text-underline-offset: 3px; }
  .use-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-top: 1px solid var(--line-strong); border-left: 1px solid var(--line-strong); }
  .use-grid div { display: grid; gap: 6px; padding: 18px; border-right: 1px solid var(--line-strong); border-bottom: 1px solid var(--line-strong); }
  .use-grid strong { font-family: var(--font-mono); font-size: var(--fs-label); text-transform: uppercase; letter-spacing: 0.08em; }
  .use-grid span { color: var(--text-muted); font-size: var(--fs-label); line-height: 1.5; }
  @media (max-width: 820px) {
    .provider-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .title-row { align-items: flex-start; flex-direction: column; }
    .head-actions { justify-items: start; }
  }
  @media (max-width: 620px) {
    .sources-shell { width: min(100% - 20px, 1120px); padding-top: 28px; }
    .provider-grid, .use-grid { grid-template-columns: 1fr; }
    .connections a { grid-template-columns: 1fr auto; gap: 7px 12px; }
    .connection-mode, .connection-time { grid-column: 1; }
    .connection-health { grid-column: 2; grid-row: 1; }
    .connections a > span:last-child { display: none; }
    .section-head { align-items: flex-start; flex-direction: column; }
  }
</style>
