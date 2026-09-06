<script lang="ts">
  // The mail gate.
  //
  // 2,781 held threads, and the design problem is that almost none of them
  // deserve an individual judgement. So the page leads with the two views that
  // settle many threads at once — a ranked shortlist and the sender/subject
  // clusters — and keeps the full list as the third tab rather than the first.
  //
  // Structure and tokens follow /jkai/intel/review, which is the nearest
  // precedent: JkaiPageTitle, mono uppercase tabs, .wrap full-bleed, no
  // invented colours.
  import JkaiPageTitle from '$lib/components/jkai/JkaiPageTitle.svelte';
  import { invalidateAll } from '$app/navigation';

  let { data } = $props();

  type Tab = 'suggested' | 'clusters' | 'all' | 'rules';
  let tab = $state<Tab>('suggested');

  // Selection is by id, so it survives the list being re-sorted or filtered.
  let selected = $state<Set<string>>(new Set());
  let busy = $state(false);
  let message = $state('');
  let filter = $state('');
  let kindFilter = $state<'all' | 'correspondence' | 'notification' | 'bulk'>('all');
  /** Show only threads that name something the graph already knows. */
  let graphOnly = $state(false);

  const queue = $derived(data.queue);

  const visibleRows = $derived.by(() => {
    const needle = filter.trim().toLowerCase();
    return queue.rows.filter((r) => {
      if (kindFilter !== 'all' && r.emailKind !== kindFilter) return false;
      if (graphOnly && r.graphHits === 0) return false;
      if (!needle) return true;
      return r.subject.toLowerCase().includes(needle) || r.senderDomain.includes(needle);
    });
  });

  // The toggle has to mean the same thing on every tab, or it reads as broken
  // on the one it does not reach. Suggestions are already ranked server-side;
  // this only narrows them.
  const visibleSuggestions = $derived(
    graphOnly ? queue.suggestions.filter((r) => r.graphHits > 0) : queue.suggestions,
  );

  const visibleClusters = $derived.by(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return queue.clusters;
    return queue.clusters.filter((c) => c.label.toLowerCase().includes(needle) || c.domain.includes(needle));
  });

  function toggle(id: string) {
    // Reassigned rather than mutated: a Set mutated in place is the same
    // reference, and $state would not know anything had changed.
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
  }

  function selectAll(ids: string[]) {
    selected = new Set([...selected, ...ids]);
  }

  function clearSelection() {
    selected = new Set();
  }

  /**
   * Send an action, continuing until the server says there is nothing left.
   *
   * Admission costs 27–50 SECONDS per thread — Gmail, attachments, a Codex
   * extraction — and the site is behind a Cloudflare tunnel that abandons a
   * request at 100 seconds. So the server works to a time budget and hands back
   * the threads it did not reach; this loop re-sends them.
   *
   * The bug this replaces: one request for four threads ran ~160s, the browser
   * got a 524, and because the fetch rejected the page never refreshed — so
   * mail that HAD been admitted still showed as pending and it read as a total
   * failure. Progress is reported every round for the same reason: a silent
   * two-minute wait is indistinguishable from a hang.
   */
  async function act(action: 'admit' | 'reject' | 'requeue', noteIds: string[]) {
    if (!noteIds.length || busy) return;
    busy = true;
    const total = noteIds.length;
    const tally = { admitted: 0, rejected: 0, requeued: 0, failed: 0, entities: 0, edges: 0, attachments: 0, chunks: 0 };
    let queue = [...noteIds];
    let rounds = 0;

    try {
      while (queue.length) {
        if (action === 'admit') {
          const done = total - queue.length;
          message = `Reading ${done + 1}–${total} of ${total}… (about 40s each, leave this open)`;
        }
        const res = await fetch('/api/jkai/intel/mail', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action, noteIds: queue }),
        });
        const body = await res.json();
        if (!res.ok) {
          message = body?.error ?? 'That did not work.';
          break;
        }

        tally.admitted += body.admitted ?? 0;
        tally.rejected += body.rejected ?? 0;
        tally.requeued += body.requeued ?? 0;
        tally.failed += body.failed ?? 0;
        tally.entities += body.entities ?? 0;
        tally.edges += body.edges ?? 0;
        tally.attachments += body.attachmentsSaved ?? 0;
        tally.chunks += body.chunks ?? 0;

        const left: string[] = Array.isArray(body.remaining) ? body.remaining : [];
        // Guard against a server that returns the same work forever: if a round
        // made no progress, stop rather than spin.
        if (left.length >= queue.length) {
          queue = [];
          message = 'Stopped — the server returned no progress on that batch.';
          break;
        }
        queue = left;
        rounds += 1;
      }

      if (queue.length === 0 && rounds > 0) {
        if (action === 'admit') {
          message =
            `Admitted ${tally.admitted} — ${tally.entities} entities, ${tally.edges} links, ` +
            `${tally.attachments} attachments saved, ${tally.chunks} passages indexed` +
            (tally.failed ? `. ${tally.failed} failed.` : '.');
        } else if (action === 'reject') {
          message = `Rejected ${tally.rejected}.`;
        } else {
          message = `Put ${tally.requeued} back in the queue.`;
        }
      }
      clearSelection();
      await invalidateAll();
    } catch (err) {
      // Even on a network failure the earlier rounds really did land, so the
      // page is refreshed regardless — the old version left it stale and made a
      // partial success look like a total one.
      message = `${err instanceof Error ? err.message : String(err)} — ${tally.admitted + tally.rejected + tally.requeued} of ${total} were done before this.`;
      await invalidateAll().catch(() => {});
    } finally {
      busy = false;
    }
  }

  /**
   * Re-score the queue against the graph.
   *
   * Offered as a button as well as a nightly stage because the scores go stale
   * the moment the graph changes — watch an entity, merge two, pin one to a
   * dossier, and every thread in the queue is answering a slightly different
   * question. No model calls, so it is cheap to run whenever.
   */
  async function scoreRelevance() {
    if (busy) return;
    busy = true;
    message = 'Matching held threads against the graph…';
    try {
      const res = await fetch('/api/jkai/intel/mail', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'score-relevance' }),
      });
      const body = await res.json();
      if (!res.ok) {
        message = body?.error ?? 'Scoring failed.';
        return;
      }
      message = body.entities
        ? `${body.withHits} of ${body.scanned} threads name something the graph knows, ` +
          `scored against ${body.entities} entities.` +
          (body.remaining ? ` ${body.remaining} past the limit — run it again.` : '') +
          (body.similarityFailed ? ' Similarity was unavailable — the name matching still ran.' : '')
        : 'Nothing in the graph is known from outside email yet, so there is nothing to score against.';
      await invalidateAll();
    } catch (err) {
      message = err instanceof Error ? err.message : 'Scoring failed.';
    } finally {
      busy = false;
    }
  }

  async function ruleAction(action: string, key?: string) {
    if (busy) return;
    busy = true;
    message = action === 'propose' ? 'Looking for a pattern in your decisions…' : '';
    try {
      const res = await fetch('/api/jkai/intel/mail/rules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, key }),
      });
      const body = await res.json();
      if (!res.ok) {
        message = body?.error ?? 'That did not work.';
        return;
      }
      if (action === 'propose') {
        const accepted = body.accepted?.length ?? 0;
        const refused = body.refused?.length ?? 0;
        message = accepted
          ? `${accepted} rule(s) proposed${refused ? `, ${refused} refused by the backtest` : ''}.`
          : refused
            ? `Nothing offerable — ${refused} proposal(s) failed the backtest: ${body.refused.map((r: { reasons: string[] }) => r.reasons[0]).join(' ')}`
            : 'Nothing worth proposing yet.';
      } else if (action === 'apply') {
        message = body.ran
          ? `Rules ran: ${body.admitted} admitted, ${body.rejected} rejected, ${body.deferred} left for tomorrow.`
          : 'No active rules yet.';
      } else if (action === 'seed') {
        message = body.created ? 'Starter rule proposed — read its backtest below.' : 'It is already there.';
      } else {
        message = 'Done.';
      }
      await invalidateAll();
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  function shortDate(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
  }
</script>

<JkaiPageTitle title="INTEL / MAIL" titleHref="/jkai/intel" />

<div class="wrap">
  <p class="lede">
    Every swept thread waits here. Nothing reaches the graph until you say so — or until a rule you approved
    says so for you. Rejecting a thread does not delete it: daydreaming still reads your mail for vouchers,
    receipts and interests exactly as before.
  </p>

  <div class="stats">
    <span><b>{queue.pending.toLocaleString()}</b> held</span>
    <span><b>{queue.admitted.toLocaleString()}</b> in the graph</span>
    <span><b>{queue.rejected.toLocaleString()}</b> refused</span>
    <span><b>{data.relevance.withHits.toLocaleString()}</b> name the graph</span>
    <span class="ghost">{data.index.threads.toLocaleString()} threads searchable · {data.index.chunks.toLocaleString()} passages</span>
    <button class="plain" disabled={busy} onclick={scoreRelevance}>Re-score against the graph</button>
  </div>
  {#if data.relevance.unscored > 0}
    <p class="hint warn">
      {data.relevance.unscored.toLocaleString()} held threads have never been scored against the graph, so every
      graph* fact reads 0 for them and no topical rule can match them. Re-score to fix it.
    </p>
  {/if}

  <div class="tabs">
    <button class:on={tab === 'suggested'} onclick={() => (tab = 'suggested')}>
      Suggested <b>{queue.suggestions.length}</b>
    </button>
    <button class:on={tab === 'clusters'} onclick={() => (tab = 'clusters')}>
      Clusters <b>{queue.clusters.length}</b>
    </button>
    <button class:on={tab === 'all'} onclick={() => (tab = 'all')}>
      All threads <b>{queue.pending}</b>
    </button>
    <button class:on={tab === 'rules'} onclick={() => (tab = 'rules')}>
      Rules <b>{data.rules.filter((r) => r.status === 'active').length}</b>
    </button>
    <span class="spacer"></span>
    {#if tab !== 'rules'}
      <input class="search" placeholder="filter by subject or sender" bind:value={filter} />
      <select class="search" bind:value={kindFilter} aria-label="Filter by kind">
        <option value="all">every kind</option>
        <option value="correspondence">correspondence</option>
        <option value="notification">notifications</option>
        <option value="bulk">bulk</option>
      </select>
      <label class="toggle"><input type="checkbox" bind:checked={graphOnly} /> names the graph</label>
    {/if}
  </div>

  {#if message}
    <p class="message">{message}</p>
  {/if}

  {#if selected.size > 0}
    <div class="bar">
      <span>{selected.size} selected</span>
      <button class="go" disabled={busy} onclick={() => act('admit', [...selected])}>Add to graph</button>
      <button class="no" disabled={busy} onclick={() => act('reject', [...selected])}>Never</button>
      <button class="plain" disabled={busy} onclick={clearSelection}>Clear</button>
    </div>
  {/if}

  {#if tab === 'suggested'}
    {#if visibleSuggestions.length === 0}
      <p class="empty">
        {#if graphOnly && queue.suggestions.length}
          None of the top-ranked threads name anything the graph knows. Clear the filter, or re-score.
        {:else}
          Nothing held. Every swept thread has been decided.
        {/if}
      </p>
    {:else}
      <p class="hint">
        Ranked by what usually means a thread mattered — whether you replied, whether it is two-way, Gmail's own
        importance flag, and what the thread has to do with the graph you already have. Entities it names are
        listed on the row. Only entities the graph knows from somewhere other than email count, so admitted mail
        can never make more mail look relevant.
      </p>
      <ul class="rows">
        {#each visibleSuggestions as row (row.id)}
          <li class="row" class:picked={selected.has(row.id)}>
            <label class="pick">
              <input type="checkbox" checked={selected.has(row.id)} onchange={() => toggle(row.id)} />
            </label>
            <div class="body">
              <div class="subject">
                {row.subject}
                {#if !row.captured}<span class="tag warn">not yet captured</span>{/if}
              </div>
              <div class="meta">
                <span class="score">{row.score > 0 ? `+${row.score}` : row.score}</span>
                {row.senderDomain} · {row.emailKind} · {row.messageCount} msg · {shortDate(row.observedAt)}
              </div>
              <div class="why">{row.reasons.join(' · ')}</div>
              {#if row.graphNames.length}
                <div class="graph">
                  {#each row.graphNames as name}<span class="ent">{name}</span>{/each}
                  {#if row.graphHits > row.graphNames.length}
                    <span class="ghost">+{row.graphHits - row.graphNames.length} more</span>
                  {/if}
                </div>
              {/if}
            </div>
            <div class="acts">
              {#if row.gmailUrl}
                <a class="plain" href={row.gmailUrl} target="_blank" rel="noopener">Open</a>
              {/if}
              <button class="go" disabled={busy} onclick={() => act('admit', [row.id])}>Add</button>
              <button class="no" disabled={busy} onclick={() => act('reject', [row.id])}>Never</button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  {:else if tab === 'clusters'}
    {#if visibleClusters.length === 0}
      <p class="empty">No clusters match that.</p>
    {:else}
      <p class="hint">
        One decision, many threads. A sender cluster covers everything from that address; a subject cluster is
        one repeated conversation inside it. They overlap on purpose.
      </p>
      <div class="cards">
        {#each visibleClusters as cluster (cluster.key)}
          <div class="card">
            <div class="card-hd">
              <span class="kind">{cluster.kind}</span>
              <span class="label">{cluster.label}</span>
            </div>
            <div class="meta">
              <b>{cluster.count}</b> threads · {cluster.importantCount} important · {cluster.repliedCount} you replied to
              · {shortDate(cluster.oldest)} → {shortDate(cluster.newest)}
            </div>
            <ul class="samples">
              {#each cluster.samples as sample}<li>{sample}</li>{/each}
            </ul>
            <div class="acts">
              <button class="go" disabled={busy} onclick={() => act('admit', cluster.noteIds)}>
                Add all {cluster.count}
              </button>
              <button class="no" disabled={busy} onclick={() => act('reject', cluster.noteIds)}>Never any</button>
              <button class="plain" onclick={() => selectAll(cluster.noteIds)}>Select</button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {:else if tab === 'all'}
    {#if queue.truncated}
      <p class="hint warn">Showing the newest {queue.rows.length.toLocaleString()} held threads. Work through the clusters to bring this down.</p>
    {/if}
    <ul class="rows">
      {#each visibleRows.slice(0, 400) as row (row.id)}
        <li class="row" class:picked={selected.has(row.id)}>
          <label class="pick">
            <input type="checkbox" checked={selected.has(row.id)} onchange={() => toggle(row.id)} />
          </label>
          <div class="body">
            <div class="subject">{row.subject}</div>
            <div class="meta">{row.senderDomain} · {row.emailKind} · {shortDate(row.observedAt)}</div>
            {#if row.graphNames.length}
              <div class="graph">
                {#each row.graphNames as name}<span class="ent">{name}</span>{/each}
              </div>
            {/if}
          </div>
          <div class="acts">
            <button class="go" disabled={busy} onclick={() => act('admit', [row.id])}>Add</button>
            <button class="no" disabled={busy} onclick={() => act('reject', [row.id])}>Never</button>
          </div>
        </li>
      {/each}
    </ul>
    {#if visibleRows.length > 400}
      <p class="hint">{(visibleRows.length - 400).toLocaleString()} more match — narrow the filter or use a cluster.</p>
    {/if}
  {:else}
    <p class="hint">
      A rule is data, not code: a fixed set of facts about a thread, compared against values. Every proposal is
      replayed over your whole mailbox and against your own decisions before you see it, and nothing switches
      itself on.
    </p>
    <div class="bar">
      {#if data.seedAvailable}
        <button class="go" disabled={busy} onclick={() => ruleAction('seed')}>Propose the starter rule</button>
      {/if}
      <button class="plain" disabled={busy} onclick={() => ruleAction('propose')}>Look for a new rule</button>
      <button class="plain" disabled={busy} onclick={() => ruleAction('apply')}>Run active rules now</button>
      <span class="ghost">{data.decisions.byOwner} of your decisions to learn from</span>
    </div>

    {#if data.rules.length === 0}
      <p class="empty">No rules yet. Decide on a few threads, then ask for one.</p>
    {:else}
      <div class="cards">
        {#each data.rules as rule (rule.key)}
          <div class="card" class:active={rule.status === 'active'}>
            <div class="card-hd">
              <span class="kind" class:admit={rule.action === 'admit'}>{rule.action}</span>
              <span class="label">{rule.label}</span>
              <span class="status">{rule.status}</span>
            </div>
            <div class="cond">{rule.explanation}</div>
            {#if rule.rationale}<p class="why">{rule.rationale}</p>{/if}
            {#if rule.backtest}
              <div class="meta">
                Matches <b>{rule.backtest.matched}</b> of {rule.backtest.scanned} threads
                (~{rule.backtest.perWeek}/week) · agrees with you {rule.backtest.agreed}, disagrees
                {rule.backtest.disagreed}
                {#if rule.backtest.falseAdmits > 0}
                  · <span class="warn">would re-admit {rule.backtest.falseAdmits} you rejected</span>
                {/if}
              </div>
              {#if rule.backtest.samples.length}
                <ul class="samples">
                  {#each rule.backtest.samples as sample}<li>{sample}</li>{/each}
                </ul>
              {/if}
            {:else}
              <div class="meta warn">Never replayed — run the backtest before switching it on.</div>
            {/if}
            <div class="acts">
              {#if rule.status !== 'active'}
                <button class="go" disabled={busy || !rule.backtest} onclick={() => ruleAction('activate', rule.key)}>
                  Switch on
                </button>
              {:else}
                <button class="plain" disabled={busy} onclick={() => ruleAction('pause', rule.key)}>Pause</button>
              {/if}
              <button class="plain" disabled={busy} onclick={() => ruleAction('backtest', rule.key)}>Re-check</button>
              {#if rule.status !== 'declined'}
                <button class="no" disabled={busy} onclick={() => ruleAction('decline', rule.key)}>Decline</button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .wrap {
    padding: 16px 20px 28px;
    width: 100%;
  }

  .lede {
    max-width: 68ch;
    color: var(--text-secondary);
    font-size: var(--fs-body-sm, 0.9rem);
    margin: 0 0 14px;
  }

  .stats {
    display: flex;
    gap: 18px;
    flex-wrap: wrap;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    margin-bottom: 14px;
  }
  .stats b {
    color: var(--text-primary);
    font-weight: 600;
  }
  .ghost {
    color: var(--text-ghost);
  }

  .tabs {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    border-bottom: 1px solid var(--line-hair);
    padding-bottom: 10px;
    margin-bottom: 14px;
  }
  .tabs .spacer {
    flex: 1;
  }
  .tabs > button {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 6px 11px;
    border: 1px solid transparent;
    border-radius: var(--radius-sharp);
    background: transparent;
    color: var(--text-ghost);
    cursor: pointer;
  }
  .tabs > button.on {
    color: var(--accent);
    border-color: var(--accent-tint-35);
    background: var(--accent-tint-08);
  }
  .tabs > button b {
    font-weight: 500;
    color: var(--text-muted);
  }
  .search {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    padding: 5px 9px;
    border: 1px solid var(--line-hair);
    border-radius: var(--radius-sharp);
    background: var(--surface-elevated);
    color: var(--text-primary);
  }

  .message {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent-ink);
    border-left: 2px solid var(--accent-ink);
    padding: 6px 10px;
    margin: 0 0 12px;
  }

  .hint {
    max-width: 74ch;
    color: var(--text-muted);
    font-size: var(--fs-body-sm, 0.9rem);
    margin: 0 0 12px;
  }
  .hint.warn,
  .warn {
    color: var(--warn);
  }

  .empty {
    color: var(--text-ghost);
    padding: 32px 0;
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 8px 0 14px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }

  button.go,
  button.no,
  button.plain,
  a.plain {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 5px 10px;
    border-radius: var(--radius-sharp);
    border: 1px solid var(--line-hair);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    text-decoration: none;
  }
  button.go {
    border-color: var(--accent-tint-35);
    background: var(--accent-tint-08);
    color: var(--accent);
  }
  button.no {
    border-color: var(--line-hair);
    color: var(--text-ghost);
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 9px 11px;
    border: 1px solid var(--line-hair);
    border-radius: var(--radius-sharp);
    background: var(--card-bg);
  }
  .row.picked {
    border-color: var(--accent-tint-35);
    background: var(--accent-tint-08);
  }
  .pick {
    padding-top: 2px;
  }
  .row .body {
    flex: 1;
    min-width: 0;
  }
  .subject {
    font-size: var(--fs-body-sm, 0.9rem);
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }
  .meta,
  .why,
  .cond {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    margin-top: 3px;
  }
  .why {
    color: var(--text-muted);
  }
  .cond {
    color: var(--accent-ink);
    overflow-wrap: anywhere;
  }
  .score {
    color: var(--accent);
    margin-right: 6px;
  }
  .row .acts,
  .card .acts {
    display: flex;
    gap: 6px;
    align-items: center;
    flex-wrap: wrap;
  }
  .card .acts {
    margin-top: 10px;
  }

  .tag {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 1px 5px;
    margin-left: 6px;
    border: 1px solid var(--line-hair);
    border-radius: var(--radius-sharp);
    color: var(--text-ghost);
  }
  .graph {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
  }
  .ent {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    padding: 1px 5px;
    border: 1px solid var(--line-hair);
    border-radius: var(--radius-sharp);
    color: var(--accent-ink);
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    white-space: nowrap;
  }

  .tag.warn {
    color: var(--warn);
    border-color: var(--warn);
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
    gap: 10px;
  }
  .card {
    border: 1px solid var(--line-hair);
    border-radius: var(--radius-sharp);
    background: var(--card-bg);
    padding: 12px;
  }
  .card.active {
    border-color: var(--success);
  }
  .card-hd {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
  }
  .kind,
  .status {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
    border: 1px solid var(--line-hair);
    border-radius: var(--radius-sharp);
    padding: 1px 5px;
  }
  .kind.admit {
    color: var(--accent);
    border-color: var(--accent-tint-35);
  }
  .label {
    font-size: var(--fs-body-sm, 0.9rem);
    color: var(--text-primary);
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .samples {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
  }
  .samples li {
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
