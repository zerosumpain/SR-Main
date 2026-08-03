<script lang="ts">
  // Sweep the mailbox into the graph, on demand.
  //
  // The rolling Gmail ingest runs nightly at 04:15, which is right for keeping
  // up but useless when you want to see the effect of a change now, or to start
  // a backfill without waiting a day. This is the manual handle on the same
  // endpoint.
  //
  // The request is SYNCHRONOUS — the server reads threads and calls the model
  // inline — so the budget field is the important control here, not a detail:
  // it is the only thing standing between one click and a request that runs for
  // half an hour. It defaults low deliberately. Larger backfills are what the
  // nightly pass is for, and it picks up exactly where this leaves off.

  let {
    onDone,
  }: {
    /** Fired after a sweep that changed something, so the graph can refetch. */
    onDone?: () => void;
  } = $props();

  interface Preview {
    account: string;
    windowDays?: number;
    newThreads: number;
    threads: Array<{ threadId: string; alreadyIngested: boolean }>;
    error?: string;
  }

  interface SweepResult {
    account: string;
    threads: number;
    extracted: number;
    unchanged: number;
    deferred: number;
    failed: number;
    entities: number;
    edges: number;
    attachments: number;
    autoMerged: number;
    budgetLeft: number;
    error?: string;
  }

  let preview = $state<Preview | null>(null);
  let previewError = $state<string | null>(null);
  let loadingPreview = $state(false);

  let budget = $state(25);
  let includeAttachments = $state(true);
  let sweeping = $state(false);
  let result = $state<SweepResult | null>(null);
  let sweepError = $state<string | null>(null);
  /** Seconds the current sweep has been running — a long wait needs a pulse. */
  let elapsed = $state(0);

  // Plain handle, never $state: a timer read and cleared by the same helper is
  // the read-own-write cycle that locks the UI up (svelte5-pitfalls §1).
  let ticker: ReturnType<typeof setInterval> | null = null;

  function stopTicker() {
    if (ticker) clearInterval(ticker);
    ticker = null;
  }

  async function loadPreview() {
    if (loadingPreview) return;
    loadingPreview = true;
    previewError = null;
    try {
      const res = await fetch('/api/jkai/intel/gmail-ingest?mode=rolling');
      const body = await res.json();
      if (!res.ok) {
        previewError = body?.error ?? `Preview failed (${res.status})`;
        preview = null;
      } else {
        preview = body;
      }
    } catch (err) {
      previewError = err instanceof Error ? err.message : 'Preview failed';
      preview = null;
    } finally {
      loadingPreview = false;
    }
  }

  async function sweep() {
    if (sweeping) return;
    sweeping = true;
    sweepError = null;
    result = null;
    elapsed = 0;
    stopTicker();
    ticker = setInterval(() => (elapsed += 1), 1000);

    try {
      const res = await fetch('/api/jkai/intel/gmail-ingest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'rolling',
          extractBudget: budget,
          includeAttachments,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        sweepError = body?.error ?? `Sweep failed (${res.status})`;
      } else {
        result = body;
        // Only refetch when the graph actually changed — a sweep that found
        // nothing new should not make the whole dashboard flicker.
        if ((body.extracted ?? 0) > 0 || (body.edges ?? 0) > 0 || (body.autoMerged ?? 0) > 0) {
          onDone?.();
        }
        void loadPreview();
      }
    } catch (err) {
      // A long sweep can outlive the proxy's patience. The server keeps going,
      // so this is a lost connection rather than lost work — say so, because
      // "failed" would be wrong and would invite a pointless retry.
      sweepError =
        err instanceof Error && /fetch|network|aborted/i.test(err.message)
          ? 'Lost the connection while sweeping. The server carries on — check back in a few minutes, or look at tonight’s run.'
          : (err instanceof Error ? err.message : 'Sweep failed');
    } finally {
      stopTicker();
      sweeping = false;
    }
  }

  const notConnected = $derived(Boolean(previewError && /no active gmail account/i.test(previewError)));
  const needsReauth = $derived(Boolean(previewError && /re-authentication|auth expired|invalid_grant/i.test(previewError)));
</script>

<div class="ctl">
  <span class="ctl-title">Mailbox</span>

  {#if !preview && !previewError}
    <button type="button" class="link" onclick={loadPreview} disabled={loadingPreview}>
      {loadingPreview ? 'Checking…' : 'Check what is waiting'}
    </button>
    <p class="hint">Gmail sweeps automatically at 04:15. This reads it now.</p>
  {:else if previewError}
    <p class="hint err">{previewError}</p>
    {#if notConnected || needsReauth}
      <a class="link" href="/admin/connections/gmail">
        {notConnected ? 'Connect an account →' : 'Re-authenticate →'}
      </a>
    {:else}
      <button type="button" class="link" onclick={loadPreview}>Try again</button>
    {/if}
  {:else if preview}
    <p class="hint">
      <strong>{preview.threads?.length ?? 0}</strong> threads in the last
      {preview.windowDays ?? 84} days · <strong>{preview.newThreads}</strong> not read yet
      <br /><span class="acct">{preview.account}</span>
    </p>

    <label class="field">
      Read up to
      <input type="number" min="1" max="500" step="5" bind:value={budget} disabled={sweeping} />
      bodies
    </label>

    <label class="check">
      <input type="checkbox" bind:checked={includeAttachments} disabled={sweeping} />
      Read attachments
    </label>

    <button type="button" class="go" onclick={sweep} disabled={sweeping}>
      {sweeping ? `Sweeping… ${elapsed}s` : 'Sweep now'}
    </button>

    {#if sweeping}
      <p class="hint">
        Runs while this stays open — every thread body is a model call. Leaving early does not
        stop it.
      </p>
    {/if}
  {/if}

  {#if sweepError}
    <p class="hint err">{sweepError}</p>
  {/if}

  {#if result}
    <p class="hint done">
      Read <strong>{result.extracted}</strong> thread{result.extracted === 1 ? '' : 's'} —
      {result.entities} entities, {result.edges} links{result.attachments
        ? `, ${result.attachments} attachments`
        : ''}.
      {#if result.autoMerged}<br />Merged {result.autoMerged} duplicate{result.autoMerged === 1 ? '' : 's'}.{/if}
      {#if result.deferred}
        <br />{result.deferred} left for later — their sender/recipient links are already in.
      {/if}
      {#if result.failed}<br />{result.failed} failed.{/if}
    </p>
  {/if}
</div>

<style>
  .ctl {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .ctl-title {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--text-ghost);
  }

  .hint {
    margin: 0;
    font-size: var(--fs-label-xs);
    line-height: 1.45;
    color: var(--text-ghost);
  }
  .hint strong {
    color: var(--text-secondary);
    font-weight: 600;
  }
  .hint.err {
    color: var(--accent-ink);
  }
  .hint.done {
    color: var(--text-secondary);
  }
  .acct {
    font-family: var(--font-mono);
  }

  .field,
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .field input {
    width: 68px;
    /* --fs-body is 16px. Anything smaller on a typed field makes mobile Safari
       zoom the viewport on focus (gate:font-sizes enforces this). */
    font-size: var(--fs-body);
    padding: 3px 6px;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    background: var(--bg);
    color: var(--text-primary);
  }

  .go {
    align-self: flex-start;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 5px 11px;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all var(--t-fast) var(--ease-out);
  }
  .go:hover:not(:disabled) {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .go:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .link {
    align-self: flex-start;
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    font-size: var(--fs-label-xs);
    color: var(--accent);
    text-decoration: none;
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }
</style>
