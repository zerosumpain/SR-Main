<script lang="ts">
  // A SHARED, READ-ONLY ASSESSMENT — the same report, without a login.
  //
  // The reader here is the person the owner sent the link to: a colleague, a
  // policy lead, somebody in the room where the paper is being decided. They get
  // the assessment and nothing around it — no upload, no run log, no spend, no
  // other assessments, no controls — and the page says in as many words what it
  // is and what it leaves out, because a report that quietly omits a chapter is
  // worse than one that names the omission.
  //
  // It renders `AssessmentBody`, the same component the owner dashboard uses, so
  // the two cannot drift into different reports. What differs is what is passed
  // in: no personas, no cross-policy, no run log.
  import { onMount, tick } from 'svelte';
  import type { PageData } from './$types';
  import AssessmentBody from '$lib/components/policy-analysis/AssessmentBody.svelte';
  import { printNow, wirePrint } from '$lib/policy-analysis/print';
  import { withheldNote } from '$lib/policy-analysis/share';

  let { data }: { data: PageData } = $props();

  let selectedId = $state<string | null>(null);
  let opener: HTMLElement | null = null;

  const selected = $derived(data.artefacts.find((a) => a.id === selectedId) ?? null);
  const note = $derived(withheldNote(data.withheld));
  const fmt = (v: string | null) => (v ? new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : 'not recorded');
  const pct = (v: number | null) => (v === null ? 'unknown' : `${Math.round(v * 100)}%`);

  // Ctrl+P must get the same document the button produces.
  onMount(wirePrint);

  function inspect(id: string) {
    if (!selectedId && document.activeElement instanceof HTMLElement) opener = document.activeElement;
    selectedId = id;
    void tick().then(() => {
      const panel = document.getElementById('policy-inspector');
      panel?.scrollIntoView({ block: 'nearest' });
      panel?.focus({ preventScroll: true });
    });
  }

  function closeInspector() {
    selectedId = null;
    void tick().then(() => { opener?.focus(); opener = null; });
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && selectedId) { e.preventDefault(); closeInspector(); } }} />
<svelte:head>
  <title>{data.title} — shared policy assessment</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<p class="eyebrow">{data.jurisdiction ?? 'Jurisdiction not specified'} · {data.policyArea ?? 'Policy assessment'} · shared copy</p>
<h1>{data.title}</h1>
<p class="standfirst">
  A red-team assessment: how this policy can be beaten by the people it governs, who would do it, and what
  the evidence does and does not support. It is written to find weaknesses, not to assure the paper.
</p>

<section class="shared-note">
  <p class="sr-label">What this is</p>
  <p>
    A read-only copy, shared by its author. The assessment finished on {fmt(data.completedAt)}
    {#if data.status === 'completed_with_gaps'}and reports gaps of its own, listed below{/if}.
    Nothing on this page can be changed, and the link stops working on {fmt(data.expiresAt)}.
  </p>
  {#if note}<p class="muted">{note}</p>{/if}
  {#if data.warnings.length}
    <details>
      <summary>{data.warnings.length} thing{data.warnings.length === 1 ? '' : 's'} this assessment could not establish</summary>
      <ul class="gaps">{#each data.warnings as w, i (i)}<li><span class="muted">{w.stage}</span> {w.text}</li>{/each}</ul>
    </details>
  {/if}
  <button class="nm-save-btn" onclick={printNow}>Print or save as PDF</button>
</section>

<AssessmentBody artefacts={data.artefacts} status={data.status} {inspect} />

{#if selected}
  <aside id="policy-inspector" tabindex="-1" class="inspector" aria-label="Evidence inspector">
    <div class="toolbar">
      <strong>{selected.label}</strong>
      <button class="nm-save-btn" onclick={closeInspector}>Close</button>
    </div>
    <p class="kicker-sm">{selected.kind.replaceAll('_', ' ')} · {selected.origin.replaceAll('_', ' ')}</p>
    <p>{selected.statement}</p>
    <p class="muted">Confidence {pct(selected.confidence)} — a model or extraction judgement, not a calibrated probability.</p>
    {#if selected.page || selected.section}
      <p class="muted">{selected.page ? `Page ${selected.page}` : ''}{selected.section ? `${selected.page ? ' · ' : ''}${selected.section}` : ''}</p>
    {/if}
    {#if selected.sourceQuote}<blockquote>{selected.sourceQuote}</blockquote>{/if}
    {#if selected.url}<a href={selected.url} target="_blank" rel="noopener noreferrer">Open external source</a>{/if}
    {#if selected.refs.length}
      <p class="sr-label">What it rests on</p>
      <ul class="refs">
        {#each selected.refs as ref (ref)}
          {@const source = data.artefacts.find((a) => a.id === ref)}
          {#if source}
            <li><button class="link" onclick={() => inspect(ref)}>{source.label}</button> <span class="muted">{source.kind.replaceAll('_', ' ')}</span></li>
          {/if}
        {/each}
      </ul>
    {/if}
  </aside>
{/if}

<style>
  .standfirst { font-size: var(--fs-body-lg); color: var(--text-secondary); max-width: 60ch; }
  .shared-note { border-top: 2px solid var(--text-primary); border-bottom: 2px solid var(--text-primary); padding: 1rem 0 1.25rem; margin-top: 1.5rem; }
  .shared-note p { max-width: 72ch; }
  .sr-label { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--text-muted); margin: 0 0 .4rem; }
  .kicker-sm { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--text-muted); margin: 0 0 .3rem; }
  summary { cursor: pointer; padding: .7rem 0; font-weight: 600; }
  .gaps { padding-left: 1.25rem; margin: 0; }
  .gaps li { padding: .35rem 0; }
  .inspector {
    position: sticky; bottom: 0; margin-top: 2.5rem; background: var(--bg);
    border: 1px solid var(--line-strong); border-top: 3px solid var(--accent);
    padding: 1.1rem 1.25rem; max-height: 60vh; overflow: auto; z-index: 5;
  }
  .inspector:focus-visible { outline: 2px solid var(--accent-ink); outline-offset: -4px; }
  blockquote { border-left: 3px solid var(--accent); margin: .75rem 0; padding: .35rem 0 .35rem 1rem; color: var(--text-secondary); }
  .refs { list-style: none; padding: 0; margin: 0; display: grid; gap: .35rem; }
  .link { font: inherit; font-family: var(--font-mono); font-size: var(--fs-label); background: none; border: 0; padding: 0; color: var(--accent-ink); text-decoration: underline; cursor: pointer; text-align: left; overflow-wrap: anywhere; }
  @media print { .inspector { display: none; } }
</style>
