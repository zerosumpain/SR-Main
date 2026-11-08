<script lang="ts">
  import { enhance } from '$app/forms';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const live = $derived(data.tvs.filter((t) => !t.revokedAt));
  const gone = $derived(data.tvs.filter((t) => t.revokedAt));
</script>

<svelte:head><title>TVs · Access</title></svelte:head>

<main class="tvs">
  <h1>TVs</h1>
  <p class="lead">
    The televisions that can host a family games party. On the TV open <strong>sr. tv</strong> (or
    <code>strangeramblings.com/tv</code> in its browser); it shows four letters. Type them here.
    Installing the app: <a href="/games/tv/install">the install steps</a>.
  </p>

  <form method="POST" action="?/link" use:enhance class="tvs-link">
    <label>
      <span>Code on the TV</span>
      <input name="code" autocomplete="off" autocapitalize="characters" maxlength="6" required value={form && 'code' in form ? form.code : ''} />
    </label>
    <label>
      <span>Name</span>
      <input name="name" maxlength="40" placeholder="Living room TV" value={form && 'name' in form ? form.name : ''} />
    </label>
    <button type="submit">Link this TV</button>
  </form>
  {#if form && 'error' in form && form.error}<p class="err" role="alert">{form.error}</p>{/if}
  {#if form && 'ok' in form && form.ok}<p class="ok" role="status">Done.</p>{/if}

  <h2>Linked</h2>
  {#if live.length === 0}
    <p class="muted">No TV is linked yet.</p>
  {:else}
    <ul class="tvs-list">
      {#each live as tv (tv.id)}
        <li>
          <form method="POST" action="?/rename" use:enhance class="tvs-row">
            <input type="hidden" name="id" value={tv.id} />
            <input name="name" value={tv.name} maxlength="40" aria-label="Name" />
            <button type="submit">Rename</button>
          </form>
          <p class="muted">Linked {when(tv.linkedAt)} · last seen {when(tv.lastSeenAt)}</p>
          <form method="POST" action="?/revoke" use:enhance>
            <input type="hidden" name="id" value={tv.id} />
            <button type="submit" class="danger">Unlink</button>
          </form>
        </li>
      {/each}
    </ul>
  {/if}

  {#if gone.length}
    <h2>Unlinked</h2>
    <ul class="tvs-list">
      {#each gone as tv (tv.id)}
        <li class="muted">{tv.name} · unlinked {when(tv.revokedAt)}</li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  .tvs { max-width: 44rem; margin: 0 auto; padding: 2rem 1rem 4rem; font-family: var(--font-body); }
  h1 { font-family: var(--font-display); font-size: 1.75rem; margin: 0 0 0.75rem; }
  h2 { font-family: var(--font-mono); font-size: 0.8rem; letter-spacing: 0.12em; text-transform: uppercase; margin: 2rem 0 0.75rem; color: var(--text-muted); }
  .lead { line-height: 1.6; margin: 0 0 1.5rem; }
  .tvs-link { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: flex-end; }
  label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.9rem; }
  label span { font-family: var(--font-mono); font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase; }
  input { font: inherit; padding: 0.5rem 0.6rem; border: 1px solid var(--line-strong); border-radius: 2px; background: var(--surface-elevated); color: inherit; }
  input[name='code'] { width: 7rem; font-family: var(--font-mono); letter-spacing: 0.2em; text-transform: uppercase; }
  button { font: inherit; padding: 0.5rem 0.9rem; border-radius: 2px; border: 1px solid var(--accent-ink); background: var(--accent-ink); color: var(--bg); cursor: pointer; }
  button.danger { background: transparent; color: var(--error); border-color: var(--error); }
  .tvs-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 1rem; }
  .tvs-list li { border-top: 1px solid var(--line-strong); padding-top: 0.75rem; display: grid; gap: 0.4rem; }
  .tvs-row { display: flex; gap: 0.5rem; }
  .muted { color: var(--text-muted); font-size: 0.9rem; margin: 0; }
  .err { color: var(--error); }
  .ok { color: var(--success); }
</style>
