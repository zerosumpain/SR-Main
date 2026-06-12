<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { buildExports } from '../lib/exporters';
  import type { ExportArtifact } from '../lib/exporters';
  const base = '/projects/data-standard-designer';

  const artifacts = $derived(buildExports(app.toExportInput()));
  let preview = $state<string | null>('spec');

  function download(a: ExportArtifact) {
    const blob = new Blob([a.content], { type: `${a.mime};charset=utf-8` });
    const el = document.createElement('a');
    el.href = URL.createObjectURL(blob);
    el.download = a.filename;
    el.click();
    setTimeout(() => URL.revokeObjectURL(el.href), 1000);
  }
  function downloadAll() {
    // No zip dependency — emit each file in quick succession.
    artifacts.forEach((a, i) => setTimeout(() => download(a), i * 250));
  }
  async function importDesign(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      if (json && json.brief) app.loadDesign({ brief: json.brief, fields: json.fields || [], version: json.version });
    } catch {
      alert('Could not read that design file.');
    }
    input.value = '';
  }
  const current = $derived(artifacts.find((a) => a.id === preview));
  const readiness = $derived(Math.round((app.overall)));
</script>

<div class="dsd-route">
  <span class="dsd-eyebrow">Step 05 · Publish</span>
  <h1 class="dsd-h1" style="font-size:clamp(26px,4vw,40px)">Ship the standard.</h1>
  <p class="dsd-prose">Download the standard in machine-readable and human-readable formats — including a publication-grade specification and the rationale pack that evidences every choice. Each artifact is generated live from your current design.</p>

  <div class="bar">
    <label class="ver"><span class="dsd-label" style="margin:0">Version</span>
      <input class="dsd-input" style="width:120px" bind:value={app.version} /></label>
    <div class="ready">
      <span class="dsd-label" style="margin:0">Design readiness</span>
      <div class="rb"><div class="rf" style="width:{readiness}%"></div></div>
      <b>{readiness}/100</b>
    </div>
    <button class="dsd-btn primary" onclick={downloadAll}>⤓ Download all ({artifacts.length})</button>
    <label class="dsd-btn sm import">⤒ Import design<input type="file" accept="application/json,.json" onchange={importDesign} hidden /></label>
  </div>

  {#if app.overall < 60}
    <div class="dsd-note" style="border-color:var(--warn)"><span class="tag" style="color:var(--warn)">Before you publish</span>This design scores {app.overall}/100. It will still export, but consider raising interoperability, assurance and adoption on the earlier steps first — the rationale pack lists the open gaps.</div>
  {/if}

  <div class="grid">
    <div class="cards">
      {#each artifacts as a}
        <div class="art" class:active={preview === a.id}>
          <button class="art-main" onclick={() => (preview = a.id)}>
            <b>{a.label}</b>
            <code>{a.filename}</code>
            <p>{a.description}</p>
          </button>
          <button class="art-dl" onclick={() => download(a)} title="Download">⤓</button>
        </div>
      {/each}
    </div>

    <div class="preview">
      {#if current}
        <div class="pv-head"><b>{current.label}</b><button class="dsd-btn sm" onclick={() => download(current)}>⤓ Download</button></div>
        <pre>{current.content.length > 14000 ? current.content.slice(0, 14000) + '\n\n… (truncated in preview — download for the full file)' : current.content}</pre>
      {:else}<p class="empty">Select an artifact to preview.</p>{/if}
    </div>
  </div>

  <p class="foot-note">Schemas carry an <code>x-</code> / <code>dsd:</code> namespace for design metadata (personal-data flags, source standard, identifier reuse) so nothing about the design intent is lost on export. The Markdown specification follows a publication-grade structure (purpose → scope → legal basis → data dictionary → conformance → governance).</p>
</div>

<style>
  .bar { display: flex; align-items: flex-end; gap: 16px; flex-wrap: wrap; margin: 16px 0; padding-bottom: 16px; border-bottom: 1px solid var(--divider); }
  .ver { display: flex; flex-direction: column; gap: 6px; }
  .ready { display: flex; flex-direction: column; gap: 4px; }
  .ready .rb { width: 180px; height: 8px; background: var(--surface-overlay); border-radius: var(--radius-pill); overflow: hidden; }
  .ready .rf { height: 100%; background: var(--accent); }
  .ready b { font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); }
  .import { cursor: pointer; }

  .grid { display: grid; grid-template-columns: 340px minmax(0, 1fr); gap: 18px; align-items: start; }
  .cards { display: flex; flex-direction: column; gap: 8px; }
  .art { display: flex; border: 1.5px solid var(--card-border); border-radius: var(--radius-round); overflow: hidden; background: var(--surface-elevated); }
  .art.active { border-color: var(--accent); }
  .art-main { flex: 1; text-align: left; background: transparent; border: none; padding: 11px 13px; cursor: pointer; }
  .art-main b { font-size: 13.5px; color: var(--text-primary); display: block; }
  .art-main code { font-family: var(--font-mono); font-size: 10px; color: var(--accent); display: block; margin: 2px 0 5px; }
  .art-main p { font-size: 11.5px; line-height: 1.4; color: var(--text-muted); margin: 0; }
  .art-dl { background: var(--card-bg); border: none; border-left: 1.5px solid var(--card-border); cursor: pointer; padding: 0 14px; font-size: 16px; color: var(--text-secondary); }
  .art-dl:hover { background: var(--accent); color: #fff; }

  .preview { position: sticky; top: 110px; border: 1.5px solid var(--text-primary); border-radius: var(--radius-round); overflow: hidden; background: var(--code-bg); }
  .pv-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: var(--code-bg); border-bottom: 1px solid rgba(255,255,255,0.12); }
  .pv-head b { color: var(--code-text); font-size: 13px; }
  .pv-head :global(.dsd-btn) { background: transparent; color: var(--code-text); border-color: rgba(255,255,255,0.3); }
  .preview pre { margin: 0; padding: 14px; max-height: 70vh; overflow: auto; font-family: var(--font-mono); font-size: 11.5px; line-height: 1.5; color: var(--code-text); white-space: pre-wrap; word-break: break-word; }
  .empty { color: var(--text-muted); padding: 20px; }

  .foot-note { font-size: 11.5px; color: var(--text-muted); line-height: 1.5; margin-top: 18px; max-width: 80ch; }
  .foot-note code { font-family: var(--font-mono); background: var(--card-bg); padding: 1px 4px; border-radius: 3px; }

  @media (max-width: 860px) { .grid { grid-template-columns: 1fr; } .preview { position: static; } }
</style>
