<script lang="ts">
  // Site-media picker — browse what the site can put on a slide and insert it
  // as a ready-made block. Four tabs: registered interactives (with scenario
  // staging), curated pages, static images, and a live browse-the-site frame
  // whose current page can be inserted (same-origin, so the address is
  // readable). Parent mounts via {#if open}; panel is opaque per the modal
  // token rules; local portal action (NOT $lib/canvas/portal — its destroy
  // re-appends).
  import type { MediaCatalogue } from '$lib/presentation/site-media';
  import type { Block } from '$lib/presentation/types';

  let {
    catalogue,
    onInsert,
    onClose,
  }: {
    catalogue: MediaCatalogue;
    onInsert: (block: Block) => void;
    onClose: () => void;
  } = $props();

  type Tab = 'interactives' | 'pages' | 'images' | 'find' | 'generate' | 'upload' | 'browse';
  let tab = $state<Tab>('interactives');

  interface Candidate {
    title: string;
    creator: string | null;
    license: string;
    source: string;
    pageUrl: string;
    thumbUrl: string;
    imageUrl: string;
  }

  // Interactives
  let embedId = $state(catalogue.interactives[0]?.embed ?? '');
  let scenarioId = $state('');
  let autoplay = $state(true);
  const activeInteractive = $derived(catalogue.interactives.find((i) => i.embed === embedId));
  const scenarioGroups = $derived(
    [...new Set((activeInteractive?.scenarios ?? []).map((s) => s.group))].map((g) => ({
      group: g,
      items: (activeInteractive?.scenarios ?? []).filter((s) => s.group === g),
    })),
  );

  // Pages
  let pagePath = $state(catalogue.pages[0]?.path ?? '/');
  let pageTitle = $state(catalogue.pages[0]?.title ?? 'Page');
  let pageHeight = $state(560);

  // Images
  let imageSrc = $state('');
  let imageAlt = $state('');
  let imageUrlInput = $state('');

  // Find (open-licence providers)
  let findQuery = $state('');
  let findResults = $state<Candidate[]>([]);
  let findBusy = $state(false);
  let findError = $state('');
  let selectedCandidate = $state<Candidate | null>(null);
  let importing = $state(false);

  // Generate (pollinations.ai)
  let genPrompt = $state('');
  let genBusy = $state(false);
  let genError = $state('');
  let genResult = $state<{ src: string; alt: string; caption: string } | null>(null);

  // Upload (own files — images become image blocks, mp4/webm video blocks)
  let upBusy = $state(false);
  let upError = $state('');
  let upDragging = $state(false);
  let upResult = $state<{ src: string; alt: string; kind: 'image' | 'video' } | null>(null);
  let fileInput: HTMLInputElement | undefined; // plain render handle

  async function uploadFile(file: File) {
    if (upBusy) return;
    upBusy = true;
    upError = '';
    upResult = null;
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/decks/media/upload', { method: 'POST', body: fd });
      const payload = (await res.json()) as { src?: string; alt?: string; kind?: 'image' | 'video'; error?: string };
      if (!res.ok || !payload.src) throw new Error(payload.error ?? res.statusText);
      upResult = { src: payload.src, alt: payload.alt ?? 'Uploaded media', kind: payload.kind ?? 'image' };
    } catch (err) {
      upError = err instanceof Error ? err.message : 'upload failed';
    } finally {
      upBusy = false;
    }
  }

  function insertUpload() {
    if (!upResult) return;
    if (upResult.kind === 'video') onInsert({ type: 'video', src: upResult.src });
    else onInsert({ type: 'image', src: upResult.src, alt: upResult.alt });
  }

  async function runFind() {
    const q = findQuery.trim();
    if (q.length < 2) return;
    findBusy = true;
    findError = '';
    selectedCandidate = null;
    try {
      const res = await fetch(`/api/decks/media/search?q=${encodeURIComponent(q)}`);
      const payload = (await res.json()) as { results?: Candidate[]; error?: string };
      if (!res.ok) throw new Error(payload.error ?? res.statusText);
      findResults = payload.results ?? [];
      if (!findResults.length) findError = 'Nothing found — try broader words.';
    } catch (err) {
      findError = err instanceof Error ? err.message : 'search failed';
    } finally {
      findBusy = false;
    }
  }

  async function importSelected() {
    if (!selectedCandidate || importing) return;
    importing = true;
    findError = '';
    try {
      const res = await fetch('/api/decks/media/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(selectedCandidate),
      });
      const payload = (await res.json()) as { src?: string; alt?: string; caption?: string; error?: string };
      if (!res.ok || !payload.src) throw new Error(payload.error ?? res.statusText);
      onInsert({ type: 'image', src: payload.src, alt: payload.alt ?? 'Image', caption: payload.caption });
    } catch (err) {
      findError = err instanceof Error ? err.message : 'import failed';
    } finally {
      importing = false;
    }
  }

  async function runGenerate() {
    const prompt = genPrompt.trim();
    if (prompt.length < 3 || genBusy) return;
    genBusy = true;
    genError = '';
    genResult = null;
    try {
      const res = await fetch('/api/decks/media/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const payload = (await res.json()) as { src?: string; alt?: string; caption?: string; error?: string };
      if (!res.ok || !payload.src) throw new Error(payload.error ?? res.statusText);
      genResult = { src: payload.src, alt: payload.alt ?? prompt, caption: payload.caption ?? '' };
    } catch (err) {
      genError = err instanceof Error ? err.message : 'generation failed';
    } finally {
      genBusy = false;
    }
  }

  // Browse. frameEl is an internal handle — plain let, never $state
  // (nothing reactive reads it; see svelte5-pitfalls §1).
  let browseInput = $state('/');
  let frameEl: HTMLIFrameElement | null = null;
  let frameSrc = $state('/');
  let framePath = $state('/');
  let frameTitle = $state('');

  function go() {
    const p = browseInput.trim();
    frameSrc = /^\/(?!\/|\\)/.test(p) ? p : '/';
  }

  function readFrame(syncInput = false) {
    try {
      const win = frameEl?.contentWindow;
      if (!win) return;
      framePath = win.location.pathname + win.location.search;
      frameTitle = win.document?.title?.split('—')[0]?.trim() || framePath;
      if (syncInput) browseInput = framePath;
    } catch {
      framePath = frameSrc; // cross-origin fallback (shouldn't happen — site-relative only)
    }
  }

  // In-frame SvelteKit navigation is client-side — no load event fires — so
  // poll the (same-origin) frame location while the browse tab is showing.
  // Never syncs the address input mid-poll: the user may be typing there.
  $effect(() => {
    if (tab !== 'browse') return;
    const t = setInterval(() => readFrame(false), 600);
    return () => clearInterval(t);
  });

  function insertInteractive() {
    if (!activeInteractive) return;
    const config: Record<string, unknown> = {};
    if (scenarioId) {
      config.scenario = scenarioId;
      config.autoplay = autoplay;
    }
    onInsert({ type: 'embed', embed: activeInteractive.embed, config });
  }

  function insertPage(path: string, title: string) {
    onInsert({ type: 'iframe', src: path, title, height: pageHeight });
  }

  function insertImage() {
    const src = imageSrc || imageUrlInput.trim();
    if (!src) return;
    onInsert({ type: 'image', src, alt: imageAlt.trim() || 'Image' });
  }

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'interactives', label: 'INTERACTIVES' },
    { id: 'pages', label: 'PAGES' },
    { id: 'images', label: 'IMAGES' },
    { id: 'find', label: 'FIND IMAGES' },
    { id: 'generate', label: 'GENERATE' },
    { id: 'upload', label: 'UPLOAD' },
    { id: 'browse', label: 'BROWSE SITE' },
  ];
</script>

<svelte:window onkeydown={onKeydown} />

<div class="smp-backdrop" use:portal role="presentation" onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
  <div class="smp" role="dialog" aria-modal="true" aria-label="Insert site media">
    <header class="smp-hd">
      <span class="smp-title">INSERT FROM SITE</span>
      <nav class="smp-tabs">
        {#each TABS as t (t.id)}
          <button class:active={tab === t.id} onclick={() => (tab = t.id)}>{t.label}</button>
        {/each}
      </nav>
      <button class="smp-x" onclick={onClose} aria-label="Close">✕</button>
    </header>

    {#if tab === 'interactives'}
      <div class="smp-body two-col">
        <div class="col">
          <span class="lab">INTERACTIVE</span>
          {#each catalogue.interactives as it (it.embed)}
            <button class="row" class:sel={embedId === it.embed} onclick={() => (embedId = it.embed)}>
              <strong>{it.label}</strong>
              <span class="row-note">{it.doc}</span>
            </button>
          {/each}
          {#if activeInteractive?.scenarios.length}
            <span class="lab">STAGE A SCENARIO (optional)</span>
            <select bind:value={scenarioId} size="8" class="scenario-list">
              <option value="">— none: open at rest —</option>
              {#each scenarioGroups as g (g.group)}
                <optgroup label={g.group}>
                  {#each g.items as s (s.id)}<option value={s.id}>{s.title}</option>{/each}
                </optgroup>
              {/each}
            </select>
            <label class="check"><input type="checkbox" bind:checked={autoplay} /> auto-run when the slide opens</label>
          {/if}
        </div>
        <div class="col preview-col">
          <span class="lab">PREVIEW</span>
          <div class="int-preview">
            <span class="int-glyph">◈</span>
            <span>{activeInteractive?.label}</span>
            {#if scenarioId}<span class="int-scenario">▶ {activeInteractive?.scenarios.find((s) => s.id === scenarioId)?.title}</span>{/if}
          </div>
          <button class="insert" onclick={insertInteractive}>insert interactive</button>
        </div>
      </div>
    {:else if tab === 'pages'}
      <div class="smp-body two-col">
        <div class="col">
          <span class="lab">PAGES THAT FRAME WELL</span>
          {#each catalogue.pages as p (p.path)}
            <button class="row" class:sel={pagePath === p.path} onclick={() => { pagePath = p.path; pageTitle = p.title; }}>
              <strong>{p.title}</strong>
              <span class="row-note">{p.path} · {p.note}</span>
            </button>
          {/each}
          <label class="field">
            <span class="lab">FRAME HEIGHT (px)</span>
            <input type="number" bind:value={pageHeight} min="120" max="2000" />
          </label>
        </div>
        <div class="col preview-col">
          <span class="lab">LIVE PREVIEW</span>
          <iframe src={pagePath} title="Page preview" class="page-preview"></iframe>
          <button class="insert" onclick={() => insertPage(pagePath, pageTitle)}>insert page</button>
        </div>
      </div>
    {:else if tab === 'images'}
      <div class="smp-body">
        <div class="img-grid">
          {#each catalogue.images as img (img.src)}
            <button
              class="img-cell"
              class:sel={imageSrc === img.src}
              onclick={() => { imageSrc = img.src; imageAlt = img.label; }}
              title={img.src}
            >
              <img src={img.src} alt={img.label} loading="lazy" />
            </button>
          {/each}
          {#if !catalogue.images.length}<p class="empty">No images found under static/images.</p>{/if}
        </div>
        <div class="img-form">
          <label class="field grow">
            <span class="lab">…OR PASTE AN IMAGE URL</span>
            <input type="text" bind:value={imageUrlInput} placeholder="/images/… or https://…" oninput={() => (imageSrc = '')} />
          </label>
          <label class="field grow">
            <span class="lab">ALT TEXT</span>
            <input type="text" bind:value={imageAlt} placeholder="Describe the image" />
          </label>
          <button class="insert" disabled={!imageSrc && !imageUrlInput.trim()} onclick={insertImage}>insert image</button>
        </div>
      </div>
    {:else if tab === 'find'}
      <div class="smp-body">
        <div class="find-bar">
          <input
            type="text"
            bind:value={findQuery}
            placeholder="search openly-licensed images (Openverse + Wikimedia Commons)…"
            onkeydown={(e) => { if (e.key === 'Enter') void runFind(); }}
          />
          <button class="go" disabled={findBusy} onclick={runFind}>{findBusy ? 'searching…' : 'search'}</button>
        </div>
        {#if findError}<p class="err">{findError}</p>{/if}
        <div class="img-grid">
          {#each findResults as c (c.imageUrl)}
            <button
              class="img-cell found"
              class:sel={selectedCandidate === c}
              onclick={() => (selectedCandidate = c)}
              title={`${c.title} — ${c.license}`}
            >
              <img src={c.thumbUrl} alt={c.title} loading="lazy" />
              <span class="cell-meta">{c.license} · {c.source}</span>
            </button>
          {/each}
        </div>
        {#if selectedCandidate}
          <div class="find-form">
            <div class="find-meta">
              <strong>{selectedCandidate.title}</strong>
              <span class="row-note">
                {selectedCandidate.creator ?? 'unknown creator'} · {selectedCandidate.license} ·
                <a href={selectedCandidate.pageUrl} target="_blank" rel="noopener">source ↗</a>
              </span>
              <span class="row-note">A copy is stored on this site; the attribution becomes the figure caption.</span>
            </div>
            <button class="insert" disabled={importing} onclick={importSelected}>
              {importing ? 'importing…' : 'insert image'}
            </button>
          </div>
        {/if}
      </div>
    {:else if tab === 'generate'}
      <div class="smp-body two-col">
        <div class="col">
          <label class="field">
            <span class="lab">DESCRIBE THE IMAGE</span>
            <textarea
              rows="5"
              bind:value={genPrompt}
              placeholder="a wooden cruiser moored on a misty broad at dawn, editorial photography, muted tones…"
            ></textarea>
          </label>
          <button class="insert" disabled={genBusy || genPrompt.trim().length < 3} onclick={runGenerate}>
            {genBusy ? 'generating… (can take ~30s)' : genResult ? 'regenerate' : 'generate'}
          </button>
          {#if genError}<p class="err">{genError}</p>{/if}
          <span class="row-note">Free open service (pollinations.ai). The result is stored on this site and labelled AI-generated.</span>
        </div>
        <div class="col preview-col">
          <span class="lab">RESULT</span>
          {#if genResult}
            <img class="gen-preview" src={genResult.src} alt={genResult.alt} />
            <button class="insert" onclick={() => genResult && onInsert({ type: 'image', src: genResult.src, alt: genResult.alt, caption: genResult.caption })}>
              insert image
            </button>
          {:else}
            <div class="int-preview">
              <span class="int-glyph">✦</span>
              <span>{genBusy ? 'painting…' : 'nothing yet'}</span>
            </div>
          {/if}
        </div>
      </div>
    {:else if tab === 'upload'}
      <div class="smp-body two-col">
        <div class="col">
          <div
            class="drop"
            class:over={upDragging}
            role="button"
            tabindex="0"
            aria-label="Drop a file or click to choose"
            ondragover={(e) => { e.preventDefault(); upDragging = true; }}
            ondragleave={() => (upDragging = false)}
            ondrop={(e) => { e.preventDefault(); upDragging = false; const f = e.dataTransfer?.files?.[0]; if (f) void uploadFile(f); }}
            onclick={() => fileInput?.click()}
            onkeydown={(e) => { if (e.key === 'Enter') fileInput?.click(); }}
          >
            <span class="drop-main">{upBusy ? 'uploading…' : '⤒ drop a file here, or click to choose'}</span>
            <span class="row-note">jpg · png · webp · gif images (≤15MB) — mp4 · webm video (≤60MB)</span>
          </div>
          <input
            class="file-hidden"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm"
            bind:this={fileInput}
            onchange={(e) => { const f = e.currentTarget.files?.[0]; if (f) void uploadFile(f); e.currentTarget.value = ''; }}
          />
          {#if upError}<p class="err">{upError}</p>{/if}
          <span class="row-note">A copy is stored on this site (deck-media) — videos insert as a video block.</span>
        </div>
        <div class="col preview-col">
          <span class="lab">RESULT</span>
          {#if upResult}
            {#if upResult.kind === 'image'}
              <img class="gen-preview" src={upResult.src} alt={upResult.alt} />
            {:else}
              <!-- svelte-ignore a11y_media_has_caption -->
              <video class="gen-preview" src={upResult.src} controls muted></video>
            {/if}
            <button class="insert" onclick={insertUpload}>insert {upResult.kind}</button>
          {:else}
            <div class="int-preview">
              <span class="int-glyph">⤒</span>
              <span>{upBusy ? 'uploading…' : 'nothing yet'}</span>
            </div>
          {/if}
        </div>
      </div>
    {:else}
      <div class="smp-body browse">
        <div class="browse-bar">
          <input
            type="text"
            bind:value={browseInput}
            placeholder="/projects/…"
            onkeydown={(e) => { if (e.key === 'Enter') go(); }}
          />
          <button class="go" onclick={go}>go</button>
          <span class="browse-path">at: <code>{framePath}</code></span>
          <button class="insert slim" onclick={() => insertPage(framePath, frameTitle || framePath)}>insert this page</button>
        </div>
        <iframe bind:this={frameEl} src={frameSrc} title="Browse the site" class="browse-frame" onload={() => readFrame(true)}></iframe>
        <p class="hint">Navigate to the thing you want — links work inside the frame. “Insert this page” embeds the page you are looking at.</p>
      </div>
    {/if}
  </div>
</div>

<style>
  .smp-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(26, 16, 8, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4vh 4vw;
  }
  .smp {
    width: min(1060px, 100%);
    max-height: 88vh;
    display: flex;
    flex-direction: column;
    background: var(--surface-elevated);
    border: 2px solid var(--text-primary);
    border-radius: 4px;
    overflow: hidden;
  }
  .smp-hd {
    display: flex;
    align-items: center;
    gap: 18px;
    padding: 12px 16px;
    border-bottom: 2px solid var(--text-primary);
  }
  .smp-title {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.18em;
    color: var(--text-primary);
    font-weight: 600;
  }
  .smp-tabs { display: flex; gap: 4px; flex: 1; }
  .smp-tabs button {
    font-family: var(--font-mono);
    font-size: 9.5px;
    letter-spacing: 0.12em;
    color: var(--text-muted);
    background: none;
    border: 1px solid transparent;
    border-radius: 2px;
    padding: 5px 10px;
    cursor: pointer;
  }
  .smp-tabs button.active { color: var(--accent); border-color: var(--accent); }
  .smp-x { font-size: 13px; color: var(--text-muted); background: none; border: none; cursor: pointer; padding: 4px 6px; }
  .smp-x:hover { color: var(--error); }

  .smp-body { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
  .smp-body.two-col { display: grid; grid-template-columns: 340px 1fr; gap: 18px; align-items: start; }
  .col { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .preview-col { position: sticky; top: 0; }
  .lab {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.16em;
    color: var(--text-muted);
    margin-top: 4px;
  }
  .row {
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-family: var(--font-body);
    font-size: 12.5px;
    color: var(--text-primary);
    background: var(--bg);
    border: 1px solid var(--card-border);
    border-radius: 2px;
    padding: 8px 10px;
    cursor: pointer;
  }
  .row.sel { border-color: var(--accent); outline: 1px solid var(--accent); }
  .row-note { font-family: var(--font-mono); font-size: 9.5px; color: var(--text-muted); }
  .scenario-list, .field input, .browse-bar input {
    font-family: var(--font-body);
    font-size: 12.5px;
    color: var(--text-primary);
    background: var(--bg);
    border: 1px solid var(--card-border);
    border-radius: 2px;
    padding: 6px 8px;
    width: 100%;
    box-sizing: border-box;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: 9.5px;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .field.grow { flex: 1; }

  .int-preview {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    aspect-ratio: 16 / 9;
    background: var(--bg);
    border: 1px dashed var(--card-border);
    border-radius: 2px;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.1em;
    color: var(--text-muted);
  }
  .int-glyph { font-size: 30px; color: var(--accent-ink); }
  .int-scenario { color: var(--accent); }

  .page-preview { width: 100%; aspect-ratio: 16 / 10; border: 1px solid var(--card-border); border-radius: 2px; background: #fff; }

  .img-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 10px;
  }
  .img-cell {
    padding: 0;
    background: var(--bg);
    border: 1px solid var(--card-border);
    border-radius: 2px;
    cursor: pointer;
    aspect-ratio: 16 / 10;
    overflow: hidden;
  }
  .img-cell.sel { border-color: var(--accent); outline: 2px solid var(--accent); }
  .img-cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .img-cell.found { position: relative; }
  .cell-meta {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    font-family: var(--font-mono);
    font-size: 8px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #f4ecdc;
    background: rgba(26, 16, 8, 0.72);
    padding: 3px 6px;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .find-bar { display: flex; gap: 8px; }
  .find-bar input {
    flex: 1;
    font-family: var(--font-body);
    font-size: 12.5px;
    color: var(--text-primary);
    background: var(--bg);
    border: 1px solid var(--card-border);
    border-radius: 2px;
    padding: 7px 9px;
  }
  .find-form {
    display: flex;
    gap: 14px;
    align-items: center;
    justify-content: space-between;
    border-top: 1px solid var(--card-border);
    padding-top: 12px;
  }
  .find-meta { display: flex; flex-direction: column; gap: 3px; font-family: var(--font-body); font-size: 12.5px; color: var(--text-primary); min-width: 0; }
  .find-meta a { color: var(--accent-ink); }
  .err { font-family: var(--font-mono); font-size: 10px; color: var(--error); margin: 0; }
  .field textarea {
    font-family: var(--font-body);
    font-size: 12.5px;
    color: var(--text-primary);
    background: var(--bg);
    border: 1px solid var(--card-border);
    border-radius: 2px;
    padding: 7px 9px;
    resize: vertical;
  }
  .gen-preview { width: 100%; border: 1px solid var(--card-border); border-radius: 2px; display: block; margin-bottom: 10px; }
  .drop {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 150px;
    border: 1.5px dashed var(--card-border);
    border-radius: 4px;
    padding: 20px;
    cursor: pointer;
    text-align: center;
    background: var(--bg);
  }
  .drop.over,
  .drop:hover { border-color: var(--accent); }
  .drop-main {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .file-hidden { display: none; }
  .empty { font-family: var(--font-mono); font-size: 10.5px; color: var(--text-muted); }
  .img-form { display: flex; gap: 12px; align-items: flex-end; border-top: 1px solid var(--card-border); padding-top: 12px; }

  .browse { gap: 8px; }
  .browse-bar { display: flex; gap: 8px; align-items: center; }
  .browse-bar input { max-width: 300px; font-family: var(--font-mono); font-size: 11px; }
  .go {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-muted);
    background: none;
    border: 1px solid var(--card-border);
    border-radius: 2px;
    padding: 6px 12px;
    cursor: pointer;
  }
  .go:hover { color: var(--accent); border-color: var(--accent); }
  .browse-path { font-family: var(--font-mono); font-size: 9.5px; color: var(--text-muted); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .browse-frame { flex: 1; min-height: 46vh; width: 100%; border: 1px solid var(--card-border); border-radius: 2px; background: #fff; }
  .hint { font-family: var(--font-mono); font-size: 9.5px; color: var(--text-ghost); margin: 0; }

  .insert {
    font-family: var(--font-mono);
    font-size: 10.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--bg);
    background: var(--accent-ink);
    border: none;
    border-radius: 2px;
    padding: 9px 16px;
    cursor: pointer;
    align-self: flex-start;
  }
  .insert.slim { padding: 6px 12px; align-self: center; }
  .insert:hover { background: var(--accent-ink-hover); }
  .insert:disabled { opacity: 0.45; cursor: default; }

  @media (max-width: 860px) {
    .smp-body.two-col { display: flex; flex-direction: column; }
  }
</style>
