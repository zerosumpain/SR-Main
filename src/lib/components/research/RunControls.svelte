<script lang="ts">
  /**
   * Pause, resume, stop.
   *
   * The page could start a run and watch it, and that was all. A long
   * investigation that stalled had exactly one remedy — wait, or delete it —
   * and a production run measured on 2026-08-15 had been going nine hours,
   * restarting its first phase on every deploy, with no control on the page
   * that would have let anyone intervene.
   *
   * The three verbs mean different things and the labels say which:
   *
   *  - **Pause** keeps your place. Leads in flight go back on the queue and the
   *    phase is recorded, so resuming carries on rather than starting over.
   *  - **Resume** picks up at the recorded phase.
   *  - **Stop** ends it and writes the report from what has been gathered. It is
   *    the one that cannot be taken back, so it asks first.
   */
  let {
    sessionId,
    status,
    pausable = true,
    onChanged,
  }: {
    sessionId: string;
    status: string;
    /**
     * Only the phase-walking `investigation` tier can be paused. The budgeted
     * tiers run to a clock of two minutes or less in a single bounded call, so
     * a Pause button on one would be a control that does nothing — and a
     * control that does nothing is worse than no control.
     */
    pausable?: boolean;
    /** Called with the new status so the page can update without a reload. */
    onChanged?: (status: string) => void;
  } = $props();

  let busy = $state<'pause' | 'resume' | 'stop' | null>(null);
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);

  const TERMINAL = ['complete', 'failed'];
  /**
   * Winding down. Pause is cooperative, so the worker finishes the lead in its
   * hand first — measured at up to ninety seconds when the model queue was
   * congested. Offering Resume in that window would be offering to restart
   * something that has not stopped.
   */
  const pending = $derived(status === 'pausing' || status === 'stopping');
  const paused = $derived(status === 'paused');
  const live = $derived(!TERMINAL.includes(status) && !paused && !pending);
  /**
   * A failed run keeps everything it gathered, so resuming it is a real option
   * and not a euphemism for starting again. Only a completed run has nothing
   * left to do.
   */
  const resumable = $derived(
    !pending && (paused || status === 'failed' || (!live && status !== 'complete')),
  );

  async function send(action: 'pause' | 'resume' | 'stop') {
    if (busy) return;
    if (action === 'stop' && !confirm('Stop this run and write the report from what it has so far?')) {
      return;
    }
    busy = action;
    error = null;
    notice = null;
    try {
      const res = await fetch(`/api/research/${sessionId}/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = await res.json().catch(() => ({}) as Record<string, unknown>);
      if (!res.ok) {
        error = typeof body.error === 'string' ? body.error : `That did not work (${res.status}).`;
        return;
      }
      if (typeof body.note === 'string') notice = body.note;
      // 'pausing' and 'stopping' are honest intermediate states: the worker
      // finishes the lead in its hand first, and the stream carries the real
      // status a moment later.
      if (typeof body.status === 'string') onChanged?.(body.status);
    } catch (err) {
      error = err instanceof Error ? err.message : 'That did not work.';
    } finally {
      busy = null;
    }
  }
</script>

{#if !TERMINAL.includes(status) || resumable}
  <div class="controls">
    {#if pending}
      <span class="ctl waiting">
        {status === 'pausing' ? 'Pausing' : 'Stopping'} — finishing the source in hand
      </span>
    {:else if live}
      {#if pausable}
        <button type="button" class="ctl" disabled={!!busy} onclick={() => send('pause')}>
          {busy === 'pause' ? 'Pausing…' : 'Pause'}
        </button>
      {/if}
      <button type="button" class="ctl danger" disabled={!!busy} onclick={() => send('stop')}>
        {busy === 'stop' ? 'Stopping…' : 'Stop & report'}
      </button>
    {:else if resumable}
      <button type="button" class="ctl primary" disabled={!!busy} onclick={() => send('resume')}>
        {busy === 'resume' ? 'Resuming…' : 'Resume'}
      </button>
    {/if}
  </div>
{/if}

{#if notice}<p class="line">{notice}</p>{/if}
{#if error}<p class="line err">{error}</p>{/if}

<style>
  .controls { display: flex; gap: 0.4rem; align-items: center; }
  .ctl {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.1em;
    background: none; border: 1px solid var(--line-strong); color: var(--text-muted);
    cursor: pointer; padding: 3px 9px;
  }
  .ctl:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .ctl:disabled { opacity: 0.5; cursor: default; }
  .ctl.primary { border-color: var(--accent); color: var(--accent); }
  .ctl.waiting { border-style: dashed; text-transform: none; letter-spacing: 0.04em; cursor: default; }
  .ctl.danger:hover:not(:disabled) { border-color: var(--error); color: var(--error); }

  .line { margin: 0.35rem 0 0; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }
  .line.err { color: var(--error); }
</style>
