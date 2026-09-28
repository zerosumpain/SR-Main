<script lang="ts">
  // The sign-off sheet for a double-check (a "commission"), inside the card of
  // the note that started it.
  //
  // One question, answered in four short lists — what will happen, what will
  // not, the limits, how you will know it worked — and then one primary
  // button. After approval the same block becomes a progress track, then the
  // report. The receipts (hashes, raw query results, the event log) stay, but
  // folded: they are for proving, not for reading.
  //
  // `#commission-<id>` and `.result` are anchors the local QA journey
  // (`scripts/qa/daydream-commission-preview.mjs`) and `?commission=` links use.
  import { goto, invalidateAll } from '$app/navigation';
  import { COMMISSION_LABELS, decisionAllowed, type CommissionDecision, type CommissionView } from '$lib/daydream/commissioning';
  import { describeSource, parseCardRef, sourceText } from '$lib/daydream/think/explain';
  import { ago, stamp } from '$lib/daydream/format';

  let { c, focused = false }: { c: CommissionView; focused?: boolean } = $props();

  let busy = $state(false);
  let error = $state<string | null>(null);

  const STEPS = ['Proposed', 'Approved', 'Checking', 'Report ready'] as const;
  const step = $derived(
    c.state === 'completed' ? 3 : c.state === 'running' || c.state === 'needs_attention' ? 2 : c.state === 'queued' ? 1 : 0,
  );
  const stopped = $derived(c.state === 'declined' || c.state === 'cancelled');
  const asking = $derived(decisionAllowed(c.state, 'approve'));
  const reads = $derived(c.spec.reads.map((r) => describeSource(r.tool, r.args)));
  const seconds = $derived(c.spec.budget.maxWallSeconds);

  function evidenceLabel(e: { sourceRef: string; tool: string }): string {
    const parsed = parseCardRef(e.sourceRef);
    return sourceText(describeSource(e.tool, parsed?.args ?? {}));
  }

  async function post(body: Record<string, unknown>) {
    const response = await fetch('/api/daydream/commissions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error ?? 'That did not save. Try again.');
    return result;
  }

  async function decide(decision: CommissionDecision) {
    busy = true;
    error = null;
    try {
      await post({ action: 'decide', id: c.id, decision, revision: c.revision, specHash: c.specHash, operationKey: crypto.randomUUID() });
    } catch (e) {
      error = e instanceof Error ? e.message : 'That did not save. Try again.';
    } finally {
      // Either way: the response may have been lost after the commit.
      await invalidateAll();
      busy = false;
    }
  }

  async function refresh() {
    busy = true;
    error = null;
    try {
      const result = await post({ action: 'prepare', thoughtId: c.thoughtId });
      if (result.commission.id === c.id) error = 'Nothing has changed since this was prepared. Add a note to the idea first, then refresh.';
      else await goto(result.commission.url, { invalidateAll: true });
    } catch (e) {
      error = e instanceof Error ? e.message : 'That did not refresh. Try again.';
    } finally {
      busy = false;
    }
  }
</script>

<div class="signoff" class:asking class:focused id="commission-{c.id}">
  <div class="so-head">
    <p class="so-kicker">Double-check · {COMMISSION_LABELS[c.state]}</p>
    <span class="so-when" title={stamp(c.updatedAt)}>{ago(c.updatedAt)}</span>
  </div>

  {#if !stopped}
    <ol class="so-steps" aria-label="Progress: {STEPS[step]}">
      {#each STEPS as s, i (s)}
        <li class:on={i <= step} class:here={i === step && c.state !== 'completed'} class:warn={i === step && c.state === 'needs_attention'}>
          <span class="so-dot" aria-hidden="true"></span>{s}
        </li>
      {/each}
    </ol>
  {/if}

  {#if asking}
    <p class="so-lede">{c.spec.outcome}</p>
    <div class="so-grid">
      <div>
        <h4>What will happen</h4>
        <ul class="so-list do">
          {#each reads as r, i (i)}<li>Re-read <strong>{r.label}</strong>{r.detail ? ` — ${r.detail}` : ''}</li>{/each}
          <li>Save a private report here and tell you when it is ready</li>
        </ul>
      </div>
      <div>
        <h4>What won't happen</h4>
        <ul class="so-list dont">
          {#each c.spec.exclusions as x, i (i)}<li>{x}</li>{/each}
        </ul>
      </div>
      <div>
        <h4>You'll know it worked when</h4>
        <ul class="so-list">
          {#each c.spec.acceptance as x, i (i)}<li>{x}</li>{/each}
        </ul>
      </div>
      <div>
        <h4>Limits</h4>
        <ul class="so-list">
          <li>{c.spec.budget.maxReads} look-up{c.spec.budget.maxReads === 1 ? '' : 's'}, nothing else</li>
          <li>Up to {c.spec.budget.maxAttempts} tries, {seconds >= 60 ? `${Math.round(seconds / 60)} minutes` : `${seconds} seconds`} each</li>
          <li>Carries on if you close this page</li>
        </ul>
      </div>
    </div>
    {#if c.spec.ownerCorrection}<p class="so-said">Includes your note: “{c.spec.ownerCorrection}”</p>{/if}
  {:else if c.state === 'queued' || c.state === 'running'}
    <p class="so-lede">{c.state === 'queued' ? 'Approved. It is waiting its turn on the workflow runner.' : 'Re-reading the sources now.'} You can leave this page — you will get a notification when the report is ready.</p>
  {:else if c.state === 'needs_attention'}
    <p class="so-lede warn">{c.error ?? 'It stopped before it finished.'}</p>
  {:else if stopped}
    <p class="so-lede muted">{c.state === 'declined' ? 'You declined this double-check.' : 'This double-check was cancelled.'}</p>
  {/if}

  {#if c.result}
    <div class="result">
      <h4>What the sources say now</h4>
      <p>{c.result.summary}</p>
      <ul class="evidence">
        {#each c.result.evidence as e, i (i)}
          <li class:gone={e.status === 'unavailable'}>
            <details>
              <summary>
                <span class="ev-label">{evidenceLabel(e)}</span>
                <span class="ev-meta">{e.status === 'available' ? 'read' : 'could not be reached'} · {stamp(e.retrievedAt)}</span>
              </summary>
              <pre>{e.text}</pre>
              <p class="receipt">Receipt · SHA-256 <code>{e.contentHash}</code></p>
            </details>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if error}<p class="so-err" role="alert">{error}</p>{/if}

  <div class="so-actions">
    {#if asking}
      <button type="button" class="cta" disabled={busy} onclick={() => decide('approve')}>{busy ? 'Saving…' : 'Approve and run'}</button>
      {#if c.state !== 'deferred'}<button type="button" class="btn" disabled={busy} onclick={() => decide('defer')}>Not now — ask me in a week</button>{/if}
      <button type="button" class="btn" disabled={busy} onclick={() => decide('decline')}>Decline</button>
    {/if}
    {#if decisionAllowed(c.state, 'retry')}
      <button type="button" class="cta" disabled={busy} onclick={() => decide('retry')}>Try again</button>
    {/if}
    {#if ['queued', 'running', 'needs_attention'].includes(c.state)}
      <button type="button" class="btn" disabled={busy} onclick={() => decide('cancel')}>Cancel</button>
    {/if}
    {#if ['awaiting_approval', 'deferred', 'needs_attention'].includes(c.state)}
      <button type="button" class="link-btn" disabled={busy} onclick={refresh} title="Rebuild this double-check with the note you added to the idea">Refresh with my note</button>
    {/if}
  </div>

  <details class="so-more">
    <summary>The fine print · {c.events.length} event{c.events.length === 1 ? '' : 's'}</summary>
    <ol class="timeline">
      {#each c.events as event (event.id)}
        <li><time datetime={event.at}>{stamp(event.at)}</time><span>{event.summary}</span></li>
      {/each}
    </ol>
    <ul class="so-list small">
      {#each c.spec.reuseAssessment as x, i (i)}<li>{x}</li>{/each}
    </ul>
    <p class="so-links">
      <a href={`/jkai/develop/backlog?item=${encodeURIComponent(c.backlogSlug)}`}>Filed in the build backlog</a>
      <a href={c.url}>Link to this check</a>
    </p>
  </details>
</div>

<style>
  .signoff {
    margin-top: 16px;
    border: 1px solid var(--line-strong);
    border-left: 3px solid var(--accent-ink);
    padding: 16px 18px;
    background: var(--accent-ink-tint-06);
    scroll-margin-top: 90px;
  }
  .signoff.asking {
    border-left-color: var(--accent);
    background: var(--accent-tint-04);
  }
  .signoff.focused {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .so-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
  }
  .so-kicker {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent-ink);
  }
  .asking .so-kicker {
    color: var(--accent);
  }
  .so-when {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
  .so-steps {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 0;
    margin: 14px 0 4px;
    padding: 0;
  }
  .so-steps li {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .so-steps li + li::before {
    content: '';
    width: 22px;
    height: 1px;
    margin: 0 8px 0 2px;
    background: var(--line-strong);
  }
  .so-steps li.on {
    color: var(--text-primary);
  }
  .so-dot {
    width: 9px;
    height: 9px;
    border-radius: 100px;
    border: 1px solid var(--text-ghost);
  }
  .so-steps li.on .so-dot {
    background: var(--accent-ink);
    border-color: var(--accent-ink);
  }
  .so-steps li.here .so-dot {
    background: var(--bg);
    border: 2px solid var(--accent-ink);
  }
  .so-steps li.warn .so-dot {
    border-color: var(--warn);
  }
  .so-lede {
    margin: 12px 0 0;
    font-size: var(--fs-body);
    line-height: 1.55;
    max-width: 72ch;
  }
  .so-lede.warn {
    color: var(--warn);
  }
  .so-lede.muted {
    color: var(--text-muted);
  }
  .so-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px 26px;
    margin-top: 16px;
  }
  h4 {
    margin: 0 0 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }
  .so-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .so-list li {
    position: relative;
    padding-left: 18px;
    font-size: var(--fs-body-sm);
    line-height: 1.45;
    overflow-wrap: anywhere;
  }
  .so-list li::before {
    content: '';
    position: absolute;
    left: 2px;
    top: 0.55em;
    width: 7px;
    height: 7px;
    border-radius: 100px;
    background: var(--text-ghost);
  }
  .so-list.do li::before {
    background: var(--accent-ink);
  }
  .so-list.dont li::before {
    border-radius: 0;
    height: 2px;
    top: 0.7em;
    width: 9px;
    background: var(--error);
  }
  .so-list.small li {
    font-size: var(--fs-nav);
    color: var(--text-secondary);
  }
  .so-said {
    margin: 14px 0 0;
    font-size: var(--fs-body-sm);
    color: var(--text-secondary);
  }
  .result {
    margin-top: 16px;
    padding: 12px 14px;
    border-left: 3px solid var(--success);
    background: var(--bg);
  }
  .result p {
    margin: 0 0 10px;
    line-height: 1.55;
  }
  .evidence {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .evidence summary {
    cursor: pointer;
    display: flex;
    flex-wrap: wrap;
    gap: 2px 12px;
    align-items: baseline;
    padding: 4px 0;
  }
  .ev-label {
    font-weight: 600;
    font-size: var(--fs-body-sm);
  }
  .ev-meta,
  .receipt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
  .evidence .gone .ev-label {
    color: var(--warn);
  }
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 22rem;
    overflow: auto;
    font: var(--fs-label) / 1.5 var(--font-code);
    padding: 10px;
    background: var(--surface-sunken);
    margin: 6px 0;
  }
  .receipt code {
    overflow-wrap: anywhere;
  }
  .so-err {
    margin: 12px 0 0;
    color: var(--error);
    font-size: var(--fs-body-sm);
  }
  .so-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 12px;
    margin-top: 16px;
  }
  .link-btn {
    background: none;
    border: 0;
    padding: 6px 2px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-secondary);
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .link-btn:hover:not(:disabled) {
    color: var(--accent);
  }
  .so-more {
    margin-top: 14px;
    border-top: 1px solid var(--line-hair);
    padding-top: 8px;
  }
  .so-more summary {
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .timeline {
    list-style: none;
    padding: 0;
    margin: 10px 0;
  }
  .timeline li {
    display: grid;
    grid-template-columns: minmax(9rem, 1fr) 3fr;
    gap: 12px;
    border-top: 1px solid var(--line-hair);
    padding: 6px 0;
    font-size: var(--fs-nav);
  }
  .timeline time {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
  .so-links {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
    margin: 10px 0 0;
    font-size: var(--fs-nav);
  }
  .so-links a {
    color: var(--accent-ink);
  }
  @media (max-width: 640px) {
    .so-grid {
      grid-template-columns: 1fr;
    }
    .timeline li {
      grid-template-columns: 1fr;
      gap: 2px;
    }
  }
</style>
