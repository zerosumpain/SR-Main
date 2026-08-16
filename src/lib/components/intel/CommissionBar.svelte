<script lang="ts">
  // Start any kind of work from the Intel dashboard, without a finding to
  // hang it off. Type what you want and pick how it should happen.
  //
  // This is the "commission any other type of activity" surface: research,
  // a question to jkai, a monitor, a canvas/workflow — one input, one verb.

  let {
    busy = false,
    matchCount = null,
    onRun,
    onSearch,
  }: {
    busy?: boolean;
    /** Nodes currently lit by what is typed. `null` means nothing is typed. */
    matchCount?: number | null;
    onRun: (kind: string, payload: string) => void;
    /** Fires on every keystroke — the graph lights up as you type. */
    onSearch?: (text: string) => void;
  } = $props();

  const KINDS = [
    { id: 'research', label: 'Deep dive', hint: 'run a full research session on it' },
    { id: 'ask', label: 'Ask jkai', hint: 'open chat about it, loaded with graph context' },
    { id: 'monitor', label: 'Monitor', hint: 'watch for changes and alert me' },
    { id: 'canvas', label: 'Canvas', hint: 'build a workflow for it' },
  ];

  let text = $state('');
  let kind = $state('research');

  const active = $derived(KINDS.find((k) => k.id === kind) ?? KINDS[0]);

  /**
   * The box searches as you type; the buttons commission what you typed.
   *
   * It used to only commission, which made the most prominent input on the page
   * the one thing that could not answer "where is this in my graph" — the
   * question you almost always have first, and the one that tells you whether a
   * deep dive is even worth starting. Highlighting is done over the nodes
   * already loaded, so it costs no round trip and keeps up with typing.
   *
   * Deliberately a HIGHLIGHT, not a filter. The rail's Search box narrows the
   * graph server-side and is the right tool when you know what you want; this
   * one leaves the graph whole and lights up the hits, so you can see where they
   * sit among everything else.
   */
  function onInput() {
    onSearch?.(text);
  }

  function run() {
    const payload = text.trim();
    if (!payload || busy) return;
    onRun(kind, payload);
    text = '';
    onSearch?.('');
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      run();
    }
  }
</script>

<div class="bar">
  <div class="kinds" role="group" aria-label="What kind of work">
    {#each KINDS as k (k.id)}
      <button
        type="button"
        class:on={kind === k.id}
        onclick={() => (kind = k.id)}
        title={k.hint}
      >{k.label}</button>
    {/each}
  </div>

  <div class="field">
    <input
      type="search"
      bind:value={text}
      oninput={onInput}
      onkeydown={onKey}
      placeholder="Search the graph — or type something to {active.hint}"
      aria-label="Search the graph, or describe work to commission"
      disabled={busy}
    />
    {#if matchCount !== null}
      <span class="matches" class:none={matchCount === 0} aria-live="polite">
        {matchCount === 0 ? 'nothing matches' : `${matchCount} lit`}
      </span>
    {/if}
  </div>

  <button class="run" type="button" onclick={run} disabled={busy || !text.trim()}>
    {busy ? 'Working…' : 'Go'}
  </button>
</div>

<style>
  .bar {
    display: flex;
    align-items: stretch;
    gap: 8px;
    flex-wrap: wrap;
    background: var(--card-bg);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-round);
    padding: 8px;
  }

  .kinds {
    display: flex;
    gap: 2px;
  }
  .kinds button {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 6px 11px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    background: transparent;
    color: var(--text-ghost);
    cursor: pointer;
    white-space: nowrap;
    transition: all var(--t-fast) var(--ease-out);
  }
  .kinds button:hover {
    color: var(--text-secondary);
  }
  .kinds button.on {
    background: var(--accent-tint-14);
    border-color: var(--accent-tint-35);
    color: var(--accent);
  }

  .field {
    flex: 1;
    min-width: 220px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .matches {
    flex: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent);
    white-space: nowrap;
  }
  .matches.none {
    color: var(--text-ghost);
  }

  input {
    flex: 1;
    min-width: 0;
    padding: 7px 11px;
    font: inherit;
    font-size: var(--fs-body);
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
  }
  input:focus {
    outline: none;
    border-color: var(--accent-tint-35);
  }
  input::placeholder {
    color: var(--text-ghost);
  }

  .run {
    padding: 7px 18px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: var(--radius-sharp);
    cursor: pointer;
  }
  .run:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
