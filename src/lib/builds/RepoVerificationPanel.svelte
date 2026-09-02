<script lang="ts">
  import {
    latestRepoVerification,
    verificationIsGreen,
    type RepoVerificationEvent,
    type RepoVerificationPhase,
    type RepoVerificationStatus,
  } from '$lib/verification/repo';

  interface VerificationConfig {
    applies: boolean;
    steps: Array<{
      phase: RepoVerificationPhase;
      label: string;
      command: string | null;
      owner: 'builder' | 'github' | 'production';
    }>;
  }

  let {
    logs,
    outcome = null,
    publishedSlug = null,
    config = null,
    loading = false,
    error = null,
  }: {
    logs: Array<{ id: number; type: string; content: string }>;
    outcome?: string | null;
    publishedSlug?: string | null;
    config?: VerificationConfig | null;
    loading?: boolean;
    error?: string | null;
  } = $props();

  const latest = $derived(latestRepoVerification(logs));

  const defaults: VerificationConfig['steps'] = [
    { phase: 'feedback_gate', label: 'Structural checks, typecheck and tests', command: null, owner: 'builder' },
    { phase: 'release_candidate', label: 'Production web and sidecar bundles', command: null, owner: 'builder' },
    { phase: 'publish', label: 'Publish candidate', command: null, owner: 'builder' },
    { phase: 'ci', label: 'GitHub CI and review', command: null, owner: 'github' },
    { phase: 'deploy', label: 'Production deployment', command: null, owner: 'production' },
  ];

  const steps = $derived.by(() => {
    const configured = config?.steps?.length ? config.steps : defaults;
    return configured.map((step) => {
      const event = latest[step.phase];
      let status: RepoVerificationStatus = event?.status ?? 'pending';
      let detail = event?.detail ?? defaultDetail(step.phase);

      // Historical PR rows pre-date structured events. Keep them honest but
      // useful: the PR itself proves publish happened, not that CI or deploy did.
      if (!event && step.phase === 'publish' && outcome === 'pr_open' && publishedSlug) {
        status = 'passed';
        detail = `Pull request opened: ${publishedSlug}`;
      }
      return { ...step, event, status, detail };
    });
  });

  const overall = $derived.by(() => {
    if (steps.some((s) => s.status === 'failed' || s.status === 'reused_failed')) return 'failed';
    if (steps.some((s) => s.status === 'running')) return 'running';
    if (verificationIsGreen(steps.find((s) => s.phase === 'deploy')?.status ?? 'pending')) return 'deployed';
    if (outcome === 'pr_open') return 'proposed';
    return 'pending';
  });

  function defaultDetail(phase: RepoVerificationPhase): string {
    if (phase === 'feedback_gate') return 'Waiting for the builder to run the fast feedback gate.';
    if (phase === 'release_candidate') return 'Runs only after the feedback gate passes.';
    if (phase === 'publish') return 'No verified branch or pull request recorded yet.';
    if (phase === 'ci') return 'Only GitHub can authoritatively prove required checks and merge state.';
    return 'Only an exact commit check against the public site proves deployment.';
  }

  function statusLabel(status: RepoVerificationStatus): string {
    if (status === 'reused_passed') return 'passed · reused';
    if (status === 'reused_failed') return 'failed · reused';
    return status;
  }

  function duration(event?: RepoVerificationEvent): string | null {
    if (!event?.durationMs) return null;
    const seconds = Math.round(event.durationMs / 1000);
    return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }
</script>

<div class="rv">
  <header class="rv-head">
    <div>
      <span class="rv-kicker">Release confidence</span>
      <h2>Verification chain</h2>
    </div>
    <span class="rv-overall" data-state={overall}>{overall}</span>
  </header>

  {#if loading}
    <p class="rv-note">Reading the commands recorded on this build…</p>
  {:else if error}
    <p class="rv-error" role="alert">The live configuration could not be loaded: {error}</p>
  {/if}

  <p class="rv-intro">
    Green means that phase produced evidence. A PR is a proposed candidate: it is not shown as
    deployed until CI, merge and the public commit check are known.
  </p>

  <ol class="rv-chain">
    {#each steps as step, index (step.phase)}
      <li class="rv-step" data-status={step.status}>
        <span class="rv-index" aria-hidden="true">{index + 1}</span>
        <span class="rv-main">
          <span class="rv-row">
            <strong>{step.label}</strong>
            <span class="rv-owner">{step.owner}</span>
          </span>
          <span class="rv-detail">{step.detail}</span>
          {#if step.command}
            <code>{step.command}</code>
          {/if}
        </span>
        <span class="rv-result">
          <span>{statusLabel(step.status)}</span>
          {#if duration(step.event)}<small>{duration(step.event)}</small>{/if}
        </span>
      </li>
    {/each}
  </ol>

  {#if publishedSlug}
    <div class="rv-published">
      <span>Recorded proposal</span>
      {#if /^https?:\/\//.test(publishedSlug)}
        <a href={publishedSlug} target="_blank" rel="noreferrer">{publishedSlug}</a>
      {:else}
        <code>{publishedSlug}</code>
      {/if}
    </div>
  {/if}
</div>

<style>
  .rv { display: grid; gap: 0.9rem; max-width: 70rem; margin: 0 auto; }
  .rv-head { display: flex; align-items: end; justify-content: space-between; gap: 1rem; border-bottom: 2px solid var(--text-primary); padding-bottom: 0.55rem; }
  .rv-kicker, .rv-owner { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted); }
  h2 { margin: 0.15rem 0 0; font-family: var(--font-display); font-size: 1.35rem; }
  .rv-overall { border: 1px solid currentColor; padding: 0.25rem 0.5rem; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); }
  .rv-overall[data-state='deployed'] { color: var(--status-success, #2d7d46); }
  .rv-overall[data-state='proposed'], .rv-overall[data-state='running'] { color: var(--accent); }
  .rv-overall[data-state='failed'] { color: var(--status-error, #b43232); }
  .rv-intro, .rv-note, .rv-error { margin: 0; color: var(--text-muted); line-height: 1.5; }
  .rv-error { color: var(--status-error, #b43232); }
  .rv-chain { display: grid; gap: 0.4rem; margin: 0; padding: 0; list-style: none; }
  .rv-step { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 0.75rem; align-items: start; border: 1px solid var(--card-border); border-left: 4px solid var(--text-ghost); background: var(--card-bg); padding: 0.75rem; }
  .rv-step[data-status='passed'], .rv-step[data-status='reused_passed'] { border-left-color: var(--status-success, #2d7d46); }
  .rv-step[data-status='running'] { border-left-color: var(--accent); }
  .rv-step[data-status='failed'], .rv-step[data-status='reused_failed'] { border-left-color: var(--status-error, #b43232); }
  .rv-index { display: grid; place-items: center; width: 1.55rem; height: 1.55rem; border: 1px solid var(--card-border); font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  .rv-main { min-width: 0; display: grid; gap: 0.3rem; }
  .rv-row { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.5rem; }
  .rv-row strong { font-size: 0.95rem; }
  .rv-detail { color: var(--text-muted); line-height: 1.4; }
  code { display: block; width: fit-content; max-width: 100%; overflow-wrap: anywhere; white-space: pre-wrap; font-family: var(--font-mono); font-size: var(--fs-label); background: color-mix(in srgb, var(--text-primary) 5%, transparent); padding: 0.25rem 0.4rem; }
  .rv-result { display: grid; justify-items: end; gap: 0.2rem; white-space: nowrap; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); }
  .rv-step[data-status='passed'] .rv-result, .rv-step[data-status='reused_passed'] .rv-result { color: var(--status-success, #2d7d46); }
  .rv-step[data-status='running'] .rv-result { color: var(--accent); }
  .rv-step[data-status='failed'] .rv-result, .rv-step[data-status='reused_failed'] .rv-result { color: var(--status-error, #b43232); }
  .rv-result small { color: var(--text-ghost); letter-spacing: 0; }
  .rv-published { display: grid; gap: 0.35rem; border-top: 1px dashed var(--card-border); padding-top: 0.7rem; font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-muted); }
  .rv-published a { color: var(--accent); overflow-wrap: anywhere; }
  @media (max-width: 650px) {
    .rv-step { grid-template-columns: auto minmax(0, 1fr); }
    .rv-result { grid-column: 2; justify-items: start; }
  }
</style>
