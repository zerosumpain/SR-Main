<script lang="ts">
  // A SHARED, READ-ONLY ASSESSMENT — the same dashboard, without a login.
  //
  // The reader here is the person the owner sent the link to: a colleague, a
  // policy lead, somebody in the room where the paper is being decided. They are
  // by definition NOT the author, which is the reader this whole redesign is
  // pitched at — so this page needs no different tone from the owner's, only
  // less of the machinery.
  //
  // They get the assessment and nothing around it — no upload, no run log, no
  // spend, no other assessments, no controls — and the page says in as many
  // words what it is and what it leaves out, because a report that quietly omits
  // a chapter is worse than one that names the omission.
  //
  // It renders `AssessmentBody`, the same component the owner dashboard uses, so
  // the two cannot drift into different reports. What differs is what is passed
  // in: no personas, no cross-policy, no run log, no artefact provenance
  // timestamps. The drill, the hover cards and the export come with the
  // component and work here unchanged.
  import { onMount } from 'svelte';
  import type { PageData } from './$types';
  import AssessmentBody from '$lib/components/policy-analysis/AssessmentBody.svelte';
  import { printNow, wirePrint } from '$lib/policy-analysis/print';
  import { withheldNote } from '$lib/policy-analysis/share';
  import * as view from '$lib/policy-analysis/view';
  import { documentSlug } from '$lib/policy-analysis/report-doc';

  let { data }: { data: PageData } = $props();

  let exporting = $state(false);
  let exportError = $state('');

  const note = $derived(withheldNote(data.withheld));
  const plays = $derived(view.plays(data.artefacts));
  const fmt = (v: string | null) =>
    v ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'not recorded';
  /** The ledger cell is a fixed strip at display size — "10 September 2026" was truncated to an ellipsis. */
  const short = (v: string | null) =>
    v ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'not recorded';

  // Ctrl+P must get the same document the button produces.
  onMount(wirePrint);

  /**
   * Download the assessment.
   *
   * A `fetch` into a blob rather than a navigation, because a navigation to an
   * endpoint that can 400, 404 or 500 replaces the page with an error document —
   * the reader loses the tab they were on, the filters they set and the drill
   * they had open. The button says what happened instead, and the page stays.
   */
  async function exportDoc(format: 'docx' | 'md') {
    exporting = true;
    exportError = '';
    try {
      const response = await fetch(`/policy-analysis/shared/${data.token}/export?format=${format}`);
      if (!response.ok) {
        exportError = response.status === 404
          ? 'This assessment is no longer available.'
          : 'The document could not be rendered. Nothing was changed.';
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${documentSlug(data.title)}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoked on the next tick: revoking synchronously races the download in
      // Safari, which has not read the blob by the time click() returns.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      exportError = 'Connection interrupted. The document was not downloaded.';
    } finally {
      exporting = false;
    }
  }
</script>

<svelte:head>
  <title>{data.title} — shared policy assessment</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<div class="sh-lede pa-band" role="banner">
  <div class="sh-lede-inner">
    <div class="sh-copy">
      <p class="sh-eyebrow">
        {data.jurisdiction ?? 'Jurisdiction not specified'} · {data.policyArea ?? 'Policy assessment'} · shared copy
      </p>
      <h1>{data.title}</h1>
      <p class="sh-standfirst">
        A red-team assessment — how this paper can be beaten, by whom, and what the evidence does and does
        not support.
      </p>
    </div>

    <dl class="sh-ledger">
      <div>
        <dt>Completed</dt>
        <dd>{short(data.completedAt)}</dd>
        <small>{data.status === 'completed_with_gaps' ? 'with gaps of its own' : 'in full'}</small>
      </div>
      <div>
        <dt>Ways to beat it</dt>
        <dd>{plays.length}</dd>
        <small>{plays.filter((p) => p.band === 'severe' || p.band === 'significant').length} above moderate</small>
      </div>
      <div>
        <dt>Bodies profiled</dt>
        <dd>{view.of(data.artefacts, 'profile').length}</dd>
        <small>named in the paper</small>
      </div>
      <div>
        <dt>Link expires</dt>
        <dd>{short(data.expiresAt)}</dd>
        <small>read only</small>
      </div>
    </dl>
  </div>
</div>

<div class="sh-bar pa-band">
  <div class="sh-bar-inner">
  <button class="sh-btn sh-primary" disabled={exporting} onclick={() => exportDoc('docx')}>
    {exporting ? 'Rendering…' : '↓ Word (.docx)'}
  </button>
  <button class="sh-btn" onclick={printNow}>Print or save as PDF</button>
  <button class="sh-btn sh-ghost" onclick={() => exportDoc('md')}>Markdown</button>
  </div>
</div>

{#if exportError}<p class="sh-alert pa-wrap" role="alert">{exportError}</p>{/if}

<section class="sh-note pa-wrap" aria-label="What this is">
  <p class="sh-label">What this is</p>
  <p>
    A read-only copy, shared by its author. Nothing on this page can be changed, and the link stops working
    on {fmt(data.expiresAt)}.
  </p>
  {#if note}<p class="sh-muted">{note}</p>{/if}
  {#if data.warnings.length}
    <details>
      <summary>
        {data.warnings.length} thing{data.warnings.length === 1 ? '' : 's'} this assessment could not establish
      </summary>
      <ul class="sh-gaps">
        {#each data.warnings as w, i (i)}<li><span class="sh-muted">{w.stage}</span> {w.text}</li>{/each}
      </ul>
    </details>
  {/if}
</section>

<AssessmentBody artefacts={data.artefacts} status={data.status} />

<style>
  /* A BAND: ink to the window edge, content held to the measure by the
     layout's `.pa-band > *`. The negative margin it carried could only reach
     the page wrapper, so on anything wider than 1400 the masthead was a card
     floating in cream. */
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
    align-items: center;
    gap: 9px;
    padding-block: 12px;
  }
  .sh-btn {
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    background: none;
    border: 1px solid var(--line-strong);
    border-radius: 0;
    padding: 8px 13px;
    color: var(--text-primary);
    cursor: pointer;
  }
  .sh-btn:hover:not(:disabled),
  .sh-btn:focus-visible {
    border-color: var(--accent);
    color: var(--accent);
  }
  .sh-btn:disabled {
    color: var(--text-ghost);
    border-color: var(--divider);
    cursor: default;
  }
  .sh-primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }
  .sh-primary:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
    color: var(--bg);
  }
  .sh-ghost {
    border-color: transparent;
    color: var(--accent-ink);
    text-decoration: underline;
    padding-inline: 4px;
  }

  .sh-alert {
    background: var(--surface-sunken);
    border-left: 3px solid var(--accent);
    padding: 11px 14px;
    margin: 14px 0 0;
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
