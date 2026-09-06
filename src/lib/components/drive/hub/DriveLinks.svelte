<script lang="ts">
  // D — LINKS OUT. Every share link ever minted, on the ink band.
  //
  // Health's tripwire-ledger shape, and for the same reason: these are the rows
  // that are worth being told about. A share is a capability URL that works
  // with no login, so the two things this table must never do are hide one and
  // lose one — dead rows stay listed rather than disappearing, because "there
  // is no link" and "the link expired last week" are different facts.
  //
  // The freshly minted URL is shown exactly once. The server stores only its
  // hash and genuinely cannot reproduce it, so a dismissed reveal is gone.
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import type { ShareRow } from './types';

  interface Props {
    shares: ShareRow[];
    loaded: boolean;
    ttlDays: number;
    busyId: string | null;
    minted: { url: string; name: string; expiresAt: string } | null;
    mintedCopied: boolean;
    onCopyMinted: () => void;
    onDismissMinted: () => void;
    onRevoke: (s: ShareRow) => void;
  }

  let {
    shares,
    loaded,
    ttlDays,
    busyId,
    minted,
    mintedCopied,
    onCopyMinted,
    onDismissMinted,
    onRevoke,
  }: Props = $props();

  const live = $derived(shares.filter((s) => s.active));

  function baseName(name: string): string {
    return name.split('/').pop() || name;
  }

  function expiry(iso: string): string {
    const ms = new Date(iso).getTime() - Date.now();
    if (ms <= 0) return 'expired';
    const days = Math.floor(ms / 86400000);
    if (days >= 1) return `${days}d left`;
    return `${Math.max(1, Math.floor(ms / 3600000))}h left`;
  }

  function state(s: ShareRow): { label: string; tone: 'live' | 'revoked' | 'expired' } {
    if (s.revokedAt) return { label: 'REVOKED', tone: 'revoked' };
    if (!s.active) return { label: 'EXPIRED', tone: 'expired' };
    return { label: 'LIVE', tone: 'live' };
  }

  const strap = $derived(
    live.length === 0
      ? `Nothing is shared out. A link lasts ${ttlDays} days and can be revoked at any point before that.`
      : `${live.length} link${live.length === 1 ? '' : 's'} will download without a login. They last ${ttlDays} days; revoking one stops it immediately.`,
  );
</script>

{#if minted || shares.length > 0 || loaded}
  <section class="d">
    <div class="d-inner">
      <SectionHead
        dark
        kicker="D / Links out · {live.length} live"
        title={['What can be', 'read without you']}
        {strap}
      />

      {#if minted}
        <div class="d-mint">
          <div class="d-mint-head">
            <p class="d-mint-title">Link ready — {minted.name}</p>
            <p class="d-mint-meta">
              shown once · {expiry(minted.expiresAt)}{mintedCopied ? ' · copied to clipboard' : ''}
            </p>
          </div>
          <input class="d-mint-url" readonly value={minted.url} onfocus={(e) => e.currentTarget.select()} />
          <div class="d-mint-acts">
            <button type="button" class="d-mint-copy" onclick={onCopyMinted}>
              {mintedCopied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" class="d-link" onclick={onDismissMinted}>Done</button>
          </div>
        </div>
      {/if}

      {#if shares.length > 0}
        <div class="d-scroll">
          <table class="d-table">
            <thead>
              <tr>
                <th>State</th><th>File</th><th>Minted by</th><th>Uses</th><th>Expires</th><th></th>
              </tr>
            </thead>
            <tbody>
              {#each shares as s (s.id)}
                {@const st = state(s)}
                <tr class:dead={!s.active}>
                  <td><span class="d-badge tone-{st.tone}">{st.label}</span></td>
                  <td class="d-file">
                    {baseName(s.fileName)}
                    {#if s.label}<br /><span class="d-sub">{s.label}</span>{/if}
                  </td>
                  <td class="d-mono">{s.createdBy}</td>
                  <td class="d-mono d-uses">
                    {s.useCount}
                    {#if s.lastUsedAt}<br /><span class="d-sub">last {new Date(s.lastUsedAt).toLocaleDateString('en-GB')}</span>{/if}
                  </td>
                  <td class="d-mono">{s.revokedAt ? '—' : expiry(s.expiresAt)}</td>
                  <td class="d-act">
                    {#if s.active}
                      <button type="button" class="d-link danger" disabled={busyId === s.id} onclick={() => onRevoke(s)}>
                        {busyId === s.id ? 'Revoking' : 'Revoke'}
                      </button>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <p class="d-empty">
          No links have been minted. Use Share on any file to make one.
        </p>
      {/if}
    </div>
  </section>
{/if}

<style>
  .d {
    background: var(--text-primary);
    color: var(--bg);
    padding: clamp(38px, 4.4vw, 66px) clamp(20px, 3vw, 44px);
  }
  .d-inner { max-width: 1400px; margin: 0 auto; }

  /* ——— the one-time reveal ——— */
  .d-mint { border: 1px solid var(--accent-on-dark); padding: 16px 18px; margin-bottom: 26px; }
  .d-mint-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 14px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }
  .d-mint-title, .d-mint-meta, .d-mint-url {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    margin: 0;
  }
  .d-mint-title {
    font-size: var(--fs-label);
    letter-spacing: 0.06em;
    color: var(--accent-on-dark);
  }
  .d-mint-meta {
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.55);
  }
  .d-mint-url {
    width: 100%;
    background: rgba(237, 228, 212, 0.08);
    border: 1px solid rgba(237, 228, 212, 0.2);
    color: var(--bg);
    padding: 9px 11px;
  }
  .d-mint-acts {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-top: 12px;
  }
  .d-mint-copy {
    background: var(--accent-on-dark);
    border: none;
    padding: 6px 15px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.13em;
    text-transform: uppercase;
    color: var(--text-primary);
    cursor: pointer;
  }

  /* ——— the ledger ——— */
  .d-scroll { overflow-x: auto; }
  .d-table {
    border-collapse: collapse;
    width: 100%;
    min-width: 720px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
  }
  .d-table th {
    text-align: left;
    padding: 0 14px 12px 0;
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.55);
    border-bottom: 1px solid rgba(237, 228, 212, 0.3);
  }
  .d-table th:last-child, .d-table td:last-child { padding-right: 0; text-align: right; }
  .d-table td {
    padding: 14px 14px 14px 0;
    vertical-align: top;
    border-bottom: 1px solid rgba(237, 228, 212, 0.12);
  }
  .d-table tbody tr:last-child td { border-bottom: none; }
  .d-table tbody tr.dead,
  .d-table tbody tr.dead .d-file { color: rgba(237, 228, 212, 0.45); }

  .d-badge {
    display: inline-block;
    font-weight: 700;
    letter-spacing: 0.12em;
    white-space: nowrap;
  }
  .d-badge.tone-live {
    background: var(--accent-on-dark);
    color: var(--text-primary);
    padding: 3px 8px;
  }
  .d-badge.tone-revoked {
    border: 1px solid rgba(237, 228, 212, 0.3);
    color: rgba(237, 228, 212, 0.55);
    padding: 3px 8px;
  }
  .d-badge.tone-expired { color: rgba(237, 228, 212, 0.45); font-weight: 400; }

  /* The file name is the one thing here in body font — it is a name, not a
     reading, and the mono columns beside it are what make it findable. */
  .d-file {
    font-family: var(--font-body);
    font-size: var(--fs-label);
    color: var(--bg);
    min-width: 22ch;
  }
  .d-sub {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: rgba(237, 228, 212, 0.5);
  }
  .d-mono { color: rgba(237, 228, 212, 0.75); white-space: nowrap; }
  .d-uses { font-weight: 700; }

  /* The global .nm-act is paper-accent and invisible here, so this band keeps
     its own lifted pair — the relighting rule from the health system. */
  .d-link {
    background: none;
    border: none;
    padding: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.7);
    cursor: pointer;
  }
  .d-link:hover:not(:disabled) { color: var(--bg); }
  .d-link:disabled { opacity: 0.45; cursor: default; }
  .d-link.danger { color: #e08b8b; }

  .d-empty {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: rgba(237, 228, 212, 0.5);
    border: 1px dashed rgba(237, 228, 212, 0.22);
    padding: 30px 20px;
    text-align: center;
    margin: 0;
  }
</style>
