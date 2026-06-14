<!-- src/lib/canvas/intelligence/desk/CommandBar.svelte -->
<script lang="ts">
  import ModeToggle from './ModeToggle.svelte';
  import { statusPill, controlState, type DeskStatus } from './deskControls';

  let {
    topic,
    sessionId,
    status,
    mode,
    synthesising = false,
    counts,
    onmode,
    onskip,
    onstop,
    ondeepen,
    onshare,
    onexport,
  }: {
    topic: string;
    sessionId: string;
    status: DeskStatus;
    mode: 'gather' | 'synthesize';
    synthesising?: boolean;
    counts: {
      sources: number;
      facts: number;
      entities: number;
      links: number;
      counterfactuals: number;
    };
    onmode: (next: 'gather' | 'synthesize') => void;
    onskip: () => void;
    onstop: () => void;
    ondeepen: () => void;
    onshare: () => void;
    onexport: (kind: 'docx' | 'narrative-docx' | 'narrative-md') => void;
  } = $props();

  let pill = $derived(statusPill(status, synthesising));
  let ctl = $derived(controlState(status, synthesising));

  let exportOpen = $state(false);
  function chooseExport(kind: 'docx' | 'narrative-docx' | 'narrative-md') {
    exportOpen = false;
    onexport(kind);
  }
</script>

<header class="cmdbar">
  <div class="left">
    <a class="mono-mark" href="/jkai/research" title="Back to research launcher">sr.</a>
    <h1 class="topic" title={topic}>{topic}</h1>
  </div>

  <div class="center">
    <ModeToggle {mode} {synthesising} onmode={onmode} />
  </div>

  <div class="right">
    <div class="counters" aria-label="Artefact counts">
      <span class="counter"><b>{counts.sources}</b> src</span>
      <span class="counter"><b>{counts.facts}</b> facts</span>
      <span class="counter"><b>{counts.entities}</b> ent</span>
      <span class="counter"><b>{counts.links}</b> links</span>
      {#if counts.counterfactuals > 0}
        <span class="counter challenge"><b>{counts.counterfactuals}</b> chal</span>
      {/if}
    </div>

    <div class="controls">
      <button
        type="button"
        class="ctl"
        title="Skip current phase"
        disabled={!ctl.canPause}
        onclick={onskip}
      >⏭</button>
      <button
        type="button"
        class="ctl danger"
        title="Stop & finalise"
        disabled={!ctl.canStop}
        onclick={onstop}
      >◼</button>
      <button
        type="button"
        class="ctl"
        title="Deepen (explore further)"
        disabled={!ctl.canDeepen}
        onclick={ondeepen}
      >⤓</button>
      <div class="export-wrap">
        <button
          type="button"
          class="ctl"
          title="Share / export"
          disabled={!ctl.canShare}
          aria-haspopup="menu"
          aria-expanded={exportOpen}
          onclick={() => (exportOpen = !exportOpen)}
        >⤴</button>
        {#if exportOpen}
          <div class="export-menu" role="menu">
            <button role="menuitem" onclick={() => { exportOpen = false; onshare(); }}>Copy share link</button>
            <button role="menuitem" onclick={() => chooseExport('docx')}>Export report (.docx)</button>
            <button role="menuitem" onclick={() => chooseExport('narrative-docx')}>Export narrative (.docx)</button>
            <button role="menuitem" onclick={() => chooseExport('narrative-md')}>Export narrative (.md)</button>
          </div>
        {/if}
      </div>
    </div>

    <span class="pill pill-{pill.hue}">{pill.label}</span>
  </div>
</header>

<svelte:window onclick={(e) => {
  if (exportOpen && !(e.target as HTMLElement).closest('.export-wrap')) exportOpen = false;
}} />

<style>
  .cmdbar {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 16px;
    height: 56px;
    padding: 0 16px;
    background: var(--surface-elevated);
    border-bottom: 1px solid var(--card-border);
    box-shadow: 0 2px 0 rgba(26, 16, 8, 0.06);
    z-index: 30;
    flex-shrink: 0;
  }
  .left { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .mono-mark {
    font-family: var(--font-brand);
    font-size: 18px;
    font-weight: 500;
    color: var(--accent);
    text-decoration: none;
    flex-shrink: 0;
  }
  .mono-mark:hover { color: var(--accent-hover); }
  .topic {
    font-family: var(--font-body);
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .center { display: flex; justify-content: center; }
  .right { display: flex; align-items: center; justify-content: flex-end; gap: 14px; }

  .counters { display: flex; align-items: center; gap: 10px; }
  .counter {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
    letter-spacing: 0.02em;
  }
  .counter b { color: var(--text-primary); font-weight: 600; }
  .counter.challenge b { color: var(--error); }

  .controls { display: flex; align-items: center; gap: 4px; }
  .ctl {
    font-size: 13px;
    line-height: 1;
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    background: var(--card-bg);
    color: var(--text-primary);
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  .ctl:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .ctl.danger:hover:not(:disabled) { border-color: var(--error); color: var(--error); }
  .ctl:disabled { opacity: 0.35; cursor: default; }

  .export-wrap { position: relative; }
  .export-menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    min-width: 200px;
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-round);
    box-shadow: var(--shadow-lg);
    padding: 4px;
    z-index: 40;
  }
  .export-menu button {
    display: block;
    width: 100%;
    text-align: left;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-primary);
    background: transparent;
    border: none;
    padding: 8px 10px;
    border-radius: var(--radius-sharp);
    cursor: pointer;
  }
  .export-menu button:hover { background: var(--accent-tint-08); color: var(--accent); }

  .pill {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.04em;
    padding: 5px 10px;
    border-radius: var(--radius-pill);
    white-space: nowrap;
  }
  .pill-success { color: var(--success); background: var(--success-bg); border: 1px solid var(--success-border); }
  .pill-accent  { color: var(--accent);  background: var(--accent-tint-08); border: 1px solid var(--accent-tint-35); }
  .pill-neutral { color: var(--text-muted); background: var(--card-bg); border: 1px solid var(--card-border); }
  .pill-error   { color: var(--error); background: var(--error-bg); border: 1px solid var(--error-border); }
</style>
