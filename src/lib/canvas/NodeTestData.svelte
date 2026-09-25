<script lang="ts">
  // The inspector's TEST DATA section: what a test run did with this step
  // (stubbed / used its pin), its pinned output (pin from the run on screen,
  // hand-edit, unpin) and "Run from here". Pins only ever apply to TEST runs.
  type Pin = { output: Record<string, unknown>; handle?: string | null; sourceRunId?: string | null; bytes?: number };
  type Props = {
    workflowId: string;
    nodeId: string;
    pin: Pin | null;
    /** The output on screen (live run or a past run being viewed). */
    outputData: unknown;
    /** The run that output came from, when known — pinning from it keeps the branch taken. */
    runId: string | null;
    onPinsChanged: () => void;
    onRunFromHere: (nodeId: string) => void;
  };
  let { workflowId, nodeId, pin, outputData, runId, onPinsChanged, onRunFromHere }: Props = $props();

  let editing = $state(false);
  let draft = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);

  const out = $derived(
    outputData && typeof outputData === 'object' && !Array.isArray(outputData) ? (outputData as Record<string, unknown>) : null,
  );
  const stubbed = $derived(out?._stubbed === true);
  const usedPin = $derived(out?._pinned === true);

  async function send(method: 'PUT' | 'DELETE', body?: Record<string, unknown>): Promise<boolean> {
    busy = true;
    error = null;
    try {
      const url = `/api/workflows/${workflowId}/pins${method === 'DELETE' ? `?nodeId=${encodeURIComponent(nodeId)}` : ''}`;
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify({ nodeId, ...body }) : undefined,
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
      editing = false;
      onPinsChanged();
      return true;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      return false;
    } finally {
      busy = false;
    }
  }

  // From the run on screen when known (keeps the branch it took); else, or if
  // that run did not run this step, the output as shown.
  async function pinThis() {
    if (runId && !usedPin && (await send('PUT', { fromRunId: runId }))) return;
    if (out) await send('PUT', { output: out });
  }

  function edit() {
    draft = JSON.stringify(pin?.output ?? out ?? {}, null, 2);
    editing = true;
  }

  function saveDraft() {
    try {
      void send('PUT', { output: JSON.parse(draft), handle: pin?.handle ?? null });
    } catch (err) {
      error = `Not valid JSON: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
</script>

<section class="nm-sec td">
  <div class="nm-sec-hd">
    <span class="sr-label-tight">TEST DATA</span>
    {#if pin}<span class="badge">PINNED{pin.bytes ? ` · ${Math.max(1, Math.round(pin.bytes / 1024))} KB` : ''}</span>{/if}
  </div>
  {#if stubbed}
    <div class="stub">
      <span class="stub-hd">Stubbed in this test run — not run</span>
      <span class="stub-line">would have: {String(out?.wouldHave ?? '')}</span>
    </div>
  {:else if usedPin}
    <p class="note">This test run used the pinned output instead of running the step.</p>
  {/if}
  <p class="note">
    {pin
      ? `A test run uses this pinned output (${pin.handle ? `branch “${pin.handle}”, ` : ''}${pin.sourceRunId ? `from run ${pin.sourceRunId.slice(0, 8)}` : 'hand-edited'}) instead of running the step. Real runs ignore it.`
      : 'Not pinned. Pin an output and test runs use it instead of running this step (up to 64 KB).'}
  </p>
  {#if editing}
    <textarea class="draft" rows="8" spellcheck="false" bind:value={draft}></textarea>
  {/if}
  <div class="acts">
    {#if editing}
      <button class="nm-pin-btn" onclick={saveDraft} disabled={busy}>save pin</button>
      <button class="nm-pin-btn" onclick={() => (editing = false)} disabled={busy}>cancel</button>
    {:else}
      {#if out && !stubbed}
        <button class="nm-pin-btn" onclick={pinThis} disabled={busy} title="Test runs will use this output instead of running the step">pin this output</button>
      {/if}
      <button class="nm-pin-btn" onclick={edit} disabled={busy}>{pin ? 'edit pin' : 'write a pin'}</button>
      {#if pin}<button class="nm-pin-btn" onclick={() => void send('DELETE')} disabled={busy}>unpin</button>{/if}
      <button
        class="nm-pin-btn run"
        onclick={() => onRunFromHere(nodeId)}
        title="Test-run this step and everything after it; earlier steps use their pins or their latest output"
      >run from here</button>
    {/if}
  </div>
  {#if error}<p class="err">{error}</p>{/if}
</section>

<style>
  /* Beats `.nm-inline .nm-sec { padding: 0 }` — the dock's bodies pad themselves. */
  section.td { border-top: 1px solid var(--line-hair); padding: 12px 14px 14px; }
  .badge {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.07em;
    color: var(--accent-ink);
    border: 1px solid var(--accent-ink);
    padding: 0 5px;
  }
  .stub {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px;
    border: 1px dashed var(--warn);
    margin-bottom: 6px;
  }
  .stub-hd {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--text-primary);
  }
  .stub-line { color: var(--text-secondary); overflow-wrap: anywhere; }
  .note { margin: 0 0 6px; color: var(--text-muted); font-size: var(--fs-body-sm, 0.875rem); }
  .draft {
    width: 100%;
    box-sizing: border-box;
    font-family: var(--font-mono);
    font-size: var(--fs-label-sm, 0.8125rem);
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--line-strong);
    padding: 6px;
    margin-bottom: 6px;
  }
  .acts { display: flex; flex-wrap: wrap; gap: 6px; }
  .nm-pin-btn {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 3px 8px;
    background: var(--bg);
    color: var(--text-secondary);
    border: 1px solid var(--line-strong);
    cursor: pointer;
  }
  .nm-pin-btn.run { color: var(--accent-ink); border-color: var(--accent-ink); }
  .nm-pin-btn:disabled { opacity: 0.55; cursor: not-allowed; }
  .err { margin: 6px 0 0; color: var(--error); overflow-wrap: anywhere; }
</style>
