<script lang="ts">
  /**
   * A question as a sticky note: one line, why it is asked, the answers as
   * chips (the one the plan already assumes is marked), "You decide", and what
   * happens if you skip it. A deadline (a booking) is written in the corner.
   * Tapping an answer re-solves the plan on the server and the rail shows
   * What changed, with Undo. Never blocking: skipping is always fine.
   */
  import type { Question } from '$lib/trips/decisions';
  import type { DecisionDesk } from '$lib/trips/decisions-desk.svelte';
  import { deadlineText } from '$lib/trips/decisions-view';

  let {
    q,
    desk,
    today,
    tilt = -1.2,
    onSettled,
  }: {
    q: Question;
    desk: DecisionDesk;
    today: string;
    tilt?: number;
    /** After it is skipped (no What changed takes focus), so the list can keep focus. */
    onSettled?: () => void;
  } = $props();
  async function skip() {
    if (await desk.answer(q, 'skip')) onSettled?.();
  }

  const key = $derived(`q:${q.id}`);
  const working = $derived(desk.busy === key);
  const deadline = $derived(deadlineText(q.deadline, today));
  const assumed = $derived(q.answers.find((a) => a.id === q.defaultAnswerId) ?? null);
  const votes = $derived(Object.entries(q.votes ?? {}).filter(([, names]) => names.length));
  const AUDIENCE: Record<Question['audience'], string> = { owner: 'For you', parents: 'For the parents', family: 'For the whole family' };
</script>

<article class="qc np-sticky" style:--np-tilt="{tilt}deg" aria-labelledby="qc-{q.id}" aria-busy={working}>
  <header class="qc-hd">
    <span class="qc-k">{AUDIENCE[q.audience]}</span>
    {#if deadline}<span class="qc-due" class:urgent={deadline.urgent}>{deadline.text}</span>{/if}
  </header>
  <h4 id="qc-{q.id}" class="qc-prompt">{q.prompt}</h4>
  {#if q.why}<p class="qc-why">{q.why}</p>{/if}

  <div class="qc-answers" role="group" aria-label="Answers">
    {#each q.answers as a (a.id)}
      <button class="qc-chip" type="button" disabled={!!desk.busy} aria-describedby={a.summary ? `qs-${q.id}-${a.id}` : undefined} onclick={() => desk.answer(q, 'answer', a.id)}>
        {a.label}{#if q.appliedDefault && a.id === q.defaultAnswerId}<span class="qc-now">{' · in the plan now'}</span>{/if}
      </button>
      {#if a.summary}<span id="qs-{q.id}-{a.id}" class="dx-vh">{a.summary}</span>{/if}
    {/each}
    <button class="qc-chip decide" type="button" disabled={!!desk.busy} onclick={() => desk.answer(q, 'decide')}>You decide</button>
  </div>

  {#if q.ifSkipped || assumed}
    <p class="qc-skip">If you skip: {q.ifSkipped ?? assumed?.label}
      <button class="qc-link" type="button" disabled={!!desk.busy} onclick={skip}>Skip for now</button>
    </p>
  {/if}
  {#if votes.length}
    <p class="qc-votes">{#each votes as [aid, names], vi (aid)}{vi ? ' · ' : ''}{names.join(', ')}: {q.answers.find((a) => a.id === aid)?.label ?? 'an answer'}{/each}</p>
  {/if}
  {#if working}<p class="qc-note" role="status">Re-planning with that answer…</p>{/if}
  {#if desk.problem?.where === key}<p class="qc-err" role="alert">{desk.problem.text}</p>{/if}
</article>

<style>
  /* The sticky note keeps its own inks in every theme (notes-paper.css). */
  .qc {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 14px 16px 14px;
    box-shadow: 0 10px 20px -16px rgba(26, 16, 8, 0.45);
  }
  .qc-hd {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 4px 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #5a4632;
  }
  .qc-due {
    letter-spacing: 0.04em;
    text-transform: none;
    padding: 0 6px;
    border: 1px solid rgba(26, 16, 8, 0.35);
    border-radius: 100px;
  }
  .qc-due.urgent {
    border-color: #8a3c06;
    color: #8a3c06;
    font-weight: 600;
  }
  .qc-prompt {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 17px;
    line-height: 1.3;
    color: #1a1008;
  }
  .qc-why {
    margin: 0;
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: 15px;
    line-height: 22px;
    color: #5a4632;
  }
  .qc-answers {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 2px;
  }
  .qc-chip {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.4;
    padding: 5px 11px;
    border: 1px solid rgba(26, 16, 8, 0.45);
    border-radius: 100px;
    background: rgba(255, 250, 240, 0.55);
    color: #1a1008;
    cursor: pointer;
    text-align: left;
  }
  .qc-chip:hover:not(:disabled) {
    background: rgba(255, 250, 240, 0.9);
    border-color: #1a1008;
  }
  .qc-chip:focus-visible,
  .qc-link:focus-visible {
    outline: 2px solid #0e5b66;
    outline-offset: 2px;
  }
  .qc-chip.decide {
    border-style: dashed;
    background: transparent;
  }
  .qc-chip:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .qc-now {
    color: #8a3c06;
  }
  .qc-skip,
  .qc-votes,
  .qc-note {
    margin: 0;
    font-size: var(--fs-label);
    line-height: 1.45;
    color: #5a4632;
  }
  .qc-link {
    margin-left: 6px;
    padding: 0;
    border: 0;
    background: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: #8a3c06;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .qc-err {
    margin: 0;
    font-size: var(--fs-label);
    color: #9e1f1f;
  }
</style>
