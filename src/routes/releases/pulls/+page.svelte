<script lang="ts">
  // /releases/pulls — the pull-request desk. Two bands:
  //   A  Waiting      every open PR across the owner's repositories, with merge
  //                   and close, and why merge is not offered when it is not
  //   B  Merged       the last merges, each with a Revert (the rollback)
  //
  // The page only offers; the server decides. Every button posts what the page
  // saw (the head sha) and /api/pull-requests re-reads GitHub before acting.
  import { invalidateAll } from '$app/navigation';
  import HealthShell from '$lib/components/shell/HealthShell.svelte';
  import SectionHead from '$lib/components/shell/SectionHead.svelte';

  let { data } = $props();

  let busy = $state<string | null>(null);
  let outcome = $state<{ ok: boolean; text: string; url?: string } | null>(null);
  let repoFilter = $state('all');

  const open = $derived(data.ok ? data.open : []);
  const merged = $derived(data.ok ? data.merged : []);
  const repos = $derived([...new Set(open.map((p) => p.repo))].sort());
  const shown = $derived(repoFilter === 'all' ? open : open.filter((p) => p.repo === repoFilter));
  const readyCount = $derived(open.filter((p) => p.verdict.ready).length);

  const short = (repo: string) => repo.split('/')[1] ?? repo;

  function ago(iso: string | null): string {
    if (!iso) return '';
    const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (mins < 60) return `${Math.max(mins, 1)}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 48) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  }

  function checkTone(state: string): 'ok' | 'bad' | 'wait' | 'skip' {
    if (state === 'success') return 'ok';
    if (state === 'skipped' || state === 'neutral') return 'skip';
    if (['failure', 'error', 'cancelled', 'timed_out', 'action_required', 'startup_failure'].includes(state)) return 'bad';
    return 'wait';
  }

  async function act(action: 'merge' | 'close' | 'revert', pull: { repo: string; number: number; headSha?: string; title: string; consequence?: string; touchesSchema?: boolean }) {
    const label = `${short(pull.repo)} #${pull.number}`;
    const ask =
      action === 'merge'
        ? `Merge ${label}?\n\n${pull.title}\n\n${pull.consequence}`
        : action === 'close'
          ? `Close ${label} without merging?\n\n${pull.title}`
          : `Roll back ${label}?\n\n${pull.title}\n\nThis opens a pull request that undoes it. Nothing changes until you merge that one.` +
            (pull.touchesSchema ? '\n\nIt touched the database schema: reverting the code does not undo a schema change.' : '');
    if (!confirm(ask)) return;
    busy = `${pull.repo}#${pull.number}`;
    outcome = null;
    try {
      const res = await fetch('/api/pull-requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, repo: pull.repo, number: pull.number, sha: pull.headSha }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result.ok) throw new Error(result?.error || result?.message || `HTTP ${res.status}`);
      outcome = { ok: true, text: result.message, url: result.url };
      await invalidateAll();
    } catch (err) {
      outcome = { ok: false, text: err instanceof Error ? err.message : 'failed' };
    } finally {
      busy = null;
    }
  }
</script>

<svelte:head>
  <title>Pull requests · Shipped</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<HealthShell
  path="/releases/pulls"
  unifiedNav
  maxWidth={1200}
  footer={[
    'strangeramblings.com/releases/pulls · owner only',
    data.ok ? `${open.length} open · ${readyCount} ready · read ${ago(data.fetchedAt)}` : 'GitHub unavailable',
    'Merges squash; reverts open a pull request',
  ]}
>
  <section class="band">
    <SectionHead
      kicker={`A / Waiting · ${open.length} open`}
      title={['Open pull requests,', 'and what merging does']}
      strap="Every open pull request across your repositories. Merge is offered only when checks are green, nothing conflicts and no release is already queued. The server checks all of that again when you press it."
    />

    {#if outcome}
      <p class="outcome" class:bad={!outcome.ok} role="status">
        {outcome.text}
        {#if outcome.url}<a href={outcome.url} target="_blank" rel="noopener">Open on GitHub ↗</a>{/if}
      </p>
    {/if}

    {#if !data.ok}
      <p class="empty">Could not read GitHub: {data.error}</p>
    {:else}
      {#if repos.length > 1}
        <div class="filters" role="group" aria-label="Filter by repository">
          <button type="button" class="chip" class:on={repoFilter === 'all'} onclick={() => (repoFilter = 'all')}>All · {open.length}</button>
          {#each repos as repo (repo)}
            <button type="button" class="chip" class:on={repoFilter === repo} onclick={() => (repoFilter = repo)}>
              {short(repo)} · {open.filter((p) => p.repo === repo).length}
            </button>
          {/each}
        </div>
      {/if}

      {#if shown.length === 0}
        <p class="empty">Nothing open. Everything has either shipped or been closed.</p>
      {/if}

      <ul class="pulls">
        {#each shown as pull (pull.repo + pull.number)}
          {@const failing = pull.checks.filter((c) => checkTone(c.state) === 'bad')}
          {@const waiting = pull.checks.filter((c) => checkTone(c.state) === 'wait')}
          <li class="pull" class:ready={pull.verdict.ready}>
            <div class="pull-hd">
              <p class="meta">
                <span class="repo">{short(pull.repo)}</span>
                <a href={pull.url} target="_blank" rel="noopener">#{pull.number}</a>
                · {ago(pull.createdAt)}
                {#if pull.author}· {pull.author}{/if}
                {#if pull.isDraft}<span class="tag">draft</span>{/if}
                {#if pull.supersededBy}<span class="tag">superseded by #{pull.supersededBy}</span>{/if}
                {#if pull.touchesSchema}<span class="tag warn">schema</span>{/if}
              </p>
              <h3>{pull.title}</h3>
              <p class="facts">
                <code>{pull.branch}</code> → <code>{pull.base}</code>
                · <span class="add">+{pull.additions}</span> <span class="del">−{pull.deletions}</span> in {pull.changedFiles}
                {pull.changedFiles === 1 ? 'file' : 'files'}
              </p>
            </div>

            <div class="status">
              <p class="checks">
                {#if pull.checks.length === 0}
                  <span class="dot wait"></span> no checks reported
                {:else if failing.length}
                  <span class="dot bad"></span> failing:
                  {#each failing as c, i (c.name + i)}{#if i > 0}, {/if}{#if c.url}<a href={c.url} target="_blank" rel="noopener">{c.name}</a>{:else}{c.name}{/if}{/each}
                {:else if waiting.length}
                  <span class="dot wait"></span> running: {waiting.map((c) => c.name).join(', ')}
                {:else}
                  {@const passed = pull.checks.filter((c) => checkTone(c.state) === 'ok').length}
                  <span class="dot ok"></span> {passed} {passed === 1 ? 'check' : 'checks'} passed
                {/if}
                {#if pull.mergeable === 'CONFLICTING'}<span class="tag bad">conflicts</span>{/if}
              </p>
              <p class="consequence">{pull.consequence}</p>
            </div>

            <div class="actions">
              <button
                type="button"
                class="btn"
                disabled={!!busy || !pull.verdict.ready}
                title={pull.verdict.reason || 'Squash-merge'}
                onclick={() => act('merge', pull)}>{busy === `${pull.repo}#${pull.number}` ? 'Working…' : 'Merge'}</button
              >
              <button type="button" class="btn ghost" disabled={!!busy} onclick={() => act('close', pull)}>Close</button>
              {#if !pull.verdict.ready}<span class="why">{pull.verdict.reason}</span>{/if}
            </div>

            <details>
              <summary>Description and files</summary>
              <div class="detail">
                {#if pull.body.trim()}
                  <pre class="body">{pull.body}</pre>
                {:else}
                  <p class="empty">No description.</p>
                {/if}
                {#if pull.files.length}
                  <table class="files">
                    <tbody>
                      {#each pull.files as f (f.path)}
                        <tr>
                          <th scope="row">{f.path}</th>
                          <td class="add">+{f.additions}</td>
                          <td class="del">−{f.deletions}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                  {#if pull.files.length < pull.changedFiles}
                    <p class="empty">First {pull.files.length} of {pull.changedFiles} files — the rest are on GitHub.</p>
                  {/if}
                {/if}
              </div>
            </details>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  {#if data.ok}
    <section class="band">
      <SectionHead
        kicker={`B / Merged · last ${merged.length}`}
        title={['Recently merged,', 'and the way back']}
        strap="Revert opens a pull request that undoes a merge. It runs the same checks, and merging it here ships the previous behaviour through the normal release path. It reverts code, not a schema change that already reached production."
      />
      <ul class="merged">
        {#each merged as pull (pull.repo + pull.number)}
          <li>
            <div>
              <p class="meta">
                <span class="repo">{short(pull.repo)}</span>
                <a href={pull.url} target="_blank" rel="noopener">#{pull.number}</a>
                · merged {ago(pull.mergedAt)}
                {#if pull.mergeCommit}· <code>{pull.mergeCommit.slice(0, 8)}</code>{/if}
                {#if pull.touchesSchema}<span class="tag warn">schema</span>{/if}
              </p>
              <p class="title">{pull.title}</p>
            </div>
            <div class="actions">
              {#if pull.revertedBy}
                <a class="rev" href={pull.revertedBy.url} target="_blank" rel="noopener"
                  >{pull.revertedBy.merged ? 'Rolled back' : 'Rollback open'} · #{pull.revertedBy.number} ↗</a
                >
              {:else}
                <button type="button" class="btn ghost" disabled={!!busy} onclick={() => act('revert', pull)}>
                  {busy === `${pull.repo}#${pull.number}` ? 'Working…' : 'Revert'}
                </button>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</HealthShell>

<style>
  /* The hub's own gutter (ReleasesHub `.filters` / `.c`), so the two pages line up. */
  .band { padding: clamp(20px, 2.5vw, 34px) clamp(20px, 3vw, 44px) 8px; }
  .outcome {
    margin: 18px 0 0;
    padding: 12px 16px;
    border-left: 3px solid var(--success);
    background: var(--surface-elevated);
    font: var(--fs-label) var(--font-body);
  }
  .outcome.bad { border-left-color: var(--error); }
  .outcome a { margin-left: 8px; color: var(--accent-ink); }
  .empty { color: var(--text-muted); font: var(--fs-label) var(--font-body); }

  .filters { display: flex; flex-wrap: wrap; gap: 6px; margin: 22px 0 6px; }
  .chip {
    font: 600 var(--fs-label-xs) var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 6px 12px;
    border: 1px solid var(--text-primary);
    border-radius: 100px;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
  }
  .chip.on { background: var(--text-primary); color: var(--bg); }

  .pulls, .merged { list-style: none; margin: 16px 0 0; padding: 0; }
  .pull {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) auto;
    gap: 10px 24px;
    padding: 18px 0;
    border-top: 2px solid var(--text-primary);
  }
  .pull.ready { border-top-color: var(--success); }
  .pull h3 { margin: 4px 0 6px; font: 800 1.15rem/1.25 var(--font-display); }
  .meta, .facts, .checks, .consequence, .why {
    margin: 0;
    font: var(--fs-label-xs) var(--font-mono);
    color: var(--text-secondary);
    overflow-wrap: anywhere;
  }
  .meta a, .checks a { color: var(--accent-ink); }
  .repo { font-weight: 700; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.08em; }
  .tag {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 7px;
    border: 1px solid currentColor;
    border-radius: 100px;
    font-size: var(--fs-label-xs);
  }
  .tag.warn { color: var(--warn); }
  .tag.bad { color: var(--error); }
  .add { color: var(--success); }
  .del { color: var(--error); }
  .checks { color: var(--text-primary); }
  .consequence { margin-top: 6px; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 100px; margin-right: 4px; vertical-align: 1px; }
  .dot.ok { background: var(--success); }
  .dot.bad { background: var(--error); }
  .dot.wait { background: var(--warn); }

  .actions { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; }
  .pull .actions { flex-direction: column; align-items: stretch; min-width: 130px; }
  .why { max-width: 180px; }
  .btn {
    font: 700 var(--fs-label-xs) var(--font-mono);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 9px 16px;
    border: 1px solid var(--accent);
    border-radius: 0;
    background: var(--accent);
    color: var(--bg);
    cursor: pointer;
  }
  .btn.ghost { background: transparent; color: var(--text-primary); border-color: var(--text-primary); }
  .btn:hover:not(:disabled) { background: var(--text-primary); border-color: var(--text-primary); color: var(--bg); }
  .btn:disabled { opacity: 0.45; cursor: default; }

  details { grid-column: 1 / -1; }
  summary { cursor: pointer; font: 600 var(--fs-label-xs) var(--font-mono); letter-spacing: 0.08em; text-transform: uppercase; }
  .detail { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; margin-top: 12px; }
  .body {
    margin: 0;
    max-height: 420px;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font: var(--fs-label) var(--font-body);
    padding: 12px 14px;
    background: var(--surface-elevated);
  }
  .files { width: 100%; border-collapse: collapse; font: var(--fs-label-xs) var(--font-mono); }
  .files th { text-align: left; font-weight: 400; overflow-wrap: anywhere; padding: 4px 8px 4px 0; border-bottom: 1px solid var(--line-hair); }
  .files td { text-align: right; padding: 4px 0 4px 8px; white-space: nowrap; border-bottom: 1px solid var(--line-hair); }

  .merged li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    padding: 12px 0;
    border-top: 1px solid var(--text-primary);
  }
  .merged .title { margin: 3px 0 0; font: 600 1rem/1.3 var(--font-body); }
  .rev { font: 600 var(--fs-label-xs) var(--font-mono); color: var(--accent-ink); text-transform: uppercase; letter-spacing: 0.08em; }

  @media (max-width: 760px) {
    .pull { grid-template-columns: minmax(0, 1fr); }
    .pull .actions { flex-direction: row; align-items: center; }
    .why { max-width: none; }
    .detail { grid-template-columns: minmax(0, 1fr); }
    .merged li { flex-direction: column; align-items: flex-start; }
  }
</style>
