<script lang="ts">
  import { goto } from '$app/navigation';
  import { untrack } from 'svelte';
  import ActivityOnboardingStepper from '$lib/components/jkai/ActivityOnboardingStepper.svelte';
  import { getActivityOnboardingGuide } from '$lib/activity/onboarding';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let label = $state(untrack(() => data.provider.name));
  let understood = $state(false);
  let busy = $state(false);
  let message = $state<string | null>(null);

  const mode = untrack(() => data.provider.modes[0]);
  const guide = untrack(() => getActivityOnboardingGuide(data.provider.id, mode));

  const evidenceLabels: Record<string, string> = {
    provider_event: 'Timestamped provider events',
    provider_snapshot: 'Recent-list snapshots',
    inferred_delta: 'Changes inferred between syncs',
    archive_import: 'Records from your archive',
    device_observation: 'Observations emitted by a device',
  };

  function blockerCopy(): string | null {
    if (data.provider.startBlocker === 'not_launched') {
      return `${data.provider.name} is in preview. You can review the complete setup now, but connection creation stays closed until its data format and deletion path pass validation.`;
    }
    if (data.provider.startBlocker === 'operator_setup_required') {
      return 'The secure application credential has not been configured by the service operator. Users will never be asked to supply it.';
    }
    if (data.provider.startBlocker === 'fabric_disabled') {
      return 'Personal activity collection is currently paused for everyone.';
    }
    if (data.provider.startBlocker === 'provider_disabled') {
      return `${data.provider.name} is ready in the application but has not been enabled by the service operator.`;
    }
    return null;
  }

  async function createConnection() {
    if (!data.provider.canStart || !understood || busy) return;
    busy = true;
    message = null;
    try {
      const response = await fetch('/api/activity/v1/connections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: data.provider.id,
          mode,
          label,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? body.error ?? 'Could not create connection');
      await goto(`/jkai/sources/connections/${body.connection.id}?onboarding=1`);
    } catch (error) {
      message = error instanceof Error ? error.message : 'Could not create connection';
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Set up {data.provider.name} — JKAI</title></svelte:head>

<main class="connect-shell">
  <a class="back" href="/jkai/sources">← Sources</a>
  <header>
    <div>
      <p class="eyebrow">Add a personal source</p>
      <h1>Set up {data.provider.name}</h1>
      <p>{guide.actionDescription}</p>
    </div>
    <span class:ready={data.provider.canStart} class="readiness">{data.provider.canStart ? 'Ready' : 'Preview'}</span>
  </header>

  <ActivityOnboardingStepper current={1} />

  {#if blockerCopy()}
    <aside class="blocker" aria-label="Connection readiness">
      <strong>Why setup cannot start yet</strong>
      <p>{blockerCopy()}</p>
    </aside>
  {/if}

  <section aria-labelledby="prepare-title">
    <div class="section-heading">
      <p class="section-code">01 / Before you start</p>
      <h2 id="prepare-title">Bring the account, not its password</h2>
    </div>
    <div class="method-grid">
      <div><span>Connection method</span><strong>{guide.method}</strong></div>
      <div><span>Typical setup</span><strong>{guide.estimatedTime}</strong></div>
      <div><span>Updates</span><strong>{data.provider.supportsIncrementalSync ? 'Updates automatically after connection' : 'You choose when to add another archive'}</strong></div>
    </div>
    <ol class="prerequisites">
      {#each guide.prerequisites as prerequisite}
        <li>{prerequisite}</li>
      {/each}
    </ol>

    {#if guide.preparation}
      <div class="preparation">
        <div>
          <p class="section-code">Prepare at the provider</p>
          <h3>{guide.preparation.label}</h3>
        </div>
        <ol>
          {#each guide.preparation.steps as step}
            <li>{step}</li>
          {/each}
        </ol>
        {#if guide.preparation.waitNote}<p>{guide.preparation.waitNote}</p>{/if}
        <a href={guide.preparation.url} target="_blank" rel="noreferrer">Open official provider page ↗</a>
      </div>
    {/if}
  </section>

  <section aria-labelledby="boundary-title">
    <div class="section-heading">
      <p class="section-code">02 / Authorization boundary</p>
      <h2 id="boundary-title">Exactly what crosses the boundary</h2>
    </div>
    <div class="boundary-grid">
      <div class="receives">
        <h3>JKAI receives</h3>
        <ul>
          {#each guide.receives as item}<li>{item}</li>{/each}
        </ul>
      </div>
      <div class="never">
        <h3>JKAI never receives</h3>
        <ul>
          {#each guide.neverReceives as item}<li>{item}</li>{/each}
        </ul>
      </div>
    </div>
    <p class="credential-note"><strong>Application credentials are separate.</strong> Any API key owned by this JKAI installation is configured by its operator. It is never requested from an end user.</p>
  </section>

  <section aria-labelledby="evidence-title">
    <div class="section-heading">
      <p class="section-code">03 / Evidence quality</p>
      <h2 id="evidence-title">What the resulting activity can claim</h2>
    </div>
    <ul class="evidence-list">
      {#each data.provider.evidenceModes as evidence (evidence)}
        <li><span>{evidenceLabels[evidence] ?? evidence}</span><code>{evidence}</code></li>
      {/each}
    </ul>
    <p class="truth">{data.provider.availabilityNote}</p>
    <p class="fine">Unavailable facts stay unknown. A sync timestamp is never presented as the time an activity happened.</p>
  </section>

  <section class="start" aria-labelledby="start-title">
    <div class="section-heading">
      <p class="section-code">04 / Begin</p>
      <h2 id="start-title">Name this source</h2>
    </div>
    <label for="connection-label">Connection label</label>
    <input id="connection-label" bind:value={label} maxlength="120" disabled={!data.provider.canStart} />
    <label class="acknowledge" class:disabled={!data.provider.canStart}>
      <input type="checkbox" bind:checked={understood} disabled={!data.provider.canStart} />
      <span>I understand the evidence limits above. JKAI, Daydream and other uses will remain off until I choose them later in setup.</span>
    </label>
    {#if message}<p class="error" role="alert">{message}</p>{/if}
    <button disabled={!data.provider.canStart || !understood || !label.trim() || busy} onclick={createConnection}>
      {busy ? 'Creating…' : data.provider.canStart ? `${guide.actionLabel} →` : 'Connection not open yet'}
    </button>
    <p class="fine">Creating a connection does not grant any JKAI or Daydream access. You will review those permissions after authorization and data verification.</p>
  </section>
</main>

<style>
  .connect-shell { width: min(900px, calc(100% - 32px)); margin: 0 auto; padding: 38px 0 80px; color: var(--text-primary); }
  .back { display: inline-block; margin-bottom: 34px; color: var(--text-muted); font-family: var(--font-mono); font-size: var(--fs-label); text-decoration: none; }
  header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; padding-bottom: 28px; border-bottom: 2px solid var(--line-strong); }
  .eyebrow, .section-code { margin: 0 0 8px; color: var(--accent, #c4570a); font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: .12em; text-transform: uppercase; }
  h1 { margin: 0; font-family: var(--font-display); font-size: clamp(40px, 7vw, 68px); font-weight: 500; line-height: 1; }
  header p:last-child { max-width: 680px; margin: 12px 0 0; color: var(--text-muted); font-size: var(--fs-body); line-height: 1.55; }
  .readiness { padding: 4px 7px; border: 1px solid currentColor; color: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; }
  .readiness.ready { color: var(--success, #2d7a3a); }
  .blocker { margin-top: 20px; padding: 14px; border: 1px solid var(--line-strong); border-left: 3px solid var(--accent, #c4570a); }
  .blocker strong { font-size: var(--fs-label); }
  .blocker p { margin: 5px 0 0; color: var(--text-muted); font-size: var(--fs-label); line-height: 1.5; }
  section { padding: 30px 0; border-bottom: 1px solid var(--line-strong); }
  .section-heading { margin-bottom: 16px; }
  h2 { margin: 0; font-family: var(--font-display); font-size: clamp(27px, 4vw, 36px); font-weight: 500; }
  h3 { margin: 0; font-size: var(--fs-body); }
  .method-grid { display: grid; grid-template-columns: repeat(3, 1fr); border-top: 1px solid var(--line-strong); border-left: 1px solid var(--line-strong); }
  .method-grid div { display: grid; align-content: start; gap: 7px; min-height: 92px; padding: 14px; border-right: 1px solid var(--line-strong); border-bottom: 1px solid var(--line-strong); }
  .method-grid span { color: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; }
  .method-grid strong { font-size: var(--fs-label); line-height: 1.45; }
  .prerequisites { margin: 15px 0 0; padding-left: 23px; color: var(--text-muted); font-size: var(--fs-label); line-height: 1.7; }
  .preparation { display: grid; grid-template-columns: minmax(180px, .7fr) 1.3fr; gap: 12px 28px; margin-top: 20px; padding: 18px; border: 1px solid var(--line-strong); background: color-mix(in srgb, var(--accent, #c4570a) 5%, transparent); }
  .preparation ol { grid-row: span 2; margin: 0; padding-left: 20px; color: var(--text-muted); font-size: var(--fs-label); line-height: 1.6; }
  .preparation > p { margin: 0; color: var(--text-ghost); font-size: var(--fs-label-xs); line-height: 1.5; }
  .preparation > a { width: fit-content; color: var(--accent, #c4570a); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-decoration: none; text-transform: uppercase; }
  .boundary-grid { display: grid; grid-template-columns: repeat(2, 1fr); border-top: 1px solid var(--line-strong); border-left: 1px solid var(--line-strong); }
  .boundary-grid > div { padding: 17px; border-right: 1px solid var(--line-strong); border-bottom: 1px solid var(--line-strong); }
  .boundary-grid h3 { font-family: var(--font-mono); font-size: var(--fs-label); text-transform: uppercase; }
  .boundary-grid ul { margin: 12px 0 0; padding-left: 19px; color: var(--text-muted); font-size: var(--fs-label); line-height: 1.65; }
  .receives h3 { color: var(--success, #2d7a3a); }
  .never h3 { color: var(--text-ghost); }
  .credential-note, .truth { margin: 14px 0 0; padding-left: 12px; border-left: 3px solid var(--accent, #c4570a); color: var(--text-muted); font-size: var(--fs-label); line-height: 1.55; }
  .credential-note strong { color: var(--text-primary); }
  .evidence-list { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line-strong); }
  .evidence-list li { display: flex; justify-content: space-between; gap: 16px; padding: 11px 0; border-bottom: 1px solid var(--line-strong); }
  .evidence-list code { color: var(--text-ghost); font-size: var(--fs-label-xs); }
  .fine { margin: 12px 0 0; color: var(--text-ghost); font-size: var(--fs-label-xs); line-height: 1.5; }
  .start { display: grid; gap: 10px; }
  .start .section-heading { margin-bottom: 5px; }
  .start > label:not(.acknowledge) { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; color: var(--text-muted); }
  .start > input { max-width: 440px; padding: 10px; border: 1px solid var(--line-strong); border-radius: 0; background: var(--surface-elevated, transparent); color: var(--text-primary); font: inherit; }
  .acknowledge { display: grid; grid-template-columns: auto 1fr; gap: 10px; align-items: start; max-width: 700px; margin-top: 7px; color: var(--text-muted); font-size: var(--fs-label); line-height: 1.5; cursor: pointer; }
  .acknowledge input { margin-top: 3px; accent-color: var(--accent, #c4570a); }
  .acknowledge.disabled { color: var(--text-ghost); cursor: default; }
  .start button { width: fit-content; margin-top: 7px; padding: 9px 14px; border: 1px solid var(--accent, #c4570a); border-radius: 0; background: transparent; color: var(--accent, #c4570a); font-family: var(--font-mono); font-size: var(--fs-label); cursor: pointer; }
  .start button:disabled { border-color: var(--line-strong); color: var(--text-ghost); cursor: default; }
  .error { margin: 0; color: var(--error, #a33); font-size: var(--fs-label); }
  @media (max-width: 680px) {
    .connect-shell { width: min(100% - 20px, 900px); }
    header { flex-direction: column; }
    .method-grid, .boundary-grid { grid-template-columns: 1fr; }
    .preparation { grid-template-columns: 1fr; }
    .preparation ol { grid-row: auto; }
  }
</style>
