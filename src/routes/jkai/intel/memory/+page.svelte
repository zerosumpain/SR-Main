<script lang="ts">
  // Personal memory: what jkai remembers about you, and which of it reaches a
  // conversation. Pinned facts ride in core context on every turn; the rest are
  // recalled only when they match the subject. A row carrying `supersededBy` is
  // HISTORICAL — kept for the trail, read by nothing, and reachable only through
  // an as-of view. Rows load on mount, so recall re-queries without navigating.
  // Section chrome is the global .nm-* tokens; only a row's own parts are here.
  import { onMount } from 'svelte';
  import JkaiPageTitle from '$lib/components/jkai/JkaiPageTitle.svelte';

  interface Memory {
    id: string; content: string; category: string; createdAt: string;
    supersededBy: string | null; recalledBecause: string;
    provenance: { origin?: string; assertion?: string; sourceId?: string; pinned?: boolean; validFrom?: string; validUntil?: string } | null;
    entities: Array<{ id: string; name: string }>;
  }

  const CATEGORIES = ['people', 'preferences', 'places', 'health', 'devices', 'situations', 'patterns'];

  let memories = $state<Memory[]>([]);
  let query = $state(''), asOf = $state('');
  let busy = $state(false), loaded = $state(false);
  let message = $state(''), failed = $state(false);
  // `editing` is the id under correction; null while composing a new memory.
  let open = $state(false), editing = $state<string | null>(null);
  let content = $state(''), category = $state('preferences');
  let validFrom = $state(''), validUntil = $state('');
  let linkTarget = $state<string | null>(null), entityQuery = $state('');
  let entityResults = $state<Array<{ id: string; name: string; type: string }>>([]);

  // Counted over what is on screen, so a figure and the list never disagree.
  const pinned = $derived(memories.filter((m) => m.provenance?.pinned && !m.supersededBy));
  const historical = $derived(memories.filter((m) => m.supersededBy));
  const linked = $derived(memories.filter((m) => m.entities.length));

  function say(text: string, isFailure = false) {
    message = text;
    failed = isFailure;
  }

  async function load() {
    busy = true;
    try {
      const res = await fetch(`/api/jkai/memory?q=${encodeURIComponent(query)}&asOf=${encodeURIComponent(asOf)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.message);
      memories = body.memories;
    } catch (err) {
      say(err instanceof Error ? err.message : 'Unable to load memories', true);
    } finally {
      busy = false;
      loaded = true;
    }
  }

  async function act(body: Record<string, unknown>): Promise<boolean> {
    busy = true;
    say('');
    try {
      const res = await fetch('/api/jkai/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const parsed = await res.json();
      if (!res.ok) throw new Error(parsed.message);
      say('Memory updated');
      await load();
      return true;
    } catch (err) {
      say(err instanceof Error ? err.message : 'Unable to update memory', true);
      return false;
    } finally {
      busy = false;
    }
  }

  function edit(m: Memory | null) {
    editing = m?.id ?? null;
    content = m?.content ?? '';
    category = m?.category ?? 'preferences';
    validFrom = validUntil = '';
    open = true;
  }

  function close() {
    open = false; editing = null;
    content = validFrom = validUntil = '';
  }

  function toggleLinks(id: string) {
    linkTarget = linkTarget === id ? null : id;
    entityResults = [];
    entityQuery = '';
  }

  async function save() {
    const done = await act({
      action: editing ? 'correct' : 'save', id: editing ?? undefined,
      content, category, validFrom: validFrom || undefined, validUntil: validUntil || undefined,
    });
    if (done) close();
  }

  async function findEntities() {
    const res = await fetch(`/api/jkai/memory?entities=${encodeURIComponent(entityQuery)}`);
    if (res.ok) entityResults = (await res.json()).entities;
  }

  function relink(m: Memory, ids: string[]) {
    return act({ action: 'link', id: m.id, entityIds: ids });
  }

  const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null);

  /** Where the sentence came from, in words rather than an internal id. */
  const source = ({ provenance: p }: Memory) => !p?.sourceId ? 'No original source recorded'
    : p.sourceId.startsWith('memory-editor:') ? 'Saved here, in the memory editor' : p.sourceId;

  onMount(load);
</script>

<svelte:head><title>Memory · Intel</title></svelte:head>

<JkaiPageTitle title="MEMORY" titleHref="/jkai/intel">
  {#snippet meta()}<span>{memories.length} held</span><span>{pinned.length} pinned</span>{/snippet}
</JkaiPageTitle>

{#snippet sechd(title: string, meta: string)}
  <div class="nm-sec-hd"><h2 class="sr-label-tight">{title}</h2><span class="nm-sec-meta">{meta}</span></div>
{/snippet}

<div class="wrap">
  <header class="page-hdr">
    <p class="kicker">Intelligence graph</p>
    <h1>What it remembers</h1>
    <p class="sub">Personal context, wired to your intelligence graph. Pinned facts ride in core
      context on every turn; everything else is recalled only when it matches the subject.</p>
    <div class="hdr-actions">
      <button type="button" class="nm-save-btn" onclick={() => edit(null)}>Remember something</button>
      <button type="button" class="row-link" disabled={busy} onclick={() => act({ action: 'backfill' })}>Link existing memories</button>
      <a class="row-link" href="/api/jkai/memory?format=md">Export markdown</a>
    </div>
    {#if message}<p class="note" class:failed role="status">{message}</p>{/if}
  </header>

  <section class="stats">
    <div class="stat"><span class="n">{memories.length}</span><span class="l">In this view</span></div>
    <div class="stat"><span class="n pin">{pinned.length}</span><span class="l">In core context</span></div>
    <div class="stat"><span class="n">{linked.length}</span><span class="l">Linked to entities</span></div>
    <div class="stat"><span class="n old">{historical.length}</span><span class="l">Historical</span></div>
  </section>

  <section class="nm-sec">
    {@render sechd('Recall', asOf ? `as it stood on ${asOf}` : 'as it stands now')}
    <div class="bar">
      <label class="field grow">
        <span class="sr-label-tight">Search</span>
        <input class="nm-text-input" bind:value={query} placeholder="Person, project, preference…" onkeydown={(e) => { if (e.key === 'Enter') load(); }} />
      </label>
      <label class="field"><span class="sr-label-tight">Valid on</span><input class="nm-text-input" type="date" bind:value={asOf} /></label>
      <button type="button" class="nm-btn-ghost" onclick={load} disabled={busy}>{busy ? 'Reading…' : 'Search'}</button>
    </div>
  </section>

  {#if open}
    <section class="nm-sec">
      {@render sechd(editing ? 'Correct memory' : 'Remember something',
        editing ? 'supersedes the original, which is kept' : 'stated by you')}
      <label class="field"><span class="sr-label-tight">Memory</span><textarea class="nm-text-input" bind:value={content} rows="3"></textarea></label>
      <div class="bar">
        <label class="field"><span class="sr-label-tight">Category</span>
          <select class="nm-text-input select" bind:value={category}>{#each CATEGORIES as c (c)}<option value={c}>{c}</option>{/each}</select>
        </label>
        <label class="field"><span class="sr-label-tight">Valid from</span><input class="nm-text-input" type="date" bind:value={validFrom} /></label>
        <label class="field"><span class="sr-label-tight">Valid until</span><input class="nm-text-input" type="date" bind:value={validUntil} /></label>
        <button type="button" class="nm-save-btn" disabled={busy || !content.trim()} onclick={save}>Save</button>
        <button type="button" class="nm-btn-ghost" onclick={close}>Cancel</button>
      </div>
    </section>
  {/if}

  <section class="nm-sec">
    {@render sechd('Stored memories', `${memories.length} shown`)}
    {#if !memories.length}<p class="empty">{loaded ? 'No personal memories match this view.' : 'Reading the store…'}</p>{/if}

    {#each memories as m (m.id)}
      <article class="mem" class:old={!!m.supersededBy}>
        <div class="m-hd">
          <span class="tag cat">{m.category}</span>
          <span class="tag" class:stated={m.provenance?.assertion === 'stated'}>{m.provenance?.assertion ?? 'unverified'}</span>
          <span class="tag quiet">{m.provenance?.origin ?? 'legacy'}</span>
          {#if m.provenance?.pinned}<span class="tag pin">Pinned</span>{/if}
          {#if m.supersededBy}<span class="tag quiet">Historical</span>{/if}
          <span class="when">{day(m.provenance?.validFrom) ?? day(m.createdAt)} → {day(m.provenance?.validUntil) ?? 'open'}</span>
        </div>
        <p class="body">{m.content}</p>
        <p class="why">{m.recalledBecause}</p>

        {#if m.entities.length}
          <div class="chips">{#each m.entities as e (e.id)}<a class="ent" href="/jkai/intel/entities/{e.id}">{e.name}</a>{/each}</div>
        {/if}

        <div class="m-act">
          <button type="button" class="row-link" disabled={busy || !!m.supersededBy} onclick={() => act({ action: 'pin', id: m.id, pinned: !m.provenance?.pinned })}>{m.provenance?.pinned ? 'Unpin' : 'Pin'}</button>
          <button type="button" class="row-link" disabled={!!m.supersededBy} onclick={() => edit(m)}>Correct</button>
          <button type="button" class="row-link" onclick={() => toggleLinks(m.id)}>Entity links</button>
          <button type="button" class="row-link danger" disabled={busy} onclick={() => act({ action: 'forget', id: m.id })}>Forget</button>
          <span class="src">{source(m)}</span>
        </div>

        {#if linkTarget === m.id}
          <div class="linker">
            <div class="bar">
              <label class="field grow"><span class="sr-label-tight">Find entity</span>
                <input class="nm-text-input" bind:value={entityQuery} onkeydown={(e) => { if (e.key === 'Enter') findEntities(); }} /></label>
              <button type="button" class="nm-btn-ghost" onclick={findEntities}>Find</button>
            </div>
            <div class="chips">
              {#each entityResults as e (e.id)}
                <button type="button" class="chip" disabled={busy || m.entities.some((x) => x.id === e.id)}
                        onclick={() => relink(m, [...m.entities.map((x) => x.id), e.id])}>+ {e.name} <span class="quiet">{e.type}</span></button>
              {/each}
              {#each m.entities as e (e.id)}
                <button type="button" class="chip drop" onclick={() => relink(m, m.entities.filter((x) => x.id !== e.id).map((x) => x.id))}>− {e.name}</button>
              {/each}
            </div>
          </div>
        {/if}
      </article>
    {/each}
  </section>
</div>

<style>
  .wrap { max-width: 1100px; margin: 0 auto; padding: 24px 20px 64px; }

  /* One mono-label treatment for every small-caps label on the page. */
  .kicker, .when, .stat .l, .row-link, .tag {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.07em;
  }
  /* Not uppercased: this often holds a raw source id, which caps make unreadable. */
  .src { font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  .kicker, .when, .src, .stat .l { color: var(--text-ghost); }

  .page-hdr { padding-bottom: 16px; margin-bottom: 22px; border-bottom: 2px solid var(--text-primary); }
  .kicker { margin: 0 0 6px; }
  h1 { margin: 0 0 8px; font-family: var(--font-display); font-size: clamp(1.8rem, 4vw, 2.6rem); line-height: 1.05; }
  .sub { margin: 0; max-width: 62ch; font-size: var(--fs-body-sm); line-height: 1.55; color: var(--text-secondary); }
  .hdr-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; margin-top: 12px; }
  .note { margin: 10px 0 0; font-size: var(--fs-label); color: var(--success); }
  .note.failed { color: var(--error); }
  .empty { margin: 0; font-size: var(--fs-label); color: var(--text-ghost); }

  .stats { display: flex; flex-wrap: wrap; gap: 26px; margin-bottom: 24px; }
  .stat { display: flex; flex-direction: column; }
  .stat .n { font-family: var(--font-mono); font-size: 1.5rem; color: var(--text-primary); }
  .stat .n.pin { color: var(--accent); }
  .stat .n.old { color: var(--text-ghost); }

  .bar { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; }
  .field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .field.grow { flex: 1 1 260px; }
  textarea.nm-text-input { resize: vertical; line-height: 1.5; }
  /* .nm-select was never defined anywhere, so the picker was styled by nothing.
     A native select does not inherit the input chrome, so it is drawn here. */
  .select {
    appearance: none; padding-right: 26px;
    background: linear-gradient(45deg, transparent 50%, var(--text-muted) 50%) no-repeat right 12px center / 5px 5px,
                linear-gradient(135deg, var(--text-muted) 50%, transparent 50%) no-repeat right 7px center / 5px 5px,
                var(--surface-sunken);
  }

  .row-link { padding: 0; background: none; border: none; color: var(--accent); text-decoration: none; cursor: pointer; }
  .row-link:hover:not(:disabled) { color: var(--accent-hover); }
  .row-link.danger { color: var(--error); }
  .row-link:disabled { color: var(--text-ghost); cursor: default; }

  .mem {
    display: flex; flex-direction: column; gap: 7px;
    padding: 12px 14px 13px; margin-bottom: 10px;
    background: var(--card-bg); border: 1px solid var(--line-strong);
    border-left: 3px solid var(--line-strong); border-radius: var(--radius-sharp);
  }
  /* Pinned is the one distinction the page exists to make, so it is the only
     thing that moves a row's edge. */
  .mem:has(.tag.pin) { border-left-color: var(--accent); }
  .mem.old { opacity: 0.6; border-left-style: dashed; }

  .m-hd { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .tag, .ent, .chip { padding: 2px 7px; border: 1px solid var(--line-hair); border-radius: var(--radius-sharp); }
  .tag { color: var(--text-muted); border-color: var(--line-strong); }
  .tag.cat { color: var(--text-primary); border-color: var(--text-primary); }
  /* Petrol, not green — the counter-accent stays separable from the burnt-orange
     pin under every colour-vision deficiency. */
  .tag.stated { color: var(--accent-ink); border-color: var(--accent-ink); }
  .tag.pin { color: var(--accent); border-color: var(--accent); }
  .tag.quiet { color: var(--text-ghost); border-color: var(--line-hair); }
  .when, .src { margin-left: auto; }

  .body { margin: 0; font-size: var(--fs-body-sm); line-height: 1.55; color: var(--text-primary); overflow-wrap: anywhere; }
  .why { margin: 0; font-size: var(--fs-label); color: var(--text-muted); overflow-wrap: anywhere; }

  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .ent, .chip { font-family: var(--font-mono); font-size: var(--fs-label-xs); background: none; text-decoration: none; cursor: pointer; }
  .ent { color: var(--accent-ink); }
  .ent:hover { border-color: var(--accent-ink); background: var(--accent-tint-08); }
  .chip { color: var(--text-secondary); border-color: var(--line-strong); }
  .chip:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .chip.drop:hover { border-color: var(--error); color: var(--error); }
  .chip:disabled { opacity: 0.5; cursor: default; }
  .quiet { color: var(--text-ghost); }

  .m-act { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; padding-top: 8px; border-top: 1px solid var(--line-hair); }
  .linker {
    display: flex; flex-direction: column; gap: 10px; padding: 11px;
    background: var(--surface-sunken); border: 1px solid var(--line-hair); border-radius: var(--radius-sharp);
  }

  @media (max-width: 640px) {
    .wrap { padding: 18px 14px 48px; }
    .when, .src { margin-left: 0; }
  }
</style>
