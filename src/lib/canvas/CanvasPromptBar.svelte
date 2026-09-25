<script lang="ts">
  // "Ask jkai to change this…" — the canvas editor's prompt bar. The model
  // PROPOSES (POST /api/canvas/:slug/ask → the same proposeAmendOps the iPhone
  // uses); the owner reads the proposal in plain words, sees the steps it
  // touches outlined on the canvas, and applies it (POST .../amend → the shared
  // validator + applyAmendOps, audited as `owner`) or discards it. Nothing is
  // ever applied without that click.
  import { affectedNodeIds, describeOp, type ProposedOp, type WordingContext } from './amend-words';

  type Proposal = {
    instruction: string;
    summary: string;
    ops: ProposedOp[];
    warnings: string[];
    version: number;
  };

  type Props = {
    slug: string;
    wording: WordingContext;
    /** Edge id → its two node ids, so a removed edge highlights its ends. */
    edgeEnds: (edgeId: string) => string[];
    /** The steps an open proposal touches; null when none is open. */
    onHighlight: (ids: Set<string> | null) => void;
    /** After an apply — the page reloads its graph. */
    onApplied: () => Promise<void> | void;
  };
  let { slug, wording, edgeEnds, onHighlight, onApplied }: Props = $props();

  let draft = $state('');
  let asking = $state(false);
  let applying = $state(false);
  let proposal = $state<Proposal | null>(null);
  let error = $state<string | null>(null);
  let stale = $state(false);
  let note = $state<string | null>(null);
  let inputEl = $state<HTMLTextAreaElement | undefined>(undefined);

  /** Pre-fill (the needs-attention banner's "Ask jkai to fix") and focus. */
  export function prefill(text: string) {
    draft = text;
    error = null;
    note = null;
    queueMicrotask(() => {
      inputEl?.focus();
      inputEl?.setSelectionRange(draft.length, draft.length);
    });
  }

  function setProposal(p: Proposal | null) {
    proposal = p;
    onHighlight(p && p.ops.length > 0 ? affectedNodeIds(p.ops, edgeEnds) : null);
  }

  async function ask(instruction = draft.trim()) {
    if (!instruction || asking) return;
    asking = true;
    error = null;
    note = null;
    stale = false;
    setProposal(null);
    try {
      const res = await fetch(`/api/canvas/${encodeURIComponent(slug)}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<Proposal> & { error?: string };
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setProposal({
        instruction,
        summary: body.summary ?? '',
        ops: Array.isArray(body.ops) ? body.ops : [],
        warnings: Array.isArray(body.warnings) ? body.warnings : [],
        version: typeof body.version === 'number' ? body.version : 0,
      });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      asking = false;
    }
  }

  async function apply() {
    const p = proposal;
    if (!p || p.ops.length === 0 || applying) return;
    applying = true;
    error = null;
    try {
      const res = await fetch(`/api/canvas/${encodeURIComponent(slug)}/amend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ops: p.ops, expectedVersion: p.version }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; outcomes?: unknown[] };
      if (res.status === 409) {
        stale = true;
        throw new Error('The canvas changed since jkai made this proposal. Ask again to get one for the canvas as it is now.');
      }
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      const n = body.outcomes?.length ?? p.ops.length;
      note = `Applied ${n} change${n === 1 ? '' : 's'}.`;
      draft = '';
      setProposal(null);
      await onApplied();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      applying = false;
    }
  }

  function discard() {
    setProposal(null);
    error = null;
    stale = false;
  }

  const rows = $derived(proposal ? proposal.ops.map((op) => describeOp(op, proposal!.ops, wording)) : []);
</script>

<div class="pbar">
  <form
    class="pbar-form"
    onsubmit={(e) => {
      e.preventDefault();
      ask();
    }}
  >
    <span class="pbar-mark" aria-hidden="true">jkai</span>
    <textarea
      bind:this={inputEl}
      class="pbar-input"
      rows="1"
      bind:value={draft}
      placeholder="Ask jkai to change this…"
      aria-label="Ask jkai to change this workflow"
      disabled={asking || applying}
      onkeydown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          ask();
        } else if (e.key === 'Escape' && proposal) {
          e.preventDefault();
          discard();
        }
      }}
    ></textarea>
    <button type="submit" class="pbar-btn" disabled={!draft.trim() || asking || applying}>
      {asking ? 'Thinking…' : 'Propose'}
    </button>
  </form>

  {#if note && !proposal}
    <p class="pbar-note" role="status">{note}</p>
  {/if}
  {#if error && !proposal}
    <p class="pbar-err" role="alert">⚠ {error}</p>
  {/if}

  {#if proposal}
    <section class="prop" aria-label="Proposed change">
      <header class="prop-hd">
        <span class="prop-kicker">Proposal · nothing applied yet</span>
        <span class="prop-ask" title={proposal.instruction}>“{proposal.instruction}”</span>
      </header>
      <p class="prop-summary">{proposal.summary}</p>
      {#if rows.length > 0}
        <ol class="prop-ops">
          {#each rows as row, i (i)}
            <li class="prop-op" data-kind={row.kind}>
              <span class="prop-op-mark">{row.kind}</span>
              <span class="prop-op-text">{row.text}</span>
            </li>
          {/each}
        </ol>
      {/if}
      {#each proposal.warnings as w (w)}
        <p class="prop-warn">⚠ {w}</p>
      {/each}
      {#if error}
        <p class="pbar-err" role="alert">⚠ {error}</p>
      {/if}
      <div class="prop-actions">
        {#if stale}
          <button type="button" class="pbar-btn" disabled={asking} onclick={() => ask(proposal!.instruction)}>Ask again</button>
        {:else if proposal.ops.length > 0}
          <button type="button" class="pbar-btn" disabled={applying} onclick={apply}>
            {applying ? 'Applying…' : `Apply ${proposal.ops.length} change${proposal.ops.length === 1 ? '' : 's'}`}
          </button>
        {/if}
        <button type="button" class="prop-discard" disabled={applying} onclick={discard}>Discard</button>
        {#if proposal.ops.length > 0}
          <span class="prop-hint">outlined steps on the canvas are the ones this touches</span>
        {/if}
      </div>
    </section>
  {/if}
</div>

<style>
  .pbar {
    border-bottom: 1px solid var(--line-hair);
    background: var(--bg);
    flex-shrink: 0;
  }
  .pbar-form {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
  }
  .pbar-mark {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--accent);
    flex-shrink: 0;
  }
  .pbar-input {
    flex: 1;
    min-width: 0;
    resize: none;
    font-family: var(--font-body);
    font-size: var(--fs-body);
    line-height: 1.4;
    color: var(--text-primary);
    background: var(--surface-sunken);
    border: 1px solid var(--line-strong);
    padding: 6px 10px;
    outline: none;
  }
  .pbar-input:focus {
    border-color: var(--accent);
    background: var(--bg);
  }
  .pbar-input::placeholder {
    color: var(--text-ghost);
  }
  .pbar-btn {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    padding: 6px 12px;
    background: var(--accent);
    color: var(--bg);
    border: 1px solid var(--accent);
    cursor: pointer;
    flex-shrink: 0;
  }
  .pbar-btn:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }
  .pbar-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .pbar-note,
  .pbar-err {
    margin: 0;
    padding: 0 14px 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
  }
  .pbar-note {
    color: var(--accent-ink);
  }
  .pbar-err {
    color: var(--error);
    overflow-wrap: anywhere;
  }
  .prop {
    margin: 0 14px 10px;
    padding: 10px 12px;
    background: var(--surface-elevated);
    border: 1px solid var(--line-strong);
    border-left: 3px solid var(--accent-ink);
    display: grid;
    gap: 8px;
    max-height: 42vh;
    overflow-y: auto;
  }
  .prop-hd {
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-width: 0;
  }
  .prop-kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--accent-ink);
    flex-shrink: 0;
  }
  .prop-ask {
    font-size: var(--fs-label);
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .prop-summary {
    margin: 0;
    color: var(--text-primary);
    line-height: 1.45;
    overflow-wrap: anywhere;
  }
  .prop-ops {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 4px;
  }
  .prop-op {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }
  .prop-op-mark {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    width: 5.5em;
    flex-shrink: 0;
    color: var(--text-muted);
  }
  .prop-op[data-kind='add'] .prop-op-mark {
    color: var(--accent-ink);
  }
  .prop-op[data-kind='remove'] .prop-op-mark {
    color: var(--error);
  }
  .prop-op[data-kind='change'] .prop-op-mark {
    color: var(--accent);
  }
  .prop-op-text {
    font-size: var(--fs-label);
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }
  .prop-warn {
    margin: 0;
    font-size: var(--fs-label);
    color: var(--warn);
    overflow-wrap: anywhere;
  }
  .prop-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .prop-discard {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    padding: 6px 12px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--line-strong);
    cursor: pointer;
  }
  .prop-discard:hover:not(:disabled) {
    border-color: var(--text-muted);
  }
  .prop-hint {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  @media (max-width: 768px) {
    .pbar-form {
      padding: 6px 10px;
    }
    .pbar-mark {
      display: none;
    }
    .prop {
      margin: 0 10px 8px;
    }
    .prop-hint {
      display: none;
    }
  }
</style>
