<script lang="ts">
  import { onMount } from 'svelte';
  import { featurePreviewUrl } from '$lib/builds/development-progress';
  import { previewAccess } from '$lib/builds/preview-access';
  import type { DeliveryState } from '$lib/constants/development';

  let { delivery, busy, pending = false, running, canInspect, prepare, close }: {
    delivery: DeliveryState; busy: boolean; pending?: boolean; running: boolean; canInspect: boolean;
    prepare: () => void; close: () => void;
  } = $props();
  let route = $state('');
  let phone = $state(false);
  let reload = $state(0);
  let now = $state(Date.now());
  let remote = $state(false);
  const access = $derived(previewAccess(delivery.preview.url, now));
  const starting = $derived(pending || delivery.preview.status === 'starting');
  const inaccessible = $derived(access.loopback && remote);
  const usable = $derived(!!delivery.preview.url && !access.expired && !inaccessible && ['ready', 'starting'].includes(delivery.preview.status));
  const chosen = $derived(delivery.brief.routes.includes(route) ? route : delivery.brief.routes[0] ?? '/');
  const href = $derived(usable ? featurePreviewUrl(delivery.preview.url, chosen) : null);
  const canPrepare = $derived(!busy && !running && !starting && (!!delivery.candidate || canInspect));
  const title = $derived(starting ? 'Preparing your preview' : access.expired ? 'Refresh access to your preview' : inaccessible ? 'This preview needs a reachable address' : delivery.preview.lastError || delivery.preview.status === 'failed' ? usable ? 'Previous preview retained' : 'The preview needs attention' : usable ? 'Your preview is ready to try' : 'Prepare a preview to try your build');
  const reason = $derived(starting ? 'This can take several minutes. Progress is saved; you can leave this page and return.' : access.expired ? 'The eight-hour access link has expired. Your build and saved feedback are still here. Prepare it again to get a fresh link.' : inaccessible ? 'This link points to the build host’s loopback address. It cannot open on this device. Configure the preview gateway or forward the port, then reopen the workspace.' : usable ? 'Try the feature below, then record what worked and what needs changing.' : running ? 'The worker is building. A working preview appears after its checks pass. Pause to inspect saved work manually.' : !delivery.candidate && !canInspect ? 'Build the first version from your accepted brief. Its saved work will appear here for testing.' : 'Open a saved version of the feature before assessing it. Preparation keeps the last working preview available.');
  onMount(() => {
    remote = !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    const timer = setInterval(() => now = Date.now(), 1000);
    return () => clearInterval(timer);
  });
</script>

<section class="preview-desk" aria-label="Test your build">
  <div class="preview-status" aria-live="polite" aria-busy={starting}>
    <div><p class="eyebrow">{starting ? 'Preparing' : access.expired ? 'Access expired' : usable ? 'Ready to test' : 'Preview setup'}</p><h2>{title}</h2><p>{reason}</p></div>
    <button class:primary={!usable || delivery.preview.revision !== delivery.candidate} disabled={!canPrepare} onclick={prepare}>{starting ? 'Preparing preview…' : access.expired ? 'Refresh preview access' : delivery.preview.lastError || delivery.preview.status === 'failed' ? 'Retry preview' : delivery.preview.url ? 'Prepare latest preview' : 'Prepare preview'}</button>
  </div>
  {#if running && !starting && delivery.preview.url}<p class="hint">Pause the build before preparing another preview. You can keep testing the available version.</p>{/if}
  {#if delivery.preview.lastError}
    <details class="failure" open={!usable}><summary>Why the last preview attempt failed</summary><pre>{delivery.preview.lastError}</pre><p>Retry preparation after resolving the issue, or return to Build to ask for a fix.</p></details>
  {/if}
  {#if starting || delivery.preview.status === 'failed'}<p class="hint" role="status">{delivery.preview.detail}</p>{/if}

  {#if href}
    <div class="preview-toolbar">
      <label>Page to test<select aria-label="Page to test" value={chosen} onchange={(event) => route = event.currentTarget.value}>
        {#each delivery.brief.routes.length ? delivery.brief.routes : ['/'] as path}<option value={path}>{path}</option>{/each}
      </select></label>
      <div class="devices" aria-label="Preview width"><button aria-pressed={!phone} onclick={() => phone = false}>Desktop</button><button aria-pressed={phone} onclick={() => phone = true}>Phone</button></div>
      <button onclick={() => reload++}>Reload preview</button>
      <a href={href} target="_blank" rel="noopener noreferrer">Open in new tab ↗</a>
    </div>
    <div class="test-layout">
      <div class="preview-stage">
        <div class="frame" class:phone>{#key `${href}:${reload}`}<iframe title="Isolated feature preview" src={href} sandbox="allow-scripts allow-forms allow-same-origin allow-downloads"></iframe>{/key}</div>
      </div>
      <aside class="test-list">
        <p class="eyebrow">While you try it</p><h3>Check the brief</h3>
        <ol>{#each delivery.criteria as criterion}<li>{criterion.text}</li>{:else}<li>Return to Brief to define what this feature should do.</li>{/each}</ol>
        <p>Try the main action, change an input, then check the result at phone width.</p>
        <a href="#preview-evidence">Record your results ↓</a>
      </aside>
    </div>
    <div class="preview-caption">
      <span>{delivery.preview.kind === 'release' ? 'Release candidate' : delivery.preview.kind === 'working' ? 'Working preview' : 'Inspection preview'} · <code>{delivery.preview.revision?.slice(0, 12) ?? 'unversioned'}</code>{delivery.preview.revision !== delivery.candidate ? ' · a newer version is waiting' : ''}</span>
      <button disabled={busy || running || starting} onclick={close}>Close preview</button>
    </div>
    <p class="hint">If the embedded page cannot open, try a new tab or prepare the preview again. Saved status does not guarantee that its server is still available.</p>
  {/if}
  {#if delivery.preview.evidence?.length}<details class="checks"><summary>Automated browser checks</summary>{#each delivery.preview.evidence as evidence}<p>{evidence}</p>{/each}</details>{/if}
</section>

<style>
  .preview-desk { min-width: 0; }
  .preview-status { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 20px 22px; border-left: 3px solid var(--accent); background: var(--surface-sunken); }
  .eyebrow { font: var(--fs-label-xs) var(--font-mono); letter-spacing: .13em; text-transform: uppercase; color: var(--accent-ink); margin: 0 0 8px; }
  h2, h3 { font-family: var(--font-display); font-size: var(--fs-body-lg); line-height: 1.2; margin: 0 0 8px; }
  p { font-size: var(--fs-nav); line-height: 1.5; margin: 8px 0 0; max-width: 82ch; }
  button, a { font-size: var(--fs-label); }
  button { min-height: 40px; padding: 9px 13px; background: transparent; border: 1px solid var(--line-strong); color: var(--text-primary); cursor: pointer; }
  button:hover:not(:disabled) { border-color: var(--accent); }
  .primary { flex-shrink: 0; background: var(--accent); border-color: var(--accent); color: var(--bg); }
  button:disabled { opacity: .5; cursor: default; }
  a { color: var(--accent-ink); text-underline-offset: 3px; }
  .hint { color: var(--text-secondary); margin: 12px 0; }
  .preview-toolbar { display: flex; align-items: end; flex-wrap: wrap; gap: 12px; padding: 18px 0; }
  label { display: grid; gap: 6px; min-width: 0; flex: 1; font-size: var(--fs-label); }
  select { width: 100%; min-width: 0; min-height: 42px; border: 1px solid var(--line-strong); padding: 8px 10px; background: var(--surface-elevated); color: var(--text-primary); font: var(--fs-body) var(--font-body); }
  .devices { display: flex; }
  .devices button + button { border-left: 0; }
  button[aria-pressed='true'] { background: var(--text-primary); color: var(--bg); }
  .preview-toolbar a { padding: 12px 0; }
  .test-layout { display: grid; grid-template-columns: minmax(0, 1fr) 270px; border: 1px solid var(--line-strong); }
  .preview-stage { min-width: 0; background: var(--surface-rail); }
  .frame { height: clamp(440px, 65vh, 760px); width: 100%; background: var(--bg); margin: 0 auto; }
  .frame.phone { max-width: 390px; border-inline: 1px solid var(--line-strong); }
  iframe { width: 100%; height: 100%; border: 0; display: block; }
  .test-list { padding: 20px; border-left: 1px solid var(--line-strong); overflow-wrap: anywhere; }
  ol { padding-left: 20px; margin: 18px 0; font-size: var(--fs-nav); line-height: 1.5; }
  li { padding-left: 4px; margin: 12px 0; }
  .test-list a { display: inline-block; margin-top: 16px; }
  .preview-caption { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin: 12px 0; font-size: var(--fs-label); color: var(--text-secondary); }
  code, pre { font-family: var(--font-code); }
  details { padding: 14px 0; border-bottom: 1px solid var(--line); font-size: var(--fs-nav); }
  summary { cursor: pointer; }
  .failure { color: var(--error); }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--fs-label); }
  .checks p { white-space: pre-wrap; overflow-wrap: anywhere; }
  :is(button, a, select, summary):focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  @media (max-width: 1000px) { .test-layout { grid-template-columns: minmax(0, 1fr); } .test-list { border-left: 0; border-top: 1px solid var(--line-strong); } }
  @media (max-width: 600px) { .preview-status { flex-direction: column; align-items: stretch; padding: 16px; } .preview-toolbar label { flex-basis: 100%; } .frame { height: 550px; } }
</style>
