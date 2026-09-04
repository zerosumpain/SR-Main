<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import DrillPanel from '$lib/components/jkai/daydream/hub/DrillPanel.svelte';
  import { postThought } from '$lib/daydream/feed-client';
  import { ago } from '$lib/daydream/format';
  import {
    BACKLOG_KINDS,
    STAGE_META,
    type BacklogKind,
    type BoardTone,
    type WorkItem,
  } from '$lib/selfimprove/board';
  import {
    BACKLOG_EFFORTS,
    BACKLOG_RISKS,
    calculateReadiness,
    lines,
    normaliseGrooming,
    renderBacklogBrief,
    type GroomingModelResult,
  } from '$lib/selfimprove/grooming';
  import type { BacklogGroomingData } from '$lib/selfimprove/types';

  interface Props {
    item: WorkItem | null;
    onclose: () => void;
  }

  let { item, onclose }: Props = $props();
  const creating = $derived(item == null);
  const actionable = $derived(item == null || item.actionable);
  const tone = $derived<BoardTone>(item ? STAGE_META[item.stage].tone : 'action');

  type Step = 'brief' | 'groom' | 'review';
  type Turn = { role: 'user' | 'assistant'; content: string };

  let seeded = $state(false);
  let step = $state<Step>('brief');
  let title = $state('');
  let detail = $state('');
  let kind = $state<BacklogKind>('feature');
  let priority = $state(3);
  let draft = $state<BacklogGroomingData | null>(null);
  let suggestions = $state<GroomingModelResult['suggestions'] | null>(null);
  let conversation = $state<Turn[]>([]);
  let ask = $state('');
  let model = $state<string | null>(null);
  let groomingBusy = $state(false);
  let saving = $state(false);
  let destructiveBusy = $state(false);
  let error = $state<string | null>(null);
  let confirmRemove = $state(false);

  const KIND_HELP: Readonly<Record<BacklogKind, string>> = {
    tool: 'A small runtime capability the toolsmith can author and smoke-test.',
    feature: 'A repository change handed to the gated autonomous build engine.',
    source: 'A data source to discover, register and sample.',
    watch: 'A scheduled monitor that can notify when something changes.',
    engine: 'A change to Daydream itself; recorded here but never auto-built.',
  };

  $effect(() => {
    if (seeded) return;
    title = item?.title ?? '';
    detail = item?.detail ?? '';
    kind = item && BACKLOG_KINDS.includes(item.kind as BacklogKind)
      ? (item.kind as BacklogKind)
      : 'feature';
    priority = item?.priority ?? 3;
    draft = item?.grooming ?? null;
    model = item?.grooming?.modelId ?? null;
    seeded = true;
  });

  function updateDraft<K extends keyof BacklogGroomingData>(key: K, value: BacklogGroomingData[K]) {
    const current = ensureDraft();
    const next = { ...current, [key]: value };
    draft = { ...next, readiness: calculateReadiness(next) };
  }

  function ensureDraft(): BacklogGroomingData {
    if (draft) return draft;
    draft = normaliseGrooming({
      problem: detail,
      outcome: '',
      acceptanceCriteria: [],
      validation: [],
      constraints: [],
      nonGoals: [],
      dependencies: [],
      implementationNotes: [],
      assumptions: [],
      openQuestions: [],
      decisions: [],
      relatedItems: [],
      effort: 'medium',
      risk: 'medium',
    }, {
      modelId: item?.grooming?.modelId ?? 'manual',
      revision: item?.grooming?.revision ?? 1,
    });
    return draft;
  }

  function go(stepTo: Step) {
    error = null;
    if (stepTo === 'review') ensureDraft();
    step = stepTo;
  }

  async function groom(message = '') {
    const userMessage = message.trim();
    if (!title.trim() && !detail.trim() && !userMessage) {
      error = 'Start with a title, a rough brief, or a question for the model.';
      step = 'brief';
      return;
    }
    error = null;
    groomingBusy = true;
    step = 'groom';
    const sentConversation = conversation.slice(-12);
    const result = await postThought<GroomingModelResult>({
      action: 'backlog_groom',
      ...(item ? { slug: item.slug } : {}),
      title: title.trim(),
      detail: detail.trim(),
      kind,
      priority,
      ...(draft ? { grooming: draft } : {}),
      conversation: sentConversation,
      ...(userMessage ? { message: userMessage } : {}),
    });
    groomingBusy = false;
    if (!result.ok) {
      error = result.error ?? 'The model could not groom this feature.';
      return;
    }
    const out = result.out;
    draft = out.grooming;
    suggestions = out.suggestions;
    model = out.model;
    conversation = [
      ...sentConversation,
      ...(userMessage ? [{ role: 'user' as const, content: userMessage }] : []),
      { role: 'assistant', content: out.assistantMessage },
    ];
    ask = '';
  }

  function applyModelDraft() {
    if (suggestions) {
      title = suggestions.title || title;
      detail = suggestions.detail || detail;
      kind = suggestions.kind;
      priority = suggestions.priority;
    }
    ensureDraft();
    step = 'review';
  }

  async function save(includeGrooming: boolean) {
    if (!title.trim()) {
      error = 'A feature needs a title.';
      step = 'brief';
      return;
    }
    error = null;
    saving = true;
    const result = await postThought({
      action: creating ? 'backlog_create' : 'backlog_update',
      ...(item ? { slug: item.slug } : {}),
      title: title.trim(),
      detail: detail.trim(),
      kind,
      priority,
      ...(includeGrooming && draft ? { grooming: draft } : {}),
    });
    if (result.ok) {
      await invalidateAll();
      saving = false;
      onclose();
      return;
    }
    saving = false;
    error = result.error ?? 'The feature was not saved.';
  }

  async function statusAction(action: 'park' | 'restore' | 'remove') {
    if (!item) return;
    error = null;
    destructiveBusy = true;
    const result = action === 'remove'
      ? await postThought({ action: 'backlog_remove', slug: item.slug })
      : await postThought({
          action: 'backlog_park',
          slug: item.slug,
          parked: action === 'park',
          ...(action === 'park' ? { reason: 'Parked from the backlog room' } : {}),
        });
    if (result.ok) {
      await invalidateAll();
      destructiveBusy = false;
      onclose();
      return;
    }
    destructiveBusy = false;
    error = result.error ?? `The feature could not be ${action === 'remove' ? 'removed' : 'updated'}.`;
  }

  function listValue(values: string[]): string {
    return values.join('\n');
  }

  function relationLabel(value: string): string {
    return value === 'blocked_by' ? 'blocked by' : value;
  }

  const builderPreview = $derived(
    draft ? renderBacklogBrief({ title, detail, grooming: draft }) : `${title}\n\n${detail}`.trim(),
  );
</script>

<DrillPanel
  label={creating ? 'Add a backlog feature' : (item?.title ?? 'Backlog feature')}
  kicker={creating ? 'New feature' : `${item?.lane ?? ''} · ${item ? STAGE_META[item.stage].label : ''}`}
  {tone}
  {onclose}
  wide
>
  {#snippet head()}
    {#if item?.grooming}
      <span class="pill t-{item.grooming.readiness.status === 'ready' ? 'good' : item.grooming.readiness.status === 'needs_input' ? 'watch' : 'quiet'}">
        {item.grooming.readiness.score}% groomed
      </span>
    {:else if creating}
      <span class="pill t-action">added by you</span>
    {/if}
  {/snippet}

  {#if !actionable && item}
    <div class="readonly">
      <p class="eyebrow">Capability lead</p>
      <h2>{item.title}</h2>
      <p>{item.detail || 'No detail was recorded.'}</p>
      {#if item.evidence.length}
        <div class="context-card"><strong>Why it was raised</strong><p>{item.evidence.join(' · ')}</p></div>
      {/if}
      <p class="helper">
        This lead is not a backlog record yet. Rule on it in
        <a class="link" href="/jkai/daydreams/improvement#appetite">Improvement → Appetite</a>;
        once accepted, it becomes editable and groomable here.
      </p>
    </div>
  {:else}
    <nav class="journey" aria-label="Feature editor steps">
      <button type="button" class:active={step === 'brief'} onclick={() => go('brief')}>
        <span>1</span><b>Brief</b><small>Frame the need</small>
      </button>
      <button type="button" class:active={step === 'groom'} onclick={() => go('groom')}>
        <span>2</span><b>AI groom</b><small>Question and refine</small>
      </button>
      <button type="button" class:active={step === 'review'} onclick={() => go('review')}>
        <span>3</span><b>Review</b><small>Approve the build contract</small>
      </button>
    </nav>

    {#if error}<p class="modal-error" role="alert">{error}</p>{/if}

    {#if step === 'brief'}
      <section class="step-pane brief-pane" aria-labelledby="brief-heading">
        <div class="section-heading">
          <p class="eyebrow">Step 1 · your intent</p>
          <h2 id="brief-heading">What should be better?</h2>
          <p>Give the model enough to understand the outcome. It will propose structure; you stay in control of what is saved.</p>
        </div>

        <label class="field wide">
          <span>Feature title</span>
          <input class="control title-input" bind:value={title} maxlength="200" placeholder="A short, outcome-led name" />
          {#if item}<small>The durable identifier stays <code>{item.slug}</code> if the title changes.</small>{/if}
        </label>

        <label class="field wide">
          <span>Rough brief</span>
          <textarea
            class="control"
            bind:value={detail}
            maxlength="2000"
            rows="7"
            placeholder="Describe who needs this, what is difficult today, and what a good outcome looks like. Rough notes are fine."
          ></textarea>
          <small>{detail.length}/2000 · the model will turn this into acceptance criteria and validation</small>
        </label>

        <div class="property-row">
          <label class="field">
            <span>Delivery lane</span>
            <select class="control" bind:value={kind} disabled={item?.backlogStatus === 'shipped'}>
              {#each BACKLOG_KINDS as option (option)}<option value={option}>{option}</option>{/each}
            </select>
            <small>{item?.backlogStatus === 'shipped' ? 'Locked because this has shipped.' : KIND_HELP[kind]}</small>
          </label>
          <label class="field">
            <span>Priority</span>
            <select class="control" bind:value={priority}>
              {#each [1, 2, 3, 4, 5] as value (value)}
                <option value={value}>P{value}{value === 1 ? ' — highest' : value === 5 ? ' — lowest' : ''}</option>
              {/each}
            </select>
            <small>The nightly picker ranks this before age and attempt count.</small>
          </label>
        </div>

        <aside class="model-callout">
          <span class="spark" aria-hidden="true">✦</span>
          <div><strong>Groom with your default model</strong><p>It will draft scope, testable outcomes, risks, dependencies and likely duplicate links. Nothing is saved until you approve it.</p></div>
        </aside>
      </section>
    {:else if step === 'groom'}
      <section class="step-pane groom-pane" aria-labelledby="groom-heading">
        <div class="groom-main">
          <div class="section-heading">
            <p class="eyebrow">Step 2 · collaborative grooming</p>
            <h2 id="groom-heading">Shape the implementation brief</h2>
            <p>Ask about scope, trade-offs or feasibility, or answer a question the model has raised.</p>
          </div>

          {#if conversation.length === 0 && !groomingBusy}
            <div class="empty-ai">
              <span class="spark" aria-hidden="true">✦</span>
              <h3>Ready to groom</h3>
              <p>The configured default model will produce a complete first draft and call out what it cannot know.</p>
              <button class="clean-button primary" type="button" onclick={() => groom()}>Run first pass</button>
            </div>
          {/if}

          <div class="conversation" aria-live="polite">
            {#each conversation as turn, index (`${turn.role}-${index}`)}
              <article class="bubble {turn.role}">
                <span>{turn.role === 'assistant' ? 'Default model' : 'You'}</span>
                <p>{turn.content}</p>
              </article>
            {/each}
            {#if groomingBusy}
              <article class="bubble assistant thinking"><span>Default model</span><p>Reviewing scope, criteria, risks and related work…</p></article>
            {/if}
          </div>

          {#if conversation.length > 0 || groomingBusy}
            <div class="composer">
              <label for="groom-question">Ask or answer</label>
              <textarea id="groom-question" class="control" bind:value={ask} rows="3" maxlength="2000" placeholder="Answer an open question, change the scope, or ask what the builder needs to know…"></textarea>
              <div class="composer-foot">
                <span>{ask.length}/2000</span>
                <button class="clean-button primary" type="button" disabled={groomingBusy || !ask.trim()} onclick={() => groom(ask)}>
                  {groomingBusy ? 'Thinking…' : 'Send to model'}
                </button>
              </div>
            </div>
          {/if}
        </div>

        <aside class="groom-side">
          <div class="model-chip"><span class="live-dot"></span>{model ? `Default model · ${model}` : 'Uses your configured default model'}</div>
          {#if draft}
            <div class="readiness-card status-{draft.readiness.status}">
              <div class="readiness-top"><span>Build readiness</span><strong>{draft.readiness.score}%</strong></div>
              <div class="meter"><i style={`width:${draft.readiness.score}%`}></i></div>
              <p>{draft.readiness.reason}</p>
            </div>

            {#if draft.openQuestions.length}
              <div class="side-block questions">
                <h3>Questions to resolve</h3>
                <ul>{#each draft.openQuestions as question}<li>{question}</li>{/each}</ul>
              </div>
            {/if}

            <div class="side-block compact-spec">
              <h3>Draft at a glance</h3>
              <dl>
                <div><dt>Criteria</dt><dd>{draft.acceptanceCriteria.length}</dd></div>
                <div><dt>Checks</dt><dd>{draft.validation.length}</dd></div>
                <div><dt>Effort</dt><dd>{draft.effort}</dd></div>
                <div><dt>Risk</dt><dd>{draft.risk}</dd></div>
              </dl>
            </div>

            {#if suggestions}
              <div class="side-block suggested-shell">
                <h3>Suggested item update</h3>
                <strong>{suggestions.title}</strong>
                <span>{suggestions.kind} · P{suggestions.priority}</span>
                <p>{suggestions.detail}</p>
                <small>Applied only when you choose “Apply draft and review”.</small>
              </div>
            {/if}

            {#if draft.relatedItems.length}
              <div class="side-block relations">
                <h3>Related backlog</h3>
                {#each draft.relatedItems as relation (relation.slug)}
                  <article class:duplicate={relation.relation === 'duplicate'}>
                    <span>{relationLabel(relation.relation)}</span>
                    <strong>{relation.title}</strong>
                    <p>{relation.reason}</p>
                    <code>{relation.slug}</code>
                  </article>
                {/each}
              </div>
            {/if}
          {:else}
            <div class="side-block"><h3>What the pass adds</h3><ul><li>Problem and desired outcome</li><li>Testable acceptance criteria</li><li>Validation plan and implementation notes</li><li>Risks, constraints and dependencies</li><li>Duplicate and related-work suggestions</li></ul></div>
          {/if}
        </aside>
      </section>
    {:else}
      {@const g = ensureDraft()}
      <section class="step-pane review-pane" aria-labelledby="review-heading">
        <div class="review-head">
          <div class="section-heading">
            <p class="eyebrow">Step 3 · human approval</p>
            <h2 id="review-heading">Make this the builder’s contract</h2>
            <p>Edit anything the model got wrong. These fields—not the chat transcript—are saved and passed to the automated build engine.</p>
          </div>
          <div class="readiness-inline status-{g.readiness.status}">
            <strong>{g.readiness.score}%</strong><span>{g.readiness.status === 'needs_input' ? 'needs input' : g.readiness.status}</span>
          </div>
        </div>

        <div class="review-properties">
          <label class="field item-title"><span>Feature title</span><input class="control" bind:value={title} maxlength="200" /></label>
          <label class="field"><span>Delivery lane</span><select class="control" bind:value={kind} disabled={item?.backlogStatus === 'shipped'}>{#each BACKLOG_KINDS as option (option)}<option value={option}>{option}</option>{/each}</select></label>
          <label class="field"><span>Priority</span><select class="control" bind:value={priority}>{#each [1, 2, 3, 4, 5] as value (value)}<option value={value}>P{value}</option>{/each}</select></label>
        </div>

        <div class="review-grid">
          <div class="review-fields">
            <label class="field"><span>Problem</span><textarea class="control" rows="4" value={g.problem} oninput={(event) => updateDraft('problem', event.currentTarget.value)}></textarea><small>Who is affected and what fails today?</small></label>
            <label class="field"><span>Desired outcome</span><textarea class="control" rows="4" value={g.outcome} oninput={(event) => updateDraft('outcome', event.currentTarget.value)}></textarea><small>What observable result should change?</small></label>
            <label class="field full"><span>Acceptance criteria · one per line</span><textarea class="control" rows="7" value={listValue(g.acceptanceCriteria)} oninput={(event) => updateDraft('acceptanceCriteria', lines(event.currentTarget.value))}></textarea><small>Independent, testable conditions the implementation must satisfy.</small></label>
            <label class="field full"><span>Validation · one per line</span><textarea class="control" rows="5" value={listValue(g.validation)} oninput={(event) => updateDraft('validation', lines(event.currentTarget.value))}></textarea><small>Specific automated and manual checks that prove the outcome.</small></label>

            <details class="advanced" open={g.openQuestions.length > 0}>
              <summary>Scope, delivery and uncertainty</summary>
              <div class="advanced-grid">
                <label class="field"><span>Constraints</span><textarea class="control" rows="4" value={listValue(g.constraints)} oninput={(event) => updateDraft('constraints', lines(event.currentTarget.value))}></textarea></label>
                <label class="field"><span>Non-goals</span><textarea class="control" rows="4" value={listValue(g.nonGoals)} oninput={(event) => updateDraft('nonGoals', lines(event.currentTarget.value))}></textarea></label>
                <label class="field"><span>Dependencies</span><textarea class="control" rows="4" value={listValue(g.dependencies)} oninput={(event) => updateDraft('dependencies', lines(event.currentTarget.value))}></textarea></label>
                <label class="field"><span>Implementation notes</span><textarea class="control" rows="4" value={listValue(g.implementationNotes)} oninput={(event) => updateDraft('implementationNotes', lines(event.currentTarget.value))}></textarea></label>
                <label class="field"><span>Decisions made</span><textarea class="control" rows="4" value={listValue(g.decisions)} oninput={(event) => updateDraft('decisions', lines(event.currentTarget.value))}></textarea></label>
                <label class="field"><span>Assumptions to verify</span><textarea class="control" rows="4" value={listValue(g.assumptions)} oninput={(event) => updateDraft('assumptions', lines(event.currentTarget.value))}></textarea></label>
                <label class="field full"><span>Open questions</span><textarea class="control" rows="4" value={listValue(g.openQuestions)} oninput={(event) => updateDraft('openQuestions', lines(event.currentTarget.value))}></textarea><small>Any item here keeps readiness in “needs input”. Remove it only when it is genuinely resolved.</small></label>
                <label class="field"><span>Effort</span><select class="control" value={g.effort} onchange={(event) => updateDraft('effort', event.currentTarget.value as BacklogGroomingData['effort'])}>{#each BACKLOG_EFFORTS as value}<option value={value}>{value}</option>{/each}</select></label>
                <label class="field"><span>Risk</span><select class="control" value={g.risk} onchange={(event) => updateDraft('risk', event.currentTarget.value as BacklogGroomingData['risk'])}>{#each BACKLOG_RISKS as value}<option value={value}>{value}</option>{/each}</select></label>
                {#if g.relatedItems.length}
                  <div class="field full relation-review">
                    <span>Related backlog suggestions</span>
                    {#each g.relatedItems as relation (relation.slug)}
                      <article>
                        <div><strong>{relationLabel(relation.relation)} · {relation.title}</strong><p>{relation.reason}</p><code>{relation.slug}</code></div>
                        <button class="clean-button quiet" type="button" aria-label={`Remove relationship to ${relation.title}`} onclick={() => updateDraft('relatedItems', g.relatedItems.filter((candidate) => candidate.slug !== relation.slug))}>Remove</button>
                      </article>
                    {/each}
                  </div>
                {/if}
              </div>
            </details>
          </div>

          <aside class="builder-preview">
            <p class="eyebrow">Exactly what the builder receives</p>
            <pre>{builderPreview}</pre>
            <div class="provenance"><span>Groomed by</span><strong>{model ?? g.modelId ?? 'Manual edit'}</strong><span>Revision {g.revision}</span></div>
          </aside>
        </div>

        {#if item}
          <details class="record">
            <summary>Record and lifecycle</summary>
            <dl>
              <div><dt>Identifier</dt><dd><code>{item.slug}</code></dd></div>
              <div><dt>State</dt><dd>{STAGE_META[item.stage].label} · {STAGE_META[item.stage].question}</dd></div>
              <div><dt>Route</dt><dd>{kind} → {item.lane} lane</dd></div>
              <div><dt>Arrived through</dt><dd>{item.intake ?? 'capability ledger'}</dd></div>
              <div><dt>Attempts</dt><dd>{item.attempts} of {item.attemptCeiling}</dd></div>
              <div><dt>Last touched</dt><dd>{ago(item.updatedAt)}</dd></div>
            </dl>
            {#if item.lastError}<p class="record-warning"><strong>Last build failure</strong>{item.lastError}</p>{/if}
          </details>

          <details class="danger-zone" open={confirmRemove}>
            <summary onclick={() => (confirmRemove = true)}>Park or remove this feature</summary>
            <p>Parking keeps it visible but out of build selection. Removing hides it and retains a tombstone so the engine cannot recreate it tomorrow.</p>
            <div class="danger-actions">
              {#if item.stage === 'parked'}
                <button class="clean-button" type="button" disabled={destructiveBusy} onclick={() => statusAction('restore')}>Put back in queue</button>
              {:else if item.stage !== 'live' && item.stage !== 'verifying'}
                <button class="clean-button" type="button" disabled={destructiveBusy} onclick={() => statusAction('park')}>Park feature</button>
              {/if}
              {#if !confirmRemove}
                <button class="clean-button danger" type="button" disabled={destructiveBusy} onclick={() => (confirmRemove = true)}>Remove feature…</button>
              {:else}
                <button class="clean-button danger solid" type="button" disabled={destructiveBusy} onclick={() => statusAction('remove')}>{destructiveBusy ? 'Removing…' : 'Confirm removal'}</button>
                <button class="clean-button" type="button" disabled={destructiveBusy} onclick={() => (confirmRemove = false)}>Keep feature</button>
              {/if}
            </div>
          </details>
        {/if}
      </section>
    {/if}
  {/if}

  {#snippet foot()}
    <div class="footer-actions">
      <button class="clean-button quiet" type="button" disabled={saving || groomingBusy || destructiveBusy} onclick={onclose}>Close</button>
      <span class="footer-spacer"></span>
      {#if actionable}
        {#if step === 'brief'}
          <button class="clean-button" type="button" disabled={saving || groomingBusy} onclick={() => save(false)}>{saving ? 'Saving…' : creating ? 'Add without grooming' : 'Save brief only'}</button>
          <button class="clean-button primary" type="button" disabled={saving || groomingBusy} onclick={() => groom()}>{groomingBusy ? 'Grooming…' : 'Groom with default model →'}</button>
        {:else if step === 'groom'}
          <button class="clean-button" type="button" disabled={groomingBusy} onclick={() => go('brief')}>← Back to brief</button>
          {#if draft}<button class="clean-button primary" type="button" disabled={groomingBusy} onclick={applyModelDraft}>Apply draft and review →</button>{/if}
        {:else}
          <button class="clean-button" type="button" disabled={saving} onclick={() => go(draft?.modelId === 'manual' ? 'brief' : 'groom')}>← Back</button>
          <button class="clean-button primary" type="button" disabled={saving} onclick={() => save(true)}>{saving ? 'Saving contract…' : creating ? 'Approve and add to backlog' : 'Approve and save contract'}</button>
        {/if}
      {/if}
    </div>
  {/snippet}
</DrillPanel>

<style>
  :global(.dp-panel.wide) {
    font-family: var(--font-body);
  }
  .journey {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    border: 1px solid var(--line-hair);
    margin-bottom: 22px;
  }
  .journey button {
    display: grid;
    grid-template-columns: 30px 1fr;
    grid-template-rows: auto auto;
    gap: 1px 10px;
    padding: 12px 14px;
    border: 0;
    border-right: 1px solid var(--line-hair);
    background: transparent;
    color: var(--text-muted);
    font-family: var(--font-body);
    text-align: left;
    cursor: pointer;
  }
  .journey button:last-child { border-right: 0; }
  .journey button:hover { background: var(--accent-tint-04); }
  .journey button.active { background: var(--bg-section); color: var(--text-primary); box-shadow: inset 0 -3px 0 var(--accent); }
  .journey button > span { grid-row: 1 / 3; align-self: center; display: grid; place-items: center; width: 28px; height: 28px; border: 1px solid var(--line-strong); font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  .journey button.active > span { color: var(--bg); background: var(--accent); border-color: var(--accent); }
  .journey b { font-size: var(--fs-nav); font-weight: 650; }
  .journey small { font-size: var(--fs-label-xs); color: var(--text-ghost); }

  .step-pane { min-height: 420px; }
  .section-heading { max-width: 720px; margin-bottom: 20px; }
  .eyebrow { margin: 0 0 5px; color: var(--accent-ink); font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: .14em; text-transform: uppercase; }
  .section-heading h2, .readonly h2 { margin: 0; font-family: var(--font-display); font-size: clamp(1.55rem, 2.7vw, 2.35rem); line-height: 1.05; color: var(--text-primary); }
  .section-heading > p:last-child { margin: 8px 0 0; color: var(--text-secondary); line-height: 1.55; }
  .brief-pane { display: grid; grid-template-columns: 1fr; gap: 18px; max-width: 860px; margin: 0 auto; }
  .property-row { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
  .field { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
  .field > span, .composer > label { color: var(--text-muted); font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; letter-spacing: .11em; text-transform: uppercase; }
  .field small { color: var(--text-ghost); font-family: var(--font-body); font-size: var(--fs-label-xs); line-height: 1.45; }
  .control { box-sizing: border-box; width: 100%; border: 1px solid var(--line-strong); border-radius: 0; padding: 10px 11px; background: var(--surface-overlay); color: var(--text-primary); font-family: var(--font-body); font-size: var(--fs-body-sm); line-height: 1.45; }
  textarea.control { resize: vertical; }
  .control:focus { outline: 2px solid var(--accent); outline-offset: -1px; border-color: var(--accent); }
  .title-input { font-family: var(--font-display); font-size: 1.25rem; font-weight: 650; }
  .model-callout { display: flex; gap: 13px; padding: 14px 16px; border: 1px solid var(--accent-tint-35); background: var(--accent-tint-04); }
  .spark { color: var(--accent); font-size: 1.35rem; line-height: 1; }
  .model-callout strong { color: var(--text-primary); }
  .model-callout p { margin: 3px 0 0; color: var(--text-secondary); font-size: var(--fs-label); line-height: 1.5; }

  .groom-pane { display: grid; grid-template-columns: minmax(0, 1fr) 310px; gap: 24px; }
  .groom-main { min-width: 0; }
  .groom-side { display: flex; flex-direction: column; gap: 12px; border-left: 1px solid var(--line-hair); padding-left: 18px; }
  .model-chip { display: flex; align-items: center; gap: 7px; padding: 7px 9px; border: 1px solid var(--line-hair); color: var(--text-muted); font-family: var(--font-mono); font-size: var(--fs-label-xs); overflow-wrap: anywhere; }
  .live-dot { width: 7px; height: 7px; background: var(--good); border-radius: 50%; flex: none; }
  .empty-ai { text-align: center; border: 1px dashed var(--line-strong); padding: 34px 20px; }
  .empty-ai h3 { margin: 8px 0 5px; font-family: var(--font-display); font-size: 1.3rem; }
  .empty-ai p { max-width: 480px; margin: 0 auto 16px; color: var(--text-secondary); line-height: 1.5; }
  .conversation { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
  .bubble { max-width: 88%; padding: 11px 13px; border: 1px solid var(--line-hair); }
  .bubble.assistant { align-self: flex-start; background: var(--bg-section); border-left: 3px solid var(--accent); }
  .bubble.user { align-self: flex-end; background: var(--accent-tint-08); border-right: 3px solid var(--accent-ink); }
  .bubble > span { color: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: .08em; text-transform: uppercase; }
  .bubble p { margin: 5px 0 0; color: var(--text-secondary); line-height: 1.55; white-space: pre-wrap; }
  .bubble.thinking { opacity: .72; }
  .composer { padding: 12px; border: 1px solid var(--line-strong); background: var(--surface-overlay); }
  .composer textarea { margin-top: 7px; border-color: var(--line-hair); }
  .composer-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 8px; }
  .composer-foot > span { color: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  .readiness-card, .side-block { padding: 12px; border: 1px solid var(--line-hair); background: var(--surface-overlay); }
  .readiness-card { border-top: 3px solid var(--accent-ink); }
  .readiness-card.status-ready { border-top-color: var(--good); }
  .readiness-card.status-needs_input { border-top-color: var(--warn); }
  .readiness-top { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; }
  .readiness-top span { color: var(--text-muted); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: .1em; }
  .readiness-top strong { font-family: var(--font-display); font-size: 1.45rem; }
  .meter { height: 5px; margin: 8px 0; background: var(--line-hair); }
  .meter i { display: block; height: 100%; background: var(--accent); }
  .readiness-card.status-ready .meter i { background: var(--good); }
  .readiness-card.status-needs_input .meter i { background: var(--warn); }
  .readiness-card p, .side-block p { margin: 0; color: var(--text-secondary); font-size: var(--fs-label); line-height: 1.45; }
  .side-block h3 { margin: 0 0 8px; font-family: var(--font-display); font-size: var(--fs-body); }
  .side-block ul { margin: 0; padding-left: 18px; color: var(--text-secondary); font-size: var(--fs-label); line-height: 1.5; }
  .questions { border-left: 3px solid var(--warn); background: var(--warn-bg); }
  .compact-spec dl { display: grid; grid-template-columns: repeat(2, 1fr); gap: 7px; margin: 0; }
  .compact-spec dl div { padding: 7px; background: var(--bg-section); }
  .compact-spec dt { color: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; }
  .compact-spec dd { margin: 2px 0 0; color: var(--text-primary); font-weight: 650; }
  .suggested-shell > strong, .suggested-shell > span, .suggested-shell > small { display: block; }
  .suggested-shell > strong { color: var(--text-primary); line-height: 1.35; }
  .suggested-shell > span { margin: 3px 0 7px; color: var(--accent-ink); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; }
  .suggested-shell > small { margin-top: 8px; color: var(--text-ghost); font-size: var(--fs-label-xs); }
  .relations article { padding: 9px 0; border-top: 1px solid var(--line-hair); }
  .relations article:first-of-type { border-top: 0; }
  .relations article.duplicate { margin-inline: -12px; padding-inline: 12px; background: var(--error-bg); }
  .relations article > span { color: var(--accent-ink); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; }
  .relations article strong, .relations article code { display: block; margin-top: 3px; }
  .relations article code { color: var(--text-ghost); font-size: var(--fs-label-xs); overflow-wrap: anywhere; }

  .review-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; }
  .readiness-inline { min-width: 110px; padding: 10px 12px; border: 1px solid var(--line-hair); border-top: 3px solid var(--accent-ink); text-align: right; }
  .readiness-inline.status-ready { border-top-color: var(--good); }
  .readiness-inline.status-needs_input { border-top-color: var(--warn); }
  .readiness-inline strong, .readiness-inline span { display: block; }
  .readiness-inline strong { font-family: var(--font-display); font-size: 1.5rem; }
  .readiness-inline span { color: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; }
  .review-properties { display: grid; grid-template-columns: minmax(0, 1fr) 180px 110px; gap: 12px; margin-bottom: 18px; padding: 12px; border: 1px solid var(--line-hair); background: var(--bg-section); }
  .review-grid { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 22px; align-items: start; }
  .review-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 12px; }
  .review-fields .full, .advanced { grid-column: 1 / -1; }
  .advanced, .record, .danger-zone { border: 1px solid var(--line-hair); }
  .advanced summary, .record summary, .danger-zone summary { padding: 11px 12px; cursor: pointer; color: var(--text-secondary); font-weight: 650; background: var(--bg-section); }
  .advanced-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 12px; padding: 14px; }
  .advanced-grid .full { grid-column: 1 / -1; }
  .relation-review article { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 10px 0; border-top: 1px solid var(--line-hair); }
  .relation-review article:first-of-type { margin-top: 2px; }
  .relation-review article p { margin: 3px 0; color: var(--text-secondary); font-size: var(--fs-label); }
  .relation-review article code { color: var(--text-ghost); font-size: var(--fs-label-xs); }
  .builder-preview { position: sticky; top: 0; border: 1px solid var(--line-strong); border-top: 3px solid var(--accent); background: var(--bg-section); padding: 13px; min-width: 0; }
  .builder-preview pre { max-height: 510px; overflow: auto; margin: 8px 0 12px; padding: 11px; background: var(--surface-overlay); border: 1px solid var(--line-hair); color: var(--text-secondary); font-family: var(--font-mono); font-size: var(--fs-label-xs); line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
  .provenance { display: flex; flex-wrap: wrap; gap: 4px 9px; color: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  .provenance strong { color: var(--text-secondary); overflow-wrap: anywhere; }
  .record, .danger-zone { margin-top: 18px; }
  .record dl { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; margin: 0; }
  .record dl div { padding: 10px 12px; border-top: 1px solid var(--line-hair); }
  .record dt { color: var(--text-ghost); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; }
  .record dd { margin: 3px 0 0; color: var(--text-secondary); font-size: var(--fs-label); overflow-wrap: anywhere; }
  .record-warning { display: grid; gap: 3px; margin: 0; padding: 11px 12px; border-top: 1px solid var(--warn); background: var(--warn-bg); color: var(--text-secondary); }
  .danger-zone { border-color: var(--error-border); }
  .danger-zone > p { margin: 0; padding: 12px; color: var(--text-secondary); line-height: 1.5; }
  .danger-actions { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 12px 12px; }

  .modal-error { margin: 0 0 16px; padding: 10px 12px; color: var(--error); background: var(--error-bg); border-left: 3px solid var(--error); font-size: var(--fs-label); }
  .clean-button { min-height: 36px; padding: 7px 13px; border: 1px solid var(--line-strong); border-radius: 0; background: var(--surface-overlay); color: var(--text-secondary); font-family: var(--font-body); font-size: var(--fs-label); font-weight: 650; cursor: pointer; }
  .clean-button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent-ink); }
  .clean-button.primary { border-color: var(--accent); background: var(--accent); color: var(--bg); }
  .clean-button.primary:hover:not(:disabled) { background: var(--accent-ink); color: var(--bg); }
  .clean-button.quiet { background: transparent; }
  .clean-button.danger { color: var(--error); border-color: var(--error-border); }
  .clean-button.danger.solid { background: var(--error); border-color: var(--error); color: white; }
  .clean-button:disabled { cursor: wait; opacity: .55; }
  .footer-actions { display: flex; width: 100%; align-items: center; gap: 8px; flex-wrap: wrap; }
  .footer-spacer { flex: 1; }
  .readonly { max-width: 740px; margin: 10px auto; }
  .readonly > p:not(.eyebrow) { color: var(--text-secondary); line-height: 1.6; }
  .context-card { margin: 18px 0; padding: 13px; border-left: 3px solid var(--accent); background: var(--bg-section); }
  .context-card p { margin: 5px 0 0; color: var(--text-secondary); }
  .helper { padding-top: 14px; border-top: 1px solid var(--line-hair); }

  @media (max-width: 850px) {
    .groom-pane, .review-grid { grid-template-columns: 1fr; }
    .groom-side { border-left: 0; border-top: 1px solid var(--line-hair); padding: 16px 0 0; }
    .builder-preview { position: static; }
    .record dl { grid-template-columns: repeat(2, 1fr); }
  }
  @media (max-width: 640px) {
    .journey button { grid-template-columns: 24px 1fr; padding: 9px 7px; gap: 2px 6px; }
    .journey button > span { width: 22px; height: 22px; }
    .journey small { display: none; }
    .property-row, .review-properties, .review-fields, .advanced-grid { grid-template-columns: 1fr; }
    .review-fields .full, .advanced, .advanced-grid .full { grid-column: auto; }
    .review-head { align-items: stretch; }
    .readiness-inline { min-width: 82px; }
    .record dl { grid-template-columns: 1fr; }
    .footer-spacer { display: none; }
    .footer-actions .clean-button { flex: 1 1 auto; }
  }
</style>
