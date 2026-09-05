<script lang="ts">
  import EvidenceSort from '$lib/components/activity/EvidenceSort.svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import { onMount, untrack } from 'svelte';
  import ActivityOnboardingStepper from '$lib/components/jkai/ActivityOnboardingStepper.svelte';
  import {
    getActivityOnboardingGuide,
    getActivityOnboardingOutcome,
    isActivityOnboardingOutcomeId,
  } from '$lib/activity/onboarding';
  import type { ConnectionMode } from '$lib/activity/contracts';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let busy = $state<string | null>(null);
  let message = $state<string | null>(untrack(() =>
    data.authResult === 'connected'
      ? `${data.provider.name} authorization succeeded. The first sync is queued.`
      : data.authResult === 'failed'
        ? `${data.provider.name} did not authorize this connection. You can try again.`
        : data.notice,
  ));
  let grants = $state(untrack(() => data.grants.map((grant) => ({ ...grant }))));
  let importFile = $state<File | null>(null);
  let lastReportedStep = $state<number | null>(null);
  const guide = untrack(() =>
    getActivityOnboardingGuide(data.provider.id, data.connection.mode as ConnectionMode),
  );

  const consumers = [
    { id: 'jkai', label: 'JKAI', note: 'Bounded search and detail when your question needs it.' },
    { id: 'daydream', label: 'Daydream', note: 'Daily projections, coverage and evidence quality.' },
    { id: 'briefing', label: 'Briefing', note: 'Small changes and summaries.' },
    { id: 'workflow', label: 'Workflows', note: 'Only explicitly selected source data.' },
    { id: 'intel', label: 'Intel', note: 'Content analysis; raw text remains a separate permission.' },
    { id: 'mcp', label: 'External tools', note: 'Owner-only tool access using the same grants.' },
  ];

  onMount(() => {
    void reportJourneyProgress();
    const timer = window.setInterval(() => {
      const jobRunning = data.jobs.some((job) => ['queued', 'leased', 'running', 'retry_wait'].includes(job.status));
      const importRunning = data.imports.some((activityImport) =>
        ['uploaded', 'inspecting', 'importing'].includes(activityImport.status),
      );
      if (jobRunning || importRunning) void invalidateAll().then(reportJourneyProgress);
    }, 3_000);
    return () => window.clearInterval(timer);
  });

  function when(value: Date | string | null): string {
    if (!value) return 'Never';
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  }

  function grantFor(consumer: string, dataClass: string) {
    return grants.find((grant) => grant.consumer === consumer && grant.dataClass === dataClass && grant.category === null);
  }

  function checked(consumer: string, dataClass: string): boolean {
    return grantFor(consumer, dataClass)?.allowed ?? false;
  }

  function toggle(consumer: string, dataClass: string) {
    const grant = grantFor(consumer, dataClass);
    if (grant) grant.allowed = !grant.allowed;
  }

  function useRecommendedPermissions() {
    for (const grant of grants) {
      grant.allowed =
        (grant.consumer === 'jkai' || grant.consumer === 'daydream') &&
        (grant.dataClass === 'metadata' || grant.dataClass === 'activity');
    }
  }

  function hasAllowedPermission(): boolean {
    return grants.some((grant) => grant.allowed);
  }

  function needsAuthorization(): boolean {
    return data.connection.status === 'pending' ||
      (data.connection.status === 'action_required' && data.connection.healthStatus === 'credential');
  }

  function currentOnboardingStep(): number {
    if (data.connection.mode === 'import') {
      const latest = data.imports[0];
      if (!latest || latest.status === 'failed') return 3;
      if (['uploaded', 'inspecting', 'ready'].includes(latest.status)) return 5;
      if (latest.status === 'importing') return 7;
      if (!hasAllowedPermission()) return 6;
      return 8;
    } else if (needsAuthorization()) {
      return 3;
    }
    if (!data.connection.lastSyncSucceededAt && !hasAllowedPermission()) return 5;
    if (!hasAllowedPermission()) return 6;
    if (!data.connection.lastSyncSucceededAt) return 7;
    return 8;
  }

  async function reportJourneyProgress() {
    if (!data.onboardingSession) return;
    const current = currentOnboardingStep();
    if (lastReportedStep === current) return;
    lastReportedStep = current;
    try {
      const response = await fetch('/api/activity/v1/onboarding', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'progress',
          sessionId: data.onboardingSession.id,
          connectionId: data.connection.id,
          step: current,
        }),
      });
      if (!response.ok) lastReportedStep = null;
    } catch {
      lastReportedStep = null;
    }
  }

  function payoffPrompt(): string {
    const outcomeId = data.onboardingSession?.outcomes.find(isActivityOnboardingOutcomeId);
    return outcomeId
      ? getActivityOnboardingOutcome(outcomeId).jkaiPrompt
      : 'Summarise my activity from my connected sources and point out one grounded pattern.';
  }

  /** Hand the question to the chat and send it: jkai's `activity` toolset answers from the grants just saved. */
  function askJkaiHref(): string {
    return `/jkai?q=${encodeURIComponent(payoffPrompt())}&send=1`;
  }

  function previewLabel(activityEvent: PageData['previewEvents'][number]): string {
    return typeof activityEvent.object.label === 'string'
      ? activityEvent.object.label
      : activityEvent.type.replaceAll('.', ' ');
  }

  function selectImport(event: Event) {
    importFile = (event.currentTarget as HTMLInputElement).files?.[0] ?? null;
  }

  function importFact(value: unknown): string | null {
    if (typeof value === 'number') return new Intl.NumberFormat('en-GB').format(value);
    if (typeof value === 'string' && value.trim()) return value;
    return null;
  }

  async function uploadImport() {
    if (!importFile || busy !== null) return;
    busy = 'upload';
    message = null;
    try {
      const form = new FormData();
      form.set('connectionId', data.connection.id);
      form.set('file', importFile);
      const response = await fetch('/api/activity/v1/imports', { method: 'POST', body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? 'Could not upload archive');
      message = body.duplicate
        ? 'This exact archive is already here.'
        : 'Archive encrypted and queued for inspection.';
      importFile = null;
      await invalidateAll();
      await reportJourneyProgress();
    } catch (error) {
      message = error instanceof Error ? error.message : 'Could not upload archive';
    } finally {
      busy = null;
    }
  }

  async function confirmImport(importId: string) {
    busy = `confirm:${importId}`;
    message = null;
    try {
      const response = await fetch(`/api/activity/v1/imports/${importId}/confirm`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? 'Could not confirm import');
      message = 'Import queued. Replays are idempotent, so the same record will not be duplicated.';
      await invalidateAll();
      await reportJourneyProgress();
    } catch (error) {
      message = error instanceof Error ? error.message : 'Could not confirm import';
    } finally {
      busy = null;
    }
  }

  async function saveGrants() {
    busy = 'grants';
    message = null;
    try {
      const response = await fetch(`/api/activity/v1/connections/${data.connection.id}/grants`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedVersion: data.connection.version,
          grants: grants.map(({ consumer, dataClass, category, allowed }) => ({ consumer, dataClass, category, allowed })),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? 'Could not save permissions');
      message = 'Permissions saved';
      await invalidateAll();
      await reportJourneyProgress();
    } catch (error) {
      message = error instanceof Error ? error.message : 'Could not save permissions';
    } finally {
      busy = null;
    }
  }

  async function syncNow() {
    busy = 'sync';
    message = null;
    try {
      const response = await fetch(`/api/activity/v1/connections/${data.connection.id}/sync`, {
        method: 'POST',
        headers: { 'idempotency-key': crypto.randomUUID() },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? 'Could not queue sync');
      message = `Sync queued · ${body.jobId}`;
      await invalidateAll();
      await reportJourneyProgress();
    } catch (error) {
      message = error instanceof Error ? error.message : 'Could not queue sync';
    } finally {
      busy = null;
    }
  }

  async function authorize() {
    busy = 'authorize';
    message = null;
    try {
      if (data.connection.provider === 'apple_music') {
        const { authorizeAppleMusicConnection } = await import('$lib/activity/providers/apple-music/client');
        const result = await authorizeAppleMusicConnection(data.connection.id);
        message = `Apple Music connected · ${result.jobId}`;
        await invalidateAll();
        await reportJourneyProgress();
        busy = null;
        return;
      }
      const journeyQuery = data.onboardingSession
        ? `?journey=${encodeURIComponent(data.onboardingSession.id)}`
        : '';
      const response = await fetch(`/api/activity/v1/connections/${data.connection.id}/authorize${journeyQuery}`, {
        method: 'POST',
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? 'Could not begin authorization');
      window.location.assign(body.authorizationUrl);
    } catch (error) {
      message = error instanceof Error ? error.message : 'Could not begin authorization';
      busy = null;
    }
  }

  async function erase() {
    if (!confirm(`Delete ${data.connection.label}, its credentials, events and projections? This cannot be undone.`)) return;
    busy = 'erase';
    message = null;
    try {
      const response = await fetch(`/api/activity/v1/connections/${data.connection.id}`, {
        method: 'DELETE',
        headers: { 'idempotency-key': crypto.randomUUID() },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? 'Could not queue deletion');
      await goto('/jkai/sources');
    } catch (error) {
      message = error instanceof Error ? error.message : 'Could not queue deletion';
      busy = null;
    }
  }
</script>

<svelte:head><title>{data.connection.label} — Sources</title></svelte:head>

<main class="detail-shell source-surface">
  <a class="back" href={data.onboardingSession ? `/jkai/sources/onboard?session=${data.onboardingSession.id}` : '/jkai/sources'}>← {data.onboardingSession ? 'Guided setup' : 'Sources'}</a>
  <header>
    <div>
      <p class="eyebrow">{data.provider.name} · {data.connection.mode.replaceAll('_', ' ')}</p>
      <h1>{data.connection.label}</h1>
      <p>{data.provider.availabilityNote}</p>
    </div>
    <span class="status status-{data.connection.status}">{data.connection.status.replaceAll('_', ' ')}</span>
  </header>

  <ActivityOnboardingStepper current={currentOnboardingStep()} />

  {#if message}<p class="message" role="status">{message}</p>{/if}

  {#if needsAuthorization() && data.connection.mode !== 'import'}
    <section class="authorize">
      <div><p class="section-code">Step 3 / Connect</p><h2>{guide.actionLabel}</h2><p>{guide.actionDescription} No downstream consumer is enabled yet, and JKAI never sees your provider password.</p></div>
      <button onclick={authorize} disabled={busy !== null || !data.provider.canStart}>{busy === 'authorize' ? 'Opening…' : `${guide.actionLabel} →`}</button>
    </section>
  {/if}

  {#if data.connection.mode === 'import'}
    <section class="imports">
      <div class="section-head">
        <div>
          <p class="section-code">Next / Archive</p>
          <h2>Inspect before importing</h2>
        </div>
      </div>
      <p class="section-copy">Upload the provider archive as a ZIP. JKAI encrypts it at rest, inspects its manifest, and waits for your confirmation before creating activity events. Maximum size: 100 MB.</p>
      {#if guide.preparation}
        <details class="export-help" open={data.imports.length === 0}>
          <summary>How to prepare the right archive</summary>
          <ol>{#each guide.preparation.steps as step}<li>{step}</li>{/each}</ol>
          {#if guide.preparation.waitNote}<p>{guide.preparation.waitNote}</p>{/if}
          <a href={guide.preparation.url} target="_blank" rel="noreferrer">{guide.preparation.label} ↗</a>
        </details>
      {/if}
      <div class="upload-row">
        <label for="activity-archive">Choose ZIP archive</label>
        <input id="activity-archive" type="file" accept=".zip,application/zip" onchange={selectImport} />
        <button onclick={uploadImport} disabled={!importFile || busy !== null}>
          {busy === 'upload' ? 'Encrypting…' : 'Upload for inspection'}
        </button>
      </div>

      {#if data.imports.length === 0}
        <p class="empty">No archives uploaded yet.</p>
      {:else}
        <ol class="import-list">
          {#each data.imports as activityImport (activityImport.id)}
            <li>
              <div class="import-title">
                <strong>{activityImport.filename}</strong>
                <span class="import-status import-{activityImport.status}">{activityImport.status}</span>
              </div>
              <dl>
                <div><dt>Uploaded</dt><dd>{when(activityImport.createdAt)}</dd></div>
                <div><dt>Size</dt><dd>{(activityImport.compressedBytes / 1024 / 1024).toFixed(1)} MB</dd></div>
                {#if importFact(activityImport.manifest.estimatedRecords)}
                  <div><dt>Recognized records</dt><dd>{importFact(activityImport.manifest.estimatedRecords)}</dd></div>
                {/if}
                {#if importFact(activityImport.manifest.format)}
                  <div><dt>Format</dt><dd>{importFact(activityImport.manifest.format)}</dd></div>
                {/if}
              </dl>
              {#if activityImport.status === 'ready'}
                <p class="review-note">Inspection passed. Confirming turns the recognized records into provenance-linked events.</p>
                <button class="confirm-import" onclick={() => confirmImport(activityImport.id)} disabled={busy !== null}>
                  {busy === `confirm:${activityImport.id}` ? 'Queueing…' : 'Confirm import'}
                </button>
              {:else if activityImport.status === 'failed'}
                <p class="import-error">{importFact(activityImport.report.error) ?? 'Inspection or import failed. The archive remains encrypted for review.'}</p>
              {:else if activityImport.status === 'succeeded'}
                <p class="review-note">Imported {importFact(activityImport.report.inserted) ?? '0'} new events; {importFact(activityImport.report.duplicates) ?? '0'} duplicates skipped.</p>
              {/if}
            </li>
          {/each}
        </ol>
      {/if}
    </section>
  {/if}

  {#if data.connection.mode !== 'import' && currentOnboardingStep() === 5}
    <section class="onboarding-callout">
      <div>
        <p class="section-code">Step 5 / Preview</p>
        <h2>{data.connection.healthStatus === 'private_source' ? 'Make activity visible at the provider' : data.connection.status === 'active' ? 'Checking the first records' : 'The first check needs another try'}</h2>
        <p>{data.connection.healthStatus === 'private_source' ? (data.connection.healthMessage ?? 'This account is connected, but its activity is private.') : data.connection.status === 'active' ? 'The authorization succeeded. The initial sync is durable and can finish after you leave this page.' : (data.connection.healthMessage ?? 'The provider check did not complete. Existing consumer permissions remain off.')}</p>
      </div>
      {#if data.connection.status !== 'active'}
        <button onclick={syncNow} disabled={busy !== null || !data.provider.canStart}>{busy === 'sync' ? 'Checking…' : 'Check again'}</button>
      {/if}
    </section>
  {/if}

  {#if data.previewEvents.length > 0}
    <section class="preview" aria-labelledby="preview-title">
      <div class="section-head">
        <div><p class="section-code">Step 5 / Preview</p><h2 id="preview-title">A sample before sharing</h2></div>
        <a href="/jkai/activity?connection={data.connection.id}&sort={data.ordering.sort}&direction={data.ordering.direction}&then={data.ordering.then ?? ''}">Open full audit →</a>
      </div>
      <p class="section-copy">These normalized records came from the source. They remain unavailable to JKAI and Daydream until you enable their permissions below.</p>
      <EvidenceSort ordering={data.ordering} preserve={{ journey: data.onboardingSession?.id }} />
      <p class="section-copy preview-limit">Up to 5 records in the selected order.</p>
      <ol>
        {#each data.previewEvents as activityEvent (activityEvent.id)}
          <li>
            <span><strong>{previewLabel(activityEvent)}</strong><small>{activityEvent.type.replaceAll('.', ' ')}</small></span>
            <span class="evidence">{activityEvent.evidenceMode.replaceAll('_', ' ')}</span>
            <span class="preview-dates"><small>Occurred</small><strong>{activityEvent.occurredAt ? when(activityEvent.occurredAt) : 'Unknown'}</strong><small>Observed</small><strong>{when(activityEvent.observedAt)}</strong></span>
          </li>
        {/each}
      </ol>
    </section>
  {/if}

  <section>
    <div class="section-head">
      <div><p class="section-code">A / Connection</p><h2>Health and freshness</h2></div>
      {#if data.connection.mode !== 'import'}
        <button onclick={syncNow} disabled={busy !== null || !data.fabricEnabled || !data.provider.enabled || data.connection.status === 'erasing'}>
          {busy === 'sync' ? 'Queueing…' : 'Sync now'}
        </button>
      {/if}
    </div>
    <div class="facts">
      <div><span>Last success</span><strong>{when(data.connection.lastSyncSucceededAt)}</strong></div>
      <div><span>Last attempt</span><strong>{when(data.connection.lastSyncStartedAt)}</strong></div>
      <div><span>Evidence</span><strong>{data.provider.evidenceModes.map((mode) => mode.replaceAll('_', ' ')).join(' · ')}</strong></div>
      <div><span>Health</span><strong>{data.connection.healthMessage ?? data.connection.healthStatus ?? 'Not tested'}</strong></div>
    </div>
  </section>

  <section>
    <div class="section-head">
      <div><p class="section-code">Step 6 / Permissions</p><h2>Who may read it?</h2></div>
      <div class="permission-actions">
        <button class="secondary" onclick={useRecommendedPermissions} disabled={busy !== null}>Use recommended</button>
        <button onclick={saveGrants} disabled={busy !== null}>{busy === 'grants' ? 'Saving…' : 'Save permissions'}</button>
      </div>
    </div>
    <p class="section-copy"><strong>Recommended</strong> enables activity and metadata for JKAI answers and Daydream summaries only. Briefing, workflows, Intel, external tools and all raw content stay off.</p>
    <div class="grant-table" style={`--grant-cols: ${data.connection.dataClasses.length}`}>
      <div class="grant-head"><span>Consumer</span>{#each data.connection.dataClasses as dataClass}<span>{dataClass.replaceAll('_', ' ')}</span>{/each}</div>
      {#each consumers as consumer (consumer.id)}
        <div class="grant-row">
          <span><strong>{consumer.label}</strong><small>{consumer.note}</small></span>
          {#each data.connection.dataClasses as dataClass (dataClass)}
            <button
              class:allowed={checked(consumer.id, dataClass)}
              aria-pressed={checked(consumer.id, dataClass)}
              aria-label="{consumer.label} may read {dataClass.replaceAll('_', ' ')}"
              onclick={() => toggle(consumer.id, dataClass)}
            >{checked(consumer.id, dataClass) ? 'Allowed' : 'Off'}</button>
          {/each}
        </div>
      {/each}
    </div>
  </section>

  {#if currentOnboardingStep() === 8}
    <section class="complete-panel">
      <div><p class="section-code">Step 8 / Payoff</p><h2>This source is ready to be useful</h2><p>Ask jkai now. It reads only what you granted above, and says when a source is unavailable instead of guessing. You can change permissions or disconnect at any time.</p></div>
      <div class="complete-actions">
        <a class="primary" href={askJkaiHref()}>Ask jkai: “{payoffPrompt()}” →</a>
        <a href="/jkai/activity?connection={data.connection.id}&sort={data.ordering.sort}&direction={data.ordering.direction}&then={data.ordering.then ?? ''}">Review the evidence</a>
        <a href="/jkai/sources/onboard?restart=1">Set up another source</a>
        <a href="/jkai/sources">Back to Sources</a>
      </div>
    </section>
  {/if}

  <section>
    <div class="section-head"><div><p class="section-code">C / Jobs</p><h2>{data.connection.mode === 'import' ? 'Import history' : 'Sync history'}</h2></div></div>
    {#if data.jobs.length === 0}
      <p class="empty">No jobs have run for this connection.</p>
    {:else}
      <ol class="jobs">
        {#each data.jobs as job (job.id)}
          <li><span>{job.kind.replaceAll('_', ' ')}</span><strong class="job-{job.status}">{job.status.replaceAll('_', ' ')}</strong><time>{when(job.createdAt)}</time></li>
        {/each}
      </ol>
    {/if}
  </section>

  <section class="danger">
    <div><p class="section-code">D / Disconnect</p><h2>Remove this source</h2><p>Reads stop immediately. A durable job removes credentials, raw objects, events and projections.</p></div>
    <button onclick={erase} disabled={busy !== null}>{busy === 'erase' ? 'Queueing deletion…' : 'Disconnect & delete'}</button>
  </section>
</main>

<style>
  .preview-dates { display: grid; gap: 3px; font-size: var(--fs-label); }
  .preview-dates strong { font-family: var(--font-code); font-weight: 400; }
  .preview-limit { margin-top: 12px; }
  .back { display: inline-block; margin-bottom: 34px; color: var(--text-muted); font-family: var(--font-mono); font-size: var(--fs-label); text-decoration: none; }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; padding-bottom: 28px; border-bottom: 2px solid var(--line-title); }
  .eyebrow, .section-code { margin: 0 0 8px; color: var(--accent, #c4570a); font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: .12em; text-transform: uppercase; }
  header p:last-child { max-width: 650px; margin: 11px 0 0; color: var(--text-muted); }
  .status { padding: 4px 7px; border: 1px solid currentColor; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; color: var(--text-muted); }
  .status-active { color: var(--success, #2d7a3a); }
  .status-error, .status-action_required { color: var(--error, #a33); }
  .message { margin: 16px 0 0; padding: 10px; border-left: 3px solid var(--accent, #c4570a); color: var(--text-muted); font-size: var(--fs-label); }
  section { padding: 30px 0; border-bottom: 1px solid var(--line-strong); }
  .section-head { display: flex; justify-content: space-between; align-items: end; gap: 16px; margin-bottom: 15px; }
  h2 { margin: 0; font-family: var(--font-display); font-size: clamp(1.5rem, 3vw, 2rem); font-weight: 500; }
  .section-head > button, .permission-actions button, .danger > button { padding: 7px 10px; border: 1px solid var(--accent, #c4570a); border-radius: 0; background: transparent; color: var(--accent, #c4570a); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; cursor: pointer; }
  .section-head > a { color: var(--accent, #c4570a); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-decoration: none; text-transform: uppercase; }
  .permission-actions { display: flex; flex-wrap: wrap; gap: 7px; }
  .permission-actions button.secondary { border-color: var(--line-strong); color: var(--text-muted); }
  button:disabled { opacity: .45; cursor: default; }
  .facts { display: grid; grid-template-columns: repeat(2, 1fr); border-top: 1px solid var(--line-strong); border-left: 1px solid var(--line-strong); }
  .facts div { display: grid; gap: 5px; min-height: 75px; padding: 13px; border-right: 1px solid var(--line-strong); border-bottom: 1px solid var(--line-strong); }
  .facts span { color: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; }
  .facts strong { font-size: var(--fs-label); line-height: 1.45; }
  .grant-table { overflow-x: auto; border-top: 1px solid var(--line-strong); border-left: 1px solid var(--line-strong); }
  .grant-head, .grant-row { min-width: 690px; display: grid; grid-template-columns: minmax(250px, 1fr) repeat(var(--grant-cols, 3), 110px); }
  .grant-head span, .grant-row > span, .grant-row > button { min-height: 48px; padding: 9px; border-right: 1px solid var(--line-strong); border-bottom: 1px solid var(--line-strong); }
  .grant-head span { min-height: auto; color: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; }
  .grant-row > span { display: grid; gap: 3px; }
  .grant-row small { color: var(--text-ghost); font-size: var(--fs-label-xs); }
  .grant-row > button { border-top: 0; border-left: 0; background: transparent; color: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label-xs); cursor: pointer; }
  .grant-row > button.allowed { color: var(--success, #2d7a3a); background: color-mix(in srgb, var(--success, #2d7a3a) 8%, transparent); }
  .empty { margin: 0; padding: 15px; border: 1px dashed var(--line-strong); color: var(--text-muted); }
  .section-copy { max-width: 700px; margin: 0 0 16px; color: var(--text-muted); line-height: 1.55; }
  .section-copy strong { color: var(--text-primary); }
  .export-help { margin: 0 0 15px; padding: 14px; border: 1px solid var(--line-strong); }
  .export-help summary { color: var(--text-primary); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; cursor: pointer; }
  .export-help ol { margin: 12px 0 0; padding-left: 21px; color: var(--text-muted); font-size: var(--fs-label); line-height: 1.65; }
  .export-help p { margin: 10px 0; color: var(--text-ghost); font-size: var(--fs-label-xs); }
  .export-help a { color: var(--accent, #c4570a); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-decoration: none; text-transform: uppercase; }
  .upload-row { display: grid; grid-template-columns: minmax(180px, 1fr) auto; gap: 9px 14px; align-items: center; padding: 14px; border: 1px solid var(--line-strong); }
  .upload-row label { grid-column: 1 / -1; color: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; }
  .upload-row input { min-width: 0; font-size: var(--fs-label); color: var(--text-muted); }
  .upload-row button, .confirm-import { padding: 8px 11px; border: 1px solid var(--accent, #c4570a); border-radius: 0; background: transparent; color: var(--accent, #c4570a); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; cursor: pointer; }
  .import-list { list-style: none; display: grid; gap: 12px; margin: 15px 0 0; padding: 0; }
  .import-list > li { padding: 14px; border: 1px solid var(--line-strong); }
  .import-title { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
  .import-title strong { overflow-wrap: anywhere; }
  .import-status { color: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; }
  .import-ready, .import-succeeded { color: var(--success, #2d7a3a); }
  .import-failed { color: var(--error, #a33); }
  .import-list dl { display: flex; flex-wrap: wrap; gap: 12px 24px; margin: 13px 0 0; }
  .import-list dl div { display: grid; gap: 3px; }
  .import-list dt { color: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; }
  .import-list dd { margin: 0; font-size: var(--fs-label); }
  .review-note, .import-error { margin: 13px 0; color: var(--text-muted); font-size: var(--fs-label); line-height: 1.5; }
  .import-error { color: var(--error, #a33); }
  .jobs { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line-strong); }
  .jobs li { display: grid; grid-template-columns: 1fr auto auto; gap: 14px; padding: 10px 0; border-bottom: 1px solid var(--line-strong); font-size: var(--fs-label); }
  .jobs strong { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; }
  .jobs time { color: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  .job-succeeded { color: var(--success, #2d7a3a); }
  .job-failed { color: var(--error, #a33); }
  .danger { display: flex; align-items: center; justify-content: space-between; gap: 24px; }
  .authorize, .onboarding-callout { display: flex; align-items: center; justify-content: space-between; gap: 24px; background: color-mix(in srgb, var(--accent, #c4570a) 6%, transparent); }
  .authorize p:last-child, .onboarding-callout p:last-child { max-width: 620px; margin: 7px 0 0; color: var(--text-muted); font-size: var(--fs-label); line-height: 1.5; }
  .authorize > button, .onboarding-callout > button { padding: 8px 11px; border: 1px solid var(--accent, #c4570a); border-radius: 0; background: transparent; color: var(--accent, #c4570a); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; white-space: nowrap; cursor: pointer; }
  .preview > ol { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line-strong); }
  .preview > ol li { display: grid; grid-template-columns: 1fr auto auto; gap: 14px; align-items: center; padding: 11px 0; border-bottom: 1px solid var(--line-strong); }
  .preview li > span:first-child { display: grid; gap: 3px; }
  .preview small { color: var(--text-ghost); font-size: var(--fs-label-xs); text-transform: uppercase; }
  .preview .evidence { color: var(--text-muted); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; }
  .preview .evidence { padding: 2px 5px; border: 1px solid currentColor; }
  .complete-panel { display: flex; align-items: center; justify-content: space-between; gap: 24px; border: 1px solid var(--success, #2d7a3a); padding-inline: 18px; background: color-mix(in srgb, var(--success, #2d7a3a) 7%, transparent); }
  .complete-panel p:last-child { max-width: 620px; margin: 7px 0 0; color: var(--text-muted); font-size: var(--fs-label); line-height: 1.5; }
  .complete-actions { display: grid; justify-items: end; gap: 7px; }
  .complete-actions a { color: var(--success, #2d7a3a); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-decoration: none; text-transform: uppercase; white-space: nowrap; }
  .complete-actions a.primary { max-width: 360px; padding: 9px 12px; border: 1px solid var(--success, #2d7a3a); white-space: normal; text-align: right; line-height: 1.4; }
  .complete-actions a:hover { text-decoration: underline; text-underline-offset: 3px; }
  .danger p:last-child { max-width: 620px; margin: 7px 0 0; color: var(--text-muted); font-size: var(--fs-label); }
  .danger > button { color: var(--error, #a33); border-color: currentColor; white-space: nowrap; }
  @media (max-width: 650px) {
      header, .section-head, .danger, .authorize, .onboarding-callout, .complete-panel { align-items: flex-start; flex-direction: column; }
    .facts { grid-template-columns: 1fr; }
    .jobs li { grid-template-columns: 1fr auto; }
    .jobs time { grid-column: 1 / -1; }
    .upload-row { grid-template-columns: 1fr; align-items: start; }
    .upload-row label { grid-column: auto; }
    .preview > ol li { grid-template-columns: 1fr auto; }
    .preview-dates { grid-column: 1 / -1; }
    .complete-actions { justify-items: start; }
    .complete-actions a.primary { text-align: left; }
  }
</style>
