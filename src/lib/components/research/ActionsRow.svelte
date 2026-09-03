<script lang="ts">
  /**
   * What to do with a finished piece of research.
   *
   * Every one of these already had a working backend and no button: `@research`
   * retrieval reads the fact and source-chunk index, the export routes render
   * docx and markdown, and `share` mints a public token. A finished run was a
   * dead end in the UI — you could read it or export it, and that was all.
   *
   * Actions that leave the site or change what other people can see are the ones
   * worth being careful about, so `share` confirms before minting a link rather
   * than doing it on a single click. Committing to the knowledge graph confirms
   * for the same reason: the session's graph is its own until then, and merging
   * it changes what every other surface in jkai reasons over.
   */
  import { onMount } from 'svelte';

  let {
    sessionId,
    depth,
    hasReport,
    shareToken = null,
  }: {
    sessionId: string;
    depth: string;
    hasReport: boolean;
    shareToken?: string | null;
  } = $props();

  let busy = $state<string | null>(null);
  let message = $state<string | null>(null);
  let error = $state<string | null>(null);
  let token = $state<string | null>(shareToken);
  let confirmingShare = $state(false);
  let confirmingCommit = $state(false);

  /**
   * Whether this session's graph is already in the durable graph, and how big
   * it is. Fetched rather than passed down: it is a fact about the intel graph,
   * not about the research row, and the page load has no reason to know it.
   */
  let graph = $state<{
    committed: boolean;
    committedAt: string | null;
    entities: number;
    relationships: number;
  } | null>(null);

  onMount(async () => {
    try {
      const res = await fetch(`/api/research/${sessionId}/to-intel`);
      if (res.ok) graph = await res.json();
    } catch {
      // The commit button falls back to its unqualified label. Not knowing the
      // count is not a reason to hide the action.
    }
  });

  async function run(key: string, fn: () => Promise<string>) {
    busy = key;
    error = null;
    message = null;
    try {
      message = await fn();
    } catch (e: any) {
      error = e?.message ?? 'That did not work';
    } finally {
      busy = null;
    }
  }

  const commitToGraph = () =>
    run('intel', async () => {
      const res = await fetch(`/api/research/${sessionId}/to-intel`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `Commit failed (${res.status})`);
      confirmingCommit = false;
      graph = {
        committed: true,
        committedAt: new Date().toISOString(),
        entities: body.entities ?? graph?.entities ?? 0,
        relationships: body.relationships ?? graph?.relationships ?? 0,
      };
      return `Merged ${body.entities ?? 0} entities and ${body.relationships ?? 0} relationships into the knowledge graph.`;
    });

  const share = () =>
    run('share', async () => {
      const res = await fetch(`/api/deepdive/${sessionId}/share`, { method: 'POST' });
      if (!res.ok) throw new Error(`Could not create a share link (${res.status})`);
      const body = await res.json();
      token = body.shareToken ?? body.token ?? null;
      confirmingShare = false;
      return token ? 'Share link created — anyone with it can read this.' : 'Shared.';
    });

  const unshare = () =>
    run('share', async () => {
      const res = await fetch(`/api/deepdive/${sessionId}/share`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Could not revoke the link (${res.status})`);
      token = null;
      return 'Share link revoked.';
    });

  function copyShare() {
    if (!token) return;
    navigator.clipboard?.writeText(`${location.origin}/deepdive/share/${token}`);
    message = 'Link copied.';
  }
</script>

<section class="nm-sec">
  <div class="nm-sec-hd"><span class="sr-label-tight">Do something with this</span></div>

  <div class="actions">
<!-- "Ask jkai about it" now lives in AskJkaiPanel above, which asks a real
         question from this report rather than seeding the composer with a
         fragment for the reader to finish. -->
    <!-- The session's graph is its own until this is pressed. Nothing merges
         research into the durable graph automatically any more, so this button
         is the only door. -->
    {#if hasReport}
      {#if confirmingCommit}
        <span class="confirm">
          Merges into the knowledge graph everything else reads.
          <button class="act" type="button" disabled={busy === 'intel'} onclick={commitToGraph}>
            {busy === 'intel' ? 'Merging…' : 'Commit'}
          </button>
          <button class="act" type="button" onclick={() => (confirmingCommit = false)}>Cancel</button>
        </span>
      {:else if graph?.committed}
        <span class="state">In the knowledge graph</span>
        <button class="act" type="button" onclick={() => (confirmingCommit = true)}>Re-commit</button>
      {:else}
        <button class="act" type="button" onclick={() => (confirmingCommit = true)}>
          {graph && graph.entities > 0
            ? `Commit ${graph.entities} entities, ${graph.relationships} links`
            : 'Commit to knowledge graph'}
        </button>
      {/if}
    {/if}

    {#if depth === 'investigation'}
      <a class="act" href="/research/{sessionId}/desk">Open the desk</a>
    {/if}

    <a class="act" href="/api/deepdive/{sessionId}/export/md" download>Markdown</a>
    <a class="act" href="/api/deepdive/{sessionId}/export/docx" download>Word</a>

    {#if token}
      <button class="act" type="button" onclick={copyShare}>Copy share link</button>
      <button class="act danger" type="button" disabled={busy === 'share'} onclick={unshare}>
        {busy === 'share' ? 'Revoking…' : 'Revoke link'}
      </button>
    {:else if confirmingShare}
      <span class="confirm">
        Anyone with the link can read this.
        <button class="act" type="button" disabled={busy === 'share'} onclick={share}>
          {busy === 'share' ? 'Creating…' : 'Create link'}
        </button>
        <button class="act" type="button" onclick={() => (confirmingShare = false)}>Cancel</button>
      </span>
    {:else}
      <button class="act" type="button" onclick={() => (confirmingShare = true)}>Share publicly…</button>
    {/if}
  </div>

  {#if message}<p class="msg">{message}</p>{/if}
  {#if error}<p class="err">{error}</p>{/if}
</section>

<style>
  .nm-sec { border: 1px solid var(--line-strong); background: var(--surface-elevated); padding: 0.8rem 0.9rem; margin-bottom: 1rem; }
  .nm-sec-hd { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.6rem; padding-bottom: 0.4rem; border-bottom: 1px solid var(--line-hair); }
  .sr-label-tight { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.16em; color: var(--text-muted); }

  .actions { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; }
  .act {
    font-family: var(--font-mono); font-size: var(--fs-label); text-transform: uppercase; letter-spacing: 0.1em;
    padding: 0.4rem 0.7rem; background: var(--bg); border: 1px solid var(--line-strong);
    color: var(--text-primary); text-decoration: none; cursor: pointer;
  }
  .act:hover { border-color: var(--accent); color: var(--accent); }
  .act:disabled { opacity: 0.5; cursor: not-allowed; }
  .act.danger:hover { border-color: var(--error); color: var(--error); }
  .confirm { display: inline-flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; font-size: 0.85rem; color: var(--text-secondary); }
  .state {
    font-family: var(--font-mono); font-size: var(--fs-label); text-transform: uppercase;
    letter-spacing: 0.1em; color: var(--text-muted); padding: 0.4rem 0;
  }

  .msg { margin: 0.6rem 0 0; font-size: 0.85rem; color: var(--success); }
  .err { margin: 0.6rem 0 0; font-family: var(--font-mono); font-size: var(--fs-label); color: var(--error); }
</style>
