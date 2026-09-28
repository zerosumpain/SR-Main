<svelte:head><title>People — Admin</title></svelte:head>
<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import type { PageData } from './$types';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';
  import AccessEditor from '$lib/components/admin/AccessEditor.svelte';
  import type { Permission } from '$lib/access/catalogue';
  import { summarise } from '$lib/access/roles';

  type RequestView = PageData['requests'][number];
  type InviteView = PageData['invites'][number];
  type RoleView = PageData['roles'][number];

  let { data }: { data: PageData } = $props();

  let errorMsg = $state('');
  let busy = $state<string | null>(null);

  /** Send a change, then reload the page's data. False on failure. */
  async function send(url: string, method: string, payload: unknown, key: string): Promise<Record<string, unknown> | null> {
    busy = key;
    errorMsg = '';
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        errorMsg = body.error ?? 'That did not work';
        return null;
      }
      await invalidateAll();
      return body;
    } catch {
      errorMsg = 'Network error';
      return null;
    } finally {
      busy = null;
    }
  }

  const roleById = $derived(new Map(data.roles.map((r) => [r.id, r])));
  const holdsCircle = (roleId: string | null) => !!roleId && (roleById.get(roleId)?.grants ?? []).includes('family:circle');
  /** Household people with no account yet: the ones an approval can link. */
  const unlinked = $derived(data.household.filter((m) => !m.email));

  // ── Waiting ──────────────────────────────────────────────────────────────
  const pending = $derived(data.requests.filter((r) => r.status === 'pending'));
  const decided = $derived(data.requests.filter((r) => r.status !== 'pending').slice(0, 5));

  /** Per request: the owner's changes to the role and household choice. */
  let picks = $state<Record<string, { role?: string | null; household?: string }>>({});
  /** The choice shown: a sensible default, overridden by anything picked. PURE — no writes during render. */
  function pickFor(r: RequestView): { role: string | null; household: string } {
    const match = unlinked.find((m) => m.displayName.toLowerCase() === r.name.trim().toLowerCase());
    const fallback = {
      role: r.wantsApp ? 'family-circle' : roleById.has('friend') ? 'friend' : null,
      household: match ? `link:${match.subject}` : r.wantsApp ? 'create' : 'none',
    };
    return { ...fallback, ...picks[r.id] };
  }
  function setPick(r: RequestView, patch: { role?: string | null; household?: string }) {
    picks[r.id] = { ...picks[r.id], ...patch };
  }

  async function decide(r: RequestView, decision: 'approve' | 'decline') {
    if (decision === 'decline' && !confirm(`Decline ${r.name}'s request?`)) return;
    const p = pickFor(r);
    const inHousehold = decision === 'approve' && holdsCircle(p.role);
    const household = !inHousehold
      ? undefined
      : p.household === 'create'
        ? { create: true }
        : p.household.startsWith('link:')
          ? { link: p.household.slice(5) }
          : undefined;
    await send(
      '/api/admin/access/requests',
      'PATCH',
      { id: r.id, decision, groups: p.role ? [p.role] : [], household },
      `request:${r.id}`,
    );
  }

  // ── Add someone ──────────────────────────────────────────────────────────
  let addMode = $state<'email' | 'invite'>('email');
  let addEmail = $state('');
  let addName = $state('');
  let addRole = $state<string | null>('friend');
  /** The link just minted: the only time its code exists in plaintext. */
  let minted = $state<{ link: string; qr: string } | null>(null);
  let copied = $state(false);

  async function addByEmail() {
    const email = addEmail.trim().toLowerCase();
    if (!email) {
      errorMsg = 'Enter their Google email';
      return;
    }
    const added = await send('/api/admin/access', 'POST', { email, note: addName.trim() || undefined }, 'add');
    if (!added) return;
    if (addRole) await send('/api/admin/access', 'PATCH', { email, groups: [addRole], grants: [] }, 'add');
    addEmail = '';
    addName = '';
  }

  async function mintInvite() {
    minted = null;
    copied = false;
    const body = await send(
      '/api/admin/access/invites',
      'POST',
      { email: addEmail.trim() || undefined, name: addName.trim() || undefined, groups: addRole ? [addRole] : [] },
      'invite:new',
    );
    if (body) {
      minted = { link: String(body.link), qr: String(body.qr) };
      addEmail = '';
      addName = '';
    }
  }

  async function copyLink() {
    if (!minted) return;
    try {
      await navigator.clipboard.writeText(minted.link);
      copied = true;
    } catch {
      copied = false;
    }
  }

  async function revokeInvite(inv: InviteView) {
    if (!confirm(`Revoke the invite${inv.name ? ` for ${inv.name}` : ''}? The link stops working at once.`)) return;
    await send('/api/admin/access/invites', 'DELETE', { id: inv.id }, `invite:${inv.id}`);
  }

  const INVITE_STATE: Record<string, string> = { ok: 'Open', used: 'Used', revoked: 'Revoked', expired: 'Expired' };
  const openInvites = $derived(data.invites.filter((i) => i.state === 'ok'));

  // ── Roles ────────────────────────────────────────────────────────────────
  let editingRole = $state<{ id: string | null; label: string; description: string; grants: Permission[] } | null>(null);

  function editRole(r: RoleView) {
    editingRole = { id: r.id, label: r.label, description: r.description ?? '', grants: [...r.grants] };
  }

  async function saveRole() {
    if (!editingRole) return;
    const { id, ...rest } = editingRole;
    const ok = id
      ? await send('/api/admin/access/groups', 'PATCH', { id, ...rest }, `role:${id}`)
      : await send('/api/admin/access/groups', 'POST', rest, 'role:new');
    if (ok) editingRole = null;
  }

  async function removeRole(r: RoleView, holders: number) {
    const who = holders === 1 ? '1 person loses it' : `${holders} people lose it`;
    if (!confirm(`Delete the role "${r.label}"? ${who}.`)) return;
    await send('/api/admin/access/groups', 'DELETE', { id: r.id }, `role:${r.id}`);
  }

  const holdersOf = (id: string) => data.people.filter((p) => p.roleId === id).length;

  const SOURCE: Record<string, string> = { life360: 'Life360', companion: 'the app', none: 'no location' };

  function formatDate(d: string | Date) {
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
</script>

<PageWrap>
  <PageHeader
    kicker="Access"
    title="People"
    sub="Everyone who can sign in, everyone in the household, and what each of them may do. Open a person to change their access, household details and phones."
  />

  {#if errorMsg}<p class="result-bad" role="alert">{errorMsg}</p>{/if}
  {#each data.deviceWarnings as w}<p class="muted warn">{w}</p>{/each}

  <section class="nm-sec" data-section="waiting" id="requests">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Waiting</span>
      <span class="nm-pill" data-state={pending.length ? 'connected' : 'disconnected'}>{pending.length}</span>
    </div>
    {#each pending as r (r.id)}
      {@const p = pickFor(r)}
      <div class="request">
        <div class="row-main">
          <span class="person-name">{r.name}</span>
          <span class="email">{r.email}</span>
          {#if r.wantsApp}<span class="tag">wants the app</span>{/if}
          <span class="added">asked {formatDate(r.createdAt)}</span>
        </div>
        {#if r.message}<p class="muted desc">“{r.message}”</p>{/if}
        <div class="choose">
          <span class="sr-label-tight">Role</span>
          <div class="chips-pick" role="radiogroup" aria-label="Role for {r.name}">
            <label class="pick" class:on={p.role === null}>
              <input type="radio" name="req-{r.id}-role" checked={p.role === null} onchange={() => setPick(r, { role: null })} />
              None
            </label>
            {#each data.roles as role (role.id)}
              <label class="pick" class:on={p.role === role.id} title={role.description ?? ''}>
                <input type="radio" name="req-{r.id}-role" checked={p.role === role.id} onchange={() => setPick(r, { role: role.id })} />
                {role.label}
              </label>
            {/each}
          </div>
        </div>
        {#if holdsCircle(p.role)}
          <label class="choose">
            <span class="sr-label-tight">In the household as</span>
            <select class="nm-text-input" value={p.household} onchange={(e) => setPick(r, { household: e.currentTarget.value })}>
              {#each unlinked as m (m.subject)}<option value="link:{m.subject}">{m.displayName} (already on the map)</option>{/each}
              <option value="create">A new household person, {r.name}</option>
              <option value="none">Not in the household</option>
            </select>
          </label>
        {/if}
        <div class="add-row">
          <button class="nm-save-btn" onclick={() => decide(r, 'approve')} disabled={busy === `request:${r.id}`}>Approve</button>
          <button class="row-link danger" onclick={() => decide(r, 'decline')} disabled={busy === `request:${r.id}`}>Decline</button>
        </div>
      </div>
    {:else}
      <p class="muted">Nobody is waiting. Requests come from <a href="/welcome">/welcome</a>.</p>
    {/each}
    {#if decided.length}
      <ul class="decided">
        {#each decided as r (r.id)}
          <li><span>{r.name}</span> <span class="email">{r.email}</span> <span class="tag">{r.status}</span></li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="nm-sec" data-section="people">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">People</span>
      <span class="nm-pill" data-state="connected">{data.people.length}</span>
    </div>
    <ul class="people">
      {#each data.people as person (person.key)}
        <li>
          <a class="person" href="/admin/access/{encodeURIComponent(person.key)}">
            <span class="person-name">{person.name}</span>
            <span class="badge" data-kind={person.kind}>
              {person.kind === 'owner' ? 'Super admin' : person.kind === 'household' ? 'Household only' : (person.roleLabel ?? 'No role')}
            </span>
            <span class="email">{person.email ?? 'no account'}</span>
            <span class="facts">
              {#if person.kind === 'account'}
                {person.summary.length ? person.summary.join(', ') : 'public pages only'}
              {/if}
              {#if person.household}
                <span class="fact">location from {SOURCE[person.household.source] ?? person.household.source}</span>
              {/if}
              {#if person.devices.length}
                <span class="fact">{person.devices.length} phone {person.devices.length === 1 ? 'pairing' : 'pairings'}</span>
              {/if}
            </span>
          </a>
        </li>
      {/each}
    </ul>
  </section>

  <section class="nm-sec" data-section="add">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Add someone</span>
    </div>
    <div class="chips-pick" role="radiogroup" aria-label="How to add them">
      <label class="pick" class:on={addMode === 'email'}>
        <input type="radio" name="add-mode" checked={addMode === 'email'} onchange={() => (addMode = 'email')} />
        I know their Google email
      </label>
      <label class="pick" class:on={addMode === 'invite'}>
        <input type="radio" name="add-mode" checked={addMode === 'invite'} onchange={() => (addMode = 'invite')} />
        Send them a link
      </label>
    </div>
    <p class="muted">
      {addMode === 'email'
        ? 'They sign in with Google using exactly this address.'
        : 'A one-time link to /welcome, good for 14 days. Leave the email blank and whoever you send it to can use it.'}
    </p>
    <div class="nm-form-row">
      <label class="nm-field">
        <span class="sr-label-tight">Name</span>
        <input class="nm-text-input" type="text" bind:value={addName} placeholder="e.g. Jane" />
      </label>
      <label class="nm-field">
        <span class="sr-label-tight">Google email{addMode === 'invite' ? ' (optional)' : ''}</span>
        <input class="nm-text-input" type="email" bind:value={addEmail} placeholder="name@gmail.com" />
      </label>
      <label class="nm-field">
        <span class="sr-label-tight">Role</span>
        <select class="nm-text-input" bind:value={addRole}>
          <option value={null}>No role</option>
          {#each data.roles as role (role.id)}<option value={role.id}>{role.label}</option>{/each}
        </select>
      </label>
    </div>
    <div class="add-row">
      {#if addMode === 'email'}
        <button class="nm-save-btn" onclick={addByEmail} disabled={busy === 'add'}>{busy === 'add' ? 'Adding…' : 'Add person'}</button>
      {:else}
        <button class="nm-save-btn" onclick={mintInvite} disabled={busy === 'invite:new'}>
          {busy === 'invite:new' ? 'Making…' : 'Create invite link'}
        </button>
      {/if}
    </div>
    {#if minted}
      <div class="minted" data-state="minted">
        <img src={minted.qr} alt="Invite link QR code" width="180" height="180" />
        <div class="minted-meta">
          <span class="sr-label-tight">Send this link. It is shown once.</span>
          <code class="link">{minted.link}</code>
          <div class="add-row">
            <button class="nm-btn-ghost" onclick={copyLink}>{copied ? 'Copied' : 'Copy link'}</button>
            <button class="nm-btn-ghost" onclick={() => (minted = null)}>Done</button>
          </div>
        </div>
      </div>
    {/if}
  </section>

  <details class="nm-sec fold" data-section="invites">
    <summary class="nm-sec-hd">
      <span class="sr-label-tight">Invite links</span>
      <span class="nm-pill" data-state={openInvites.length ? 'connected' : 'disconnected'}>{openInvites.length} open</span>
    </summary>
    <ul class="plain">
      {#each data.invites as inv (inv.id)}
        <li class="line">
          <span class="person-name">{inv.name ?? 'Anyone with the link'}</span>
          {#if inv.email}<span class="email">{inv.email}</span>{/if}
          {#each inv.groups as g}<span class="tag">{roleById.get(g)?.label ?? g}</span>{/each}
          <span class="tag">{INVITE_STATE[inv.state] ?? inv.state}{inv.usedByEmail ? ` · ${inv.usedByEmail}` : ''}</span>
          <span class="added">{inv.state === 'ok' ? `until ${formatDate(inv.expiresAt)}` : formatDate(inv.createdAt)}</span>
          {#if inv.state === 'ok'}
            <button class="row-link danger" onclick={() => revokeInvite(inv)} disabled={busy === `invite:${inv.id}`}>Revoke</button>
          {/if}
        </li>
      {:else}
        <li class="muted">No invites yet.</li>
      {/each}
    </ul>
  </details>

  <details class="nm-sec fold" data-section="roles">
    <summary class="nm-sec-hd">
      <span class="sr-label-tight">Roles</span>
      <span class="nm-pill" data-state="connected">{data.roles.length}</span>
    </summary>
    <p class="muted">
      Each person has one role. What a role gives is edited here and changes for everyone in it; anything extra for one
      person is added on their page.
    </p>
    <ul class="plain">
      {#each data.roles as r (r.id)}
        <li class="role-line">
          <div class="row-main">
            <span class="person-name">{r.label}</span>
            {#if r.builtIn}<span class="tag">built-in</span>{/if}
            <span class="added">{holdersOf(r.id)} {holdersOf(r.id) === 1 ? 'person' : 'people'}</span>
            <button class="row-link" onclick={() => editRole(r)} disabled={busy === `role:${r.id}`}>Edit</button>
            {#if !r.builtIn}
              <button class="row-link danger" onclick={() => removeRole(r, holdersOf(r.id))} disabled={busy === `role:${r.id}`}>Delete</button>
            {/if}
          </div>
          <p class="muted desc">{r.description ?? ''} <span class="gives">Gives: {summarise(r.grants).join(', ') || 'nothing'}{r.grants.includes('family:admin') ? ', kids’ history' : r.grants.includes('family:circle') ? ', live locations' : ''}</span></p>
          {#if editingRole?.id === r.id}{@render roleEditor()}{/if}
        </li>
      {/each}
      {#if editingRole && editingRole.id === null}
        <li class="role-line">{@render roleEditor()}</li>
      {/if}
    </ul>
    {#if !editingRole}
      <button class="row-link" onclick={() => (editingRole = { id: null, label: '', description: '', grants: [] })}>New role</button>
    {/if}
  </details>
</PageWrap>

{#snippet roleEditor()}
  {#if editingRole}
    <div class="editor">
      <div class="nm-form-row">
        <label class="nm-field">
          <span class="sr-label-tight">Name</span>
          <input class="nm-text-input" type="text" bind:value={editingRole.label} placeholder="e.g. Research readers" />
        </label>
        <label class="nm-field">
          <span class="sr-label-tight">Description</span>
          <input class="nm-text-input" type="text" bind:value={editingRole.description} />
        </label>
      </div>
      <AccessEditor name="role-{editingRole.id ?? 'new'}" showRoles={false} bind:grants={editingRole.grants} />
      <div class="add-row">
        <button class="nm-save-btn" onclick={saveRole} disabled={busy?.startsWith('role:')}>
          {editingRole.id ? 'Save role' : 'Create role'}
        </button>
        <button class="nm-btn-ghost" onclick={() => (editingRole = null)}>Cancel</button>
      </div>
    </div>
  {/if}
{/snippet}

<style>
  .muted { margin: 0 0 0.75rem; font-size: 0.85rem; color: var(--text-secondary); }
  .muted.desc { margin: 0.25rem 0 0; }
  .muted.warn { color: var(--warn); }
  .muted a { color: var(--accent-ink); }
  .result-bad { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--error); margin: 0 0 0.75rem; }
  .row-main { display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem 0.85rem; }
  .person-name { font-weight: 600; color: var(--text-primary); }
  .email { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-secondary); overflow-wrap: anywhere; }
  .tag {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
    border: 1px solid var(--divider);
    padding: 0.05rem 0.4rem;
    border-radius: 2px;
  }
  .added {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
    margin-left: auto;
  }
  .request {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.8rem 0;
    border-bottom: 1px solid var(--divider);
  }
  .choose { display: flex; flex-direction: column; gap: 0.3rem; max-width: 28rem; }
  .chips-pick { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-bottom: 0.5rem; }
  .pick {
    position: relative;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    padding: 0.25rem 0.6rem;
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .pick input { position: absolute; opacity: 0; pointer-events: none; }
  .pick.on { background: var(--accent-ink); border-color: var(--accent-ink); color: var(--bg); }
  .pick:focus-within { outline: 2px solid var(--accent-ink); outline-offset: 1px; }
  .decided { list-style: none; margin: 0.6rem 0 0; padding: 0; color: var(--text-ghost); font-size: var(--fs-label); }
  .decided li { display: flex; gap: 0.6rem; align-items: center; padding: 0.2rem 0; }
  .people { list-style: none; margin: 0.25rem 0 0; padding: 0; }
  .person {
    display: grid;
    grid-template-columns: minmax(8rem, 12rem) auto minmax(0, 1fr);
    grid-template-areas: 'name badge email' 'facts facts facts';
    align-items: center;
    gap: 0.25rem 0.85rem;
    padding: 0.65rem 0.25rem;
    border-bottom: 1px solid var(--divider);
    color: inherit;
    text-decoration: none;
  }
  .person:hover { background: var(--card-bg); }
  .person:hover .person-name { color: var(--accent-ink); }
  .person .person-name { grid-area: name; }
  .person .email { grid-area: email; }
  .person .facts { grid-area: facts; font-size: var(--fs-label-xs); color: var(--text-muted); display: flex; flex-wrap: wrap; gap: 0.2rem 0.8rem; }
  .fact::before { content: '· '; color: var(--text-ghost); }
  .badge {
    grid-area: badge;
    justify-self: start;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 0.05rem 0.4rem;
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    color: var(--text-primary);
  }
  .badge[data-kind='owner'] { color: var(--accent); border-color: var(--accent); }
  .badge[data-kind='household'] { color: var(--text-muted); border-color: var(--divider); }
  .add-row { display: flex; align-items: center; gap: 0.8rem; margin-top: 0.4rem; }
  .row-link {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
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
  .fold > summary { cursor: pointer; list-style: none; }
  .fold > summary::-webkit-details-marker { display: none; }
  .fold > summary::after { content: '+'; margin-left: auto; font-family: var(--font-mono); color: var(--text-muted); }
  .fold[open] > summary::after { content: '−'; }
  .plain { list-style: none; margin: 0.5rem 0; padding: 0; }
  .line { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.8rem; padding: 0.5rem 0; border-bottom: 1px solid var(--divider); }
  .role-line { padding: 0.6rem 0; border-bottom: 1px solid var(--divider); }
  .gives { color: var(--text-muted); }
  .editor {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    margin-top: 0.6rem;
    padding: 0.8rem;
    border: 1px solid var(--line-strong);
    background: var(--bg);
  }
  .minted {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: flex-start;
    margin: 0.75rem 0;
    padding: 0.8rem;
    border: 1px solid var(--accent);
    background: var(--bg);
  }
  .minted img { image-rendering: pixelated; border: 1px solid var(--line-strong); }
  .minted-meta { display: flex; flex-direction: column; gap: 0.45rem; min-width: 0; flex: 1; }
  .link {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    background: var(--code-bg);
    color: var(--code-text);
    padding: 0.35rem 0.5rem;
    border-radius: 2px;
    overflow-wrap: anywhere;
    user-select: all;
  }
  @media (max-width: 640px) {
    .person {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas: 'name badge' 'email email' 'facts facts';
    }
  }
</style>
