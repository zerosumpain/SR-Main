<script lang="ts">
  import { author } from '../../lib/author/authorState.svelte';
  import { docToMarkdown, htmlToText } from '../../lib/author/serialize';

  let snapName = $state('');
  let importError = $state('');
  let fileInput: HTMLInputElement | undefined = $state();

  function download(name: string, blob: Blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }
  const slug = () => author.doc.title.replace(/\W+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'education-strategy';

  function exportMd() {
    download(`${slug()}.md`, new Blob([docToMarkdown(author.doc)], { type: 'text/markdown' }));
  }
  async function exportDocx() {
    try {
      const res = await fetch('/projects/dfe-data-strategy/synth?export=docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: docToMarkdown(author.doc), title: author.doc.title }),
      });
      if (!res.ok) throw new Error();
      download(`${slug()}.docx`, await res.blob());
    } catch {
      exportMd(); // docx export is owner-only server-side; fall back to markdown
    }
  }
  function exportJson() {
    const payload = { kind: 'keystone-strategy', version: 1, doc: $state.snapshot(author.doc), plan: { milestones: $state.snapshot(author.milestones), risks: $state.snapshot(author.risks), measures: $state.snapshot(author.measures) } };
    download(`${slug()}.json`, new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  }
  async function importJson(e: Event) {
    importError = '';
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const p = JSON.parse(await file.text());
      if (p?.kind !== 'keystone-strategy' || !p?.doc?.sections) throw new Error('Not a Keystone strategy file.');
      if (!author.importDoc(p.doc)) throw new Error('No usable sections in the file.');
      if (Array.isArray(p?.plan?.milestones)) author.milestones = p.plan.milestones;
      if (Array.isArray(p?.plan?.risks)) author.risks = p.plan.risks;
      if (Array.isArray(p?.plan?.measures)) author.measures = p.plan.measures;
    } catch (err: any) {
      importError = err?.message ?? 'Import failed.';
    } finally {
      if (fileInput) fileInput.value = '';
    }
  }

  function wordDelta(snapDoc: typeof author.doc): string {
    const count = (d: typeof author.doc) => d.sections.reduce((n, s) => n + (htmlToText(s.html).split(/\s+/).filter(Boolean).length || 0), 0);
    const d = count(author.doc) - count(snapDoc);
    return d === 0 ? '±0 words vs now' : d > 0 ? `−${d} words vs now` : `+${-d} words vs now`;
  }
  function takeSnap() {
    author.takeSnapshot(snapName);
    snapName = '';
  }
</script>

<div class="xp">
  <div class="side">
    <section class="blk">
      <h3 class="xp-h">Download</h3>
      <div class="btns">
        <button class="dl" onclick={exportMd}>↓ Markdown (.md)</button>
        <button class="dl" onclick={exportDocx}>↓ Word (.docx)</button>
        <button class="dl" onclick={exportJson}>↓ Keystone file (.json)</button>
        <button class="dl ghost" onclick={() => window.print()}>⎙ Print / PDF</button>
      </div>
      <p class="note">The .json file carries the full document plus the roadmap, risks and measures — the way to move work between machines or share it with the team.</p>
      <label class="imp">
        Import a Keystone file
        <input type="file" accept="application/json,.json" bind:this={fileInput} onchange={importJson} />
      </label>
      {#if importError}<p class="err">{importError}</p>{/if}
    </section>

    <section class="blk">
      <h3 class="xp-h">Snapshots</h3>
      <div class="snaprow">
        <input class="in" placeholder="Name this version…" bind:value={snapName} onkeydown={(e) => e.key === 'Enter' && takeSnap()} />
        <button class="dl" onclick={takeSnap}>+ Save</button>
      </div>
      {#if author.snapshots.length}
        <ul class="snaps">
          {#each author.snapshots as s (s.id)}
            <li>
              <div class="s-meta">
                <b>{s.name}</b>
                <span>{new Date(s.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {wordDelta(s.doc)}</span>
              </div>
              <button class="s-op" onclick={() => confirm(`Replace the current draft with “${s.name}”?`) && author.restoreSnapshot(s.id)}>restore</button>
              <button class="s-op danger" onclick={() => author.deleteSnapshot(s.id)}>✕</button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="note">No snapshots yet — save one before big edits.</p>
      {/if}
    </section>
  </div>

  <section class="preview-wrap">
    <h3 class="xp-h">Preview <span class="pv-note">what the published document reads like</span></h3>
    <article class="preview">
      <h1>{author.doc.title}</h1>
      {#each author.doc.sections as s (s.id)}
        <h2>{s.title}</h2>
        {#if s.html.trim()}
          <!-- eslint-disable-next-line svelte/no-at-html-tags — html passes through sanitizeHtml on every write -->
          {@html s.html}
        {:else}
          <p class="pv-empty">Not written yet.</p>
        {/if}
      {/each}
    </article>
  </section>
</div>

<style>
  .xp {
    display: grid;
    grid-template-columns: 320px minmax(0, 1fr);
    gap: 20px;
    align-items: start;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 16px;
    position: sticky;
    top: calc(var(--topH, 90px) + 12px);
  }
  .blk {
    border: 1px solid rgba(28, 22, 17, 0.14);
    border-radius: var(--radius-sharp);
    background: rgba(255, 255, 255, 0.45);
    padding: 13px 16px;
  }
  .xp-h {
    margin: 0 0 10px;
    font-family: var(--fs-serif);
    font-size: var(--fs-body);
    font-weight: 600;
    color: var(--ink);
  }
  .btns {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .dl {
    font-family: var(--font-body);
    font-size: var(--fs-label);
    font-weight: 500;
    padding: 8px 13px;
    background: var(--ink);
    color: var(--paper, #f1ead6);
    border: none;
    border-radius: var(--radius-sharp);
    cursor: pointer;
    text-align: left;
  }
  .dl:hover {
    background: #000;
  }
  .dl.ghost {
    background: transparent;
    color: var(--ink);
    border: 1px solid rgba(28, 22, 17, 0.3);
  }
  .dl.ghost:hover {
    background: rgba(28, 22, 17, 0.06);
  }
  .note {
    margin: 9px 0 0;
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    color: rgba(28, 22, 17, 0.55);
  }
  .imp {
    display: block;
    margin-top: 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent-ink);
    cursor: pointer;
  }
  .imp input {
    display: block;
    margin-top: 4px;
    font-size: var(--fs-label-xs);
  }
  .err {
    margin: 6px 0 0;
    font-size: var(--fs-label-xs);
    color: var(--error, #a33);
  }
  .snaprow {
    display: flex;
    gap: 6px;
  }
  .in {
    flex: 1;
    font-family: var(--font-body);
    font-size: var(--fs-label-xs);
    padding: 6px 9px;
    border: 1px solid rgba(28, 22, 17, 0.25);
    border-radius: var(--radius-sharp);
    background: rgba(255, 255, 255, 0.7);
    color: var(--ink);
    min-width: 0;
  }
  .snaprow .dl {
    padding: 6px 12px;
  }
  .snaps {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .snaps li {
    display: flex;
    align-items: center;
    gap: 8px;
    border: 1px solid rgba(28, 22, 17, 0.13);
    border-radius: var(--radius-sharp);
    background: rgba(255, 255, 255, 0.5);
    padding: 6px 10px;
  }
  .s-meta {
    flex: 1;
    min-width: 0;
  }
  .s-meta b {
    display: block;
    font-size: var(--fs-label-xs);
    color: var(--ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .s-meta span {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: rgba(28, 22, 17, 0.5);
  }
  .s-op {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    padding: 3px 8px;
    background: transparent;
    border: 1px solid rgba(28, 22, 17, 0.25);
    border-radius: var(--radius-sharp);
    color: var(--ink);
    cursor: pointer;
  }
  .s-op:hover {
    background: rgba(28, 22, 17, 0.06);
  }
  .s-op.danger {
    color: var(--error, #a33);
  }

  .preview-wrap .pv-note {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(28, 22, 17, 0.45);
    margin-left: 8px;
  }
  .preview {
    border: 1px solid rgba(28, 22, 17, 0.16);
    border-radius: var(--radius-sharp);
    background: #fdfaf2;
    padding: 44px 52px 56px;
    max-width: 78ch;
    font-family: var(--font-body);
    font-size: var(--fs-nav);
    line-height: 1.65;
    color: var(--ink);
  }
  .preview h1 {
    font-family: var(--fs-serif);
    font-size: 30px;
    font-weight: 600;
    letter-spacing: -0.02em;
    margin: 0 0 20px;
    padding-bottom: 14px;
    border-bottom: 3px solid var(--ink);
  }
  .preview h2 {
    font-family: var(--fs-serif);
    font-size: 21px;
    font-weight: 600;
    margin: 30px 0 8px;
  }
  .preview :global(h3) {
    font-family: var(--fs-serif);
    font-size: 16.5px;
    font-weight: 600;
    margin: 18px 0 5px;
  }
  .preview :global(h4) {
    font-family: var(--fs-serif);
    font-size: var(--fs-nav);
    font-weight: 600;
    margin: 14px 0 4px;
  }
  .preview :global(p) {
    margin: 0 0 10px;
  }
  .preview :global(ul),
  .preview :global(ol) {
    margin: 0 0 10px;
    padding-left: 22px;
  }
  .preview :global(blockquote) {
    margin: 10px 0;
    padding: 6px 14px;
    border-left: 3px solid var(--accent-ink);
    background: var(--accent-ink-tint-06);
  }
  .preview :global(a) {
    color: var(--accent-ink);
  }
  .pv-empty {
    color: rgba(28, 22, 17, 0.35);
    font-style: italic;
  }
  @media (max-width: 1000px) {
    .xp {
      grid-template-columns: 1fr;
    }
    .side {
      position: static;
    }
    .preview {
      padding: 26px 22px 34px;
    }
  }
  @media print {
    .side,
    .xp-h {
      display: none;
    }
    .preview {
      border: none;
      background: #fff;
      padding: 0;
      max-width: none;
    }
  }
</style>
