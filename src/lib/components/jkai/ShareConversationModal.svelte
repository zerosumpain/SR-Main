<script lang="ts">
  import { onMount } from 'svelte';

  type Visibility = 'private' | 'users' | 'public';

  let {
    conversation,
    onClose,
    onUpdate,
  }: {
    conversation: { id: string; title: string | null; shareToken?: string | null; shareVisibility?: string | null };
    onClose: () => void;
    onUpdate?: (id: string, visibility: Visibility, shareToken: string | null) => void;
  } = $props();

  let visibility = $state<Visibility>((conversation.shareVisibility as Visibility) ?? 'private');
  let shareToken = $state<string | null>(conversation.shareToken ?? null);
  let saving = $state(false);
  let copied = $state(false);
  let origin = $state('');

  onMount(() => {
    origin = location.origin;
  });

  const shareUrl = $derived(shareToken && origin ? `${origin}/jkai/shared/${shareToken}` : '');

  const OPTIONS: Array<{ v: Visibility; label: string; desc: string }> = [
    { v: 'private', label: 'Private', desc: 'Only you can see this conversation.' },
    { v: 'users', label: 'Signed-in users', desc: 'Anyone signed in to the site, with the link, can view (read-only).' },
    { v: 'public', label: 'Anyone with the link', desc: 'Public read-only view — no sign-in needed.' },
  ];

  async function setVisibility(v: Visibility) {
    if (v === visibility || saving) return;
    saving = true;
    try {
      const res = await fetch(`/api/jkai/conversations/${conversation.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shareVisibility: v }),
      });
      if (res.ok) {
        const row = await res.json();
        visibility = row.shareVisibility as Visibility;
        shareToken = row.shareToken ?? null;
        onUpdate?.(conversation.id, visibility, shareToken);
      }
    } catch (err) {
      console.error('Failed to update share visibility:', err);
    } finally {
      saving = false;
    }
  }

  async function copyLink() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch { /* clipboard may be blocked; ignore */ }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  // Local portal — appends to <body> and removes on destroy. Do NOT use the
  // shared $lib/canvas/portal action here (its destroy re-appends the node).
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="ovl" use:portal onclick={onClose} role="presentation">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="panel" onclick={(e) => e.stopPropagation()}>
    <div class="p-hd">
      <span class="sr-label-tight">Share conversation</span>
      <button class="x" onclick={onClose} aria-label="Close">
        <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 5l10 10M15 5L5 15"/></svg>
      </button>
    </div>

    <p class="conv-name">{conversation.title || 'Untitled conversation'}</p>

    <div class="opts" class:busy={saving}>
      {#each OPTIONS as o (o.v)}
        <button class="opt" class:sel={visibility === o.v} onclick={() => setVisibility(o.v)} disabled={saving}>
          <span class="radio" class:on={visibility === o.v} aria-hidden="true"></span>
          <span class="opt-body">
            <span class="opt-label">{o.label}</span>
            <span class="opt-desc">{o.desc}</span>
          </span>
        </button>
      {/each}
    </div>

    {#if visibility !== 'private' && shareUrl}
      <div class="link-row">
        <input class="link-in" readonly value={shareUrl} onclick={(e) => (e.currentTarget as HTMLInputElement).select()} aria-label="Share link" />
        <button class="copy" onclick={copyLink}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <p class="hint">
        {visibility === 'public'
          ? 'Anyone with this link can read the conversation.'
          : 'Recipients must be signed in to the site to view.'}
      </p>
    {/if}
  </div>
</div>

<style>
  .ovl {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.42);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    padding: 20px;
  }
  .panel {
    width: 100%;
    max-width: 420px;
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-round);
    padding: 16px 18px 18px;
  }
  .p-hd {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }
  .x {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    background: none;
    color: var(--text-ghost);
    cursor: pointer;
    border-radius: var(--radius-round);
  }
  .x:hover { color: var(--text-primary); background: var(--card-bg); }
  .conv-name {
    font-size: var(--fs-nav);
    font-weight: 500;
    color: var(--text-secondary);
    margin: 0 0 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .opts { display: flex; flex-direction: column; gap: 6px; }
  .opts.busy { opacity: 0.7; pointer-events: none; }
  .opt {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    text-align: left;
    padding: 10px 11px;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-round);
    background: none;
    cursor: pointer;
    transition: border-color 0.12s, background 0.12s;
  }
  .opt:hover { background: var(--bg-section); }
  .opt.sel { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 7%, transparent); }
  .radio {
    width: 15px;
    height: 15px;
    border-radius: 100px;
    border: 1.5px solid var(--card-border);
    margin-top: 1px;
    flex-shrink: 0;
    transition: border-color 0.12s;
  }
  .radio.on {
    border-color: var(--accent);
    background:
      radial-gradient(circle at center, var(--accent) 0 4px, transparent 5px);
  }
  .opt-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .opt-label { font-size: var(--fs-nav); font-weight: 600; color: var(--text-primary); }
  .opt-desc { font-size: var(--fs-label); color: var(--text-ghost); line-height: 1.35; }

  .link-row { display: flex; gap: 6px; margin-top: 14px; }
  .link-in {
    flex: 1;
    min-width: 0;
    padding: 7px 9px;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-round);
    background: var(--bg);
    font-family: var(--font-mono);
    font-size: var(--fs-body);
    color: var(--text-secondary);
  }
  .link-in:focus { outline: none; border-color: var(--accent); }
  .copy {
    padding: 7px 14px;
    border: 1px solid var(--accent);
    border-radius: var(--radius-round);
    background: var(--accent);
    color: #fff;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.12s;
  }
  .copy:hover { background: var(--accent-hover); }
  .hint { font-size: var(--fs-label); color: var(--text-ghost); margin: 8px 0 0; line-height: 1.4; }
</style>
