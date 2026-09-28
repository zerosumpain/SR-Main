<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import { COMMISSION_LABELS, decisionAllowed, type CommissionDecision, type CommissionView } from '$lib/daydream/commissioning';
  import { stamp } from '$lib/daydream/format';

  let { commissions, focus = null, loadError = null }: { commissions: CommissionView[]; focus?: string | null; loadError?: string | null } = $props();
  let filter = $state('all');
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);
  const visible = $derived(commissions.filter(c => c.id === focus || filter === 'all' ||
    (filter === 'approval' && ['awaiting_approval', 'deferred'].includes(c.state)) ||
    (filter === 'progress' && ['queued', 'running'].includes(c.state)) ||
    (filter === 'attention' && c.state === 'needs_attention') ||
    (filter === 'outcomes' && ['completed', 'cancelled', 'declined'].includes(c.state))));

  async function decide(c: CommissionView, decision: CommissionDecision) {
    busy = c.id;
    error = null;
    try {
      const response = await fetch('/api/daydream/commissions', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'decide', id: c.id, decision, revision: c.revision, specHash: c.specHash, operationKey: crypto.randomUUID() }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'The decision could not be saved.');
      await invalidateAll();
    } catch (e) {
      error = e instanceof Error ? e.message : 'The decision could not be saved.';
      await invalidateAll(); // The response may have been lost after commit.
    }
    finally { busy = null; }
  }
  async function refresh(c: CommissionView) {
    busy = c.id; error = null;
    try {
      const response = await fetch('/api/daydream/commissions', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'prepare', thoughtId: c.thoughtId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'The proposal could not be refreshed.');
      if (result.commission.id === c.id) error = 'This proposal already uses the current suggestion. Add your correction to the original suggestion first.';
      else await goto(result.commission.url, { invalidateAll: true });
    } catch (e) { error = e instanceof Error ? e.message : 'The proposal could not be refreshed.'; }
    finally { busy = null; }
  }
  onMount(() => {
    const timer = setInterval(() => {
      if (!document.hidden && !busy && commissions.some(c => ['queued', 'running', 'awaiting_approval'].includes(c.state))) void invalidateAll();
    }, 15_000);
    return () => clearInterval(timer);
  });
  $effect(() => {
    const id = focus;
    if (id) void tick().then(() => document.getElementById(`commission-${id}`)?.scrollIntoView({ block: 'start' }));
  });
</script>

<section class="band" aria-label="Daydream improvements">
  <div class="inner">
    <div class="heading"><div><p class="eyebrow">From idea to action</p><h2>Your improvements</h2></div><span class="count">{commissions.length} proposals</span></div>
    <p class="intro">Review the intended result and approve its scope. Work continues while you are away; every decision and result stays here.</p>
    <nav class="filters" aria-label="Improvement status">
      {#each [['all', 'All'], ['approval', 'Awaiting approval'], ['progress', 'In progress'], ['attention', 'Needs attention'], ['outcomes', 'Outcomes']] as [key, label]}
        <button class="btn sm" aria-pressed={filter === key} onclick={() => filter = key}>{label}</button>
      {/each}
    </nav>
    {#if error || loadError}<p class="err" role="alert">{error || loadError}</p>{/if}
    {#if !visible.length}<p class="intro">No improvements in this view. Choose “Investigate first” on a suggestion to prepare a scoped evidence refresh.</p>{/if}
    {#each visible as c (c.id)}
      <article class="improvement" id={`commission-${c.id}`}>
        <p class="state">{COMMISSION_LABELS[c.state]} <span>· Next: {c.nextActor}</span></p>
        <h3>{c.spec.title}</h3>
        <p>{c.spec.outcome}</p>
        <div class="links"><a href={`?note=${encodeURIComponent(c.thoughtId)}`}>Original suggestion</a><a href={`/jkai/develop/backlog?item=${encodeURIComponent(c.backlogSlug)}`}>Backlog group</a><a href={c.url}>Link to this history</a></div>
        <details open={c.id === focus || c.state === 'awaiting_approval'}>
          <summary>Proposal and evidence</summary>
          <dl><dt>Current observation</dt><dd>{c.spec.currentBehaviour}</dd><dt>Improved behaviour</dt><dd>{c.spec.improvedBehaviour}</dd></dl>
          {#if c.spec.ownerCorrection}<p><strong>Your correction:</strong> {c.spec.ownerCorrection}</p>{/if}
          <h4>Existing capabilities</h4><ul>{#each c.spec.reuseAssessment as item}<li>{item}</li>{/each}</ul>
          <h4>Success criteria</h4><ul>{#each c.spec.acceptance as item}<li>{item}</li>{/each}</ul>
          <h4>Scope of approval</h4><ul>{#each c.spec.effects as item}<li>{item}</li>{/each}</ul>
          <h4>Limits</h4><ul>{#each c.spec.exclusions as item}<li>{item}</li>{/each}</ul>
          <p class="budget">Up to {c.spec.budget.maxReads} source reads per attempt · {c.spec.budget.maxAttempts} attempts total · {c.spec.budget.maxWallSeconds} seconds per attempt</p>
          <h4>Sources to refresh</h4><ul>{#each c.spec.reads as read}<li><code>{read.tool}</code><details><summary>Approved query</summary><pre>{JSON.stringify(read.args, null, 2)}</pre></details></li>{/each}</ul>
        </details>
        {#if c.error}<p class="err" role="status">{c.error}</p>{/if}
        <div class="actions">
          {#if decisionAllowed(c.state, 'approve')}<button class="cta sm" disabled={busy === c.id} onclick={() => decide(c, 'approve')}>Approve evidence refresh</button>{/if}
          {#if decisionAllowed(c.state, 'defer')}<button class="btn sm" disabled={busy === c.id} onclick={() => decide(c, 'defer')}>Defer 7 days</button>{/if}
          {#if decisionAllowed(c.state, 'decline')}<button class="btn sm" disabled={busy === c.id} onclick={() => decide(c, 'decline')}>Decline</button>{/if}
          {#if decisionAllowed(c.state, 'retry')}<button class="cta sm" disabled={busy === c.id} onclick={() => decide(c, 'retry')}>Retry within approved scope</button>{/if}
          {#if ['queued', 'running', 'needs_attention'].includes(c.state)}<button class="btn sm" disabled={busy === c.id} onclick={() => decide(c, 'cancel')}>Cancel</button>{/if}
          {#if ['awaiting_approval', 'deferred', 'needs_attention'].includes(c.state)}<button class="btn sm" disabled={busy === c.id} onclick={() => refresh(c)}>Update after a correction</button>{/if}
        </div>
        {#if c.result}
          <div class="result"><h4>Evidence report</h4><p>{c.result.summary}</p>
            {#each c.result.evidence as evidence}
              <details><summary>{evidence.tool} · {evidence.status} · {stamp(evidence.retrievedAt)}</summary><pre>{evidence.text}</pre><p class="receipt">Query result · SHA-256 <code>{evidence.contentHash}</code></p></details>
            {/each}
          </div>
        {/if}
        <details open={c.id === focus}><summary>History · {c.events.length} events</summary><ol class="timeline">{#each c.events as event (event.id)}<li><time datetime={event.at}>{stamp(event.at)}</time><span>{event.summary}</span></li>{/each}</ol></details>
      </article>
    {/each}
  </div>
</section>

<style>
  .heading { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; border-bottom: var(--line-title) solid var(--text-primary); padding-bottom: .8rem; }
  h2 { font: 1.6rem var(--font-display); margin: .25rem 0 0; }
  .eyebrow,.state,.count { font-size: var(--fs-label); color: var(--accent-ink); }
  .eyebrow { text-transform: uppercase; letter-spacing: .08em; }
  .intro { color: var(--text-muted); margin: 1rem 0; }
  .filters,.actions,.links { display: flex; flex-wrap: wrap; gap: .6rem 1rem; }
  .filters button[aria-pressed='true'] { border-color: var(--accent); color: var(--accent); }
  .improvement { border-bottom: 1px solid var(--line-strong); padding: 1.5rem 0; scroll-margin-top: 8rem; }
  h3 { font-size: var(--fs-body-lg); font-weight: 700; margin: .5rem 0; }
  h4,dt { font-weight: 600; margin-top: 1rem; }
  p,dd,li { line-height: 1.6; overflow-wrap: anywhere; }
  .state span,.budget,.receipt,time { color: var(--text-muted); }
  .links,.budget,.receipt,time { font-size: var(--fs-label); }
  .links { margin: .8rem 0; }
  a { color: var(--accent-ink); text-decoration: underline; }
  details { margin: .8rem 0; } summary { cursor: pointer; font-weight: 600; }
  ul { padding-left: 1.2rem; } dd { margin: .3rem 0; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 24rem; overflow: auto; font: var(--fs-label) var(--font-code); padding: .75rem; background: var(--surface-sunken); }
  .result { padding: .2rem 1rem; border-left: 3px solid var(--good); margin: 1rem 0; }
  .timeline { list-style: none; padding: 0; } .timeline li { display: grid; grid-template-columns: minmax(9rem, 1fr) 3fr; gap: 1rem; border-top: 1px solid var(--line-hair); padding: .5rem 0; }
  @media (max-width: 600px) { .timeline li { grid-template-columns: 1fr; gap: .2rem; } .heading { align-items: start; } }
</style>
