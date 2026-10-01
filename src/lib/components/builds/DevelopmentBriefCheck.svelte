<script lang="ts">
  // The brief check, shown above the brief it judged: which lane the ask
  // belongs in, and what would stop a reviewer confirming the criteria. A
  // finding blocks acceptance until it is fixed or explicitly overridden, and
  // the two overrides are separate controls because they are separate
  // decisions (`briefAcceptanceBlocker`). When the lane is not the site, the
  // existing way to commission it in the right lane is offered here — the
  // Studio and app endpoints, or the other repository's issue tracker — rather
  // than a new lane.
  import type { BriefLint } from '$lib/constants/development';
  let {
    lint, ask, title, busy, revision, oncommissioned,
    overrideLane = $bindable(false), overrideLint = $bindable(false),
  }: { lint: BriefLint; ask: string; title: string; busy: boolean; revision: number; overrideLane?: boolean; overrideLint?: boolean;
    oncommissioned?: (label: string, href: string) => void } = $props();

  const LANE_LABEL = { site: 'The site', studio: 'Studio', 'other-repo': 'Another repository' } as const;
  const blocking = $derived(lint.findings.filter((f) => f.severity === 'block' && f.kind !== 'lane'));
  const warnings = $derived(lint.findings.filter((f) => f.severity === 'warn'));
  const stale = $derived(lint.revision !== revision);
  const issueUrl = $derived(lint.lane.repo && /^[\w.-]+\/[\w.-]+$/.test(lint.lane.repo)
    ? `https://github.com/${lint.lane.repo}/issues/new?${new URLSearchParams({ title: title.slice(0, 200), body: ask.slice(0, 6000) })}`
    : null);

  let commissioning = $state(false);
  let commissioned = $state<{ label: string; href: string } | null>(null);
  let failure = $state('');
  async function commission(kind: 'studio' | 'app') {
    commissioning = true; failure = '';
    try {
      // The original ask, not the groomed brief: the brief was shaped for a
      // site change, and Studio grooms its own research brief from the ask.
      const response = kind === 'studio'
        ? await fetch('/api/jkai/studio', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challenge: ask.slice(0, 4000), title: title.slice(0, 200) }) })
        : await fetch('/api/jkai/builds', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: ask.slice(0, 20000), title: title.slice(0, 200) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'The build could not be started.');
      const id = result.buildId ?? result.id;
      commissioned = { label: kind === 'studio' ? 'Studio explainer' : 'standalone app', href: result.url ?? `/jkai/builds/${id}` };
      oncommissioned?.(commissioned.label, commissioned.href);
    } catch (e) { failure = e instanceof Error ? e.message : 'The build could not be started.'; }
    finally { commissioning = false; }
  }
</script>

<section class="bc" class:bc-bad={lint.lane.lane !== 'site' || blocking.length > 0} aria-label="Brief check">
  <div class="bc-head">
    <p class="bc-eyebrow">Brief check</p>
    <span class="bc-stamp">Revision {lint.revision}{stale ? ' · checked before your last edit' : ''} · {new Date(lint.at).toLocaleString()}{lint.judged ? ` · criteria read by ${lint.judged.model}` : ''}</span>
  </div>

  <div class="bc-lane">
    <p class="bc-label">Lane</p>
    <p class="bc-lane-value" class:off={lint.lane.lane !== 'site'}>{LANE_LABEL[lint.lane.lane]}{lint.lane.repo ? ` · ${lint.lane.repo}` : ''}</p>
    <p class="bc-reason">{lint.lane.reason}<span class="bc-stamp"> · {lint.lane.source === 'rule' ? 'from the route registry' : lint.lane.source === 'grooming' ? 'proposed when the brief was groomed' : 'not checked'}</span></p>
  </div>

  {#if lint.lane.lane !== 'site'}
    <div class="bc-elsewhere">
      {#if lint.lane.lane === 'studio'}
        <p class="bc-text">This development lane changes SR-Main. A standalone explainer, toy or app is built in its own sandbox and published under /projects instead.</p>
        {#if commissioned}
          <p class="bc-text">Started as a {commissioned.label}. <a class="bc-link" href={commissioned.href}>Follow the build →</a></p>
        {:else}
          <div class="bc-actions">
            <button class="bc-run" disabled={busy || commissioning} onclick={() => commission('studio')}>{commissioning ? 'Starting…' : 'Build as a Studio explainer'}</button>
            <button class="bc-ghost" disabled={busy || commissioning} onclick={() => commission('app')}>Build as a standalone app</button>
          </div>
        {/if}
      {:else}
        <p class="bc-text">This development lane only changes SR-Main, so it cannot build this. Ask for it where it lives.</p>
        {#if issueUrl}<a class="bc-link" href={issueUrl} target="_blank" rel="noopener noreferrer">Open an issue in {lint.lane.repo} ↗</a>{/if}
      {/if}
      {#if failure}<p class="bc-error" role="alert">{failure}</p>{/if}
      <label class="bc-override"><input type="checkbox" bind:checked={overrideLane} disabled={busy} /> It belongs on the site anyway — accept it in this lane</label>
    </div>
  {/if}

  {#if blocking.length || warnings.length}
    <ul class="bc-findings">
      {#each [...blocking, ...warnings] as finding, index (index)}
        <li class:warn={finding.severity === 'warn'}>
          <span class="bc-kind">{finding.severity === 'block' ? 'Blocks' : 'Check'} · {finding.kind === 'preview' ? 'preview data' : finding.kind}{finding.source === 'model' ? ' · reviewer model' : ''}</span>
          {#if finding.subject}<span class="bc-subject">{finding.subject}</span>{/if}
          <span>{finding.message}</span>
        </li>
      {/each}
    </ul>
    {#if blocking.length}
      <label class="bc-override"><input type="checkbox" bind:checked={overrideLint} disabled={busy} /> Accept despite {blocking.length === 1 ? 'this problem' : `these ${blocking.length} problems`}</label>
    {/if}
  {:else if lint.lane.lane === 'site'}
    <p class="bc-text">Every target route exists or is proposed as new, and every criterion names something a reviewer can see in the preview or the diff.</p>
  {/if}
  {#if !lint.routesChecked}<p class="bc-stamp">No route manifest was available, so target routes were not checked. An unattended run will not accept this brief by itself.</p>{/if}
</section>

<style>
  .bc {
    border-left: 3px solid var(--accent-ink);
    background: var(--surface-sunken);
    padding: 16px 20px;
    margin: 0 0 22px;
    font-size: var(--fs-nav);
    line-height: 1.5;
  }
  .bc.bc-bad { border-left-color: var(--error); }
  .bc-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px 16px; align-items: baseline; }
  .bc-eyebrow,
  .bc-label,
  .bc-kind {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0 0 8px;
  }
  .bc-stamp {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .bc-lane { margin: 10px 0 0; }
  .bc-label { margin: 0 0 4px; }
  .bc-lane-value { font-weight: 600; margin: 0; color: var(--accent-ink); }
  .bc-lane-value.off { color: var(--error); }
  .bc-reason,
  .bc-text { color: var(--text-secondary); margin: 4px 0 10px; max-width: 82ch; overflow-wrap: anywhere; }
  .bc-elsewhere { border-top: 1px solid var(--line-strong); padding-top: 12px; margin-top: 4px; }
  .bc-actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 0 0 12px; }
  .bc-run,
  .bc-ghost {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 8px 15px;
    border-radius: 0;
    cursor: pointer;
  }
  .bc-run { color: var(--bg); background: var(--accent); border: 1px solid var(--accent); }
  .bc-run:hover:not(:disabled) { background: var(--accent-hover); border-color: var(--accent-hover); }
  .bc-ghost { color: var(--text-primary); background: transparent; border: 1px solid var(--line-strong); }
  .bc-ghost:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .bc-run:disabled,
  .bc-ghost:disabled { opacity: 0.45; cursor: default; }
  .bc-link { color: var(--accent-ink); display: inline-block; margin: 0 0 12px; }
  .bc-error { color: var(--error); margin: 0 0 10px; }
  .bc-override { display: flex; gap: 8px; align-items: center; color: var(--text-primary); margin: 6px 0 0; cursor: pointer; }
  .bc-findings { list-style: none; padding: 0; margin: 14px 0 6px; border-top: 1px solid var(--line-strong); }
  .bc-findings li {
    display: grid;
    gap: 2px;
    padding: 10px 0 10px 12px;
    border-bottom: 1px solid var(--line-strong);
    border-left: 2px solid var(--error);
    margin-top: 6px;
    overflow-wrap: anywhere;
  }
  .bc-findings li.warn { border-left-color: var(--warn); }
  .bc-kind { margin: 0; }
  .bc-subject { font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-primary); }
</style>
