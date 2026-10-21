<script lang="ts">
  /**
   * The Decisions rail on a trip: what just changed (with Undo), the quick
   * questions as sticky notes (at most three), the open proposals as groups
   * of index cards, and where the research stands. Beside the plan on a wide
   * sheet, above the days on a phone. Everything here is answered in place.
   */
  import { tick } from 'svelte';
  import { api, errorText } from '$lib/trips/decisions-client';
  import type { PackSummary, Proposal, Question } from '$lib/trips/decisions';
  import type { ProposalGroupView } from '$lib/trips/decisions-view';
  import type { DecisionDesk } from '$lib/trips/decisions-desk.svelte';
  import ChangeLedger from './ChangeLedger.svelte';
  import ProposalGroup from './ProposalGroup.svelte';
  import QuestionCard from './QuestionCard.svelte';

  let {
    questions,
    answered = [],
    groups,
    pack,
    desk,
    today,
    previewId = null,
    onPreview,
    placesHref,
    shapesOpen = 0,
    questionPushes = true,
  }: {
    questions: Question[];
    answered?: Question[];
    groups: ProposalGroupView[];
    pack: PackSummary;
    desk: DecisionDesk;
    today: string;
    previewId?: string | null;
    onPreview?: (p: Proposal | null) => void;
    placesHref: string;
    /** Trip shapes waiting above the plan (they are drawn there, big). */
    shapesOpen?: number;
    /** v8.1: whether the owner gets this trip's question notifications on the phone. */
    questionPushes?: boolean;
  } = $props();

  // v8.1: question notifications for this trip, on or off (the owner's own).
  // The page's value until this rail changes it; a reload brings the server's.
  let pushesSet = $state<boolean | null>(null);
  const pushesOn = $derived(pushesSet ?? questionPushes ?? true);
  let pushesBusy = $state(false);
  async function togglePushes() {
    pushesBusy = true;
    const r = await api<{ on: boolean }>('PUT', `${desk.base}/question-pushes`, { on: !pushesOn });
    pushesBusy = false;
    if (r.ok) pushesSet = r.body.on;
  }

  const open = $derived(questions.length + groups.reduce((n, g) => n + g.proposals.length, 0));
  /** Keep the keyboard in the rail when a card leaves without a What changed. */
  function refocus() {
    void tick().then(() => (document.getElementById('dr-q') ?? document.getElementById('dr-h'))?.focus());
  }
  const TILTS = [-1.4, 0.9, -0.6];

  let packNote = $state<string | null>(null);
  let packBusy = $state(false);
  async function buildPack() {
    packBusy = true;
    packNote = null;
    const r = await api('POST', `${desk.base}/pack`, { action: 'build', async: true });
    packBusy = false;
    packNote = r.ok ? 'Started. It carries on if you leave; this page updates when it is done.' : errorText(r);
  }
</script>

<div class="dr">
  <header class="dr-hd">
    <h2 id="dr-h" class="dr-h" tabindex="-1">Decisions</h2>
    <span class="dr-n">{open ? `${open} open` : 'none open'}</span>
    <button type="button" class="dr-push" aria-pressed={pushesOn} disabled={pushesBusy} onclick={togglePushes} title="Quick questions for this trip, as notifications on your phone (at most one a day)">
      {pushesOn ? 'Notify me: on' : 'Notify me: off'}
    </button>
  </header>

  {#if desk.problem && desk.problem.where === null}<p class="dx-err" role="alert">{desk.problem.text}</p>{/if}
  {#if desk.note && desk.note.where === null}<p class="dx-note" role="status">{desk.note.text}</p>{/if}

  {#if desk.change}
    <ChangeLedger card={desk.change} {desk} />
  {/if}

  {#if questions.length}
    <section class="dr-sec" aria-labelledby="dr-q">
      <h3 id="dr-q" class="dx-k dr-qh" tabindex="-1">Quick questions</h3>
      <p class="dx-aside dr-sub">Each one changes the plan. Skipping is fine — each card says what happens if you do.</p>
      <div class="dr-qs">
        {#each questions as q, qi (q.id)}<QuestionCard {q} {desk} {today} tilt={TILTS[qi % TILTS.length]} onSettled={refocus} />{/each}
      </div>
    </section>
  {/if}

  {#each groups as g (g.groupId)}
    <ProposalGroup heading={g.heading} groupId={g.groupId} proposals={g.proposals} {desk} {previewId} {onPreview} />
  {/each}

  {#if !open}
    <p class="dx-aside dr-empty">
      {shapesOpen ? 'Choose one of the ways to do the trip above first.' : 'Nothing to decide just now. Use Swap or Fill on the plan, or tell the planner what you’d like.'}
    </p>
  {/if}

  <section class="dr-pack" aria-labelledby="dr-p">
    <h3 id="dr-p" class="dx-k">Research</h3>
    {#if pack.status === 'building'}
      <p class="dx-note" role="status"><span class="dx-pulse" aria-hidden="true"></span> Still reading up{pack.stage ? `: ${pack.stage}` : ''}. It carries on if you leave.</p>
    {:else if pack.status === 'ready'}
      <p class="dr-line"><a class="dr-link" href={placesHref}>Browse the {pack.counts.places} places found →</a></p>
    {:else if pack.status === 'failed'}
      <p class="dx-note">The research did not finish.</p>
      <button class="dx-link" type="button" disabled={packBusy} onclick={buildPack}>{packBusy ? 'Starting…' : 'Try again'}</button>
    {:else}
      <p class="dx-note">Not researched yet.</p>
      <button class="dx-link" type="button" disabled={packBusy} onclick={buildPack}>{packBusy ? 'Starting…' : 'Read up on the place'}</button>
    {/if}
    {#if pack.highlights.length && pack.status !== 'none'}
      <ul class="dr-hl">{#each pack.highlights.slice(0, 4) as h, hi (hi)}<li>{h}</li>{/each}</ul>
    {/if}
    {#if packNote}<p class="dx-note" role="status">{packNote}</p>{/if}
  </section>

  {#if answered.length}
    <details class="dr-answered">
      <summary>Answered lately ({answered.length})</summary>
      <ul>
        {#each answered as q (q.id)}
          <li>{q.prompt} — <strong>{q.answers.find((a) => a.id === q.answerId)?.label ?? 'decided'}</strong>{q.answeredByName ? ` (${q.answeredByName})` : ''}</li>
        {/each}
      </ul>
    </details>
  {/if}
</div>

<style>
  .dr {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .dr-hd {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 14px 16px 10px;
    margin: 0 0 -4px;
    background: var(--text-primary);
    color: var(--bg);
    border-top: 6px solid var(--accent);
  }
  .dr-h {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 22px;
    letter-spacing: -0.02em;
    color: var(--bg);
  }
  .dr-n {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent-on-dark);
  }
  .dr-push {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent-on-dark);
    background: none;
    border: 1px dashed currentColor;
    border-radius: 100px;
    padding: 2px 10px;
    cursor: pointer;
  }
  .dr-push[aria-pressed='false'] {
    opacity: 0.7;
  }
  .dr-push:disabled {
    cursor: progress;
  }
  .dr-h:focus,
  .dr-qh:focus {
    outline: none;
  }
  .dr-h:focus-visible {
    outline: 2px solid var(--accent-on-dark);
    outline-offset: 2px;
  }
  .dr-qh:focus-visible {
    outline: 2px solid var(--accent-ink);
    outline-offset: 2px;
  }
  .dr-sec {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .dr-sub {
    font-size: 15px;
    line-height: 22px;
  }
  .dr-qs {
    display: grid;
    gap: 14px;
    padding: 4px 4px 2px;
  }
  .dr-empty {
    font-size: 16px;
  }
  .dr-pack {
    padding-top: 8px;
    border-top: 1px dashed var(--line-strong);
  }
  .dr-line {
    margin: 4px 0;
  }
  .dr-link {
    font-family: var(--font-display);
    font-weight: 800;
    color: var(--accent-ink);
  }
  .dr-hl {
    margin: 6px 0 0;
    padding-left: 18px;
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--np-ink-soft);
  }
  .dr-hl li::marker {
    color: var(--accent);
  }
  .dr-answered summary {
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent-ink);
  }
  .dr-answered ul {
    margin: 6px 0 0;
    padding-left: 18px;
    font-size: var(--fs-label);
    line-height: 1.5;
  }
</style>
