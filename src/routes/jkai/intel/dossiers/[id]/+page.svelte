<script lang="ts">
  // One case file.
  //
  // A dossier is a WORKING SET, not a report: the entities, notes, findings and
  // half-formed thoughts belonging to one line of enquiry, in the order the
  // analyst put them. Everything here is therefore editable in place and
  // reordered by hand — and the brief is generated across the whole pinned set
  // rather than one entity at a time, because the case is the unit of enquiry.
  //
  // Mutations return the freshly hydrated item list, so the page never has to
  // guess what the server did.

  import PageHeader from '$lib/components/PageHeader.svelte';
  import ChatMarkdown from '$lib/canvas/ChatMarkdown.svelte';
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  type Item = PageData['items'][number];
  type Dossier = PageData['dossier'];

  interface Citation {
    n: number;
    noteId: string;
    title: string;
    source: string;
    createdAt: string;
    href: string;
    sourceUrl: string | null;
    used: boolean;
  }
  interface Brief {
    markdown: string;
    citations: Citation[];
    droppedMarkers: number[];
    title: string;
    generatedAt: string;
    sourceCount: number;
    neighbourCount: number;
  }

  interface EntityHit {
    id: string;
    name: string;
    typeName: string;
    typeIcon: string;
    summary: string | null;
  }
  interface NoteHit {
    id: string;
    title: string | null;
    source: string;
    createdAt: string;
    snippet: string | null;
  }

  // Seeded from the loader ONCE, deliberately — everything below is edited in
  // place and re-synced from mutation responses. `untrack` says so, and stops
  // the initialiser being read as a live binding to `data`.
  let dossier = $state<Dossier>(untrack(() => ({ ...data.dossier })));
  let items = $state<Item[]>(untrack(() => [...data.items]));

  let busy = $state(false);
  let toast = $state<string | null>(null);

  let editingTitle = $state(false);
  let titleDraft = $state(untrack(() => data.dossier.title));
  let summaryDraft = $state(untrack(() => data.dossier.summary ?? ''));
  let questionDraft = $state('');
  let noteDraft = $state('');
  let editingItemId = $state<string | null>(null);
  let itemDraft = $state('');

  let searchText = $state('');
  let entityHits = $state<EntityHit[]>([]);
  let noteHits = $state<NoteHit[]>([]);

  let brief = $state<Brief | null>(null);
  let briefBusy = $state(false);
  let briefError = $state<string | null>(null);

  // Plain handles, never $state — a timer a helper both reads and clears would
  // subscribe any effect that calls it to its own write.
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  // Only the loader's payload is read reactively; the writes are untracked so
  // reassigning them cannot re-arm the effect that produced them.
  $effect(() => {
    const incoming = data;
    untrack(() => {
      if (incoming.dossier.id === dossier.id) return;
      dossier = { ...incoming.dossier };
      items = [...incoming.items];
      brief = null;
      titleDraft = incoming.dossier.title;
      summaryDraft = incoming.dossier.summary ?? '';
    });
  });

  const pinnedRefIds = $derived(new Set(items.map((i) => i.refId).filter(Boolean) as string[]));
  const entityCount = $derived(items.filter((i) => i.kind === 'entity').length);

  function notify(message: string) {
    toast = message;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), 3200);
  }

  async function send(path: string, method: string, body?: unknown): Promise<any> {
    const res = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.text()).slice(0, 240) || `HTTP ${res.status}`);
    return res.json();
  }

  async function patchDossier(fields: Record<string, unknown>) {
    if (busy) return;
    busy = true;
    try {
      const out = await send(`/api/jkai/intel/dossiers/${dossier.id}`, 'PATCH', fields);
      dossier = out.dossier;
      titleDraft = dossier.title;
      summaryDraft = dossier.summary ?? '';
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Save failed');
    } finally {
      busy = false;
    }
  }

  async function itemAction(body: Record<string, unknown>, message?: string) {
    if (busy) return;
    busy = true;
    try {
      const out = await send(`/api/jkai/intel/dossiers/${dossier.id}`, 'POST', body);
      items = out.items ?? items;
      if (out.duplicate) notify('Already pinned');
      else if (message) notify(message);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Action failed');
    } finally {
      busy = false;
    }
  }

  function saveTitle() {
    editingTitle = false;
    const next = titleDraft.trim();
    if (!next || next === dossier.title) {
      titleDraft = dossier.title;
      return;
    }
    patchDossier({ title: next });
  }

  function saveSummary() {
    if (summaryDraft === (dossier.summary ?? '')) return;
    patchDossier({ summary: summaryDraft.trim() || null });
  }

  function addQuestion(event: SubmitEvent) {
    event.preventDefault();
    const q = questionDraft.trim();
    if (!q) return;
    questionDraft = '';
    patchDossier({ openQuestions: [...dossier.openQuestions, q] });
  }

  function removeQuestion(index: number) {
    patchDossier({ openQuestions: dossier.openQuestions.filter((_, i) => i !== index) });
  }

  function addText(event: SubmitEvent) {
    event.preventDefault();
    const body = noteDraft.trim();
    if (!body) return;
    noteDraft = '';
    itemAction({ action: 'add', kind: 'text', body }, 'Note added');
  }

  function startEditItem(item: Item) {
    editingItemId = item.id;
    itemDraft = item.body ?? '';
  }

  async function saveItem() {
    const id = editingItemId;
    const body = itemDraft.trim();
    editingItemId = null;
    if (!id || !body) return;
    await itemAction({ action: 'update', itemId: id, body });
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const order = items.map((i) => i.id);
    [order[index], order[target]] = [order[target], order[index]];
    itemAction({ action: 'reorder', itemIds: order });
  }

  function onSearchInput(value: string) {
    searchText = value;
    if (searchTimer) clearTimeout(searchTimer);
    const q = value.trim();
    if (q.length < 2) {
      entityHits = [];
      noteHits = [];
      return;
    }
    searchTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/jkai/intel/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) return;
        const out = (await res.json()) as { entities: EntityHit[]; notes: NoteHit[] };
        entityHits = (out.entities ?? []).slice(0, 8);
        noteHits = (out.notes ?? []).slice(0, 6);
      } catch {
        // A failed lookup is not worth a toast; the box simply stays empty.
      }
    }, 240);
  }

  async function generateBrief() {
    if (briefBusy) return;
    briefBusy = true;
    briefError = null;
    try {
      const res = await fetch('/api/jkai/intel/brief', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dossierId: dossier.id }),
      });
      if (!res.ok) throw new Error((await res.text()).slice(0, 240) || `HTTP ${res.status}`);
      brief = (await res.json()) as Brief;
    } catch (err) {
      briefError = err instanceof Error ? err.message : 'Brief generation failed';
    } finally {
      briefBusy = false;
    }
  }

  /**
   * Built from the brief already on screen rather than re-requesting `format=md`
   * — the download is a copy of what was read, and re-generating would spend a
   * second model call producing a subtly different document.
   */
  function downloadBrief() {
    if (!brief) return;
    const lines = [
      `# ${brief.title}`,
      '',
      `_Brief generated ${brief.generatedAt.slice(0, 10)} from ${brief.sourceCount} source${brief.sourceCount === 1 ? '' : 's'}._`,
      '',
      brief.markdown.trim(),
    ];
    if (brief.citations.length) {
      lines.push('', '## Sources', '');
      for (const c of brief.citations) {
        lines.push(`${c.n}. ${c.title} — ${c.source}, ${c.createdAt.slice(0, 10)} — ${c.sourceUrl ?? c.href}`);
      }
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `brief-${dossier.slug}-${brief.generatedAt.slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function removeDossier() {
    if (!confirm(`Delete “${dossier.title}”? Everything pinned to it goes too.`)) return;
    try {
      await send(`/api/jkai/intel/dossiers/${dossier.id}`, 'DELETE');
      await goto('/jkai/intel/dossiers');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Delete failed');
    }
  }
</script>

<PageHeader title="INTEL / DOSSIER" titleHref="/jkai/intel/dossiers" />

<div class="wrap">
  <header class="top">
    {#if editingTitle}
      <input
        class="titleinput"
        bind:value={titleDraft}
        aria-label="Dossier title"
        maxlength="200"
        onblur={saveTitle}
        onkeydown={(e) => {
          if (e.key === 'Enter') saveTitle();
          if (e.key === 'Escape') {
            titleDraft = dossier.title;
            editingTitle = false;
          }
        }}
      />
    {:else}
      <h1><button type="button" class="titlebtn" onclick={() => (editingTitle = true)}>{dossier.title}</button></h1>
    {/if}

    <div class="topacts">
      <label class="ctl">
        Status
        <select
          value={dossier.status}
          disabled={busy}
          onchange={(e) => patchDossier({ status: e.currentTarget.value })}
        >
          <option value="open">open</option>
          <option value="parked">parked</option>
          <option value="closed">closed</option>
        </select>
      </label>
      <button type="button" class="danger" onclick={removeDossier}>Delete</button>
    </div>
  </header>

  <div class="cols">
    <div class="col">
      <section class="panel">
        <h2 class="plabel">Summary</h2>
        <textarea
          class="summary"
          rows="3"
          placeholder="What is this enquiry about?"
          bind:value={summaryDraft}
          onblur={saveSummary}
        ></textarea>
      </section>

      <section class="panel">
        <h2 class="plabel">Open questions <b>{dossier.openQuestions.length}</b></h2>
        {#if dossier.openQuestions.length}
          <ul class="questions">
            {#each dossier.openQuestions as q, i (q + i)}
              <li>
                <span>{q}</span>
                <button type="button" class="ghost x" disabled={busy} onclick={() => removeQuestion(i)} aria-label="Remove question">✕</button>
              </li>
            {/each}
          </ul>
        {/if}
        <form class="inline" onsubmit={addQuestion}>
          <input type="text" placeholder="What do you still need to know?" bind:value={questionDraft} maxlength="400" />
          <button type="submit" disabled={busy || !questionDraft.trim()}>Add</button>
        </form>
      </section>

      <section class="panel">
        <h2 class="plabel">Pinned <b>{items.length}</b></h2>
        {#if !items.length}
          <p class="none">Nothing pinned yet. Search below for the entities and notes this enquiry rests on.</p>
        {:else}
          <ul class="items">
            {#each items as item, i (item.id)}
              <li class="item" class:missing={item.kind !== 'text' && !item.label}>
                <span class="pos">{i + 1}</span>
                <span class="ico">{item.icon ?? '·'}</span>
                <div class="ibody">
                  {#if item.kind === 'text' && editingItemId === item.id}
                    <textarea
                      class="itemedit"
                      rows="3"
                      bind:value={itemDraft}
                      onblur={saveItem}
                    ></textarea>
                  {:else if item.kind === 'text'}
                    <button type="button" class="textbtn" onclick={() => startEditItem(item)}>{item.body}</button>
                    <span class="kind">analyst note</span>
                  {:else if item.label}
                    <a class="ilabel" href={item.href ?? '#'}>{item.label}</a>
                    <span class="kind">
                      {item.kind}
                      {#if item.meta.typeName}· {item.meta.typeName}{/if}
                      {#if item.kind === 'entity'}· {item.meta.connectionCount} connection{item.meta.connectionCount === 1 ? '' : 's'}{/if}
                      {#if item.kind === 'entity' && !item.meta.confirmed}· unconfirmed{/if}
                      {#if item.kind === 'note' && item.meta.source}· {item.meta.source}{/if}
                      {#if item.kind === 'insight' && item.meta.score != null}· score {Number(item.meta.score).toFixed(2)}{/if}
                    </span>
                    {#if item.detail}<span class="idetail">{item.detail}</span>{/if}
                  {:else}
                    <span class="ilabel">Missing {item.kind}</span>
                    <span class="kind">the thing this pin pointed at is gone</span>
                  {/if}
                </div>
                <div class="rowacts">
                  <button type="button" class="ghost" disabled={busy || i === 0} onclick={() => move(i, -1)} aria-label="Move up">↑</button>
                  <button type="button" class="ghost" disabled={busy || i === items.length - 1} onclick={() => move(i, 1)} aria-label="Move down">↓</button>
                  <button type="button" class="ghost x" disabled={busy} onclick={() => itemAction({ action: 'remove', itemId: item.id }, 'Unpinned')} aria-label="Unpin">✕</button>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section class="panel">
        <h2 class="plabel">Pin something</h2>
        <input
          class="search"
          type="search"
          placeholder="Search entities and notes"
          aria-label="Search the graph"
          value={searchText}
          oninput={(e) => onSearchInput(e.currentTarget.value)}
        />

        {#if entityHits.length}
          <p class="hlabel">Entities</p>
          <ul class="hits">
            {#each entityHits as hit (hit.id)}
              <li>
                <span class="ico">{hit.typeIcon}</span>
                <span class="hname">{hit.name}<span class="kind">{hit.typeName}</span></span>
                <button
                  type="button"
                  disabled={busy || pinnedRefIds.has(hit.id)}
                  onclick={() => itemAction({ action: 'add', kind: 'entity', refId: hit.id }, 'Pinned')}
                >{pinnedRefIds.has(hit.id) ? 'Pinned' : 'Pin'}</button>
              </li>
            {/each}
          </ul>
        {/if}

        {#if noteHits.length}
          <p class="hlabel">Notes</p>
          <ul class="hits">
            {#each noteHits as hit (hit.id)}
              <li>
                <span class="ico">📄</span>
                <span class="hname">{hit.title ?? 'Untitled note'}<span class="kind">{hit.source}</span></span>
                <button
                  type="button"
                  disabled={busy || pinnedRefIds.has(hit.id)}
                  onclick={() => itemAction({ action: 'add', kind: 'note', refId: hit.id }, 'Pinned')}
                >{pinnedRefIds.has(hit.id) ? 'Pinned' : 'Pin'}</button>
              </li>
            {/each}
          </ul>
        {/if}

        <form class="inline stack" onsubmit={addText}>
          <textarea rows="2" placeholder="Or write your own note into the case file" bind:value={noteDraft}></textarea>
          <button type="submit" disabled={busy || !noteDraft.trim()}>Add note</button>
        </form>
      </section>
    </div>

    <div class="col">
      <section class="panel">
        <h2 class="plabel">Brief</h2>
        <p class="none">
          One cited page across every entity pinned here. Each [n] maps to a note you can open.
        </p>
        <div class="briefacts">
          <button type="button" class="primary" disabled={briefBusy || entityCount === 0} onclick={generateBrief}>
            {briefBusy ? 'Assembling…' : brief ? 'Regenerate' : 'Generate brief'}
          </button>
          {#if brief}
            <button type="button" onclick={downloadBrief}>Download .md</button>
          {/if}
        </div>
        {#if entityCount === 0}
          <p class="warnline">Pin at least one entity — a brief is assembled from the graph around them.</p>
        {/if}
        {#if briefError}
          <p class="errline">{briefError}</p>
        {/if}
      </section>

      {#if brief}
        <section class="panel">
          <h2 class="plabel">
            {brief.title}
            <b>{brief.sourceCount} source{brief.sourceCount === 1 ? '' : 's'}</b>
          </h2>
          {#if brief.droppedMarkers.length}
            <p class="warnline">
              Removed {brief.droppedMarkers.length} citation marker{brief.droppedMarkers.length === 1 ? '' : 's'}
              pointing at sources that do not exist.
            </p>
          {/if}
          <div class="briefbody"><ChatMarkdown content={brief.markdown} /></div>

          {#if brief.citations.length}
            <h3 class="plabel sources">Sources</h3>
            <ol class="cites">
              {#each brief.citations as c (c.n)}
                <li class:unused={!c.used}>
                  <span class="cn">[{c.n}]</span>
                  <a href={c.href}>{c.title}</a>
                  <span class="kind">{c.source} · {c.createdAt.slice(0, 10)}{c.used ? '' : ' · not cited'}</span>
                </li>
              {/each}
            </ol>
          {/if}
        </section>
      {/if}
    </div>
  </div>
</div>

{#if toast}<div class="toast">{toast}</div>{/if}

<style>
  .wrap {
    padding: 16px 20px 40px;
    max-width: 1280px;
    margin: 0 auto;
  }

  .top {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    padding-bottom: 12px;
    margin-bottom: 14px;
    border-bottom: 1px solid var(--divider);
  }
  h1 {
    margin: 0;
    min-width: 0;
    flex: 1;
  }
  .titlebtn {
    font-family: var(--font-display);
    font-size: 20px;
    text-transform: none;
    letter-spacing: 0;
    padding: 2px 4px;
    margin-left: -4px;
    border-color: transparent;
    color: var(--text-primary);
    text-align: left;
  }
  .titleinput {
    flex: 1;
    font-family: var(--font-display);
    font-size: 20px;
    padding: 3px 6px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--accent-tint-35);
    border-radius: var(--radius-sharp);
  }
  .topacts {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .cols {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 420px);
    gap: 14px;
    align-items: start;
  }
  @media (max-width: 900px) {
    .cols {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }

  .panel {
    padding: 12px;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-round);
  }
  .plabel,
  .hlabel,
  .kind,
  .ctl {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
  }
  .plabel {
    margin: 0 0 8px;
  }
  .plabel b {
    font-weight: 500;
    color: var(--text-muted);
    margin-left: 4px;
  }
  .plabel.sources {
    margin-top: 14px;
    padding-top: 10px;
    border-top: 1px solid var(--divider);
  }
  .hlabel {
    margin: 10px 0 4px;
  }
  .ctl {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  input[type='text'],
  input[type='search'],
  textarea,
  select {
    width: 100%;
    padding: 7px 9px;
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    resize: vertical;
  }
  select {
    width: auto;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    padding: 5px 7px;
  }
  .summary {
    line-height: 1.55;
  }

  .inline {
    display: flex;
    gap: 6px;
    align-items: flex-start;
    margin-top: 8px;
  }
  .inline.stack {
    flex-direction: column;
    align-items: stretch;
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--divider);
  }
  .inline.stack button {
    align-self: flex-start;
  }

  ul,
  ol {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .questions li {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 4px 0;
    font-size: var(--fs-body-sm);
    border-bottom: 1px solid var(--divider);
  }
  .questions li span {
    flex: 1;
    min-width: 0;
  }

  .items {
    display: flex;
    flex-direction: column;
  }
  .item {
    display: grid;
    grid-template-columns: 20px 18px minmax(0, 1fr) auto;
    gap: 8px;
    align-items: start;
    padding: 8px 0;
    border-bottom: 1px solid var(--divider);
  }
  .item:last-child {
    border-bottom: 0;
  }
  .item.missing {
    opacity: 0.55;
  }
  .pos {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    padding-top: 2px;
  }
  .ico {
    font-size: 13px;
    line-height: 1.4;
  }
  .ibody {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .ilabel {
    font-size: var(--fs-body-sm);
    font-weight: 500;
    color: var(--text-primary);
    text-decoration: none;
    transition: color var(--t-fast) var(--ease-out);
  }
  a.ilabel:hover {
    color: var(--accent);
  }
  .idetail {
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .textbtn {
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    text-transform: none;
    letter-spacing: 0;
    text-align: left;
    white-space: pre-wrap;
    padding: 0;
    border-color: transparent;
    color: var(--text-primary);
    line-height: 1.5;
  }
  .itemedit {
    font-size: var(--fs-body-sm);
  }
  .rowacts {
    display: flex;
    gap: 2px;
  }

  .hits li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 0;
    border-bottom: 1px solid var(--divider);
  }
  .hname {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    font-size: var(--fs-body-sm);
  }

  .briefacts {
    display: flex;
    gap: 6px;
    margin-top: 10px;
  }
  .briefbody {
    padding-top: 4px;
  }
  .cites li {
    padding: 5px 0;
    border-bottom: 1px solid var(--divider);
    display: flex;
    flex-direction: column;
    gap: 1px;
    font-size: var(--fs-body-sm);
  }
  .cn {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent);
  }
  .cites li.unused {
    opacity: 0.55;
  }
  .cites a {
    color: var(--text-primary);
    text-decoration: none;
  }
  .cites a:hover {
    color: var(--accent);
  }

  button {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 6px 11px;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    border-color: var(--accent-tint-35);
    color: var(--accent);
  }
  button.primary {
    border-color: var(--accent-tint-35);
    background: var(--accent-tint-08);
    color: var(--accent);
  }
  button.ghost {
    border-color: transparent;
    color: var(--text-ghost);
    padding: 4px 6px;
  }
  button.danger {
    border-color: var(--error-border);
    color: var(--error);
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .none {
    font-size: var(--fs-label);
    color: var(--text-ghost);
    line-height: 1.55;
    margin: 0;
  }
  .warnline {
    margin: 8px 0 0;
    font-size: var(--fs-label-xs);
    color: var(--warn);
  }
  .errline {
    margin: 8px 0 0;
    font-size: var(--fs-label-xs);
    color: var(--error);
  }

  .toast {
    position: fixed;
    bottom: 18px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 140;
    /* Floats over the page — must be opaque. */
    background: var(--surface-elevated);
    border: 1px solid var(--accent-tint-35);
    border-radius: var(--radius-round);
    padding: 9px 16px;
    font-size: var(--fs-label);
  }
</style>
