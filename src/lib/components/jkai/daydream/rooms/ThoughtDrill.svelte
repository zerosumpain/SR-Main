<script lang="ts">
  // One thought, in full — the drill behind a feed row.
  //
  // Everything that used to unfold inside a card: why it came up, what the
  // ledger has learned about its kind, how memory shaped it, the evidence with
  // links, the actions it proposes, a note box, and the verdicts. It owns its
  // own action state so the feed page stays a list; the page hears about
  // changes through `onchanged` and about a filing through `onarchive`, which
  // is optimistic on the page's side so the row leaves at once.
  import { invalidateAll } from '$app/navigation';
  import PlaceMap from '$lib/components/jkai/PlaceMap.svelte';
  import EvidenceList from '$lib/components/jkai/daydream/EvidenceList.svelte';
  import DrillPanel from '$lib/components/jkai/daydream/hub/DrillPanel.svelte';
  import FactList from '$lib/components/jkai/daydream/hub/FactList.svelte';
  import type { FactRow } from '$lib/components/jkai/daydream/hub/types';
  import type { LedgerThought, DetectorRow } from '$lib/daydream/ledger';
  import { familyMark, familyOf, kindLabel, likelihoodBand } from '$lib/daydream/thought-groups';
  import { hasMap, thoughtDestination } from '$lib/daydream/destination';
  import { bandTone, reviewTone, thoughtTone } from '$lib/daydream/priority';
  import {
    RELEVANCE_HINT,
    RELEVANCE_STEPS,
    SHOWN_STATUSES,
    ago,
    postThought,
    reviewWord,
    stamp,
  } from '$lib/daydream/feed-client';

  interface Props {
    thought: LedgerThought;
    threshold: { value: number; feedbackCount: number };
    learned: DetectorRow | null;
    onclose: () => void;
    /** Optimistic filing on the page's side; the drill closes after calling it. */
    onarchive: (t: LedgerThought) => void;
  }

  let { thought: t, threshold, learned, onclose, onarchive }: Props = $props();

  let busy = $state<string | null>(null);
  let actionError = $state<string | null>(null);
  let note = $state<string | null>(null);
  let weaveNote = $state<string | null>(null);
  let reviewOut = $state<{ verdict: string; likelihood: number; reasoning: string; sources: string[]; toolCalls: number; memory: string } | null>(null);
  let relevanceNow = $state<number | null | undefined>(undefined);
  let place = $state<{ lat: number; lon: number; radiusM: number; suggestedAddress: string | null } | null>(null);
  let noteDraft = $state<string | undefined>(undefined);
  const MAX_NOTE_CHARS = 1000;

  const relevance = $derived(relevanceNow === undefined ? (t.relevance ?? null) : relevanceNow);
  const dest = $derived(thoughtDestination(t));
  const band = $derived(likelihoodBand(t.score, threshold.value));
  const canRate = $derived(!t.feedback && SHOWN_STATUSES.includes(t.status));
  const answered = $derived(Boolean(t.placeLabel) && t.kind.startsWith('unknown'));
  const headline = $derived(
    t.placeLabel
      ? t.placeLabel
      : t.placeSuggested
        ? `Is this ${t.placeSuggested}?`
        : t.placeAddress
          ? `The place on ${t.placeAddress}`
          : t.title,
  );
  const memoryThemes = $derived(t.evidence.filter((e) => e.kind === 'memory-theme').length);

  /** The root cause, in words — what produced it, what the raw score was,
   *  what the ledger's opinion of that kind did to it, and whether it cleared
   *  the bar. Anything not narrated stays in the components table below. */
  const cause = $derived.by(() => {
    const c = (t.components ?? {}) as Record<string, unknown>;
    const lines: string[] = [];
    const fam = familyOf(t.kind);
    lines.push(`${fam.label} · ${kindLabel(t.kind)} — ${fam.blurb}`);
    const raw = typeof c.raw === 'number' ? c.raw : null;
    const weight = typeof c.kindWeight === 'number' ? c.kindWeight : null;
    if (raw != null && weight != null) {
      lines.push(
        `The detector scored it ${raw.toFixed(2)}. The ledger's opinion of "${kindLabel(t.kind)}" multiplies that by ${weight.toFixed(2)}` +
          (weight === 1 ? ' — exactly neutral, meaning no feedback has been collected on this kind yet' : '') +
          `, giving ${t.score.toFixed(2)}.`,
      );
    } else if (raw != null) {
      lines.push(`The detector scored it ${raw.toFixed(2)}, giving ${t.score.toFixed(2)} after weighting.`);
    }
    lines.push(
      band.id === 'held'
        ? `Held back: ${band.meaning}. The bar falls as you rate things — ${threshold.feedbackCount} response${threshold.feedbackCount === 1 ? '' : 's'} so far.`
        : `Cleared the bar: ${band.meaning}.`,
    );
    if (t.suppressedReason === 'feed_only') {
      lines.push('This kind never pushes by design — it lands here and waits for you, rather than interrupting.');
    } else if (t.suppressedReason?.startsWith('already_refuted')) {
      const of = t.suppressedReason.match(/\((.*)\)$/)?.[1];
      lines.push(`Built on rows a reviewer has already ruled against${of ? ` — it settled “${of}”` : ''}. It was not sent and was not reviewed again; the ruling is in the Memory room.`);
    } else if (t.suppressedReason && t.suppressedReason !== 'below_threshold') {
      lines.push(`Not delivered because of ${t.suppressedReason.replace(/_/g, ' ')}.`);
    }
    return lines;
  });
  const NARRATED = new Set(['raw', 'kindWeight']);
  const extraComponents = $derived(
    Object.entries((t.components ?? {}) as Record<string, unknown>).filter(([k]) => !NARRATED.has(k)) as Array<[string, number]>,
  );

  /** The structured half: every fact a reader might want to line up against
   *  a diary entry, a bank row or a night's sleep. */
  const facts = $derived.by((): FactRow[] => {
    const rows: FactRow[] = [
      { label: 'Family', value: `${familyOf(t.kind).label} · ${kindLabel(t.kind)}` },
      { label: 'State', value: answered ? 'answered' : t.status, tone: thoughtTone(t) },
      { label: 'Likelihood', value: `${band.label} · score ${t.score}`, tone: bandTone(band.id) },
      { label: 'Noticed', value: `${stamp(t.createdAt)} · ${ago(t.createdAt)}`, mono: true },
    ];
    if (t.deliveredAt) rows.push({ label: 'Sent', value: `${stamp(t.deliveredAt)}${t.channel ? ` · ${t.channel}` : ''}`, tone: 'good', mono: true });
    if (t.suppressedReason) rows.push({ label: 'Held back', value: t.suppressedReason.replace(/_/g, ' '), tone: 'watch' });
    if (t.reviewVerdict) {
      rows.push({
        label: 'Review',
        value: `${reviewWord(t.reviewVerdict)}${typeof t.reviewLikelihood === 'number' ? ` · ${Math.round(t.reviewLikelihood * 100)}% likely true` : ''}`,
        tone: reviewTone(t.reviewVerdict),
      });
    }
    if (t.feedback) rows.push({ label: 'You said', value: t.feedback.replace('_', ' '), tone: 'good' });
    if (t.intelNoteId) rows.push({ label: 'Graph', value: 'woven into Intel', tone: 'good', href: `/jkai/intel/notes?note=${t.intelNoteId}` });
    if (t.reviewMemoryId) rows.push({ label: 'Memory', value: 'the ruling is remembered', tone: 'good', href: '/jkai/daydreams/memory' });
    if (memoryThemes) rows.push({ label: 'Guided by', value: `${memoryThemes} memory theme${memoryThemes === 1 ? '' : 's'}`, tone: 'good', href: '/jkai/daydreams/memory' });
    if (!t.placeLabel && t.placeAddress) rows.push({ label: 'Address', value: t.placeAddress });
    if (t.placeVisits) rows.push({ label: 'Visits', value: String(t.placeVisits) });
    if (t.promptTokens + t.completionTokens > 0) rows.push({ label: 'Tokens', value: String(t.promptTokens + t.completionTokens), mono: true });
    if (dest) rows.push({ label: 'Source', value: dest.hint ?? dest.label, href: dest.href });
    return rows;
  });

  async function act(body: Record<string, unknown>, key: string): Promise<boolean> {
    busy = key;
    actionError = null;
    const r = await postThought(body);
    if (!r.ok) actionError = r.error;
    else await invalidateAll();
    busy = null;
    return r.ok;
  }

  async function vote(verdict: 'useful' | 'not_useful' | 'never_kind') {
    const ok = await act({ action: 'feedback', id: t.id, verdict }, verdict);
    // A useful vote weaves the thought into the Intel graph, quietly. Fired
    // from here rather than inside `recordFeedback`, which the WhatsApp reply
    // handler and the triage deck also reach.
    if (ok && verdict === 'useful') await weave({ quiet: true });
  }

  async function weave(opts: { quiet?: boolean } = {}) {
    busy = 'weave';
    const r = await postThought<{ weave?: { status: string; entityCount?: number; chars?: number; reason?: string; error?: string } }>({ action: 'weave', id: t.id });
    const w = r.out.weave;
    const line = r.out.error
      ? `Intel refused it: ${r.out.error}`
      : w?.status === 'woven'
        ? `Into the graph — ${w.entityCount ?? 0} entit${w.entityCount === 1 ? 'y' : 'ies'}.`
        : w?.status === 'unchanged'
          ? 'Already in the graph, unchanged.'
          : w?.status === 'too-thin'
            ? `Too thin to extract (${w.chars ?? 0} characters). Add a note and try again.`
            : w?.status === 'failed'
              ? `Intel could not read it: ${w.error}`
              : `Not woven: ${w?.reason ?? w?.status ?? r.error ?? 'unknown'}`;
    const succeeded = w?.status === 'woven' || w?.status === 'unchanged';
    if (!opts.quiet || succeeded) weaveNote = line;
    if (succeeded) await invalidateAll();
    busy = null;
  }

  async function queueToModel() {
    busy = 'review';
    actionError = null;
    const r = await postThought<{ verdict?: string; likelihood?: number; reasoning?: string; sources?: string[]; toolCalls?: number; memory?: string }>({ action: 'review_now', id: t.id });
    if (!r.ok) actionError = r.error ?? 'the reviewer could not run';
    else {
      reviewOut = {
        verdict: r.out.verdict ?? 'uncertain',
        likelihood: r.out.likelihood ?? 0,
        reasoning: r.out.reasoning ?? '',
        sources: r.out.sources ?? [],
        toolCalls: r.out.toolCalls ?? 0,
        memory: r.out.memory ?? '',
      };
      await invalidateAll();
    }
    busy = null;
  }

  async function setRelevance(value: number) {
    // Tapping the current value clears it — a mis-tap has to be undoable
    // without inventing a sixth position on a five-position dial.
    const next = relevance === value ? null : value;
    const before = relevanceNow;
    relevanceNow = next;
    busy = 'rel';
    const r = await postThought({ action: 'set_relevance', id: t.id, relevance: next });
    if (!r.ok) {
      relevanceNow = before;
      actionError = r.error;
    }
    busy = null;
  }

  async function toggleMap() {
    if (place) {
      place = null;
      return;
    }
    busy = 'map';
    const r = await postThought<{ place?: { lat: number; lon: number; radiusM: number; suggestedAddress: string | null } }>({ action: 'thought_map', thoughtId: t.id });
    if (!r.ok) actionError = r.error ?? 'could not load that map';
    else if (r.out.place) place = r.out.place;
    else actionError = 'That one is not about a place.';
    busy = null;
  }

  async function saveNote() {
    const text = (noteDraft ?? '').trim();
    if (!text) return;
    const ok = await act({ action: 'add_note', thoughtId: t.id, text }, 'note');
    if (ok) {
      note = text;
      noteDraft = undefined;
    }
  }

  function file() {
    onarchive(t);
    onclose();
  }
</script>

<DrillPanel label={headline} kicker={`${familyMark(t.kind)} · ${kindLabel(t.kind)}`} tone={thoughtTone(t)} {onclose}>
  {#snippet head()}
    {#if answered}
      <span class="pill t-good">answered</span>
    {:else}
      <span class="pill t-{thoughtTone(t)}">{t.status}</span>
    {/if}
    {#if t.reviewVerdict}
      <span class="tag t-{reviewTone(t.reviewVerdict)}">{reviewWord(t.reviewVerdict)}</span>
    {/if}
    {#if dest}
      <a class="tag" href={dest.href} title={dest.hint}>{dest.label}{#if dest.external}<span class="q-ext">↗</span>{/if}</a>
    {/if}
  {/snippet}

  <h3 class="title">{headline}</h3>

  {#if answered}
    <p class="card-body lead">
      You named this <strong>{t.placeLabel}</strong>{t.placeVisits ? ` · ${t.placeVisits} visits` : ''}. It asked: “{t.title}”
    </p>
  {:else}
    <p class="card-body lead">{t.explanation}</p>
  {/if}

  {#if t.narrative}
    <!-- The model's phrasing, always shown AS the model's, with its tag. -->
    <blockquote class="quote" class:unchecked={t.verified === false}>
      {t.narrative}
      <span class="quote-tag" class:ok={t.verified === true}>{t.verified === true ? 'model · checked' : 'model · UNCHECKED'}</span>
    </blockquote>
  {:else if t.narrativeDroppedReason}
    <p class="note warn">phrasing dropped — {t.narrativeDroppedReason}</p>
  {/if}

  {#if t.reviewVerdict}
    <p class="review t-{reviewTone(t.reviewVerdict)}">
      <span class="review-tag">{reviewWord(t.reviewVerdict)}{#if typeof t.reviewLikelihood === 'number'}<span class="review-p">{Math.round(t.reviewLikelihood * 100)}%</span>{/if}</span>
      {#if t.reviewReasoning}<span class="review-why">{t.reviewReasoning}</span>{/if}
      {#if t.reviewMemoryId}<span class="review-mem">remembered — it will not raise this blind again</span>{/if}
    </p>
  {/if}

  <div class="detail">
    <div class="detail-block">
      <p class="field-label">The facts</p>
      <FactList rows={facts} columns={2} />
    </div>

    {#if hasMap(t)}
      <div class="detail-block">
        <button type="button" class="btn sm" disabled={busy === 'map'} onclick={toggleMap}>
          {busy === 'map' ? 'Loading…' : place ? 'Hide map' : 'Show on a map'}
        </button>
        {#if place}
          <div class="map">
            <PlaceMap lat={place.lat} lon={place.lon} radiusM={place.radiusM} height="220px" />
            {#if place.suggestedAddress}<p class="note">{place.suggestedAddress}</p>{/if}
          </div>
        {/if}
      </div>
    {/if}

    <div class="detail-block">
      <p class="field-label">Why this came up</p>
      {#each cause as line, li (li)}
        <p class="detail-line">{line}</p>
      {/each}
      {#if extraComponents.length}
        <div class="tbl-wrap">
          <table class="tbl compact">
            <thead><tr><th>Component</th><th class="right">Value</th></tr></thead>
            <tbody>
              {#each extraComponents as [k, v] (k)}
                <tr><td>{k}</td><td class="right">{v}</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>

    <div class="detail-block">
      <p class="field-label">What it has learned about “{kindLabel(t.kind)}”</p>
      {#if learned}
        <p class="detail-line">
          Every future {kindLabel(t.kind)} scores <strong>×{learned.weight.toFixed(3)}</strong>
          {learned.weight > 1
            ? '— above neutral, so this kind is being pushed up the feed.'
            : learned.weight < 1
              ? '— below neutral, so this kind is being pushed down.'
              : '— exactly neutral: nothing you have said has moved it yet.'}
        </p>
        <p class="note">
          From {learned.useful} useful and {learned.notUseful} unhelpful
          {learned.useful + learned.notUseful === 1 ? 'verdict' : 'verdicts'}{learned.relevance
            ? `, and ${learned.relevance.n} relevance rating${learned.relevance.n === 1 ? '' : 's'} averaging ${learned.relevance.mean}`
            : ', and no relevance ratings yet'}. It reaches the next detect pass, not this card.
        </p>
      {:else}
        <p class="detail-line">No detector owns this kind any more, so there is no weight to move. It stays on the ledger as a record of something that was once noticed.</p>
      {/if}
    </div>

    {#if memoryThemes}
      <div class="detail-block">
        <p class="field-label">How memory influenced this</p>
        <p class="detail-line">
          This thought cited {memoryThemes} consolidated {memoryThemes === 1 ? 'theme' : 'themes'}. The lesson, its guidance and the raw memories underneath it are in the evidence below, and in the
          <a class="link" href="/jkai/daydreams/memory">Memory room</a>.
        </p>
      </div>
    {/if}

    {#if t.evidence.length}
      <div class="detail-block">
        <p class="field-label">What it was looking at{memoryThemes ? ' — including memory' : ''}</p>
        <EvidenceList thoughtId={t.id} count={t.evidence.length} />
      </div>
    {/if}

    {#if reviewOut?.memory}
      <div class="detail-block">
        <p class="field-label">What it now remembers</p>
        <p class="detail-line said">{reviewOut.memory}</p>
        {#if reviewOut.sources.length}<p class="note">Checked: {reviewOut.sources.join(' · ')}</p>{/if}
      </div>
    {/if}

    {#if (t.proposedActions ?? []).length && t.status !== 'actioned'}
      <div class="detail-block">
        <p class="field-label">It suggests</p>
        <div class="card-actions">
          {#each t.proposedActions ?? [] as a, i (i)}
            <button type="button" class="cta" disabled={busy === `act${i}`} onclick={() => act({ action: 'run_action', id: t.id, index: i }, `act${i}`)}>
              {a.label}
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <div class="detail-block">
      <p class="field-label">Add some depth</p>
      {#if (note ?? t.note) && noteDraft === undefined}
        <p class="detail-line said">{note ?? t.note}</p>
        <button type="button" class="btn sm" onclick={() => { noteDraft = note ?? t.note ?? ''; }}>Change what you said</button>
      {:else}
        <textarea
          class="text-input area"
          rows="3"
          maxlength={MAX_NOTE_CHARS}
          placeholder="Anything it should know — what it got wrong, what it missed, what these actually are."
          bind:value={noteDraft}
        ></textarea>
        <div class="card-actions">
          <button type="button" class="cta" disabled={busy === 'note' || !(noteDraft ?? '').trim()} onclick={saveNote}>
            {busy === 'note' ? 'Saving…' : 'Save this'}
          </button>
          {#if note ?? t.note}
            <button type="button" class="btn" onclick={() => { noteDraft = undefined; }}>Cancel</button>
          {/if}
        </div>
        <p class="note">Kept as a memory, so it informs what it says next.</p>
      {/if}
    </div>
  </div>

  {#if actionError}<p class="err">{actionError}</p>{/if}
  {#if reviewOut}
    <p class="note good">Ruled <strong>{reviewOut.verdict}</strong> after {reviewOut.toolCalls} source {reviewOut.toolCalls === 1 ? 'check' : 'checks'} — and remembered.</p>
  {/if}
  {#if weaveNote}<p class="note good">{weaveNote}</p>{/if}

  {#snippet foot()}
    <div class="rel">
      <span class="rel-label">Relevance</span>
      <div class="rel-dial" role="group" aria-label="How relevant is this subject?">
        {#each RELEVANCE_STEPS as step (step)}
          <button
            type="button"
            class="rel-step"
            class:on={(relevance ?? 0) >= step}
            class:set={relevance === step}
            disabled={busy === 'rel'}
            aria-pressed={relevance === step}
            title={RELEVANCE_HINT[step]}
            onclick={() => setRelevance(step)}
          >{step}</button>
        {/each}
      </div>
      <span class="rel-read">{relevance == null ? 'not said' : RELEVANCE_HINT[relevance]}</span>
    </div>
    <div class="acts">
      {#if canRate}
        <button type="button" class="btn sm" disabled={!!busy} onclick={() => vote('useful')}>Useful</button>
        <button type="button" class="btn sm" disabled={!!busy} onclick={() => vote('not_useful')}>Not useful</button>
      {/if}
      <button type="button" class="btn sm" disabled={busy === 'review'} onclick={queueToModel} title="Send it to the reviewer: it reads the sources and rules, and remembers what it decided">
        {busy === 'review' ? 'Checking…' : t.reviewVerdict ? 'Check again' : 'Queue to model'}
      </button>
      {#if t.feedback === 'useful' && !t.intelNoteId}
        <button type="button" class="btn sm" disabled={busy === 'weave'} onclick={() => weave()}>{busy === 'weave' ? 'Weaving…' : 'Weave into Intel'}</button>
      {/if}
      {#if t.status !== 'archived'}
        <button type="button" class="cta sm" disabled={!!busy} onclick={file}>OK, file it</button>
      {/if}
      {#if canRate}
        <button type="button" class="btn sm danger" disabled={!!busy} onclick={() => vote('never_kind')}>Never this kind</button>
        <button type="button" class="btn sm" disabled={!!busy} onclick={() => act({ action: 'snooze', id: t.id, days: 7 }, 'snooze')}>Snooze a week</button>
      {/if}
    </div>
  {/snippet}
</DrillPanel>

<style>
  .title {
    margin: 0 0 10px;
    font-family: var(--font-display);
    font-size: var(--fs-display-xs);
    line-height: 1.15;
    letter-spacing: -0.015em;
    color: var(--text-primary);
    text-wrap: balance;
  }
  .quote {
    margin: 14px 0 0;
    padding: 12px 14px;
    border-left: 3px solid var(--accent-ink-tint-35);
    background: var(--bg-section);
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: var(--text-primary);
  }
  .quote.unchecked {
    border-left-color: var(--warn);
  }
  .quote-tag {
    display: block;
    margin-top: 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--warn);
  }
  .quote-tag.ok {
    color: var(--good);
  }
  .review {
    --tone: var(--text-muted);
    margin: 14px 0 0;
    padding: 10px 14px;
    border: 1px solid var(--card-border);
    border-left: 3px solid var(--tone);
    font-size: var(--fs-nav);
    line-height: 1.55;
    color: var(--text-secondary);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .review.t-urgent {
    --tone: var(--error);
  }
  .review.t-good {
    --tone: var(--good);
  }
  .review.t-watch {
    --tone: var(--warn);
  }
  .review-tag {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--tone);
  }
  .review-p {
    margin-left: 8px;
    color: var(--text-muted);
  }
  .review-why {
    color: var(--text-primary);
  }
  .review-mem {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--good);
  }
  .map {
    margin-top: 10px;
  }

  .rel {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .rel-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .rel-dial {
    display: inline-flex;
    border: 1px solid var(--line-strong);
  }
  .rel-step {
    width: 32px;
    height: 28px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    background: transparent;
    border: 0;
    border-right: 1px solid var(--line-strong);
    border-radius: 0;
    cursor: pointer;
  }
  .rel-step:last-child {
    border-right: 0;
  }
  .rel-step.on {
    background: var(--accent-tint-14);
    color: var(--accent);
  }
  .rel-step.set {
    background: var(--accent);
    color: var(--bg);
    font-weight: 700;
  }
  .rel-step:disabled {
    cursor: progress;
    opacity: 0.6;
  }
  .rel-step:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .rel-read {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.4;
    color: var(--text-muted);
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-left: auto;
  }
</style>
