<!-- src/lib/canvas/intelligence/desk/CommandBar.svelte -->
<script lang="ts">
  import ModeToggle from './ModeToggle.svelte';
  import PhaseStepper from './PhaseStepper.svelte';
  import { statusPill, controlState, type DeskStatus } from './deskControls';
  import { nextPhaseLabel } from './phases';

  let {
    topic,
    sessionId,
    status,
    mode,
    synthesising = false,
    counts,
    controlsHidden = false,
    compact = false,
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
    /** Hide the run-control cluster (skip/stop/deepen/share-export) for the
     *  readonly share desk and the quick desk, which have no mutating actions. */
    controlsHidden?: boolean;
    /** The embedded canvas node keeps the original compact command-bar height. */
    compact?: boolean;
    onmode: (next: 'gather' | 'synthesize') => void;
    onskip: () => void;
    onstop: () => void;
    ondeepen: () => void;
    onshare: () => void;
    onexport: (kind: 'docx' | 'narrative-docx' | 'narrative-md') => void;
  } = $props();

  let pill = $derived(statusPill(status, synthesising));
  let ctl = $derived(controlState(status, synthesising));
  let skipTarget = $derived(nextPhaseLabel(status));
  let skipTitle = $derived(
    skipTarget ? `Skip to ${skipTarget}` : 'Skip current phase'
  );

  let exportOpen = $state(false);
  function chooseExport(kind: 'docx' | 'narrative-docx' | 'narrative-md') {
    exportOpen = false;
    onexport(kind);
  }
</script>

<header class="cmdbar" class:compact>
  <div class="left">
    <a class="mono-mark" href="/research" title="Back to research launcher"><span class="mark-caret">&gt;</span><span class="mark-text"> sr./research</span></a>
    <span class="title-lockup">
      <span class="eyebrow">Evidence desk</span>
      <h1 class="topic" title={topic}>{topic}</h1>
    </span>
  </div>

  <div class="center">
    <ModeToggle {mode} {synthesising} onmode={onmode} dark />
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

    <PhaseStepper {status} dark />

    {#if !controlsHidden}
    <div class="controls">
      <button
        type="button"
        class="ctl"
        title={skipTitle}
        aria-label={skipTitle}
        disabled={!ctl.canPause || !skipTarget}
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
    {/if}

    <span class="pill pill-{pill.hue}">{pill.label}</span>
  </div>
</header>

<svelte:window onclick={(e) => {
  if (exportOpen && !(e.target as HTMLElement).closest('.export-wrap')) exportOpen = false;
}} />

<style>
  .cmdbar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 18px;
    min-height: 72px;
    padding: 10px 18px;
    background: var(--text-primary);
    color: var(--bg);
    border-bottom: 1px solid rgba(237, 228, 212, 0.16);
    z-index: 30;
    flex-shrink: 0;
  }
  .cmdbar.compact { min-height: 56px; padding-block: 6px; }
  .left { display: flex; align-items: center; gap: 16px; min-width: 0; }
  .mono-mark {
    font-family: var(--font-brand);
    font-size: var(--fs-label);
    font-weight: 500;
    color: rgba(237, 228, 212, 0.62);
    text-decoration: none;
    flex-shrink: 0;
  }
  .mark-caret { color: var(--accent-on-dark); }
  .mono-mark:hover { color: var(--bg); }
  .title-lockup { display: grid; gap: 3px; min-width: 0; padding-left: 16px; border-left: 1px solid rgba(237, 228, 212, 0.16); }
  .eyebrow { overflow: hidden; font-family: var(--font-mono); font-size: var(--fs-label-xs); line-height: 1; letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--accent-on-dark); text-overflow: ellipsis; white-space: nowrap; }
  .topic {
    font-family: var(--font-display);
    font-size: var(--fs-body-lg);
    font-weight: 900;
    line-height: 1;
    letter-spacing: -0.02em;
    text-transform: uppercase;
    color: var(--bg);
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .compact .title-lockup { gap: 0; }
  .compact .eyebrow { display: none; }
  .compact .topic { font-family: var(--font-body); font-size: var(--fs-body-sm); font-weight: 600; text-transform: none; letter-spacing: 0; }
  .center { display: flex; justify-content: center; }
  .right { display: flex; align-items: center; justify-content: flex-end; gap: 12px; min-width: 0; }

  .counters { display: flex; align-items: stretch; gap: 0; border-left: 1px solid rgba(237, 228, 212, 0.14); }
  .counter {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: rgba(237, 228, 212, 0.52);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 4px 8px;
    border-right: 1px solid rgba(237, 228, 212, 0.14);
  }
  .counter b { color: var(--bg); font-weight: 600; }
  .counter.challenge b { color: var(--error); }

  .controls { display: flex; align-items: center; gap: 4px; }
  .ctl {
    font-size: var(--fs-nav);
    line-height: 1;
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(237, 228, 212, 0.2);
    border-radius: 0;
    background: rgba(237, 228, 212, 0.05);
    color: rgba(237, 228, 212, 0.75);
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  .ctl:hover:not(:disabled) { border-color: var(--accent-on-dark); color: var(--accent-on-dark); }
  .ctl.danger:hover:not(:disabled) { border-color: var(--error); color: var(--error); }
  .ctl:disabled { opacity: 0.35; cursor: default; }

  .export-wrap { position: relative; }
  .export-menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    min-width: 200px;
    background: var(--text-primary);
    border: 1px solid rgba(237, 228, 212, 0.2);
    border-radius: 0;
    padding: 4px;
    z-index: 40;
  }
  .export-menu button {
    display: block;
    width: 100%;
    text-align: left;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--bg);
    background: transparent;
    border: none;
    padding: 8px 10px;
    border-radius: 0;
    cursor: pointer;
  }
  .export-menu button:hover { background: rgba(237, 228, 212, 0.08); color: var(--accent-on-dark); }

  .pill {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    padding: 5px 10px;
    border-radius: 0;
    white-space: nowrap;
  }
  .pill-success { color: var(--good-on-dark); background: transparent; border: 1px solid var(--good-on-dark); }
  .pill-accent  { color: var(--accent-on-dark); background: transparent; border: 1px solid var(--accent-on-dark); }
  .pill-neutral { color: rgba(237, 228, 212, 0.62); background: transparent; border: 1px solid rgba(237, 228, 212, 0.2); }
  .pill-error   { color: var(--error); background: var(--error-bg); border: 1px solid var(--error-border); }

  @media (max-width: 1650px) {
    .counters { display: none; }
  }
  @media (max-width: 1240px) {
    .right :global(.stepper .label) { display: none; }
    .right :global(.stepper .connector) { width: 9px; }
  }
  @media (max-width: 1080px) {
    .cmdbar { grid-template-columns: minmax(0, 1fr) auto; }
    .center { display: none; }
  }
  @media (max-width: 760px) {
    .cmdbar { min-height: 64px; padding-inline: 12px; }
    .mark-text { display: none; }
    .title-lockup { padding-left: 0; border-left: 0; }
    .right :global(.stepper) { display: none; }
    .controls { gap: 2px; }
    .ctl { width: 28px; height: 28px; }
  }
</style>
