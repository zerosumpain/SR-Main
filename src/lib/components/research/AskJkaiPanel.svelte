<script lang="ts">
  /**
   * Ask jkai about this run — and actually ask it.
   *
   * The button used to hand the composer the fragment
   * `About my research on "<topic>" — ` and stop, so it did not ask anything:
   * it opened a chat and left you to write the question you had pressed a
   * button to avoid writing.
   *
   * Now every route from here lands in a fresh jkai thread with the question
   * already sent, so what you see is the answer streaming in the jkai window
   * rather than a primed text box. The suggestions are built from THIS report's
   * gaps, contradictions, hypotheses and follow-ups (see
   * `$lib/deepdive/ask-questions`), so they are questions the run itself raised.
   *
   * Navigation rather than an embedded chat: jkai's own window already has the
   * streaming, the tools, the thinking timeline and the model picker, and a
   * second chat surface here would be a copy of it that drifts.
   */
  import { goto } from '$app/navigation';
  import { askUrl, suggestQuestions, type AskContext, type SuggestedQuestion } from '$lib/deepdive/ask-questions';

  let {
    context,
    pending = null,
  }: {
    context: AskContext;
    /**
     * A question pushed in from elsewhere on the page — clicking an entity in
     * the network, say. Shown in the box so it can be edited before it is sent.
     */
    pending?: string | null;
  } = $props();

  let typed = $state('');
  const suggestions = $derived<SuggestedQuestion[]>(suggestQuestions(context));

  // `pending` is owned by the parent; mirroring it into `typed` from an effect
  // would fight the user the moment they edited the box. Read it as a fallback
  // instead — the parent clears it when a new question arrives.
  const value = $derived(typed || pending || '');

  function ask(question: string) {
    const q = question.trim();
    if (!q) return;
    void goto(askUrl(q, context));
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      ask(value);
    }
  }
</script>

<section class="nm-sec" id="ask">
  <div class="nm-sec-hd">
    <span class="sr-label-tight">Ask jkai about this</span>
    <span class="nm-sec-meta">answers in a jkai thread, grounded in this run</span>
  </div>

  <div class="composer">
    <input
      class="nm-text-input"
      type="text"
      value={value}
      oninput={(e) => (typed = e.currentTarget.value)}
      onkeydown={onKey}
      placeholder="Ask anything about this research…"
      aria-label="Ask jkai about this research"
    />
    <button class="nm-save-btn" type="button" disabled={!value.trim()} onclick={() => ask(value)}>
      Ask
    </button>
  </div>

  <div class="chips">
    {#each suggestions as s (s.id)}
      <button type="button" class="chip" onclick={() => ask(s.question)} title={s.question}>
        {s.label}
      </button>
    {/each}
  </div>
</section>

<style>
  /* .nm-sec, .nm-sec-hd, .sr-label-tight, .nm-sec-meta, .nm-text-input and
     .nm-save-btn all come from $lib/styles/nm-tokens.css. */
  .composer { display: flex; gap: 0.4rem; align-items: stretch; margin-bottom: 0.6rem; }
  .composer :global(.nm-text-input) { flex: 1; min-width: 0; }
  .composer :global(.nm-save-btn) { white-space: nowrap; }

  .chips { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .chip {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    border: 1px solid var(--line-strong);
    background: var(--bg);
    color: var(--text-secondary);
    padding: 4px 8px;
    cursor: pointer;
    text-align: left;
  }
  .chip:hover { border-color: var(--accent); color: var(--accent); }
</style>
