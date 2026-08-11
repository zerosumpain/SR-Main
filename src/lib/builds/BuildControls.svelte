<script lang="ts">
  /**
   * The no-code control surface for a running build.
   *
   * Every control here writes a column on `jkai_builds`, and
   * `Orchestrator.runIteration` re-reads that row at the top of every
   * iteration — so a change made while a build is running takes effect on the
   * next one. That is the whole point: these are the variables that previously
   * needed a second session and a psql prompt to change.
   *
   * Controls that write immediately (selects, checkboxes, numbers) do so on
   * change and show a transient "saved" mark. The chapter spine is a draft with
   * an explicit Save, because renumbering mid-keystroke would fight the typist.
   */
  import {
    BUDGET_FIELDS,
    THINKING_LEVELS,
    RESEARCH_MODE_OPTIONS,
    type ChapterPlanEntry,
  } from './settings';
  import { untrack } from 'svelte';

  interface Build {
    id: string;
    origin: string;
    status: string;
    modelProvider: string;
    modelId: string;
    thinkingLevel: string | null;
    enforceDesignSystem: boolean;
    requireIterationApproval: boolean;
    planStatus: string;
    researchMode: string | null;
    enabledToolsets: string[] | null;
    budgetConfig: Record<string, number> | null;
    chapterPlan: ChapterPlanEntry[] | null;
  }

  interface ToolsetInfo {
    toolset: string;
    description: string;
    toolCount: number;
  }

  let {
    build,
    toolsets = [],
    catalogueLoading = false,
    spine = $bindable(null),
    onAfter,
  }: {
    build: Build;
    toolsets?: ToolsetInfo[];
    /** The toolset catalogue arrives with the build config, fetched lazily. */
    catalogueLoading?: boolean;
    /**
     * The chapter-spine draft, owned by the parent so switching tabs does not
     * destroy half-typed chapters along with this component. `key` is the
     * serialised spine the draft was seeded from, which is how "dirty" is
     * decided and how a spine changed on the server gets re-seeded.
     */
    spine?: { draft: ChapterPlanEntry[]; key: string } | null;
    onAfter: () => void | Promise<void>;
  } = $props();

  const isStudio = $derived(build.origin === 'studio');
  const budget = $derived((build.budgetConfig ?? {}) as Record<string, number>);
  const enabled = $derived(build.enabledToolsets ?? ['all']);
  const allToolsets = $derived(enabled.includes('all'));

  let saving = $state<string | null>(null);
  let savedAt = $state<string | null>(null);
  let error = $state<string | null>(null);
  // A plain timer handle: never $state, or the effect that clears it would
  // subscribe to its own write.
  let savedTimer: ReturnType<typeof setTimeout> | null = null;

  async function patch(updates: Record<string, unknown>, label: string): Promise<void> {
    saving = label;
    error = null;
    try {
      const r = await fetch(`/api/jkai/builds/${build.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!r.ok) {
        error = `${label}: ${(await r.text().catch(() => r.statusText)).slice(0, 160)}`;
        return;
      }
      savedAt = label;
      if (savedTimer) clearTimeout(savedTimer);
      savedTimer = setTimeout(() => { savedAt = null; }, 2200);
      await onAfter();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      saving = null;
    }
  }

  /**
   * Write one budget field, and make the box show what was actually stored.
   *
   * Two traps here. First, clearing a field that cannot be null (the idle
   * breaker) would validate to nothing, return `noop`, and still flash "saved"
   * while the old cap stayed in force — so an empty value falls back to that
   * field's floor rather than to null. Second, `value=` is a one-way expression:
   * when a typed number clamps back to the value already stored, the expression
   * does not change and Svelte leaves the DOM alone, stranding an out-of-range
   * number in a box that no longer reflects the build. So the input is
   * corrected explicitly.
   */
  function setBudget(el: HTMLInputElement, key: string, raw: string, label: string): void {
    const spec = BUDGET_FIELDS.find((f) => f.key === key);
    const trimmed = raw.trim();
    let value: number | null;
    if (trimmed === '') {
      value = spec?.nullable === false ? (spec?.min ?? 0) : null;
    } else {
      const n = Number(trimmed);
      if (!Number.isFinite(n)) {
        el.value = fmtPlaceholder(key);
        return;
      }
      value = spec ? Math.min(spec.max, Math.max(spec.min, n)) : n;
    }
    el.value = value === null ? '' : String(value);
    void patch({ budgetConfig: { [key]: value } }, label);
  }

  function toggleToolset(name: string, on: boolean): void {
    // 'all' is a wildcard, not a member. The first time a specific toolset is
    // unticked we have to expand the wildcard into the real list, otherwise
    // removing one from ['all'] would mean nothing.
    const base = allToolsets ? toolsets.map((t) => t.toolset) : enabled.filter((t) => t !== 'all');
    const next = on ? [...new Set([...base, name])] : base.filter((t) => t !== name);
    // Back to everything → collapse to the wildcard so new toolsets are picked
    // up automatically rather than being frozen out by an explicit list.
    const collapsed = next.length === toolsets.length ? ['all'] : next;
    void patch({ enabledToolsets: collapsed }, 'toolsets');
  }

  // --- Chapter spine (studio only) ---
  // A draft, so typing does not renumber under the cursor, and parent-owned so
  // it survives a tab switch. Seeded from the build row, and re-seeded only when
  // the row's own spine changes — reads hoisted, writes untracked, per the
  // prop-sync rule.
  $effect(() => {
    const incoming = build.chapterPlan ?? [];
    const key = JSON.stringify(incoming);
    untrack(() => {
      if (!spine || spine.key !== key) {
        spine = { draft: incoming.map((c) => ({ ...c })), key };
      }
    });
  });
  const draft = $derived(spine?.draft ?? []);
  const spineDirty = $derived(!!spine && JSON.stringify(spine.draft) !== spine.key);

  function addChapter(): void {
    if (!spine) return;
    spine.draft = [...spine.draft, { n: spine.draft.length + 1, title: '', leverId: '', outcomeId: '' }];
  }
  function removeChapter(i: number): void {
    if (!spine) return;
    spine.draft = spine.draft.filter((_, j) => j !== i).map((c, j) => ({ ...c, n: j + 1 }));
  }
  function saveSpine(): void {
    if (!spine) return;
    void patch({ chapterPlan: spine.draft }, 'chapter spine');
  }
  function resetSpine(): void {
    if (!spine) return;
    spine = { draft: (build.chapterPlan ?? []).map((c) => ({ ...c })), key: spine.key };
  }

  // --- Standing instructions ---
  // Notes are re-injected into EVERY iteration by the builder. This is the one
  // prompt-level override that already exists; it was only ever reachable by
  // typing a '# ' prefix into the session composer, which nothing told you.
  let notes = $state<Array<{ id: number; content: string }>>([]);
  let noteDraft = $state('');
  let noteBusy = $state(false);

  async function loadNotes(): Promise<void> {
    try {
      const r = await fetch(`/api/jkai/builds/${build.id}/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'snapshot' }),
      });
      if (r.ok) notes = ((await r.json()).notes ?? []) as Array<{ id: number; content: string }>;
    } catch {
      /* the session panel's SSE will bring them anyway */
    }
  }
  async function sessionPost(payload: Record<string, unknown>): Promise<void> {
    noteBusy = true;
    try {
      await fetch(`/api/jkai/builds/${build.id}/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      await loadNotes();
    } finally {
      noteBusy = false;
    }
  }
  async function addNote(): Promise<void> {
    const c = noteDraft.trim();
    if (!c) return;
    await sessionPost({ kind: 'note_add', content: c });
    noteDraft = '';
  }

  $effect(() => {
    const id = build.id;
    untrack(() => { void loadNotes(); });
    return () => { if (savedTimer) clearTimeout(savedTimer); void id; };
  });

  function fmtPlaceholder(key: string): string {
    const v = budget[key];
    return v === undefined || v === null ? '' : String(v);
  }
</script>

<div class="bc">
  {#if error}
    <p class="bc-err" role="alert">{error}</p>
  {/if}

  <div class="bc-grid">
    <!-- Model ------------------------------------------------------------ -->
    <section class="bc-card">
      <header class="bc-hd">
        <h3 class="sr-label-tight">Model</h3>
        {#if savedAt === 'thinking'}<span class="bc-saved">saved</span>{/if}
      </header>
      <dl class="bc-facts">
        <dt>Provider</dt>
        <dd>{build.modelProvider}</dd>
        <dt>Model</dt>
        <dd class="bc-break">{build.modelId}</dd>
      </dl>
      <label class="bc-field">
        <span class="bc-k">Thinking level</span>
        <select
          class="nm-text-input"
          value={build.thinkingLevel ?? 'medium'}
          disabled={saving !== null}
          onchange={(e) => patch({ thinkingLevel: e.currentTarget.value }, 'thinking')}
        >
          {#each THINKING_LEVELS as lv (lv)}
            <option value={lv}>{lv}</option>
          {/each}
        </select>
      </label>
      <p class="bc-help">
        Higher levels buy deliberation at the cost of tokens and latency. A reasoning floor can eat
        the output budget before any answer is written.
      </p>
    </section>

    <!-- Guardrails ------------------------------------------------------- -->
    <section class="bc-card">
      <header class="bc-hd">
        <h3 class="sr-label-tight">Guardrails</h3>
        {#if savedAt === 'design system' || savedAt === 'idle breaker'}<span class="bc-saved">saved</span>{/if}
      </header>
      <label class="bc-check">
        <input
          type="checkbox"
          checked={build.enforceDesignSystem}
          disabled={saving !== null}
          onchange={(e) => patch({ enforceDesignSystem: e.currentTarget.checked }, 'design system')}
        />
        <span>
          <strong>Enforce the site design system</strong>
          <em>Lints every written file for raw hex, Tailwind classes and untokenised fonts. Three unfixable findings in a row aborts the build.</em>
        </span>
      </label>
      <label class="bc-field">
        <span class="bc-k">Idle-iteration breaker</span>
        <input
          class="nm-text-input"
          type="number"
          min="0"
          max="20"
          value={fmtPlaceholder('maxIdleIterations')}
          placeholder="0 = off"
          disabled={saving !== null}
          onchange={(e) => setBudget(e.currentTarget, 'maxIdleIterations', e.currentTarget.value, 'idle breaker')}
        />
      </label>
      <p class="bc-help">
        Stops the build after this many consecutive iterations that changed no files — the failure
        mode where an agent re-verifies the same thing forever.
      </p>
    </section>

    <!-- Gates ------------------------------------------------------------ -->
    <section class="bc-card">
      <header class="bc-hd">
        <h3 class="sr-label-tight">Gates</h3>
        {#if savedAt === 'iteration approval'}<span class="bc-saved">saved</span>{/if}
      </header>
      <label class="bc-check">
        <input
          type="checkbox"
          checked={build.requireIterationApproval}
          disabled={saving !== null}
          onchange={(e) =>
            patch({ requireIterationApproval: e.currentTarget.checked }, 'iteration approval')}
        />
        <span>
          <strong>Approve each iteration</strong>
          <em>The build parks after every iteration until you approve or reject it. Rejection notes are appended to the prompt.</em>
        </span>
      </label>
      <dl class="bc-facts">
        <dt>Plan</dt>
        <dd>{build.planStatus}</dd>
        <dt>Studio gate</dt>
        <dd>
          {#if !isStudio}
            not applicable — only studio builds are chapter-checked
          {:else if (build.chapterPlan ?? []).length === 0}
            <span class="bc-flag warn">no spine — nothing is being checked</span>
          {:else}
            {(build.chapterPlan ?? []).length} chapters checked each iteration
          {/if}
        </dd>
      </dl>
    </section>

    <!-- Budget ----------------------------------------------------------- -->
    <section class="bc-card bc-wide">
      <header class="bc-hd">
        <h3 class="sr-label-tight">Budget</h3>
        {#if savedAt && BUDGET_FIELDS.some((f) => f.key === savedAt)}<span class="bc-saved">saved</span>{/if}
      </header>
      <div class="bc-budget">
        {#each BUDGET_FIELDS.filter((f) => f.key !== 'maxIdleIterations') as f (f.key)}
          <label class="bc-field">
            <span class="bc-k">{f.label}</span>
            <input
              class="nm-text-input"
              type="number"
              min={f.min}
              max={f.max}
              step={f.step}
              value={fmtPlaceholder(f.key)}
              placeholder={f.nullable ? 'no cap' : String(f.min)}
              disabled={saving !== null}
              onchange={(e) => setBudget(e.currentTarget, f.key, e.currentTarget.value, f.key)}
            />
            <em class="bc-help">{f.help}</em>
          </label>
        {/each}
      </div>
    </section>

    <!-- Studio ----------------------------------------------------------- -->
    {#if isStudio}
      <section class="bc-card bc-wide">
        <header class="bc-hd">
          <h3 class="sr-label-tight">Studio — evidence</h3>
          {#if savedAt === 'evidence'}<span class="bc-saved">saved</span>{/if}
        </header>
        <div class="bc-radios">
          {#each RESEARCH_MODE_OPTIONS as opt (opt.value)}
            <label class="bc-radio" class:active={(build.researchMode ?? 'extend') === opt.value}>
              <input
                type="radio"
                name="researchMode"
                value={opt.value}
                checked={(build.researchMode ?? 'extend') === opt.value}
                disabled={saving !== null}
                onchange={() => patch({ researchMode: opt.value }, 'evidence')}
              />
              <span>
                <strong>{opt.label}</strong>
                <em>{opt.help}</em>
              </span>
            </label>
          {/each}
        </div>
        <p class="bc-help">
          Changing this after the research brief has been written has no effect on that brief — it
          governs the next research run.
        </p>
      </section>

      <section class="bc-card bc-wide">
        <header class="bc-hd">
          <h3 class="sr-label-tight">Studio — chapter spine</h3>
          {#if savedAt === 'chapter spine'}<span class="bc-saved">saved</span>{/if}
        </header>
        <p class="bc-help">
          The gate drives these ids as data attributes: it clicks
          <code>leverId</code> and checks <code>outcomeId</code> moved. A chapter with no declared
          pair cannot be interactivity-checked, and a check that cannot run is a check that silently
          passes.
        </p>
        {#if draft.length === 0}
          <p class="bc-empty">
            No spine. Nothing is checking this build's chapters — no reachability, interactivity or
            citation findings will be produced.
          </p>
        {/if}
        <ol class="bc-spine">
          {#each draft as ch, i (i)}
            <li class="bc-chapter">
              <span class="bc-n">{i + 1}</span>
              <input
                class="nm-text-input bc-title"
                type="text"
                placeholder="Chapter title"
                value={ch.title}
                oninput={(e) => { if (spine) spine.draft[i].title = e.currentTarget.value; }}
              />
              <input
                class="nm-text-input bc-id bc-lever"
                type="text"
                placeholder="leverId"
                value={ch.leverId}
                oninput={(e) => { if (spine) spine.draft[i].leverId = e.currentTarget.value; }}
              />
              <input
                class="nm-text-input bc-id bc-outcome"
                type="text"
                placeholder="outcomeId"
                value={ch.outcomeId}
                oninput={(e) => { if (spine) spine.draft[i].outcomeId = e.currentTarget.value; }}
              />
              <button class="bc-x" type="button" onclick={() => removeChapter(i)} title="Remove chapter">×</button>
            </li>
          {/each}
        </ol>
        <div class="bc-spine-actions">
          <button class="nm-btn-ghost" type="button" onclick={addChapter}>+ chapter</button>
          <button
            class="nm-save-btn"
            type="button"
            onclick={saveSpine}
            disabled={!spineDirty || saving !== null}
          >
            {saving === 'chapter spine' ? 'Saving…' : 'Save spine'}
          </button>
          {#if spineDirty}
            <button class="row-link" type="button" onclick={resetSpine}>discard changes</button>
          {/if}
        </div>
      </section>
    {/if}

    <!-- Standing instructions -------------------------------------------- -->
    <section class="bc-card bc-wide">
      <header class="bc-hd">
        <h3 class="sr-label-tight">Standing instructions</h3>
      </header>
      <p class="bc-help">
        Re-injected into every iteration until removed. This is the no-code way to change what the
        agent is told without touching the prompt in code — use it for "always use British spelling",
        "never install a charting library", "the lever ids must stay stable".
      </p>
      {#if notes.length > 0}
        <ul class="bc-notes">
          {#each notes as n (n.id)}
            <li>
              <span>{n.content}</span>
              <button
                class="bc-x"
                type="button"
                disabled={noteBusy}
                onclick={() => sessionPost({ kind: 'note_remove', id: n.id })}
                title="Remove instruction"
              >×</button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="bc-empty">None pinned.</p>
      {/if}
      <div class="bc-note-add">
        <input
          class="nm-text-input"
          type="text"
          placeholder="Add a standing instruction…"
          bind:value={noteDraft}
          disabled={noteBusy}
          onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addNote(); } }}
        />
        <button class="nm-save-btn" type="button" onclick={addNote} disabled={noteBusy || !noteDraft.trim()}>
          Pin
        </button>
      </div>
    </section>

    <!-- Toolsets --------------------------------------------------------- -->
    <section class="bc-card bc-wide">
      <header class="bc-hd">
        <h3 class="sr-label-tight">Toolsets</h3>
        {#if savedAt === 'toolsets'}<span class="bc-saved">saved</span>{/if}
      </header>
      <p class="bc-help">
        What the agent can reach beyond its shell. {allToolsets
          ? 'All toolsets are available — unticking one switches to an explicit list.'
          : 'An explicit list is in force; new toolsets will NOT be added automatically.'}
      </p>
      {#if catalogueLoading}
        <p class="bc-empty">Reading the toolset catalogue…</p>
      {:else if toolsets.length === 0}
        <p class="bc-empty">Toolset catalogue unavailable — the tool bridge did not answer.</p>
      {:else}
        <div class="bc-toolsets">
          {#each toolsets as t (t.toolset)}
            {@const on = allToolsets || enabled.includes(t.toolset)}
            <label class="bc-toolset" class:on>
              <input
                type="checkbox"
                checked={on}
                disabled={saving !== null}
                onchange={(e) => toggleToolset(t.toolset, e.currentTarget.checked)}
              />
              <span>
                <strong>{t.toolset}</strong>
                <em>{t.description}</em>
              </span>
            </label>
          {/each}
        </div>
      {/if}
    </section>
  </div>
</div>

<style>
  .bc {
    padding: 0.75rem 0.25rem 1.5rem;
    font-family: var(--font-body);
  }
  /* Discrete bordered cards with a real gap, NOT the 1px-gap-over-a-coloured-
     background trick the cockpit uses. That trick only works when every row is
     full; here the card count and the column count disagree at most widths, and
     the leftover cell renders as a stray coloured block. */
  .bc-grid {
    display: grid;
    /* 380px, not 300: at a 1400px shell a 300px minimum yields four columns for
       three cards, leaving a dead column. `min(100%, …)` keeps it to one column
       on a phone rather than overflowing. */
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr));
    gap: 0.75rem;
    align-items: start;
  }
  .bc-card {
    background: var(--bg);
    border: 1px solid var(--card-border);
    border-top: 2px solid var(--text-primary);
    padding: 0.85rem 0.9rem 1rem;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .bc-wide {
    grid-column: 1 / -1;
  }
  .bc-hd {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .bc-hd h3 {
    margin: 0;
    color: var(--text-secondary);
  }
  .bc-saved {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs, 12px);
    color: var(--success);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .bc-err {
    margin: 0 0 0.6rem;
    padding: 0.5rem 0.7rem;
    border-left: 4px solid var(--error);
    background: var(--error-bg);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
  }
  .bc-k {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs, 12px);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .bc-field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }
  .bc-field input,
  .bc-field select {
    width: 100%;
    box-sizing: border-box;
    /* 16px floor: anything smaller makes iOS Safari zoom on focus. */
    font-size: max(16px, var(--fs-body-sm, 15px));
  }
  .bc-help {
    margin: 0;
    font-size: var(--fs-label-xs, 12px);
    line-height: 1.5;
    color: var(--text-ghost);
    font-style: normal;
  }
  .bc-help code {
    font-family: var(--font-mono);
    color: var(--accent-ink);
  }
  .bc-empty {
    margin: 0;
    font-size: var(--fs-label);
    color: var(--text-ghost);
    font-style: italic;
  }
  .bc-facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.3rem 0.8rem;
    margin: 0;
    font-size: var(--fs-body-sm, 15px);
  }
  .bc-facts dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs, 12px);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .bc-facts dd {
    margin: 0;
    color: var(--text-primary);
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .bc-break {
    word-break: break-all;
  }
  .bc-flag {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs, 12px);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.05rem 0.35rem;
    border: 1px solid currentColor;
    border-radius: 2px;
  }
  .bc-flag.warn {
    color: var(--warn);
  }

  .bc-check,
  .bc-radio,
  .bc-toolset {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.55rem;
    align-items: start;
    cursor: pointer;
    padding: 0.35rem 0.4rem;
    border: 1px solid transparent;
    min-width: 0;
  }
  .bc-check:hover,
  .bc-radio:hover,
  .bc-toolset:hover {
    background: var(--accent-tint-04);
  }
  .bc-radio.active {
    border-color: var(--accent);
    background: var(--accent-tint-04);
  }
  .bc-check input,
  .bc-radio input,
  .bc-toolset input {
    margin: 0.2rem 0 0;
    /* A 24px target — the phone is the reason this pane exists. */
    width: 20px;
    height: 20px;
    flex-shrink: 0;
  }
  .bc-check strong,
  .bc-radio strong,
  .bc-toolset strong {
    display: block;
    font-family: var(--font-body);
    font-size: var(--fs-body-sm, 15px);
    font-weight: 600;
    color: var(--text-primary);
  }
  .bc-check em,
  .bc-radio em,
  .bc-toolset em {
    display: block;
    font-style: normal;
    font-size: var(--fs-label-xs, 12px);
    line-height: 1.5;
    color: var(--text-ghost);
    margin-top: 0.15rem;
  }
  .bc-toolset strong {
    font-family: var(--font-mono);
  }

  .bc-budget {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 0.9rem;
  }
  .bc-radios {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 0.3rem;
  }
  .bc-toolsets {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 0.2rem;
    max-height: 320px;
    overflow-y: auto;
  }

  /* --- Chapter spine --- */
  .bc-spine {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .bc-chapter {
    display: grid;
    grid-template-columns: 1.6rem minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) auto;
    gap: 0.4rem;
    align-items: center;
  }
  .bc-n {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs, 12px);
    color: var(--text-muted);
    text-align: right;
  }
  .bc-chapter input {
    width: 100%;
    box-sizing: border-box;
    font-size: max(16px, var(--fs-label));
  }
  .bc-id {
    font-family: var(--font-mono);
  }
  .bc-spine-actions {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .bc-x {
    background: transparent;
    border: 1px solid var(--card-border);
    width: 28px;
    height: 28px;
    cursor: pointer;
    padding: 0;
    line-height: 1;
    color: var(--text-muted);
    flex-shrink: 0;
    border-radius: 2px;
  }
  .bc-x:hover:not(:disabled) {
    color: var(--error);
    border-color: var(--error);
  }

  /* --- Standing instructions --- */
  .bc-notes {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .bc-notes li {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.5rem;
    align-items: center;
    padding: 0.35rem 0.5rem;
    background: var(--bg-section);
    border-left: 3px solid var(--accent);
    font-size: var(--fs-body-sm, 15px);
  }
  .bc-note-add {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.5rem;
  }
  .bc-note-add input {
    width: 100%;
    box-sizing: border-box;
    font-size: max(16px, var(--fs-body-sm, 15px));
  }

  @media (max-width: 640px) {
    .bc-grid {
      grid-template-columns: 1fr;
    }
    /* Stack the spine row: five columns at 390px is unusable. */
    .bc-chapter {
      grid-template-columns: 1.6rem 1fr auto;
      grid-template-areas:
        'n title x'
        '. lever lever'
        '. outcome outcome';
      row-gap: 0.25rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px dashed var(--card-border);
    }
    .bc-n { grid-area: n; }
    .bc-title { grid-area: title; }
    .bc-lever { grid-area: lever; }
    .bc-outcome { grid-area: outcome; }
    .bc-chapter .bc-x { grid-area: x; }
  }
</style>
