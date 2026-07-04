<svelte:head><title>Access — Admin</title></svelte:head>
<script lang="ts">
  import { getContext } from 'svelte';
  import type { PageData } from './$types';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';

  type Guest = {
    email: string;
    note: string | null;
    addedBy: string | null;
    createdAt: string | Date;
  };

  let { data }: { data: PageData } = $props();
  const adminToken = getContext<string>('adminToken');

  let owners = $state<string[]>(data.owners);
  let guests = $state<Guest[]>(data.guests as Guest[]);

  let newEmail = $state('');
  let newNote = $state('');
  let adding = $state(false);
  let errorMsg = $state('');
  let busyEmail = $state<string | null>(null);

  function apiUrl(): string {
    return adminToken ? `/api/admin/access?token=${adminToken}` : '/api/admin/access';
  }

  async function addGuest() {
    const email = newEmail.trim().toLowerCase();
    errorMsg = '';
    if (!email) {
      errorMsg = 'Enter an email address';
      return;
    }
    adding = true;
    try {
      const res = await fetch(apiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, note: newNote.trim() || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        guests = body.guests ?? guests;
        newEmail = '';
        newNote = '';
      } else {
        errorMsg = body.error ?? 'Could not add that address';
      }
    } catch {
      errorMsg = 'Network error';
    } finally {
      adding = false;
    }
  }

  async function removeGuest(email: string) {
    if (!confirm(`Revoke sign-in access for ${email}?`)) return;
    busyEmail = email;
    errorMsg = '';
    try {
      const res = await fetch(apiUrl(), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        guests = body.guests ?? guests.filter((g) => g.email !== email);
      } else {
        errorMsg = body.error ?? 'Could not remove that address';
      }
    } catch {
      errorMsg = 'Network error';
    } finally {
      busyEmail = null;
    }
  }

  function formatDate(d: string | Date) {
    return new Date(d).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }
</script>

<PageWrap>
  <PageHeader
    kicker="Access"
    title="Login allow-list"
    sub="Grant a Google account permission to sign in. Guests can use the signed-in site but are not owners — the admin console and owner-only tools stay yours."
  />

  <!-- Owners (read-only) -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Owners</span>
      <span class="nm-pill" data-state="connected">{owners.length} · env</span>
    </div>
    <p class="muted">
      Full-access accounts, set via the <code>AUTH_ALLOWED_EMAILS</code> environment variable.
      Edit them there, not here.
    </p>
    <ul class="access-list">
      {#each owners as owner}
        <li class="access-row">
          <span class="email">{owner}</span>
          <span class="owner-tag">Owner</span>
        </li>
      {:else}
        <li class="access-row muted">No owners configured.</li>
      {/each}
    </ul>
  </section>

  <!-- Add a guest -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Add a guest</span>
    </div>
    <p class="muted">They sign in with Google using this exact address.</p>
    <div class="nm-form-row">
      <label class="nm-field">
        <span class="sr-label-tight">Google email</span>
        <input
          class="nm-text-input"
          type="email"
          bind:value={newEmail}
          placeholder="name@gmail.com"
          onkeydown={(e) => e.key === 'Enter' && addGuest()}
        />
      </label>
      <label class="nm-field">
        <span class="sr-label-tight">Note (optional)</span>
        <input
          class="nm-text-input"
          type="text"
          bind:value={newNote}
          placeholder="e.g. partner, colleague"
          onkeydown={(e) => e.key === 'Enter' && addGuest()}
        />
      </label>
    </div>
    <div class="add-row">
      <button class="nm-save-btn" onclick={addGuest} disabled={adding}>
        {adding ? 'Adding…' : 'Add guest'}
      </button>
      {#if errorMsg}<span class="result-bad">{errorMsg}</span>{/if}
    </div>
  </section>

  <!-- Guest list -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Guests</span>
      <span class="nm-pill" data-state={guests.length ? 'connected' : 'disconnected'}>
        {guests.length} {guests.length === 1 ? 'account' : 'accounts'}
      </span>
    </div>
    <ul class="access-list">
      {#each guests as guest (guest.email)}
        <li class="access-row">
          <span class="email">{guest.email}</span>
          {#if guest.note}<span class="note">{guest.note}</span>{/if}
          <span class="added">added {formatDate(guest.createdAt)}</span>
          <button
            class="row-link danger"
            onclick={() => removeGuest(guest.email)}
            disabled={busyEmail === guest.email}
          >
            {busyEmail === guest.email ? 'Removing…' : 'Remove'}
          </button>
        </li>
      {:else}
        <li class="access-row muted">No guests yet — only owners can sign in.</li>
      {/each}
    </ul>
  </section>
</PageWrap>

<style>
  .muted { margin: 0 0 0.75rem; font-size: 0.85rem; color: var(--text-secondary); }
  .muted code {
    font-family: var(--font-mono);
    font-size: 0.85em;
    background: var(--code-bg);
    color: var(--code-text);
    padding: 0.08rem 0.38rem;
    border-radius: 2px;
  }
  .access-list {
    list-style: none;
    margin: 0.5rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .access-row {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    padding: 0.6rem 0;
    border-bottom: 1px solid var(--divider);
    font-size: 0.9rem;
  }
  .access-row:last-child { border-bottom: none; }
  .email { font-family: var(--font-mono); font-size: 0.82rem; color: var(--text-primary); }
  .note {
    font-size: 0.75rem;
    color: var(--text-muted);
    padding: 0.1rem 0.45rem;
    background: var(--bg-section);
    border-radius: 2px;
  }
  .added {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
    margin-left: auto;
  }
  .owner-tag {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    color: var(--accent);
    border: 1px solid var(--accent);
    padding: 0.1rem 0.4rem;
    border-radius: 2px;
  }
  .add-row { display: flex; align-items: center; gap: 0.8rem; margin-top: 0.4rem; }
  .result-bad { font-family: var(--font-mono); font-size: 11px; color: var(--error); }
  .row-link {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.15rem 0.3rem;
  }
  .row-link:hover { color: var(--text-primary); }
  .row-link.danger:hover { color: var(--error); }
  .row-link:disabled { opacity: 0.5; cursor: default; }
</style>
