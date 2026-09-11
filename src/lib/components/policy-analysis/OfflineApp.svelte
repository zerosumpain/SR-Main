<script lang="ts">
  // THE ASSESSMENT, WITH NO SITE UNDER IT.
  //
  // It lives in `$lib/components` rather than beside the rest of the offline
  // pack because it is a Svelte component, and `$lib/policy-analysis` is a
  // DOMAIN module — the boundary gate forbids one importing upward into ui, and
  // it is right to: a feature module that reaches for a component has put the
  // rendering in the wrong place. The pack's pure parts (payload, html,
  // download) stay in the domain module; this and `offline-entry.ts` are its ui.
  //
  // This is the shared page's shell with the network taken out. It renders
  // `AssessmentBody` — the same component the owner dashboard and the share link
  // both render — so an offline pack cannot become a third, quietly different
  // report. What it drops is everything that needs a server: the polling, the
  // controls, the run log, the share management, and the two export buttons,
  // because the Word and markdown copies are already files sitting next to this
  // one in the pack.
  //
  // Print stays. It is the one export a file:// page can still perform, and the
  // print rules were measured rather than assumed — see the chrome block at the
  // end of `src/app.css`.
  import { onMount } from 'svelte';
  import AssessmentBody from './AssessmentBody.svelte';
  import { printNow, wirePrint } from '$lib/policy-analysis/print';
  import { withheldNote } from '$lib/policy-analysis/share';
  import * as view from '$lib/policy-analysis/view';
  import type { OfflinePayload } from '$lib/policy-analysis/offline/payload';

  let { payload }: { payload: OfflinePayload } = $props();

  const note = $derived(withheldNote(payload.withheld));
  const plays = $derived(view.plays(payload.artefacts));
  const severe = $derived(plays.filter((p) => p.band === 'severe' || p.band === 'significant').length);

  const fmt = (v: string | null) =>
    v ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'not recorded';
  /** The ledger cell is a fixed strip at display size — "10 September 2026" truncates to an ellipsis. */
  const short = (v: string | null) =>
    v ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'not recorded';

  // Ctrl+P must get the same document the button produces.
  onMount(wirePrint);
</script>

<div class="sh-lede pa-band" role="banner">
  <div class="sh-lede-inner">
    <div class="sh-copy">
      <p class="sh-eyebrow">
        {payload.jurisdiction ?? 'Jurisdiction not specified'} · {payload.policyArea ?? 'Policy assessment'} · offline pack
      </p>
      <h1>{payload.title}</h1>
      <p class="sh-standfirst">
        A red-team assessment — how this paper can be beaten, by whom, and what the evidence does and does
        not support. This copy runs from the file itself and asks nothing of the network.
      </p>
    </div>

    <dl class="sh-ledger">
      <div>
        <dt>Completed</dt>
        <dd>{short(payload.completedAt)}</dd>
        <small>{payload.status === 'completed_with_gaps' ? 'with gaps of its own' : 'in full'}</small>
      </div>
      <div>
        <dt>Ways to beat it</dt>
        <dd>{plays.length}</dd>
        <small>{severe} above moderate</small>
      </div>
      <div>
        <dt>Bodies profiled</dt>
        <dd>{view.of(payload.artefacts, 'profile').length}</dd>
        <small>named in the paper</small>
      </div>
      <div>
        <dt>Pack made</dt>
        <dd>{short(payload.generatedAt)}</dd>
        <small>offline copy</small>
      </div>
    </dl>
  </div>
</div>

<div class="sh-bar pa-band">
  <div class="sh-bar-inner">
    <div class="sh-cluster">
      <p class="sh-cluster-label">Take it away</p>
      <div class="sh-btns">
        <button class="sh-btn sh-primary" onclick={printNow}>Print / PDF</button>
      </div>
    </div>
    <p class="sh-hint">
      <code>report.docx</code> and <code>report.md</code> are in the same folder as this file.
    </p>
  </div>
</div>

<section class="sh-note pa-wrap" aria-label="What this is">
  <p class="sh-label">What this is</p>
  <p>
    A self-contained copy of a policy assessment, made on {fmt(payload.generatedAt)}. Everything it draws is
    inside this file — there is nothing to load, and it will read the same on a train, on a locked-down
    laptop, or in five years.
  </p>
  {#if note}<p class="sh-muted">{note}</p>{/if}
  {#if payload.documentSha256}
    <p class="sh-muted">
      Source document SHA-256 <code>{payload.documentSha256}</code>
    </p>
  {/if}
  {#if payload.warnings.length}
    <details>
      <summary>
        {payload.warnings.length} thing{payload.warnings.length === 1 ? '' : 's'} this assessment could not establish
      </summary>
      <ul class="sh-gaps">
        {#each payload.warnings as w, i (i)}<li><span class="sh-muted">{w.stage}</span> {w.text}</li>{/each}
      </ul>
    </details>
  {/if}
</section>

<AssessmentBody artefacts={payload.artefacts} status={payload.status} sealed={payload.sealed} />

<style>
  /* A BAND: ink to the window edge, content held to the measure by the chrome's
     `.pa-band > *`. Lifted from the shared page, which is this page's twin. */
  .sh-lede {
    padding-block: clamp(26px, 3.4vw, 46px);
    background: var(--text-primary);
    color: var(--bg);
    border-bottom: 1px solid rgba(237, 228, 212, 0.16);
  }
  .sh-lede-inner {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(360px, 0.85fr);
    align-items: end;
    gap: clamp(28px, 5vw, 64px);
  }
  .sh-copy {
    min-width: 0;
  }
  .sh-eyebrow {
    margin: 0 0 12px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label-wide);
    text-transform: uppercase;
    color: var(--accent-on-dark);
  }
  .sh-lede h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(2rem, 4.2vw, 4rem);
    font-weight: 900;
    line-height: 0.94;
    letter-spacing: -0.03em;
    color: var(--bg);
    overflow-wrap: anywhere;
    text-wrap: balance;
  }
  .sh-standfirst {
    margin: 15px 0 0;
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: rgba(237, 228, 212, 0.72);
    max-width: 56ch;
  }
  .sh-ledger {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin: 0;
    border-top: 1px solid rgba(237, 228, 212, 0.16);
    border-left: 1px solid rgba(237, 228, 212, 0.16);
  }
  .sh-ledger > div {
    min-width: 0;
    padding: 12px 14px;
    border-right: 1px solid rgba(237, 228, 212, 0.16);
    border-bottom: 1px solid rgba(237, 228, 212, 0.16);
    background: rgba(237, 228, 212, 0.04);
  }
  .sh-ledger dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label-wide);
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.52);
  }
  .sh-ledger dd {
    margin: 7px 0 4px;
    overflow: hidden;
    font-family: var(--font-display);
    font-size: clamp(1.2rem, 1.8vw, 1.7rem);
    line-height: 0.98;
    letter-spacing: -0.025em;
    text-transform: uppercase;
    color: var(--bg);
    text-overflow: ellipsis;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .sh-ledger small {
    display: block;
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.3;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--accent-on-dark);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sh-bar {
    border-bottom: 1px solid var(--line-strong);
  }
  .sh-bar-inner {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 14px clamp(20px, 3vw, 40px);
    padding-block: 12px;
  }
  .sh-cluster {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .sh-cluster-label {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .sh-btns {
    display: flex;
    flex-wrap: wrap;
  }
  /* A ground, not a hairline on cream — see the owner page's note. */
  .sh-btn {
    font: inherit;
    position: relative;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    background: var(--surface-elevated);
    border: 1px solid var(--line-strong);
    border-radius: 0;
    padding: 8px 13px;
    color: var(--text-primary);
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.12s ease-out, border-color 0.12s ease-out, color 0.12s ease-out;
  }
  .sh-primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }
  .sh-primary:hover {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
    color: var(--bg);
  }
  .sh-hint {
    margin: 0;
    font-size: var(--fs-label);
    color: var(--text-muted);
  }
  .sh-hint code,
  .sh-note code {
    font-family: var(--font-code);
    font-size: max(0.92em, var(--fs-label-xs));
    overflow-wrap: anywhere;
  }

  .sh-note {
    border-bottom: 2px solid var(--text-primary);
    padding: 16px 0 18px;
  }
  .sh-note p {
    max-width: 76ch;
  }
  .sh-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0 0 8px;
  }
  .sh-muted {
    color: var(--text-muted);
    font-size: var(--fs-label);
    line-height: 1.55;
  }
  .sh-gaps {
    padding-left: 20px;
    margin: 0;
  }
  .sh-gaps li {
    padding: 6px 0;
  }
  summary {
    cursor: pointer;
    padding: 11px 0;
    font-weight: 600;
  }

  @media (max-width: 1000px) {
    .sh-lede-inner {
      grid-template-columns: minmax(0, 1fr);
      gap: 26px;
    }
    .sh-ledger {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }
  @media (max-width: 720px) {
    .sh-ledger {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media print {
    .sh-lede {
      padding: 0 0 12pt;
      background: #fff !important;
      color: #000;
      border-bottom: 2px solid #000;
    }
    .sh-lede h1,
    .sh-ledger dd,
    .sh-eyebrow,
    .sh-ledger small {
      color: #000;
    }
    .sh-standfirst,
    .sh-ledger dt {
      color: #333;
    }
    .sh-ledger > div {
      background: none;
      border-color: #999;
    }
    .sh-ledger {
      border-color: #999;
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .sh-bar {
      display: none !important;
    }
  }
</style>
