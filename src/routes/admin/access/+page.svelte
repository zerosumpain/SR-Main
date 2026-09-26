<svelte:head><title>Access — Admin</title></svelte:head>
<script lang="ts">
  import type { PageData } from './$types';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';
  import GrantEditor from '$lib/components/admin/GrantEditor.svelte';
  import { AREAS, FAMILY, type Permission } from '$lib/access/catalogue';

  type AccessPerson = PageData['people'][number];
  type AccessGroupView = PageData['groups'][number];

  let { data }: { data: PageData } = $props();

  // One fresh copy of the page's data from every response that changes it.
  let superAdmins = $state<string[]>(data.superAdmins);
  let people = $state<AccessPerson[]>(data.people);
  let groups = $state<AccessGroupView[]>(data.groups);

  let newEmail = $state('');
  let newNote = $state('');
  let adding = $state(false);
  let errorMsg = $state('');
  let busy = $state<string | null>(null);

  /** The person being edited, with a working copy of their access. */
  let editing = $state<{ email: string; groups: string[]; grants: Permission[] } | null>(null);
  /** The group being edited (`id` null = a new one). */
  let editingGroup = $state<{ id: string | null; label: string; description: string; grants: Permission[] } | null>(null);

  const LABELS: Record<string, string> = Object.fromEntries([
    ...AREAS.flatMap((a) => (['self', 'all', 'admin'] as const).map((l) => [`${a.id}:${l}`, `${a.label} · ${l}`])),
    ...FAMILY.map((f) => [f.id, f.label]),
  ]);
  const groupLabel = (id: string) => groups.find((g) => g.id === id)?.label ?? id;

  function adopt(body: { superAdmins?: string[]; people?: AccessPerson[]; groups?: AccessGroupView[] }) {
    if (body.superAdmins) superAdmins = body.superAdmins;
    if (body.people) people = body.people;
    if (body.groups) groups = body.groups;
  }

  async function call(url: string, method: string, payload: unknown, key: string): Promise<boolean> {
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
        return false;
      }
      adopt(body);
      return true;
    } catch {
      errorMsg = 'Network error';
      return false;
    } finally {
      busy = null;
    }
  }

  async function addPerson() {
    const email = newEmail.trim().toLowerCase();
    errorMsg = '';
    if (!email) {
      errorMsg = 'Enter an email address';
      return;
    }
    adding = true;
    const ok = await call('/api/admin/access', 'POST', { email, note: newNote.trim() || undefined }, 'add');
    adding = false;
    if (ok) {
      newEmail = '';
      newNote = '';
    }
  }

  async function removePerson(email: string) {
    if (!confirm(`Revoke sign-in access for ${email}? Their material stays.`)) return;
    await call('/api/admin/access', 'DELETE', { email }, email);
    if (editing?.email === email) editing = null;
  }

  function editPerson(p: AccessPerson) {
    editing = {
      email: p.email,
      groups: [...p.groups],
      // A pre-groups member keeps their intel space when first saved here.
      grants: p.legacyMember && !p.grants.includes('jkai.intel:self') ? [...p.grants, 'jkai.intel:self'] : [...p.grants],
    };
  }

  function toggleGroup(id: string, on: boolean) {
    if (!editing) return;
    editing.groups = on ? [...editing.groups.filter((g) => g !== id), id] : editing.groups.filter((g) => g !== id);
  }

  async function savePerson() {
    if (!editing) return;
    const ok = await call('/api/admin/access', 'PATCH', editing, editing.email);
    if (ok) editing = null;
  }

  function newGroup() {
    editingGroup = { id: null, label: '', description: '', grants: [] };
  }

  function editGroup(g: AccessGroupView) {
    editingGroup = { id: g.id, label: g.label, description: g.description ?? '', grants: [...g.grants] };
  }

  async function saveGroup() {
    if (!editingGroup) return;
    const { id, ...rest } = editingGroup;
    const ok = id
      ? await call('/api/admin/access/groups', 'PATCH', { id, ...rest }, `group:${id}`)
      : await call('/api/admin/access/groups', 'POST', rest, 'group:new');
    if (ok) editingGroup = null;
  }

  async function removeGroup(g: AccessGroupView) {
    const who = g.members === 1 ? '1 person loses it' : `${g.members} people lose it`;
    if (!confirm(`Delete the group "${g.label}"? ${who}.`)) return;
    await call('/api/admin/access/groups', 'DELETE', { id: g.id }, `group:${g.id}`);
  }

  function formatDate(d: string | Date) {
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
</script>

<PageWrap>
  <PageHeader
    kicker="Access"
    title="People and permissions"
    sub="Who may sign in, and what each person may do. Put people in groups, and add one-off permissions on top. Someone with no permissions sees only public pages. Nothing here reaches your own material: 'all' means other people's and the household's, never yours."
  />

  {#if errorMsg}<p class="result-bad" role="alert">{errorMsg}</p>{/if}

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Super Admin</span>
      <span class="nm-pill" data-state="connected">{superAdmins.length} · env</span>
    </div>
    <p class="muted">
      Full access to everything, set by the <code>AUTH_ALLOWED_EMAILS</code> environment variable so a
      database fault can never lock you out. It is not a group and cannot be granted here.
    </p>
    <ul class="access-list">
      {#each superAdmins as email}
        <li class="access-row">
          <span class="email">{email}</span>
          <span class="owner-tag">Super Admin</span>
        </li>
      {:else}
        <li class="access-row muted">None configured — nobody can sign in.</li>
      {/each}
    </ul>
  </section>

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Add a person</span>
    </div>
    <p class="muted">They sign in with Google using this exact address, and start with no permissions.</p>
    <div class="nm-form-row">
      <label class="nm-field">
        <span class="sr-label-tight">Google email</span>
        <input
          class="nm-text-input"
          type="email"
          bind:value={newEmail}
          placeholder="name@gmail.com"
          onkeydown={(e) => e.key === 'Enter' && addPerson()}
        />
      </label>
      <label class="nm-field">
        <span class="sr-label-tight">Note (optional)</span>
        <input
          class="nm-text-input"
          type="text"
          bind:value={newNote}
          placeholder="e.g. partner, colleague"
          onkeydown={(e) => e.key === 'Enter' && addPerson()}
        />
      </label>
    </div>
    <div class="add-row">
      <button class="nm-save-btn" onclick={addPerson} disabled={adding}>
        {adding ? 'Adding…' : 'Add person'}
      </button>
    </div>
  </section>

  <section class="nm-sec" data-section="people">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">People</span>
      <span class="nm-pill" data-state={people.length ? 'connected' : 'disconnected'}>
        {people.length} {people.length === 1 ? 'person' : 'people'}
      </span>
    </div>
    <ul class="access-list">
      {#each people as person (person.email)}
        <li class="access-row person">
          <div class="row-main">
            <span class="email">{person.email}</span>
            {#if person.note}<span class="note">{person.note}</span>{/if}
            <span class="added">added {formatDate(person.createdAt)}</span>
            <button class="row-link" onclick={() => editPerson(person)} disabled={busy === person.email}>Edit</button>
            <button class="row-link danger" onclick={() => removePerson(person.email)} disabled={busy === person.email}>
              Remove
            </button>
          </div>
          <div class="chips">
            {#each person.groups as g}<span class="chip group">{groupLabel(g)}</span>{/each}
            {#each person.grants as p}<span class="chip">{LABELS[p] ?? p}</span>{/each}
            {#if person.legacyMember}<span class="chip">{LABELS['jkai.intel:self']} (member)</span>{/if}
            {#if person.effective.length === 0}<span class="chip ghost">Guest — public pages only</span>{/if}
          </div>

          {#if editing?.email === person.email}
            <div class="editor">
              <span class="sr-label-tight">Groups</span>
              <div class="group-picks">
                {#each groups as g (g.id)}
                  <label class="group-pick">
                    <input
                      type="checkbox"
                      checked={editing.groups.includes(g.id)}
                      onchange={(e) => toggleGroup(g.id, e.currentTarget.checked)}
                    />
                    <span class="area-name">{g.label}</span>
                    {#if g.description}<span class="area-blurb">{g.description}</span>{/if}
                  </label>
                {/each}
              </div>
              <span class="sr-label-tight">One-off permissions, on top of the groups</span>
              <GrantEditor
                name="person-{person.email}"
                grants={editing.grants}
                onchange={(next) => editing && (editing.grants = next)}
              />
              <div class="add-row">
                <button class="nm-save-btn" onclick={savePerson} disabled={busy === person.email}>
                  {busy === person.email ? 'Saving…' : 'Save'}
                </button>
                <button class="nm-btn-ghost" onclick={() => (editing = null)}>Cancel</button>
              </div>
            </div>
          {/if}
        </li>
      {:else}
        <li class="access-row muted">Nobody yet — only the Super Admin can sign in.</li>
      {/each}
    </ul>
  </section>

  <section class="nm-sec" data-section="groups">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Groups</span>
      <span class="nm-pill" data-state="connected">{groups.length}</span>
      <button class="row-link push" onclick={newGroup}>New group</button>
    </div>
    <ul class="access-list">
      {#if editingGroup && editingGroup.id === null}
        <li class="access-row person">
          {@render groupEditor()}
        </li>
      {/if}
      {#each groups as g (g.id)}
        <li class="access-row person">
          <div class="row-main">
            <span class="group-name">{g.label}</span>
            {#if g.builtIn}<span class="note">built-in</span>{/if}
            <span class="added">{g.members} {g.members === 1 ? 'person' : 'people'}</span>
            <button class="row-link" onclick={() => editGroup(g)} disabled={busy === `group:${g.id}`}>Edit</button>
            {#if !g.builtIn}
              <button class="row-link danger" onclick={() => removeGroup(g)} disabled={busy === `group:${g.id}`}>
                Delete
              </button>
            {/if}
          </div>
          {#if g.description}<p class="muted desc">{g.description}</p>{/if}
          <div class="chips">
            {#each g.grants as p}<span class="chip">{LABELS[p] ?? p}</span>{:else}<span class="chip ghost">No permissions</span>{/each}
          </div>
          {#if editingGroup?.id === g.id}
            {@render groupEditor()}
          {/if}
        </li>
      {/each}
    </ul>
  </section>
</PageWrap>

{#snippet groupEditor()}
  {#if editingGroup}
    <div class="editor">
      <div class="nm-form-row">
        <label class="nm-field">
          <span class="sr-label-tight">Name</span>
          <input class="nm-text-input" type="text" bind:value={editingGroup.label} placeholder="e.g. Research readers" />
        </label>
        <label class="nm-field">
          <span class="sr-label-tight">Description</span>
          <input class="nm-text-input" type="text" bind:value={editingGroup.description} />
        </label>
      </div>
      <GrantEditor
        name="group-{editingGroup.id ?? 'new'}"
        grants={editingGroup.grants}
        onchange={(next) => editingGroup && (editingGroup.grants = next)}
      />
      <div class="add-row">
        <button class="nm-save-btn" onclick={saveGroup} disabled={busy?.startsWith('group:')}>
          {editingGroup.id ? 'Save group' : 'Create group'}
        </button>
        <button class="nm-btn-ghost" onclick={() => (editingGroup = null)}>Cancel</button>
      </div>
    </div>
  {/if}
{/snippet}

<style>
  .muted { margin: 0 0 0.75rem; font-size: 0.85rem; color: var(--text-secondary); }
  .muted.desc { margin: 0.25rem 0 0; }
  .muted code {
    font-family: var(--font-mono);
    font-size: max(0.85em, var(--fs-label-xs));
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
  .access-row.person {
    flex-direction: column;
    align-items: stretch;
    gap: 0.4rem;
  }
  .access-row:last-child { border-bottom: none; }
  .row-main {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.85rem;
  }
  .email { font-family: var(--font-mono); font-size: 0.82rem; color: var(--text-primary); overflow-wrap: anywhere; }
  .group-name { font-weight: 600; color: var(--text-primary); }
  .note {
    font-size: 0.75rem;
    color: var(--text-muted);
    padding: 0.1rem 0.45rem;
    background: var(--bg-section);
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
  .owner-tag {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.15em;
    color: var(--accent);
    border: 1px solid var(--accent);
    padding: 0.1rem 0.4rem;
    border-radius: 2px;
  }
  .chips { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .chip {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
    border: 1px solid var(--divider);
    padding: 0.1rem 0.4rem;
    border-radius: 2px;
  }
  .chip.group { color: var(--text-primary); border-color: var(--line-strong); }
  .chip.ghost { color: var(--text-ghost); }
  .editor {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin-top: 0.4rem;
    padding: 0.8rem;
    border: 1px solid var(--line-strong);
    background: var(--bg);
  }
  .group-picks { display: flex; flex-direction: column; gap: 0.35rem; }
  .group-pick {
    display: grid;
    grid-template-columns: auto auto 1fr;
    align-items: baseline;
    gap: 0.6rem;
  }
  .area-name { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-primary); }
  .area-blurb { font-size: var(--fs-label-xs); color: var(--text-muted); }
  .add-row { display: flex; align-items: center; gap: 0.8rem; margin-top: 0.4rem; }
  .result-bad { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--error); margin: 0 0 0.75rem; }
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
  .row-link.push { margin-left: auto; }
  .row-link:hover { color: var(--text-primary); }
  .row-link.danger:hover { color: var(--error); }
  .row-link:disabled { opacity: 0.5; cursor: default; }
</style>
