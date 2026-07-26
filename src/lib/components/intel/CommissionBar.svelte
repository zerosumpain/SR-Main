<script lang="ts">
  // Start any kind of work from the Intel dashboard, without a finding to
  // hang it off. Type what you want and pick how it should happen.
  //
  // This is the "commission any other type of activity" surface: research,
  // a question to jkai, a monitor, a canvas/workflow — one input, one verb.

  let {
    busy = false,
    onRun,
  }: {
    busy?: boolean;
    onRun: (kind: string, payload: string) => void;
  } = $props();

  const KINDS = [
    { id: 'research', label: 'Deep dive', hint: 'Run a full research session on this' },
    { id: 'ask', label: 'Ask jkai', hint: 'Open chat with this question, loaded with graph context' },
    { id: 'monitor', label: 'Monitor', hint: 'Watch for changes and alert me' },
    { id: 'canvas', label: 'Canvas', hint: 'Build a workflow for this' },
  ];

  let text = $state('');
  let kind = $state('research');

  const active = $derived(KINDS.find((k) => k.id === kind) ?? KINDS[0]);

  function run() {
    const payload = text.trim();
    if (!payload || busy) return;
    onRun(kind, payload);
    text = '';
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

  <input
    type="text"
    bind:value={text}
    onkeydown={onKey}
    placeholder={active.hint}
    aria-label="What to commission"
    disabled={busy}
  />

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
    border: 1px solid var(--card-border);
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
    border: 1px solid var(--card-border);
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

  input {
    flex: 1;
    min-width: 220px;
    padding: 7px 11px;
    font: inherit;
    font-size: var(--fs-body-sm);
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
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
