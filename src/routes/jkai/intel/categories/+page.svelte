<script lang="ts">
  // The taxonomy: what a node IS, and where the knowledge CAME FROM.
  //
  // Both used to live in one panel at the bottom of /jkai/intel/quality — a
  // chip list and two <select>s. On production that is 257 entity types in a
  // control with 257 options and no search, which is not something a person can
  // navigate; and the only decision on offer was "move everything from X into
  // Y" with no opinion at all about which X and which Y.
  //
  // So: a surface of its own, and it leads with the opinion. Every suggestion
  // carries the evidence for it, because a suggestion you cannot check is one
  // you have to re-derive before you dare act on it.
  import { onMount } from 'svelte';
  import JkaiPageTitle from '$lib/components/jkai/JkaiPageTitle.svelte';
  import type {
    TaxonomyType,
    TaxonomyCategory,
    TypeMergeSuggestion,
    CategoryMergeSuggestion,
  } from '$lib/jkai/intel/taxonomy';

  interface Stats {
    total: number;
    active: number;
    proposed: number;
    retired: number;
    tiny: number;
    unused: number;
    dismissed: number;
  }

  let types = $state<TaxonomyType[]>([]);
  let categories = $state<TaxonomyCategory[]>([]);
  let typeSuggestions = $state<TypeMergeSuggestion[]>([]);
  let categorySuggestions = $state<CategoryMergeSuggestion[]>([]);
  let stats = $state<Stats | null>(null);

  let loading = $state(true);
  let busy = $state<string | null>(null);
  let message = $state<string | null>(null);

  // ── Navigation state ───────────────────────────────────────────────────
  //
  // The three things the old panel had none of: a filter, a status split and an
  // ordering. 257 rows need all three before any of them is reachable.
  let search = $state('');
  let statusFilter = $state<'all' | 'active' | 'proposed' | 'retired'>('all');
  let sortBy = $state<'usage' | 'name' | 'new'>('usage');
  /** Suggestions dispatched this session, so a row leaves without a refetch. */
  let done = $state<Set<string>>(new Set());
  /** Which type a bulk retire should move members into, per suggestion. */
  let moveTo = $state<Record<string, string>>({});

  async function load() {
    loading = true;
    try {
      const res = await fetch('/api/jkai/intel/taxonomy');
      if (!res.ok) throw new Error(`the taxonomy request came back ${res.status}`);
      const body = await res.json();
      types = body.types ?? [];
      categories = body.categories ?? [];
      typeSuggestions = body.typeSuggestions ?? [];
      categorySuggestions = body.categorySuggestions ?? [];
      stats = body.stats ?? null;
      done = new Set();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'could not load the taxonomy');
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function notify(text: string) {
    message = text;
    setTimeout(() => (message = null), 4500);
  }

  const suggestionKey = (s: TypeMergeSuggestion) =>
    s.intoId ? `${s.fromId}|${s.intoId}` : `retire:${s.fromId}`;

  const visibleSuggestions = $derived(typeSuggestions.filter((s) => !done.has(suggestionKey(s))));

  /**
   * Three groups, because they want three different amounts of attention.
   *
   * A mis-filed relationship is a specific finding about a specific name and is
   * worth reading; an unused proposal is 227 identical rows saying the same
   * sentence, and reading them one at a time is the thing this page exists to
   * stop. So the relations stay open and the tail folds away behind its own
   * bulk action.
   */
  const relationSuggestions = $derived(visibleSuggestions.filter((s) => s.kind === 'relation'));
  const unusedSuggestions = $derived(visibleSuggestions.filter((s) => s.kind === 'empty-proposal'));
  /** Everything the bulk retire covers. */
  const emptyProposals = $derived([...relationSuggestions, ...unusedSuggestions]);
  const pairSuggestions = $derived(
    visibleSuggestions.filter((s) => s.kind !== 'empty-proposal' && s.kind !== 'relation'),
  );
  let unusedOpen = $state(false);

  const filteredTypes = $derived.by(() => {
    const q = search.trim().toLowerCase();
    const rows = types.filter((t) => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (!q) return true;
      return t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q);
    });
    const sorted = [...rows];
    if (sortBy === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === 'new') sorted.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    else sorted.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    return sorted;
  });

  const typeOptions = $derived(
    [...types].filter((t) => t.status === 'active').sort((a, b) => b.count - a.count),
  );

  async function post(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch('/api/jkai/intel/taxonomy', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error((await res.text()) || `request failed (${res.status})`);
    return res.json();
  }

  async function applySuggestion(s: TypeMergeSuggestion) {
    const key = suggestionKey(s);
    if (busy) return;
    busy = key;
    try {
      if (s.intoId) {
        const out = await post({ action: 'merge-types', fromTypeId: s.fromId, intoTypeId: s.intoId });
        notify(`Moved ${out.moved ?? 0} entities from "${s.fromName}" into "${s.intoName}"`);
      } else {
        const into = moveTo[key] || undefined;
        const out = await post({ action: 'retire-type', typeId: s.fromId, intoTypeId: into });
        const failed = (out.failed as Array<{ reason: string }>) ?? [];
        if (failed.length) throw new Error(failed[0].reason);
        notify(`Retired "${s.fromName}"`);
      }
      done = new Set([...done, key]);
      void load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'that did not work');
    } finally {
      busy = null;
    }
  }

  async function dismiss(s: TypeMergeSuggestion) {
    const key = suggestionKey(s);
    done = new Set([...done, key]);
    try {
      await post({ action: 'dismiss-suggestion', fromTypeId: s.fromId, intoTypeId: s.intoId ?? undefined });
    } catch {
      // A dismissal that did not persist is a suggestion that comes back —
      // annoying, not dangerous. Say so rather than pretending it stuck.
      notify('Hidden for now, but the dismissal did not save');
    }
  }

  async function retireAllEmpty() {
    if (busy) return;
    const ids = emptyProposals.map((s) => s.fromId);
    if (!ids.length) return;
    busy = 'retire-many';
    try {
      const out = await post({ action: 'retire-many', typeIds: ids });
      const failed = (out.failed as Array<{ id: string; reason: string }>) ?? [];
      notify(
        `Retired ${out.retired ?? 0} unused proposals` +
          (failed.length ? ` — ${failed.length} kept: ${failed[0].reason}` : ''),
      );
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'the bulk retire failed');
    } finally {
      busy = null;
    }
  }

  async function admit(t: TaxonomyType) {
    if (busy) return;
    busy = t.id;
    try {
      await post({ action: 'admit-type', typeId: t.id });
      notify(`"${t.name}" is now part of the taxonomy`);
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'could not admit it');
    } finally {
      busy = null;
    }
  }

  // ── Manual merge, kept for the cases no rule proposes ───────────────────
  let mergeFrom = $state('');
  let mergeInto = $state('');

  async function mergeTypes() {
    if (!mergeFrom || !mergeInto || mergeFrom === mergeInto) return;
    busy = 'manual-merge';
    try {
      const out = await post({ action: 'merge-types', fromTypeId: mergeFrom, intoTypeId: mergeInto });
      notify(`Moved ${out.moved ?? 0} entities`);
      mergeFrom = '';
      mergeInto = '';
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'the merge failed');
    } finally {
      busy = null;
    }
  }

  async function mergeCategoryPair(fromId: string, intoId: string) {
    if (!fromId || !intoId || fromId === intoId) return;
    busy = `cat:${fromId}`;
    try {
      const out = (await post({ action: 'merge-categories', fromId, intoId })).result as {
        notesRetagged: number;
        foldersRetagged: number;
      };
      notify(`Retagged ${out.notesRetagged} notes and ${out.foldersRetagged} folders`);
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'the category merge failed');
    } finally {
      busy = null;
    }
  }

  let catFrom = $state('');
  let catInto = $state('');
</script>

<JkaiPageTitle title="INTEL / TAXONOMY" titleHref="/jkai/intel" />

<div class="wrap">
  <p class="lede">
    Two vocabularies. <b>Entity types</b> say what a node IS; <b>source categories</b> say where the
    knowledge came from. Both grow on their own — the extractor coins a type whenever it is unsure —
    and both make every filter downstream less useful as they sprawl.
  </p>
  <p class="lede-vs">
    This page decides what the graph is ALLOWED to call things. To fix which node a thing is, use
    <a href="/jkai/intel/quality">Quality</a>; to judge one entity, use
    <a href="/jkai/intel/review">Triage</a>.
  </p>

  {#if stats}
    <div class="stat-row">
      <div class="stat"><b>{stats.total}</b><span>types</span></div>
      <div class="stat"><b>{stats.active}</b><span>active</span></div>
      <div class="stat" class:warn={stats.proposed > 20}><b>{stats.proposed}</b><span>proposed</span></div>
      <div class="stat" class:warn={stats.unused > 20}><b>{stats.unused}</b><span>unused</span></div>
      <div class="stat"><b>{stats.tiny}</b><span>one or two members</span></div>
      <div class="stat"><b>{categories.length}</b><span>source categories</span></div>
    </div>
  {/if}

  <!-- ── Suggestions first. The whole point of the page. ──────────────── -->
  <section class="panel" id="suggestions">
    <header>
      <h2>Suggested merges</h2>
      {#if stats?.dismissed}
        <button
          type="button"
          class="ghost"
          onclick={async () => {
            await post({ action: 'undismiss-all' });
            await load();
          }}
        >Bring back {stats.dismissed} dismissed</button>
      {/if}
    </header>

    {#if loading}
      <p class="muted">Reading the taxonomy…</p>
    {:else if !visibleSuggestions.length}
      <p class="muted">Nothing to fold. Every type is pulling its weight.</p>
    {:else}
      {#if emptyProposals.length}
        <div class="bulk">
          <div class="bulk-text">
            <b>{emptyProposals.length}</b> proposed types nothing is filed under.
            <span class="muted-inline">
              A proposal is not inert: it re-enters the extraction prompt as a legitimate option, which
              is how a stray <code>font</code> type came to collect newspapers.
            </span>
          </div>
          <button type="button" class="primary" disabled={busy === 'retire-many'} onclick={retireAllEmpty}>
            {busy === 'retire-many' ? 'Retiring…' : `Retire all ${emptyProposals.length}`}
          </button>
        </div>

        {#snippet retireRow(s: TypeMergeSuggestion)}
          <li class="sugg">
            <div class="sugg-main">
              <span class="kind kind-{s.kind}">{s.kind === 'relation' ? 'relationship' : 'unused'}</span>
              <b>{s.fromName}</b>
              <span class="reason">{s.reason}</span>
            </div>
            <div class="sugg-act">
              {#if s.fromCount > 0}
                <select bind:value={moveTo[suggestionKey(s)]} aria-label="Move its {s.fromCount} entities to">
                  <option value="">Move its {s.fromCount} entities to…</option>
                  {#each typeOptions as t (t.id)}<option value={t.id}>{t.icon} {t.name}</option>{/each}
                </select>
              {/if}
              <button
                type="button"
                disabled={busy === suggestionKey(s) || (s.fromCount > 0 && !moveTo[suggestionKey(s)])}
                onclick={() => applySuggestion(s)}
              >Retire</button>
              <button type="button" class="ghost" onclick={() => dismiss(s)}>Keep</button>
            </div>
          </li>
        {/snippet}

        {#if relationSuggestions.length}
          <ul class="sugg-list">
            {#each relationSuggestions as s (suggestionKey(s))}{@render retireRow(s)}{/each}
          </ul>
        {/if}

        {#if unusedSuggestions.length}
          <button
            type="button"
            class="disclose"
            aria-expanded={unusedOpen}
            onclick={() => (unusedOpen = !unusedOpen)}
          >
            <span class="chev" aria-hidden="true">{unusedOpen ? '▾' : '▸'}</span>
            {unusedOpen ? 'Hide' : 'Read'} the {unusedSuggestions.length} unused proposals one by one
          </button>
          {#if unusedOpen}
            <ul class="sugg-list">
              {#each unusedSuggestions.slice(0, 60) as s (suggestionKey(s))}{@render retireRow(s)}{/each}
              {#if unusedSuggestions.length > 60}
                <li class="more">
                  …and {unusedSuggestions.length - 60} more, all covered by the bulk action above.
                </li>
              {/if}
            </ul>
          {/if}
        {/if}
      {/if}

      {#if pairSuggestions.length}
        <ul class="sugg-list">
          {#each pairSuggestions as s (suggestionKey(s))}
            <li class="sugg">
              <div class="sugg-main">
                <span class="kind kind-{s.kind}">{s.kind}</span>
                <b>{s.fromName}</b>
                <span class="count">{s.fromCount}</span>
                <span class="arrow">→</span>
                <b>{s.intoName}</b>
                <span class="count">{s.intoCount}</span>
                <span class="reason">{s.reason}</span>
              </div>
              <div class="sugg-act">
                <span class="conf">{Math.round(s.confidence * 100)}%</span>
                <button
                  type="button"
                  class="primary"
                  disabled={busy === suggestionKey(s)}
                  onclick={() => applySuggestion(s)}
                >Merge</button>
                <button type="button" class="ghost" onclick={() => dismiss(s)}>Not the same</button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </section>

  <!-- ── The list itself, now navigable. ─────────────────────────────── -->
  <section class="panel" id="types">
    <header>
      <h2>Entity types</h2>
      <div class="tools">
        <input
          type="search"
          placeholder="filter by name or description…"
          aria-label="Filter types"
          bind:value={search}
        />
        <select bind:value={statusFilter} aria-label="Status">
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="proposed">Proposed</option>
          <option value="retired">Retired</option>
        </select>
        <select bind:value={sortBy} aria-label="Sort">
          <option value="usage">Most used</option>
          <option value="name">A–Z</option>
          <option value="new">Newest</option>
        </select>
      </div>
    </header>

    {#if loading}
      <p class="muted">Counting what is filed under each…</p>
    {:else}
      <p class="muted">{filteredTypes.length} of {types.length} shown.</p>
      <ul class="type-list">
        {#each filteredTypes as t (t.id)}
          <li class="type-row" class:empty={t.count === 0}>
            <span class="ico" aria-hidden="true">{t.icon}</span>
            <span class="nm">{t.name}</span>
            <span class="badge badge-{t.status}">{t.status}</span>
            <span class="bar" aria-hidden="true">
              <i style="width: {t.count ? Math.max(2, Math.round((t.count / (types[0]?.count || 1)) * 100)) : 0}%"></i>
            </span>
            <span class="n">{t.count}</span>
            <span class="n conf-n" title="{t.confirmed} of them confirmed by a person">{t.confirmed}✓</span>
            {#if t.status === 'proposed'}
              <button type="button" class="ghost" disabled={busy === t.id} onclick={() => admit(t)}>Admit</button>
            {/if}
          </li>
        {:else}
          <li class="more">Nothing matches that filter.</li>
        {/each}
      </ul>

      <div class="manual">
        <span class="manual-label">Fold one into another</span>
        <select bind:value={mergeFrom} aria-label="Type to retire">
          <option value="">Move everything from…</option>
          {#each filteredTypes as t (t.id)}<option value={t.id}>{t.icon} {t.name} ({t.count})</option>{/each}
        </select>
        <span aria-hidden="true">→</span>
        <select bind:value={mergeInto} aria-label="Type to keep">
          <option value="">…into</option>
          {#each typeOptions as t (t.id)}<option value={t.id}>{t.icon} {t.name} ({t.count})</option>{/each}
        </select>
        <button
          type="button"
          class="primary"
          disabled={!mergeFrom || !mergeInto || mergeFrom === mergeInto || busy === 'manual-merge'}
          onclick={mergeTypes}
        >Merge types</button>
      </div>
    {/if}
  </section>

  <!-- ── Source categories. ──────────────────────────────────────────── -->
  <section class="panel" id="categories">
    <header><h2>Source categories</h2></header>
    <p class="muted">
      Labels put on Drive folders and carried onto the intel they produce — where a claim came from,
      not what it is. They are set per folder in <a href="/drive">Drive</a>, and they filter the
      <a href="/jkai/intel">graph</a>.
    </p>

    {#if loading}
      <p class="muted">Loading…</p>
    {:else if !categories.length}
      <p class="muted">
        None defined. Add one from a folder's intel settings in <a href="/drive">Drive</a>; everything
        under that folder then carries it, and the graph gains a filter for it.
      </p>
    {:else}
      {#if categorySuggestions.length}
        <ul class="sugg-list">
          {#each categorySuggestions as s (s.fromId + s.intoId)}
            <li class="sugg">
              <div class="sugg-main">
                <span class="kind kind-overlap">similar</span>
                <b>{s.fromName}</b><span class="arrow">→</span><b>{s.intoName}</b>
                <span class="reason">{s.reason}</span>
              </div>
              <div class="sugg-act">
                <button
                  type="button"
                  class="primary"
                  disabled={busy === `cat:${s.fromId}`}
                  onclick={() => mergeCategoryPair(s.fromId, s.intoId)}
                >Merge</button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}

      <ul class="type-list">
        {#each categories as c (c.id)}
          <li class="type-row">
            <span class="swatch" style="background: {c.color}" aria-hidden="true"></span>
            <span class="nm">{c.name}</span>
            <span class="slug">{c.slug}</span>
            <span class="n">{c.noteCount} notes</span>
            <span class="n">{c.folderCount} folders</span>
          </li>
        {/each}
      </ul>

      <div class="manual">
        <span class="manual-label">Fold one into another</span>
        <select bind:value={catFrom} aria-label="Category to retire">
          <option value="">Move everything from…</option>
          {#each categories as c (c.id)}<option value={c.id}>{c.name} ({c.noteCount})</option>{/each}
        </select>
        <span aria-hidden="true">→</span>
        <select bind:value={catInto} aria-label="Category to keep">
          <option value="">…into</option>
          {#each categories as c (c.id)}<option value={c.id}>{c.name} ({c.noteCount})</option>{/each}
        </select>
        <button
          type="button"
          class="primary"
          disabled={!catFrom || !catInto || catFrom === catInto || busy === `cat:${catFrom}`}
          onclick={() => mergeCategoryPair(catFrom, catInto)}
        >Merge categories</button>
      </div>
    {/if}
  </section>
</div>

{#if message}
  <div class="toast">{message}</div>
{/if}

<style>
  .wrap {
    padding: 20px;
    width: 100%;
  }
  .lede {
    font-size: var(--fs-body-sm);
    color: var(--text-secondary);
    line-height: 1.5;
    margin: 0 0 8px;
    max-width: 68ch;
  }
  .lede-vs {
    margin: 0 0 18px;
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-ghost);
    max-width: 68ch;
  }
  .lede-vs a,
  .muted a {
    color: var(--accent);
  }

  .stat-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 16px;
  }
  .stat {
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 7px 12px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    background: var(--card-bg);
  }
  .stat b {
    font-family: var(--font-mono);
    font-size: var(--fs-body-sm);
    color: var(--accent-ink);
  }
  .stat span {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }
  .stat.warn b {
    color: var(--warn);
  }

  .panel {
    background: var(--card-bg);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-round);
    padding: 16px;
    margin-bottom: 16px;
  }
  .panel > header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 10px;
  }
  h2 {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--accent-ink);
    font-weight: 500;
  }
  .muted {
    font-size: var(--fs-label);
    color: var(--text-muted);
    line-height: 1.5;
    margin: 0 0 12px;
  }
  .muted-inline {
    color: var(--text-ghost);
  }

  .tools {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  input[type='search'],
  select {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    padding: 5px 8px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    background: var(--bg);
    color: var(--text-primary);
    max-width: 100%;
  }
  input[type='search'] {
    min-width: 220px;
  }

  button {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 6px 11px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    border-color: var(--accent-tint-35);
    color: var(--accent);
  }
  button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  button.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }
  button.primary:hover:not(:disabled) {
    background: var(--accent-hover);
    color: var(--bg);
  }
  button.ghost {
    color: var(--text-ghost);
  }

  .bulk {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 10px 12px;
    margin-bottom: 12px;
    border: 1px solid var(--accent-tint-35);
    border-radius: var(--radius-sharp);
  }
  .bulk-text {
    font-size: var(--fs-label);
    color: var(--text-secondary);
    line-height: 1.5;
    max-width: 72ch;
  }
  .bulk-text code {
    font-family: var(--font-code);
    font-size: var(--fs-label-xs);
  }

  .disclose {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    margin-bottom: 8px;
    padding: 7px 9px;
    border: 1px dashed var(--line-strong);
    background: transparent;
    color: var(--text-ghost);
    text-transform: none;
    letter-spacing: 0;
    font-size: var(--fs-label);
  }
  .chev {
    color: var(--accent);
  }

  .sugg-list {
    list-style: none;
    margin: 0 0 12px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .sugg {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 9px 11px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    background: var(--bg);
  }
  .sugg-main {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
    font-size: var(--fs-label);
    color: var(--text-secondary);
    min-width: 0;
  }
  .sugg-main b {
    font-family: var(--font-mono);
    color: var(--text-primary);
    font-weight: 500;
  }
  .sugg-act {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .kind {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 2px 6px;
    border-radius: var(--radius-sharp);
    border: 1px solid var(--line-strong);
    color: var(--text-ghost);
  }
  .kind-relation {
    border-color: var(--warn);
    color: var(--warn);
  }
  .kind-plural {
    border-color: var(--accent-ink);
    color: var(--accent-ink);
  }
  .reason {
    color: var(--text-ghost);
    line-height: 1.4;
  }
  .arrow {
    color: var(--accent);
  }
  .count,
  .conf {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }

  .type-list {
    list-style: none;
    margin: 0 0 14px;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .type-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 4px;
    border-bottom: 1px solid var(--line-soft, var(--line-strong));
    font-size: var(--fs-label);
    color: var(--text-secondary);
  }
  .type-row.empty .nm {
    color: var(--text-ghost);
  }
  .ico {
    width: 1.3em;
    text-align: center;
  }
  .swatch {
    width: 12px;
    height: 12px;
    border-radius: var(--radius-sharp);
    border: 1px solid var(--line-strong);
  }
  .nm {
    font-family: var(--font-mono);
    color: var(--text-primary);
    flex: 1 1 auto;
    min-width: 14ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .slug {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  /* Fixed column: with the name flexing, a right-hugging badge put ACTIVE and
     PROPOSED at different x on adjacent rows, which reads as noise. */
  .badge {
    flex: 0 0 10ch;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-ghost);
  }
  .badge-active {
    color: var(--success);
  }
  .badge-proposed {
    color: var(--warn);
  }
  /* A fixed column, not a stretch. Full-width it ran the length of the screen
     for a type holding four entities, which reads as a scale rather than as a
     bar and leaves the name and the count separated by two feet of nothing. */
  .bar {
    flex: 0 0 180px;
    height: 6px;
    max-width: 180px;
    background: var(--surface-elevated, transparent);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    overflow: hidden;
  }
  .bar i {
    display: block;
    height: 100%;
    background: var(--accent-ink);
  }
  .n {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    min-width: 4ch;
    text-align: right;
  }
  .conf-n {
    color: var(--text-ghost);
  }
  .more {
    padding: 8px 4px;
    font-size: var(--fs-label);
    color: var(--text-ghost);
  }

  .manual {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    padding-top: 10px;
    border-top: 1px solid var(--line-strong);
  }
  .manual-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-ghost);
  }

  .toast {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--surface-elevated, var(--bg));
    border: 1px solid var(--accent);
    border-radius: var(--radius-sharp);
    padding: 9px 16px;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
    z-index: 50;
  }

  @media (max-width: 720px) {
    .type-row {
      flex-wrap: wrap;
    }
    .bar {
      order: 10;
      flex-basis: 100%;
    }
  }
</style>
