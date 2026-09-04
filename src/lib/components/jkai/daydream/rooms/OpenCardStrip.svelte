<script lang="ts">
  // The open card, above the form that edits it.
  //
  // The form can change the title, the brief, the kind and the priority. It
  // cannot change how the row got here — and the room's whole claim is that
  // "build history stays read-only: a form cannot pretend a failed attempt
  // never happened or mark untested work live". That sentence needed somewhere
  // to be true rather than only asserted, so the three lines on the right are
  // rendered from the row's own stamps and are not editable anywhere.
  //
  // Ink, because it is context for the form rather than another field of it.
  import { STAGE_META, type WorkItem } from '$lib/selfimprove/board';
  import { stamp } from '$lib/daydream/format';

  let { item }: { item: WorkItem } = $props();

  const meta = $derived(STAGE_META[item.stage]);

  /** How it arrived. `null` is a capability lead, which IS a channel rather
   *  than something that came through one — never a guess, never "owner". */
  const arrived = $derived(
    `proposed ${stamp(item.createdAt) || 'before the stamp existed'}${
      item.intake ? ` — ${item.intake}` : ' — a capability lead'
    }`,
  );

  /** What was tried. A ceiling of attempts with none used is "never tried",
   *  which is a different fact from "tried and passed". */
  const tried = $derived.by(() => {
    if (!item.attempts) return 'never attempted';
    const n = `attempt ${item.attempts} of ${item.attemptCeiling}`;
    return item.lastError ? `${n} — failed: ${item.lastError}` : `${n} — no error recorded`;
  });

  /** Where it stands. `stage === 'live'` is not "this shipped" — a shipped tool
   *  nothing has called maps to `verifying` — so the underlying status is named
   *  alongside the stage rather than inferred back out of it. */
  const stands = $derived(
    `${meta.label.toLowerCase()} — ${meta.question}${
      item.backlogStatus && item.backlogStatus !== 'open' ? ` · row is ${item.backlogStatus}` : ''
    }`,
  );
</script>

<div class="ocs">
  <div class="ocs-main">
    <p class="ocs-kicker">Open card · {meta.label} · {meta.question}</p>
    <h3 class="ocs-title">{item.title}</h3>
    {#if item.detail}
      <p class="ocs-brief">{item.detail}</p>
    {/if}
    {#if item.evidence.length}
      <p class="ocs-ev">Evidence: {item.evidence.join(' · ')}</p>
    {/if}
  </div>
  <div class="ocs-hist">
    <p class="ocs-hd">History · read-only</p>
    <p class="ocs-line">{arrived}</p>
    <p class="ocs-line">{tried}</p>
    <p class="ocs-line">{stands}</p>
    <p class="ocs-note">A form cannot pretend a failed attempt never happened.</p>
  </div>
</div>

<style>
  .ocs {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: 24px;
    margin-top: 12px;
    padding: 20px 22px;
    background: var(--text-primary);
    color: var(--bg);
  }
  @media (max-width: 780px) {
    .ocs {
      grid-template-columns: minmax(0, 1fr);
      gap: 18px;
    }
  }

  .ocs-kicker {
    margin: 0 0 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--accent-on-dark);
  }
  .ocs-title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 24px;
    line-height: 1.05;
    letter-spacing: -0.02em;
    color: var(--bg);
  }
  .ocs-brief {
    margin: 12px 0 0;
    padding-left: 14px;
    border-left: 2px solid rgba(232, 134, 58, 0.35);
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: rgba(237, 228, 212, 0.7);
    text-wrap: pretty;
  }
  .ocs-ev {
    margin: 12px 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.6;
    color: rgba(237, 228, 212, 0.45);
  }

  .ocs-hd {
    margin: 0 0 4px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.45);
  }
  .ocs-line {
    margin: 0;
    padding: 9px 0;
    border-top: 1px solid rgba(237, 228, 212, 0.12);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.55;
    color: rgba(237, 228, 212, 0.75);
    overflow-wrap: anywhere;
  }
  .ocs-note {
    margin: 10px 0 0;
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    color: rgba(237, 228, 212, 0.4);
    text-wrap: pretty;
  }
</style>
