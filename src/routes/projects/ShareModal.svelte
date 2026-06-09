<script lang="ts">
  import { onMount } from 'svelte';
  import type { PublicShare } from '$lib/projects/shares';

  interface Props {
    projectKey: string;
    href: string;        // the project's route path, e.g. /projects/policy-engine or /projects/whitehall/
    title?: string;
    onClose: () => void;
  }
  let { projectKey, href, title = '', onClose }: Props = $props();

  let shares = $state<PublicShare[]>([]);
  let loading = $state(true);
  let creating = $state(false);
  let label = $state('');
  let expiresInDays = $state(0); // 0 = no expiry
  let freshUrl = $state<string | null>(null);
  let copied = $state(false);
  let err = $state<string | null>(null);

  const origin = typeof location !== 'undefined' ? location.origin : 'https://strangeramblings.com';
  const shareUrl = (token: string) => `${origin}${href}${href.includes('?') ? '&' : '?'}t=${token}`;

  async function load() {
    loading = true;
    err = null;
    try {
      const res = await fetch(`/api/projects/share?key=${encodeURIComponent(projectKey)}`);
      const data = await res.json();
      if (res.ok) shares = data.shares ?? [];
      else err = data.error ?? 'Failed to load links';
    } catch {
      err = 'Failed to load links';
    } finally {
      loading = false;
    }
  }

  async function create() {
    creating = true;
    err = null;
    freshUrl = null;
    try {
      const res = await fetch('/api/projects/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: projectKey, label: label || undefined, expiresInDays: expiresInDays || undefined }),
      });
      const data = await res.json();
      if (res.ok && data.token) {
        freshUrl = shareUrl(data.token);
        label = '';
        copy(freshUrl);
        await load();
      } else {
        err = data.error ?? 'Failed to create link';
      }
    } catch {
      err = 'Failed to create link';
    } finally {
      creating = false;
    }
  }

  async function revoke(id: string) {
    try {
      const res = await fetch('/api/projects/share', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: projectKey, id }),
      });
      if (res.ok) await load();
    } catch { /* ignore */ }
  }

  function copy(url: string) {
    try {
      navigator.clipboard?.writeText(url);
      copied = true;
      setTimeout(() => (copied = false), 1600);
    } catch { /* clipboard blocked */ }
  }

  const fmt = (d: string | Date | null) =>
    d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const statusOf = (s: PublicShare): 'active' | 'revoked' | 'expired' =>
    s.revokedAt ? 'revoked' : s.expiresAt && new Date(s.expiresAt).getTime() <= Date.now() ? 'expired' : 'active';

  onMount(() => { load(); });
  function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
</script>

<svelte:window onkeydown={onKey} />

<div class="sh-backdrop" role="presentation" onclick={onClose}>
  <div class="sh" role="dialog" aria-modal="true" aria-label="Share links for {title || projectKey}" onclick={(e) => e.stopPropagation()}>
    <header class="sh-head">
      <div class="sh-head-txt">
        <span class="sh-eyebrow">Secure share</span>
        <h2 class="sh-title">{title || projectKey}</h2>
      </div>
      <button class="sh-x" onclick={onClose} aria-label="Close">✕</button>
    </header>
    <p class="sh-blurb">Anyone with a link below can open this page — <b>even while it's private</b>, no sign-in needed. Each link is unguessable; revoke any one instantly.</p>

    <div class="sh-create">
      <input class="sh-in" placeholder="Label (optional) — e.g. for Sam at DfE" bind:value={label} maxlength="80" />
      <select class="sh-sel" bind:value={expiresInDays}>
        <option value={0}>No expiry</option>
        <option value={7}>7 days</option>
        <option value={30}>30 days</option>
        <option value={90}>90 days</option>
      </select>
      <button class="sh-create-btn" onclick={create} disabled={creating}>{creating ? '…' : '+ Create link'}</button>
    </div>

    {#if freshUrl}
      <div class="sh-fresh">
        <span class="sh-fresh-lab">New link {copied ? '· copied ✓' : ''}</span>
        <div class="sh-urlrow">
          <input class="sh-url" readonly value={freshUrl} onclick={(e) => e.currentTarget.select()} />
          <button class="sh-copy" onclick={() => copy(freshUrl ?? '')}>{copied ? '✓ Copied' : 'Copy'}</button>
        </div>
        <span class="sh-once">Copy it now — the link itself is shown only once.</span>
      </div>
    {/if}

    {#if err}<p class="sh-err">{err}</p>{/if}

    <div class="sh-list">
      <span class="sh-list-lab">Links</span>
      {#if loading}
        <p class="sh-muted">Loading…</p>
      {:else if shares.length === 0}
        <p class="sh-muted">No links yet.</p>
      {:else}
        {#each shares as s (s.id)}
          {@const st = statusOf(s)}
          <div class="sh-row" class:dead={st !== 'active'}>
            <div class="sh-row-top">
              <span class="sh-row-label">{s.label || 'Untitled link'}</span>
              <span class="sh-badge sh-{st}">{st}</span>
            </div>
            <div class="sh-row-meta">
              created {fmt(s.createdAt)} · {s.expiresAt ? `expires ${fmt(s.expiresAt)}` : 'no expiry'} · opened {s.useCount}×{s.lastUsedAt ? ` (last ${fmt(s.lastUsedAt)})` : ''}
            </div>
            {#if st === 'active'}
              <button class="sh-revoke" onclick={() => revoke(s.id)}>Revoke</button>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  </div>
</div>

<style>
  .sh-backdrop { position: fixed; inset: 0; z-index: 200; display: flex; align-items: flex-start; justify-content: center;
    padding: 8vh 16px 16px; background: rgba(20, 16, 12, 0.55); backdrop-filter: blur(3px); }
  .sh { width: min(560px, 100%); max-height: 84vh; overflow-y: auto; background: var(--surface-elevated, #fff);
    border: 1px solid var(--card-border); border-radius: 14px; box-shadow: 0 24px 60px -24px rgba(0, 0, 0, 0.5); padding: 18px 20px 20px; }
  .sh-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .sh-eyebrow { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--accent); }
  .sh-title { margin: 2px 0 0; font-size: 19px; font-weight: 600; color: var(--text-primary); line-height: 1.2; word-break: break-word; }
  .sh-x { flex-shrink: 0; background: none; border: 1px solid var(--card-border); border-radius: 7px; width: 28px; height: 28px; cursor: pointer; color: var(--text-secondary); font-size: 13px; }
  .sh-x:hover { color: var(--text-primary); }
  .sh-blurb { margin: 10px 0 14px; font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); }
  .sh-blurb b { color: var(--text-primary); }

  .sh-create { display: flex; flex-wrap: wrap; gap: 7px; }
  .sh-in { flex: 1 1 200px; min-width: 0; background: var(--bg); border: 1px solid var(--card-border); border-radius: 8px; padding: 7px 10px; font-size: 12.5px; color: var(--text-primary); }
  .sh-sel { background: var(--bg); border: 1px solid var(--card-border); border-radius: 8px; padding: 7px 8px; font-size: 12px; color: var(--text-primary); cursor: pointer; font-family: var(--font-mono); }
  .sh-create-btn { background: var(--accent); color: #fff; border: none; border-radius: 8px; padding: 7px 14px; font-size: 12.5px; font-weight: 600; cursor: pointer; }
  .sh-create-btn:disabled { opacity: 0.5; cursor: default; }

  .sh-fresh { margin-top: 12px; padding: 11px 13px; border-radius: 10px; background: color-mix(in srgb, var(--accent) 8%, transparent); border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent); }
  .sh-fresh-lab { font-family: var(--font-mono); font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent); }
  .sh-urlrow { display: flex; gap: 6px; margin: 6px 0 5px; }
  .sh-url { flex: 1; min-width: 0; background: var(--bg); border: 1px solid var(--card-border); border-radius: 7px; padding: 7px 9px; font-family: var(--font-mono); font-size: 11px; color: var(--text-primary); }
  .sh-copy { flex-shrink: 0; background: var(--accent); color: #fff; border: none; border-radius: 7px; padding: 0 12px; font-size: 11.5px; font-weight: 600; cursor: pointer; }
  .sh-once { font-size: 10.5px; color: var(--text-secondary); }

  .sh-err { margin: 10px 0 0; font-size: 12px; color: #b43232; }

  .sh-list { margin-top: 16px; }
  .sh-list-lab { font-family: var(--font-mono); font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-secondary); }
  .sh-muted { margin: 8px 0 0; font-size: 12px; color: var(--text-secondary); }
  .sh-row { position: relative; margin-top: 8px; padding: 9px 11px; border: 1px solid var(--card-border); border-radius: 9px; background: var(--bg); }
  .sh-row.dead { opacity: 0.6; }
  .sh-row-top { display: flex; align-items: center; gap: 8px; }
  .sh-row-label { font-size: 13px; font-weight: 600; color: var(--text-primary); }
  .sh-badge { font-family: var(--font-mono); font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.06em; padding: 1px 6px; border-radius: 4px; }
  .sh-active { background: rgba(47, 125, 79, 0.14); color: #2f7d4f; }
  .sh-revoked { background: rgba(28, 22, 17, 0.1); color: var(--text-secondary); }
  .sh-expired { background: rgba(176, 99, 46, 0.14); color: #b4632e; }
  .sh-row-meta { margin-top: 3px; font-family: var(--font-mono); font-size: 10px; color: var(--text-secondary); padding-right: 64px; }
  .sh-revoke { position: absolute; top: 9px; right: 10px; background: none; border: 1px solid rgba(180, 50, 50, 0.4); color: #b43232; border-radius: 6px; padding: 3px 9px; font-size: 10.5px; cursor: pointer; }
  .sh-revoke:hover { background: rgba(180, 50, 50, 0.08); }
</style>
