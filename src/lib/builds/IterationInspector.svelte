<script lang="ts">
  /**
   * Iteration inspector — pick an iteration, read what it was ASKED to do, and
   * read what it actually DID.
   *
   * The three things this answers, none of which the stream answered well:
   *   1. what prompt did this iteration receive (and what was the build's
   *      original request)
   *   2. every command it ran, expandable, on a dark terminal surface
   *   3. where in all that output does <search term> appear
   *
   * The per-iteration prompt is real, not reconstructed: `messages[0]` is the
   * user turn the orchestrator sent, persisted by the runner.
   */
  import ShikiCodeBlock from '$lib/canvas/nodes/ShikiCodeBlock.svelte';

  interface Action {
    lang?: string;
    code?: string;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
  }
  interface Iter {
    id: string;
    number: number;
    status: string;
    tokensUsed?: number | null;
    durationMs?: number | null;
    actions?: unknown;
    messages?: unknown;
    evaluation?: string | null;
    nextSteps?: string | null;
  }

  let {
    iterations = [],
    buildPrompt = null,
  }: { iterations?: Iter[]; buildPrompt?: string | null } = $props();

  // Real iterations only — number 0 is the planner's bookkeeping row.
  const real = $derived(
    [...(iterations ?? [])].filter((i) => i && i.number > 0).sort((a, b) => a.number - b.number),
  );

  let selectedNumber = $state<number | null>(null);
  let query = $state('');
  let showBuildPrompt = $state(false);
  let openIndexes = $state<number[]>([]);

  // Default to the newest iteration and follow it as new ones arrive; once
  // `selectedNumber` is set the user's choice sticks.
  const selected = $derived.by(() => {
    const list = real;
    if (!list.length) return null;
    if (selectedNumber === null) return list[list.length - 1];
    return list.find((i) => i.number === selectedNumber) ?? list[list.length - 1];
  });

  function pick(n: number): void {
    selectedNumber = n;
    openIndexes = [];
  }

  const actions = $derived.by<Action[]>(() => {
    const a = selected?.actions;
    return Array.isArray(a) ? (a as Action[]) : [];
  });

  /** The user turn the orchestrator sent this iteration. */
  const iterationPrompt = $derived.by(() => {
    const m = selected?.messages;
    if (!Array.isArray(m)) return null;
    const first = (m as Array<{ role?: string; content?: string }>).find((x) => x?.role === 'user');
    return typeof first?.content === 'string' && first.content.trim() ? first.content : null;
  });

  function actionText(a: Action): string {
    return [a.code ?? '', a.stdout ?? '', a.stderr ?? ''].join('\n');
  }
  function countMatches(hay: string, needle: string): number {
    if (!needle) return 0;
    const h = hay.toLowerCase();
    const n = needle.toLowerCase();
    let i = 0;
    let c = 0;
    for (;;) {
      const at = h.indexOf(n, i);
      if (at === -1) break;
      c += 1;
      i = at + n.length;
    }
    return c;
  }

  const rows = $derived.by(() => {
    const q = query.trim();
    return actions
      .map((a, i) => ({ a, i, matches: q ? countMatches(actionText(a), q) : 0 }))
      .filter((r) => !q || r.matches > 0);
  });

  const totalMatches = $derived(rows.reduce((s, r) => s + r.matches, 0));

  /** Shiki language for a tool's argument blob. */
  function langFor(a: Action): string {
    const t = (a.lang ?? '').toLowerCase();
    if (t === 'bash' || t === 'shell') return 'bash';
    if (t === 'write' || t === 'edit') return guessLangFromPath(a.code ?? '');
    if (t === 'read' || t === 'ls' || t === 'find' || t === 'grep') return 'text';
    return 'text';
  }
  function guessLangFromPath(firstLine: string): string {
    const path = firstLine.split('\n')[0] ?? '';
    if (/\.tsx?$/.test(path)) return 'typescript';
    if (/\.jsx?$|\.mjs$/.test(path)) return 'javascript';
    if (/\.svelte$/.test(path)) return 'svelte';
    if (/\.json$/.test(path)) return 'json';
    if (/\.css$/.test(path)) return 'css';
    if (/\.html?$/.test(path)) return 'html';
    if (/\.md$/.test(path)) return 'markdown';
    if (/\.py$/.test(path)) return 'python';
    return 'text';
  }
  function firstLine(s: string | undefined, max = 96): string {
    const l = (s ?? '').split('\n').find((x) => x.trim()) ?? '';
    return l.length > max ? `${l.slice(0, max - 1)}…` : l;
  }
  function toggle(i: number): void {
    openIndexes = openIndexes.includes(i)
      ? openIndexes.filter((x) => x !== i)
      : [...openIndexes, i];
  }
  function fmtTokens(n: number | null | undefined): string {
    if (!n) return '0';
    if (n < 1000) return String(n);
    if (n < 1_000_000) return `${(n / 1000).toFixed(0)}k`;
    return `${(n / 1_000_000).toFixed(2)}M`;
  }
</script>

{#if real.length}
  <section class="ii" aria-label="Iteration inspector">
    <header class="ii-hd">
      <h3 class="sr-label-tight">Iterations</h3>
      <nav class="ii-chips" aria-label="Select an iteration">
        {#each real as it (it.id)}
          <button
            type="button"
            class="ii-chip"
            class:active={selected?.number === it.number}
            class:failed={it.status === 'failed'}
            onclick={() => pick(it.number)}
            title={`Iteration ${it.number} · ${it.status} · ${fmtTokens(it.tokensUsed)} tokens`}
          >
            {it.number}
          </button>
        {/each}
      </nav>
    </header>

    {#if selected}
      <!-- What it was asked to do. -->
      <div class="ii-prompt">
        <div class="ii-prompt-hd">
          <span class="ii-k">Prompt for iteration {selected.number}</span>
          {#if buildPrompt}
            <button type="button" class="ii-link" onclick={() => (showBuildPrompt = !showBuildPrompt)}>
              {showBuildPrompt ? 'hide original request' : 'show original request'}
            </button>
          {/if}
        </div>
        {#if showBuildPrompt && buildPrompt}
          <p class="ii-note">The build's original request, unchanged across every iteration:</p>
          <ShikiCodeBlock content={buildPrompt} lang="markdown" collapsedLines={10} dark />
        {/if}
        {#if iterationPrompt}
          <ShikiCodeBlock content={iterationPrompt} lang="markdown" collapsedLines={10} dark />
        {:else}
          <p class="ii-empty">
            No prompt recorded for this iteration — it predates prompt capture, or the run died
            before the first turn was persisted.
          </p>
        {/if}
      </div>

      <!-- What it actually did. -->
      <div class="ii-tools">
        <label class="ii-search">
          <span class="ii-k">Search this iteration</span>
          <input
            class="nm-text-input"
            type="search"
            placeholder="command or output text…"
            bind:value={query}
            aria-label="Search commands and output in this iteration"
          />
        </label>
        <span class="ii-count">
          {#if query.trim()}
            {totalMatches} match{totalMatches === 1 ? '' : 'es'} in {rows.length} of {actions.length}
          {:else}
            {actions.length} action{actions.length === 1 ? '' : 's'}
          {/if}
        </span>
      </div>

      {#if rows.length}
        <ul class="ii-list">
          {#each rows as r (r.i)}
            {@const open = openIndexes.includes(r.i)}
            <li class="ii-row" class:err={(r.a.exitCode ?? 0) !== 0}>
              <button
                type="button"
                class="ii-row-hd"
                onclick={() => toggle(r.i)}
                aria-expanded={open}
              >
                <span class="ii-tool">{r.a.lang ?? 'tool'}</span>
                <span class="ii-sum">{firstLine(r.a.code) || '(no arguments)'}</span>
                {#if r.matches}<span class="ii-match">{r.matches}</span>{/if}
                {#if (r.a.exitCode ?? 0) !== 0}<span class="ii-bad">failed</span>{/if}
                <span class="ii-caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
              </button>

              {#if open}
                <div class="ii-body">
                  {#if r.a.code}
                    <span class="ii-k ii-body-k">Command</span>
                    <ShikiCodeBlock content={r.a.code} lang={langFor(r.a)} collapsedLines={14} dark />
                  {/if}
                  {#if r.a.stdout?.trim()}
                    <span class="ii-k ii-body-k">Output</span>
                    <ShikiCodeBlock content={r.a.stdout} lang="text" collapsedLines={14} dark />
                  {/if}
                  {#if r.a.stderr?.trim()}
                    <span class="ii-k ii-body-k">Errors</span>
                    <ShikiCodeBlock content={r.a.stderr} lang="text" collapsedLines={14} dark />
                  {/if}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {:else if query.trim()}
        <p class="ii-empty">Nothing in iteration {selected.number} matches “{query.trim()}”.</p>
      {:else}
        <p class="ii-empty">This iteration recorded no actions.</p>
      {/if}

      {#if selected.evaluation}
        <details class="ii-eval">
          <summary class="ii-k">Evaluation written by the agent</summary>
          <pre class="ii-pre">{selected.evaluation}</pre>
        </details>
      {/if}
    {/if}
  </section>
{/if}

<style>
  .ii {
    border: 2px solid var(--text-primary);
    background: var(--bg);
    padding: 0.85rem 0.9rem 1rem;
    margin-bottom: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-width: 0;
  }
  .ii-hd {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .ii-hd h3 {
    margin: 0;
    color: var(--text-secondary);
  }
  .ii-chips {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  .ii-chip {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs, 12px);
    min-width: 2rem;
    padding: 0.2rem 0.45rem;
    border: 1px solid var(--card-border);
    background: var(--bg);
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: 2px;
  }
  .ii-chip:hover {
    border-color: var(--accent);
  }
  .ii-chip.active {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }
  /* Status, not a series — the underline survives the active fill. */
  .ii-chip.failed {
    border-bottom: 3px solid var(--error);
  }

  .ii-k {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs, 12px);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .ii-prompt-hd {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.35rem;
  }
  .ii-link {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs, 12px);
    background: none;
    border: none;
    padding: 0;
    color: var(--accent-ink);
    cursor: pointer;
    text-decoration: underline;
  }
  .ii-note {
    margin: 0 0 0.3rem;
    font-size: var(--fs-label-xs, 12px);
    color: var(--text-ghost);
  }

  .ii-tools {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .ii-search {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    flex: 1 1 260px;
    min-width: 0;
  }
  .ii-count {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs, 12px);
    color: var(--text-muted);
    padding-bottom: 0.5rem;
    white-space: nowrap;
  }

  .ii-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .ii-row {
    border: 1px solid var(--card-border);
    background: var(--bg-section);
    min-width: 0;
  }
  .ii-row.err {
    border-left: 3px solid var(--error);
  }
  .ii-row-hd {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    padding: 0.4rem 0.55rem;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs, 12px);
    color: var(--text-secondary);
    min-width: 0;
  }
  .ii-row-hd:hover {
    background: var(--accent-tint-04);
  }
  .ii-tool {
    color: var(--accent-ink);
    flex-shrink: 0;
    min-width: 3.2rem;
  }
  .ii-sum {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-primary);
    min-width: 0;
  }
  .ii-match {
    flex-shrink: 0;
    background: var(--accent);
    color: var(--bg);
    padding: 0 0.3rem;
    border-radius: 2px;
  }
  .ii-bad {
    flex-shrink: 0;
    color: var(--error);
  }
  .ii-caret {
    flex-shrink: 0;
    color: var(--text-ghost);
  }
  .ii-body {
    padding: 0.4rem 0.55rem 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }
  .ii-body-k {
    margin-top: 0.25rem;
  }

  .ii-empty {
    margin: 0;
    font-size: var(--fs-body-sm, 15px);
    color: var(--text-ghost);
  }
  .ii-eval summary {
    cursor: pointer;
  }
  .ii-pre {
    margin: 0.4rem 0 0;
    padding: 0.6rem;
    background: var(--code-bg);
    color: var(--code-text);
    font-family: var(--font-code);
    font-size: var(--fs-label-xs, 12px);
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-x: auto;
    border-radius: 2px;
  }
</style>
