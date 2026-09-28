<svelte:head><title>{data.person.name} — People</title></svelte:head>
<script lang="ts">
  // One person: access, household, phones, view-as and remove — everything
  // that used to live across /admin/access, /admin/access/devices and
  // /home/people/settings.
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import type { ActionData, PageData } from './$types';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';
  import AccessEditor from '$lib/components/admin/AccessEditor.svelte';
  import { LANE_LABEL } from '$lib/access/device-rows';
  import type { Permission } from '$lib/access/catalogue';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const person = $derived(data.person);

  // The editor's working copy, re-seeded whenever a save reloads the person.
  let role = $state<string | null>(untrack(() => data.person.roleId));
  let grants = $state<Permission[]>(untrack(() => [...data.person.effective]));
  $effect(() => {
    const p = data.person;
    untrack(() => {
      role = p.roleId;
      grants = [...p.effective];
    });
  });

  const others = $derived(data.household.filter((m) => m.subject !== person.household?.subject));
  const unlinked = $derived(data.household.filter((m) => !m.email));
  const followAll = $derived(person.household?.alerts?.follow == null);

  const SOURCE_LABEL: Record<string, string> = {
    life360: 'Life360 (Home Assistant)',
    companion: 'The iPhone app',
    none: 'Not tracked',
  };

  const KIND: Record<string, string> = { owner: 'Super admin', account: 'Account', household: 'Household only' };

  const keep = () => async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
    await update({ reset: false });
  };

  let viewAsError = $state('');
  async function viewAs() {
    viewAsError = '';
    const res = await fetch('/api/admin/access/view-as', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: person.email }),
    });
    if (res.ok) window.location.assign('/');
    else viewAsError = (await res.json().catch(() => ({}))).error ?? 'View as did not start';
  }

  function when(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  const saved = (what: string) => form && 'saved' in form && form.saved === what;
</script>

<PageWrap>
  <PageHeader
    kicker="People · {KIND[person.kind]}"
    title={person.name}
    sub={person.email ?? 'No account: they are on the household map but cannot sign in.'}
  />

  {#if form && 'error' in form && form.error}<p class="result-bad" role="alert">{form.error}</p>{/if}
  {#each data.deviceWarnings as w}<p class="muted warn">{w}</p>{/each}

  <section class="nm-sec" data-section="access">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Access</span>
      {#if person.roleLabel}<span class="nm-pill" data-state="connected">{person.roleLabel}</span>{/if}
    </div>
    {#if person.kind === 'owner'}
      <p class="muted">
        Full access to everything, from the <code>AUTH_ALLOWED_EMAILS</code> environment variable so a database fault can
        never lock you out. Nothing to set here.
      </p>
    {:else if person.kind === 'household'}
      <p class="muted">Give them a sign-in to set what they may do. Use the Google address they will sign in with.</p>
      <form method="POST" action="?/giveAccount" use:enhance={keep} class="inline-form">
        <label class="nm-field">
          <span class="sr-label-tight">Google email</span>
          <input class="nm-text-input" type="email" name="email" value={person.email ?? ''} required />
        </label>
        <button class="nm-save-btn" type="submit">Give them an account</button>
      </form>
    {:else}
      <p class="muted">
        Pick a role, then add anything extra. Rows show what they will hold; the role’s part is marked and can only be
        raised here. “Everyone’s” never includes your own material.
      </p>
      <form method="POST" action="?/access" use:enhance={keep}>
        <input type="hidden" name="role" value={role ?? ''} />
        <input type="hidden" name="grants" value={JSON.stringify(grants)} />
        <AccessEditor name="person" roles={data.roles} bind:role bind:grants />
        <div class="add-row">
          <button class="nm-save-btn" type="submit">Save access</button>
          {#if saved('access')}<span class="ok">Saved.</span>{/if}
        </div>
      </form>
    {/if}
  </section>

  <section class="nm-sec" data-section="household">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Household</span>
      {#if person.household}<span class="nm-pill" data-state="connected">{SOURCE_LABEL[person.household.source]}</span>{/if}
    </div>
    {#if person.household}
      {@const m = person.household}
      <form method="POST" action="?/household" use:enhance={keep}>
        <div class="nm-form-row">
          <label class="nm-field">
            <span class="sr-label-tight">Name</span>
            <input class="nm-text-input" name="displayName" value={m.displayName} maxlength="60" required autocomplete="off" />
          </label>
          <label class="nm-field">
            <span class="sr-label-tight">Email they sign in with</span>
            <input
              class="nm-text-input"
              name="email"
              type="email"
              value={m.email ?? ''}
              readonly={person.kind !== 'household'}
              autocomplete="off"
            />
          </label>
        </div>
        <div class="nm-form-row">
          <label class="nm-field">
            <span class="sr-label-tight">Location from</span>
            <select class="nm-text-input" name="source">
              {#each ['life360', 'companion', 'none'] as s (s)}
                <option value={s} selected={s === m.source}>{SOURCE_LABEL[s]}</option>
              {/each}
            </select>
          </label>
          <label class="nm-field">
            <span class="sr-label-tight">Home Assistant person (Life360)</span>
            <input class="nm-text-input" name="haPersonEntity" value={m.haPersonEntity ?? ''} placeholder="person.name" autocomplete="off" />
          </label>
        </div>
        <p class="muted small">
          The app takes their location from their phone only: with sharing off they show as not sharing, never picked up
          from Life360 instead.
        </p>
        <div class="nm-form-row">
          <label class="nm-field">
            <span class="sr-label-tight">WhatsApp number</span>
            <input class="nm-text-input" name="whatsapp" type="tel" value={m.whatsapp ?? ''} placeholder="07… or +44…" autocomplete="off" />
          </label>
          <label class="toggle">
            <input type="checkbox" name="whatsappOn" checked={m.alerts?.whatsapp === true} />
            <span>WhatsApp alerts</span>
          </label>
        </div>

        {#if others.length}
          <fieldset class="checks">
            <legend class="sr-label-tight">Alerts about</legend>
            <label class="toggle">
              <input type="checkbox" name="followAll" checked={followAll} />
              <span>Everyone, including anyone added later</span>
            </label>
            {#each others as o (o.subject)}
              <label class="toggle">
                <input type="checkbox" name="follow" value={o.subject} checked={followAll || (m.alerts?.follow ?? []).includes(o.subject)} />
                <span>{o.displayName}</span>
              </label>
            {/each}
          </fieldset>

          <fieldset class="checks" class:dim={person.family !== 'parent' && person.kind !== 'owner'}>
            <legend class="sr-label-tight">Parent of</legend>
            {#each others as o (o.subject)}
              <label class="toggle">
                <input type="checkbox" name="guardianOf" value={o.subject} checked={(m.guardianOf ?? []).includes(o.subject)} />
                <span>{o.displayName}</span>
              </label>
            {/each}
            <p class="muted small">
              {person.family === 'parent' || person.kind === 'owner'
                ? 'They see each ticked person’s day and journeys as their own.'
                : 'Does nothing until their Family access is Parent.'}
            </p>
          </fieldset>
        {/if}

        <div class="add-row">
          <button class="nm-save-btn" type="submit">Save household</button>
          {#if saved('household')}<span class="ok">Saved.</span>{/if}
          {#if person.kind === 'account'}
            <button class="row-link danger push" type="submit" formaction="?/leaveHousehold">Unlink from the household</button>
          {/if}
        </div>
      </form>
    {:else if person.email}
      <p class="muted">Not in the household: no location, no family map.</p>
      <form method="POST" action="?/joinHousehold" use:enhance={keep} class="inline-form">
        <label class="nm-field">
          <span class="sr-label-tight">Add them as</span>
          <select class="nm-text-input" name="target">
            {#each unlinked as u (u.subject)}<option value={u.subject}>{u.displayName} (already on the map)</option>{/each}
            <option value="new" selected={!unlinked.length}>A new household person, {person.name}</option>
          </select>
        </label>
        <button class="nm-save-btn" type="submit">Add to the household</button>
      </form>
    {/if}
  </section>

  {#if person.email}
    <section class="nm-sec" data-section="phones">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Phones</span>
        <span class="nm-pill" data-state={person.devices.length ? 'connected' : 'disconnected'}>{person.devices.length}</span>
      </div>
      {#if person.devices.length}
        <table class="devices">
          <thead>
            <tr><th>Pairing</th><th>Phone</th><th>Paired</th><th>Last used</th><th></th></tr>
          </thead>
          <tbody>
            {#each person.devices as d (d.key)}
              <tr>
                <td>{LANE_LABEL[d.lane]}</td>
                <td>{d.label ?? 'iPhone'}</td>
                <td>{when(d.paired)}</td>
                <td>{when(d.lastUsed)}</td>
                <td>
                  <form method="POST" action="?/revoke" use:enhance={keep}>
                    <input type="hidden" name="lane" value={d.lane} />
                    <input type="hidden" name="id" value={d.id} />
                    <button class="row-link danger" type="submit">Sign out</button>
                  </form>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="muted">No phone paired.</p>
      {/if}
    </section>
  {/if}

  {#if person.kind === 'account'}
    <section class="nm-sec" data-section="danger">
      <div class="nm-sec-hd"><span class="sr-label-tight">See or remove</span></div>
      <div class="add-row">
        <button class="nm-btn-ghost" type="button" onclick={viewAs}>View the site as {person.name}</button>
        {#if viewAsError}<span class="result-bad">{viewAsError}</span>{/if}
      </div>
      <form
        method="POST"
        action="?/remove"
        use:enhance={({ cancel }) => {
          if (!confirm(`Remove ${person.name}? Their sign-in, every phone and their household link go. Their material stays.`)) cancel();
          return async ({ result, update }) => {
            if (result.type === 'success') {
              const warning = (result.data as { warning?: string | null } | undefined)?.warning;
              if (warning) alert(warning);
              await goto('/admin/access');
            } else await update({ reset: false });
          };
        }}
      >
        <p class="muted">Removing takes away their sign-in, signs out every phone, and unlinks their household row.</p>
        <button class="row-link danger" type="submit">Remove {person.name}</button>
      </form>
    </section>
  {/if}
</PageWrap>

<style>
  .muted { margin: 0 0 0.75rem; font-size: 0.85rem; color: var(--text-secondary); }
  .muted.small { font-size: var(--fs-label-xs); }
  .muted.warn { color: var(--warn); }
  .muted code { font-family: var(--font-mono); font-size: max(0.85em, var(--fs-label-xs)); }
  .result-bad { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--error); margin: 0 0 0.75rem; }
  .ok { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--success); }
  .add-row { display: flex; align-items: center; flex-wrap: wrap; gap: 0.8rem; margin-top: 0.8rem; }
  .inline-form { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 0.8rem; }
  .toggle { display: flex; align-items: center; gap: 0.45rem; font-size: 0.85rem; color: var(--text-primary); }
  .checks { border: none; padding: 0; margin: 0.8rem 0 0; display: flex; flex-wrap: wrap; gap: 0.35rem 1.1rem; }
  .checks legend { margin-bottom: 0.35rem; }
  .checks .muted { flex-basis: 100%; margin: 0.2rem 0 0; }
  .checks.dim .toggle { color: var(--text-muted); }
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
  .push { margin-left: auto; }
  .devices { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  .devices th {
    text-align: left;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    font-weight: 400;
    padding: 0.3rem 0.4rem;
    border-bottom: 1px solid var(--line-strong);
  }
  .devices td { padding: 0.4rem; border-bottom: 1px solid var(--divider); }
  @media (max-width: 640px) {
    .devices th:nth-child(3), .devices td:nth-child(3) { display: none; }
  }
</style>
