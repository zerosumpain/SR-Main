<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { untrack } from 'svelte';
  import ActivityOnboardingStepper from '$lib/components/jkai/ActivityOnboardingStepper.svelte';
  import {
    ACTIVITY_ONBOARDING_OUTCOMES,
    ACTIVITY_OPERATOR_GUIDES,
    describeStartBlocker,
    getActivityOnboardingGuide,
    readinessRows,
    recommendActivityProviders,
    type ActivityOnboardingOutcomeId,
  } from '$lib/activity/onboarding';
  import type { ActivityDataClass, ConnectionMode } from '$lib/activity/contracts';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const initialOutcomes = untrack(() => {
    const saved = (data.onboarding?.outcomes ?? []).filter((value): value is ActivityOnboardingOutcomeId =>
      ACTIVITY_ONBOARDING_OUTCOMES.some((outcome) => outcome.id === value),
    );
    if (saved.length > 0 || !data.requestedProvider) return saved;
    const match = ACTIVITY_ONBOARDING_OUTCOMES.find(
      (outcome) => outcome.id !== 'whole_story' && outcome.providerIds.includes(data.requestedProvider as never),
    );
    return match ? [match.id] : [];
  });

  let sessionId = $state<string | null>(untrack(() => data.onboarding?.id ?? null));
  let outcomes = $state<ActivityOnboardingOutcomeId[]>(initialOutcomes);
  let selectedProviderId = $state<string | null>(
    untrack(() => data.onboarding?.selectedProvider ?? data.requestedProvider ?? null),
  );
  let selectedDataClasses = $state<ActivityDataClass[]>(
    untrack(() => {
      if ((data.onboarding?.dataClasses.length ?? 0) > 0) {
        return data.onboarding!.dataClasses as ActivityDataClass[];
      }
      return (data.providers.find((provider) => provider.id === data.requestedProvider)?.dataClasses ?? []) as ActivityDataClass[];
    }),
  );
  let journeyStatus = $state(untrack(() => data.onboarding?.status ?? null));
  let exportRequestedAt = $state<Date | string | null>(
    untrack(() => data.onboarding?.exportRequestedAt ?? null),
  );
  let remindAt = $state<Date | string | null>(untrack(() => data.onboarding?.remindAt ?? null));
  let step = $state(untrack(() => {
    if (initialOutcomes.length === 0) return 1;
    if (!(data.onboarding?.selectedProvider ?? data.requestedProvider)) return 2;
    return 3;
  }));
  let busy = $state(false);
  let message = $state<string | null>(null);
  let savedForLater = $state(false);

  const recommendations = $derived(recommendActivityProviders(outcomes, data.providers));
  const selectedProvider = $derived(
    data.providers.find((provider) => provider.id === selectedProviderId) ?? null,
  );
  const guide = $derived(
    selectedProvider
      ? getActivityOnboardingGuide(selectedProvider.id, selectedProvider.modes[0] as ConnectionMode)
      : null,
  );

  // The Connect step as a checklist. Each row that the owner can clear from
  // this page carries its control; `data` refreshes through invalidateAll()
  // after every action, so the rows recompute without local bookkeeping.
  const readiness = $derived(
    selectedProvider ? readinessRows(selectedProvider, data.enabled, data.vaultConfigured) : [],
  );
  const keyRow = $derived(readiness.find((row) => row.id === 'key' && row.state === 'todo') ?? null);
  const keyGuide = $derived(keyRow?.secret ? (ACTIVITY_OPERATOR_GUIDES[keyRow.secret] ?? null) : null);
  let keyDraft = $state('');

  const dataClassCopy: Record<ActivityDataClass, { label: string; description: string }> = {
    metadata: {
      label: 'Titles and identifiers',
      description: 'Names, URLs and stable IDs needed to recognize the thing the activity refers to.',
    },
    activity: {
      label: 'Activity evidence',
      description: 'Play, watch, listen or contribution evidence, including times when the source supplies them.',
    },
    raw_content: {
      label: 'Raw content',
      description: 'Post, comment or document text. This stays separate because it can be sensitive.',
    },
    location: {
      label: 'Location',
      description: 'Place or route evidence. Leave this off unless the outcome genuinely needs it.',
    },
  };

  function formatDate(value: Date | string | null): string {
    if (!value) return 'Not scheduled';
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(value));
  }

  function toggleOutcome(id: ActivityOnboardingOutcomeId) {
    outcomes = outcomes.includes(id)
      ? outcomes.filter((outcome) => outcome !== id)
      : [...outcomes, id];
  }

  function toggleDataClass(id: ActivityDataClass) {
    selectedDataClasses = selectedDataClasses.includes(id)
      ? selectedDataClasses.filter((dataClass) => dataClass !== id)
      : [...selectedDataClasses, id];
  }

  async function saveJourney(providerId: string | null, classes?: ActivityDataClass[]) {
    const response = await fetch('/api/activity/v1/onboarding', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        outcomes,
        selectedProvider: providerId,
        dataClasses: classes,
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.detail ?? 'Could not save this setup');
    sessionId = body.session.id;
    journeyStatus = body.session.status;
    exportRequestedAt = body.session.exportRequestedAt;
    remindAt = body.session.remindAt;
    return body.session;
  }

  async function continueFromPurpose() {
    if (outcomes.length === 0 || busy) return;
    busy = true;
    message = null;
    savedForLater = false;
    try {
      await saveJourney(null);
      selectedProviderId = null;
      selectedDataClasses = [];
      step = 2;
    } catch (error) {
      message = error instanceof Error ? error.message : 'Could not save this setup';
    } finally {
      busy = false;
    }
  }

  async function chooseProvider(providerId: string) {
    if (busy) return;
    const provider = data.providers.find((item) => item.id === providerId);
    if (!provider) return;
    busy = true;
    message = null;
    try {
      const classes = [...provider.dataClasses] as ActivityDataClass[];
      await saveJourney(providerId, classes);
      selectedProviderId = providerId;
      selectedDataClasses = classes;
      step = 3;
    } catch (error) {
      message = error instanceof Error ? error.message : 'Could not save this source';
    } finally {
      busy = false;
    }
  }

  async function recordExportRequest() {
    if (!selectedProviderId || busy) return;
    busy = true;
    message = null;
    try {
      if (!sessionId) await saveJourney(selectedProviderId, selectedDataClasses);
      const response = await fetch('/api/activity/v1/onboarding', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, action: 'export_requested' }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? 'Could not record the export request');
      journeyStatus = body.session.status;
      exportRequestedAt = body.session.exportRequestedAt;
      remindAt = body.session.remindAt;
      message = 'Saved. JKAI will keep your place while the provider prepares the archive.';
    } catch (error) {
      message = error instanceof Error ? error.message : 'Could not record the export request';
    } finally {
      busy = false;
    }
  }

  async function turnOn() {
    if (!selectedProvider || busy) return;
    busy = true;
    message = null;
    try {
      const response = await fetch(`/api/activity/v1/providers/${encodeURIComponent(selectedProvider.id)}/enable`, {
        method: 'POST',
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? 'Could not turn this source on');
      await invalidateAll();
      message = body.provider?.canStart
        ? `${body.provider.name} is on. You can connect it now.`
        : `${body.provider?.name ?? 'This source'} is on. One more row to clear before it can connect.`;
    } catch (error) {
      message = error instanceof Error ? error.message : 'Could not turn this source on';
    } finally {
      busy = false;
    }
  }

  async function saveKey() {
    if (!selectedProvider || !keyDraft.trim() || busy) return;
    busy = true;
    message = null;
    try {
      const response = await fetch(`/api/activity/v1/providers/${encodeURIComponent(selectedProvider.id)}/credential`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: keyDraft }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? 'Could not save the key');
      keyDraft = '';
      await invalidateAll();
      message = 'Key stored in the site vault. It is bound to api.steampowered.com and will not be shown again.';
    } catch (error) {
      message = error instanceof Error ? error.message : 'Could not save the key';
    } finally {
      busy = false;
    }
  }

  async function continueFromData() {
    if (!selectedProvider || selectedDataClasses.length === 0 || busy) return;
    busy = true;
    message = null;
    savedForLater = false;
    try {
      const saved = await saveJourney(selectedProvider.id, selectedDataClasses);
      if (!selectedProvider.canStart) {
        journeyStatus = saved.status;
        savedForLater = true;
        message = guide?.preparation
          ? journeyStatus === 'waiting_export'
            ? 'Your export wait and data choices are saved. The upload step will unlock when this importer passes its launch checks.'
            : 'Your data choices are saved. Request the export when you are ready, and JKAI will keep your place.'
          : 'Your choices are saved. This source will resume here when its connection is available.';
        return;
      }
      const response = await fetch('/api/activity/v1/connections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: selectedProvider.id,
          mode: selectedProvider.modes[0],
          label: selectedProvider.name,
          dataClasses: selectedDataClasses,
          onboardingSessionId: sessionId,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? 'Could not create the source connection');
      const connectionPath = `/jkai/sources/connections/${body.connection.id}?journey=${sessionId}`;
      // A sign-in provider goes straight to the provider: creating the pending
      // connection and beginning authorization used to be two clicks on two
      // pages. The callback lands on the connection page at step 5. Apple
      // Music authorizes in the browser (MusicKit) from that page, and an
      // archive is uploaded there, so those still navigate.
      if (selectedProvider.modes.includes('openid')) {
        const auth = await fetch(`/api/activity/v1/connections/${body.connection.id}/authorize?journey=${encodeURIComponent(sessionId ?? '')}`, {
          method: 'POST',
        });
        const authBody = await auth.json();
        if (auth.ok && typeof authBody.authorizationUrl === 'string') {
          window.location.assign(authBody.authorizationUrl);
          return;
        }
        // The connection exists now, so the retry lives on its page — but the
        // reason travels with it rather than being dropped on the floor.
        const notice = typeof authBody.detail === 'string' ? authBody.detail : 'Could not begin authorization';
        await goto(`${connectionPath}&notice=${encodeURIComponent(notice)}`);
        return;
      }
      await goto(connectionPath);
    } catch (error) {
      savedForLater = false;
      message = error instanceof Error ? error.message : 'Could not continue this setup';
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Add a source — JKAI</title></svelte:head>

<main class="onboard-shell source-surface">
  <div class="topline">
    <a href="/jkai/sources">← Sources</a>
    {#if sessionId}<span>Progress saved automatically</span>{/if}
  </div>

  <header>
    <p class="eyebrow">JKAI · Guided source setup</p>
    <h1>Make your activity useful.</h1>
    <p>Start with what you want JKAI to understand. You will see the evidence, choose the data, and grant each use separately.</p>
  </header>

  <ActivityOnboardingStepper current={step} />

  {#if message}<p class="message" role="status">{message}</p>{/if}

  {#if step === 1}
    <section aria-labelledby="purpose-title">
      <p class="section-code">Step 1 / Purpose</p>
      <h2 id="purpose-title">What should this source help with?</h2>
      <p class="section-copy">Pick one or more. This only shapes recommendations; it does not grant JKAI access.</p>
      <div class="choice-grid">
        {#each ACTIVITY_ONBOARDING_OUTCOMES as outcome (outcome.id)}
          <button
            class:selected={outcomes.includes(outcome.id)}
            aria-pressed={outcomes.includes(outcome.id)}
            onclick={() => toggleOutcome(outcome.id)}
          >
            <span>{outcomes.includes(outcome.id) ? 'Selected' : 'Choose'}</span>
            <strong>{outcome.title}</strong>
            <small>{outcome.description}</small>
          </button>
        {/each}
      </div>
      <div class="actions"><span></span><button onclick={continueFromPurpose} disabled={outcomes.length === 0 || busy}>{busy ? 'Saving…' : 'Find the right sources →'}</button></div>
    </section>
  {:else if step === 2}
    <section aria-labelledby="source-title">
      <p class="section-code">Step 2 / Source</p>
      <h2 id="source-title">Start with one source</h2>
      <p class="section-copy">These are ranked against your goals. Add another source later; each keeps its own permissions and evidence limits.</p>
      <div class="recommendations">
        {#each recommendations as recommendation, index (recommendation.provider.id)}
          <article>
            <div class="recommendation-top">
              <span class="rank">{String(index + 1).padStart(2, '0')}</span>
              <span class:ready={recommendation.provider.canStart} class="availability">{recommendation.provider.canStart ? 'Ready now' : recommendation.provider.availability.replaceAll('_', ' ')}</span>
            </div>
            <h3>{recommendation.provider.name}</h3>
            <p>{recommendation.provider.description}</p>
            <dl>
              <div><dt>Good for</dt><dd>{recommendation.reasons.join(' · ')}</dd></div>
              <div><dt>Evidence</dt><dd>{recommendation.provider.evidenceModes.map((mode) => mode.replaceAll('_', ' ')).join(' · ')}</dd></div>
            </dl>
            <button onclick={() => chooseProvider(recommendation.provider.id)} disabled={busy}>Choose {recommendation.provider.name} →</button>
          </article>
        {/each}
      </div>
      <div class="actions"><button class="secondary" onclick={() => step = 1}>← Change goals</button><a href="/jkai/sources#catalogue-title">Browse every source</a></div>
    </section>
  {:else if step === 3 && selectedProvider && guide}
    <section aria-labelledby="connect-title">
      <p class="section-code">Step 3 / Connect</p>
      <div class="provider-heading">
        <div><h2 id="connect-title">Prepare {selectedProvider.name}</h2><p>{guide.actionDescription}</p></div>
        <span class:ready={selectedProvider.canStart}>{describeStartBlocker(selectedProvider.startBlocker)}</span>
      </div>
      <div class="connect-grid">
        <div>
          <h3>Readiness</h3>
          <ol class="readiness" aria-label="What {selectedProvider.name} needs before it can connect">
            {#each readiness as row (row.id + row.label)}
              <li class="row-{row.state}">
                <span class="mark" aria-hidden="true">{row.state === 'done' ? '✓' : row.state === 'todo' ? '→' : '·'}</span>
                <div class="row-body">
                  <strong>{row.label}<small>{row.state === 'done' ? 'Done' : row.state === 'todo' ? 'To do' : 'Waiting'}</small></strong>
                  <p>{row.detail}</p>
                  {#if row.id === 'switch' && row.state === 'todo'}
                    <button class="row-action" onclick={turnOn} disabled={busy}>{busy ? 'Working…' : `Turn ${selectedProvider.name} on`}</button>
                  {/if}
                  {#if row.id === 'key' && row.state === 'todo' && keyGuide}
                    <div class="key-form">
                      <ol>{#each keyGuide.steps as item}<li>{item}</li>{/each}</ol>
                      <p class="key-domain">Domain name to enter: <code>{data.siteHost}</code></p>
                      <a href={keyGuide.url} target="_blank" rel="noreferrer">Open Steam’s API key page ↗</a>
                      <label for="operator-key">{keyGuide.label}</label>
                      <div class="key-row">
                        <input
                          id="operator-key"
                          type="password"
                          autocomplete="off"
                          spellcheck="false"
                          placeholder={keyGuide.placeholder}
                          bind:value={keyDraft}
                        />
                        <button class="row-action" onclick={saveKey} disabled={busy || !keyDraft.trim()}>{busy ? 'Saving…' : 'Save key'}</button>
                      </div>
                    </div>
                  {/if}
                </div>
              </li>
            {/each}
          </ol>
          <h3>What happens</h3>
          <dl class="facts">
            <div><dt>Method</dt><dd>{guide.method}</dd></div>
            <div><dt>Typical time</dt><dd>{guide.estimatedTime}</dd></div>
            <div><dt>Updates</dt><dd>{selectedProvider.supportsIncrementalSync ? 'Can refresh after connection' : 'Only when you upload another archive'}</dd></div>
          </dl>
          {#if guide.preparation}
            <div class="preparation">
              <h3>Request the right archive</h3>
              <ol>{#each guide.preparation.steps as item}<li>{item}</li>{/each}</ol>
              {#if guide.preparation.waitNote}<p>{guide.preparation.waitNote}</p>{/if}
              <a href={guide.preparation.url} target="_blank" rel="noreferrer">{guide.preparation.label} ↗</a>
              <button onclick={recordExportRequest} disabled={busy || journeyStatus === 'waiting_export'}>
                {journeyStatus === 'waiting_export' ? 'Export request saved ✓' : 'I requested it — save my place'}
              </button>
              {#if journeyStatus === 'waiting_export'}
                <p class="wait-state"><strong>Waiting for export</strong><span>Recorded {formatDate(exportRequestedAt)} · check back {formatDate(remindAt)}</span></p>
              {/if}
            </div>
          {/if}
        </div>
        <div class="boundary">
          <h3>The trust boundary</h3>
          <div><strong>JKAI receives</strong><ul>{#each guide.receives as item}<li>{item}</li>{/each}</ul></div>
          <div><strong>JKAI never receives</strong><ul>{#each guide.neverReceives as item}<li>{item}</li>{/each}</ul></div>
        </div>
      </div>
      <div class="actions"><button class="secondary" onclick={() => step = 2}>← Choose another source</button><button onclick={() => step = 4}>{guide.preparation ? 'Choose what to import →' : 'Choose what to connect →'}</button></div>
    </section>
  {:else if step === 4 && selectedProvider && guide}
    <section aria-labelledby="data-title">
      <p class="section-code">Step 4 / Select data</p>
      <h2 id="data-title">Which parts may become usable?</h2>
      <p class="section-copy">This limits the permission choices available after connection. JKAI still keeps the minimum source provenance needed for preview, audit and deletion.</p>
      <div class="data-choices">
        {#each selectedProvider.dataClasses as dataClass (dataClass)}
          <button
            class:selected={selectedDataClasses.includes(dataClass)}
            aria-pressed={selectedDataClasses.includes(dataClass)}
            onclick={() => toggleDataClass(dataClass)}
          >
            <span>{selectedDataClasses.includes(dataClass) ? 'Included' : 'Excluded'}</span>
            <strong>{dataClassCopy[dataClass].label}</strong>
            <small>{dataClassCopy[dataClass].description}</small>
          </button>
        {/each}
      </div>
      <aside class="next-note">
        <strong>Still off after this step</strong>
        <span>JKAI, Daydream, Briefing, workflows, Intel and external tools receive nothing until you review evidence and grant them access separately.</span>
      </aside>
      <div class="actions">
        <button class="secondary" onclick={() => step = 3}>← Back to preparation</button>
        <button onclick={continueFromData} disabled={selectedDataClasses.length === 0 || busy}>
          {busy ? 'Saving…' : selectedProvider.canStart ? `${guide.actionLabel} →` : 'Save this setup →'}
        </button>
      </div>
    </section>
  {/if}

  {#if step === 4 && savedForLater && selectedProvider && !selectedProvider.canStart}
    <aside class="saved-panel">
      <div><p class="section-code">Journey saved</p><h2>You can leave and come back.</h2><p>{guide?.preparation ? 'Your export wait and data choices are attached to this setup.' : 'Your goals, source choice and data boundary are attached to this setup.'}</p></div>
      <div><a href="/jkai/sources">Return to Sources →</a><a href="/jkai/sources/onboard?restart=1">Start another setup</a></div>
    </aside>
  {/if}
</main>

<style>
  .topline { display: flex; justify-content: space-between; gap: 18px; margin-bottom: 34px; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; }
  .topline a, .actions a { color: var(--text-muted); text-decoration: none; }
  .topline span { color: var(--success, #2d7a3a); }
  header { padding-bottom: 28px; border-bottom: 2px solid var(--line-title); }
  .eyebrow, .section-code { margin: 0 0 8px; color: var(--accent, #c4570a); font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: .12em; text-transform: uppercase; }
  header > p:last-child { max-width: 690px; margin: 15px 0 0; color: var(--text-muted); line-height: 1.55; }
  section { padding: 34px 0; }
  h2 { margin: 0; font-family: var(--font-display); font-size: clamp(1.5rem, 3vw, 2rem); font-weight: 500; }
  h3 { margin: 0; font-family: var(--font-display); font-size: var(--fs-display-xs); font-weight: 500; }
  .section-copy { max-width: 710px; margin: 9px 0 22px; color: var(--text-muted); line-height: 1.55; }
  .message { margin: 18px 0 0; padding: 11px 13px; border-left: 3px solid var(--accent, #c4570a); color: var(--text-muted); }
  button { border-radius: 0; cursor: pointer; }
  button:disabled { opacity: .45; cursor: default; }
  .choice-grid, .data-choices { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-top: 1px solid var(--line-strong); border-left: 1px solid var(--line-strong); }
  .choice-grid button, .data-choices button { min-height: 150px; display: grid; align-content: start; gap: 7px; padding: 17px; border: 0; border-right: 1px solid var(--line-strong); border-bottom: 1px solid var(--line-strong); background: transparent; color: inherit; text-align: left; }
  .choice-grid button.selected, .data-choices button.selected { background: color-mix(in srgb, var(--accent, #c4570a) 7%, transparent); outline: 1px solid var(--accent); outline-offset: -1px; }
  .choice-grid span, .data-choices span { color: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; }
  .choice-grid button.selected span, .data-choices button.selected span { color: var(--accent, #c4570a); }
  .choice-grid strong, .data-choices strong { margin-top: 8px; font-family: var(--font-display); font-size: 23px; font-weight: 500; }
  .choice-grid small, .data-choices small { color: var(--text-muted); font-size: var(--fs-label); line-height: 1.45; }
  .actions { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 22px; }
  .actions button, .preparation button { padding: 9px 12px; border: 1px solid var(--accent, #c4570a); background: transparent; color: var(--accent, #c4570a); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; }
  .actions button:not(.secondary) { background: var(--accent); color: var(--bg); min-height: 44px; }
  .actions button.secondary { border-color: var(--line-strong); color: var(--text-muted); }
  .actions a { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; }
  .recommendations { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-top: 1px solid var(--line-strong); border-left: 1px solid var(--line-strong); }
  .recommendations article { min-height: 310px; display: flex; flex-direction: column; padding: 18px; border-right: 1px solid var(--line-strong); border-bottom: 1px solid var(--line-strong); }
  .recommendation-top { display: flex; justify-content: space-between; gap: 12px; }
  .rank, .availability, .provider-heading > span { color: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; }
  .availability.ready, .provider-heading > span.ready { color: var(--success, #2d7a3a); }
  .recommendations h3 { margin-top: 26px; }
  .recommendations > article > p { margin: 7px 0 15px; color: var(--text-muted); font-size: var(--fs-label); line-height: 1.45; }
  .recommendations dl, .facts { display: grid; gap: 8px; margin: 0 0 18px; }
  .recommendations dl div, .facts div { display: grid; grid-template-columns: 90px 1fr; gap: 10px; }
  dt, dd { margin: 0; font-size: var(--fs-label-xs); line-height: 1.45; }
  dt { color: var(--text-ghost); font-family: var(--font-mono); text-transform: uppercase; }
  dd { color: var(--text-muted); }
  .recommendations article > button { margin-top: auto; padding: 8px 0; border: 0; border-top: 1px solid var(--line-strong); background: transparent; color: var(--accent, #c4570a); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-align: left; text-transform: uppercase; }
  .provider-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
  .provider-heading p { max-width: 690px; margin: 8px 0 22px; color: var(--text-muted); line-height: 1.5; }
  .connect-grid { display: grid; grid-template-columns: 1.15fr .85fr; border: 1px solid var(--line-strong); }
  .connect-grid > div { padding: 20px; }
  .connect-grid > div + div { border-left: 1px solid var(--line-strong); }
  .connect-grid h3 { margin-bottom: 14px; font-family: var(--font-mono); font-size: var(--fs-label); letter-spacing: .08em; text-transform: uppercase; }
  .readiness { list-style: none; margin: 0 0 22px; padding: 0; border-top: 1px solid var(--line-strong); }
  .readiness > li { display: grid; grid-template-columns: 26px 1fr; gap: 10px; padding: 12px 0; border-bottom: 1px solid var(--line-strong); }
  .mark { width: 22px; height: 22px; display: grid; place-items: center; border: 1px solid currentColor; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .row-done .mark { color: var(--success, #2d7a3a); }
  .row-todo .mark { color: var(--accent, #c4570a); }
  .row-body { display: grid; gap: 5px; min-width: 0; }
  .row-body strong { display: flex; align-items: baseline; gap: 10px; font-size: var(--fs-label); }
  .row-body strong small { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 400; letter-spacing: .08em; text-transform: uppercase; color: var(--text-ghost); }
  .row-done strong small { color: var(--success, #2d7a3a); }
  .row-todo strong small { color: var(--accent, #c4570a); }
  .row-body p { margin: 0; color: var(--text-muted); font-size: var(--fs-label); line-height: 1.5; }
  .row-blocked .row-body { color: var(--text-ghost); }
  .row-action { width: fit-content; margin-top: 4px; padding: 8px 11px; border: 1px solid var(--accent, #c4570a); background: transparent; color: var(--accent, #c4570a); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; }
  .key-form { display: grid; gap: 8px; margin-top: 6px; padding: 12px; border: 1px solid var(--line-strong); background: color-mix(in srgb, var(--accent, #c4570a) 4%, transparent); }
  .key-form ol { margin: 0; padding-left: 18px; color: var(--text-muted); font-size: var(--fs-label); line-height: 1.55; }
  .key-domain { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; }
  .key-domain code { padding: 1px 5px; border: 1px solid var(--line-strong); text-transform: none; }
  .key-form > a { width: fit-content; color: var(--accent, #c4570a); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-decoration: none; text-transform: uppercase; }
  .key-form label { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: .08em; text-transform: uppercase; color: var(--text-ghost); }
  .key-row { display: flex; gap: 8px; }
  .key-row input { flex: 1; min-width: 0; padding: 8px 10px; border: 1px solid var(--line-strong); border-radius: 0; background: var(--surface, var(--bg)); color: var(--text-primary); font-family: var(--font-mono); font-size: var(--fs-label); }
  .key-row input:focus { outline: 2px solid var(--accent, #c4570a); outline-offset: -1px; }
  .key-row .row-action { margin-top: 0; }
  .preparation { margin-top: 22px; padding-top: 20px; border-top: 1px solid var(--line-strong); }
  .preparation ol, .boundary ul { margin: 0; padding-left: 20px; color: var(--text-muted); font-size: var(--fs-label); line-height: 1.6; }
  .preparation p { color: var(--text-ghost); font-size: var(--fs-label-xs); line-height: 1.5; }
  .preparation a { display: inline-block; margin: 8px 12px 8px 0; color: var(--accent, #c4570a); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-decoration: none; text-transform: uppercase; }
  .preparation button { margin-top: 8px; }
  .wait-state { display: grid; gap: 4px; padding: 11px; border: 1px solid var(--success, #2d7a3a); color: var(--success, #2d7a3a) !important; }
  .wait-state span { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; }
  .boundary { background: color-mix(in srgb, var(--accent, #c4570a) 4%, transparent); }
  .boundary > div + div { margin-top: 22px; }
  .boundary strong { display: block; margin-bottom: 5px; font-size: var(--fs-label); }
  .data-choices { margin-top: 20px; }
  .next-note { display: grid; grid-template-columns: 190px 1fr; gap: 14px; margin-top: 18px; padding: 14px; border: 1px solid var(--line-strong); }
  .next-note strong { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; }
  .next-note span { color: var(--text-muted); font-size: var(--fs-label); line-height: 1.5; }
  .saved-panel { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 20px; border: 1px solid var(--success, #2d7a3a); background: color-mix(in srgb, var(--success, #2d7a3a) 7%, transparent); }
  .saved-panel h2 { font-size: 29px; }
  .saved-panel p:last-child { max-width: 620px; margin: 7px 0 0; color: var(--text-muted); }
  .saved-panel > div:last-child { display: grid; justify-items: end; gap: 8px; }
  .saved-panel a { color: var(--success, #2d7a3a); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-decoration: none; text-transform: uppercase; }
  @media (max-width: 700px) {
      .choice-grid, .recommendations, .data-choices, .connect-grid { grid-template-columns: 1fr; }
    .connect-grid > div + div { border-top: 1px solid var(--line-strong); border-left: 0; }
    .provider-heading, .saved-panel { align-items: flex-start; flex-direction: column; }
    .key-row { flex-direction: column; }
    .next-note { grid-template-columns: 1fr; }
    .saved-panel > div:last-child { justify-items: start; }
  }
</style>
