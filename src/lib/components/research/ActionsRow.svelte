<script lang="ts">
  /**
   * What to do with a finished piece of research.
   *
   * Every one of these already had a working backend and no button: `@research`
   * retrieval reads the fact and source-chunk index, `intel-bridge` pushes
   * findings into the intel graph, the export routes render docx and markdown,
   * and `share` mints a public token. A finished run was a dead end in the UI —
   * you could read it or export it, and that was all.
   *
   * Actions that leave the site or change what other people can see are the ones
   * worth being careful about, so `share` confirms before minting a link rather
   * than doing it on a single click.
   */
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

  const pushToIntel = () =>
    run('intel', async () => {
      const res = await fetch(`/api/research/${sessionId}/to-intel`, { method: 'POST' });
      if (!res.ok) throw new Error(`Intel extraction failed (${res.status})`);
      const body = await res.json();
      return `Added ${body.entities ?? 0} entities and ${body.notes ?? 0} notes to Intel.`;
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
    {#if hasReport}
      <button class="act" type="button" disabled={busy === 'intel'} onclick={pushToIntel}>
        {busy === 'intel' ? 'Adding…' : 'Add to Intel'}
      </button>
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

  .msg { margin: 0.6rem 0 0; font-size: 0.85rem; color: var(--success); }
  .err { margin: 0.6rem 0 0; font-family: var(--font-mono); font-size: var(--fs-label); color: var(--error); }
</style>
