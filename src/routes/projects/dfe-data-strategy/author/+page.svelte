<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { author, type AuthorTab } from '../lib/author/authorState.svelte';
  import SectionRail from '../components/author/SectionRail.svelte';
  import SectionEditor from '../components/author/SectionEditor.svelte';
  import GuidancePanel from '../components/author/GuidancePanel.svelte';
  import DiagnosePanel from '../components/author/DiagnosePanel.svelte';
  import InterviewPanel from '../components/author/InterviewPanel.svelte';
  import VerifyPanel from '../components/author/VerifyPanel.svelte';
  import PlanPanel from '../components/author/PlanPanel.svelte';
  import ExportPanel from '../components/author/ExportPanel.svelte';

  let { data } = $props();

  const TABS = $derived<{ id: AuthorTab; label: string; hint: string }[]>([
    // the diagnostic (the old private workbench) is the workspace's first step for the signed-in owner
    ...(data?.authed ? [{ id: 'diagnose' as AuthorTab, label: '◆ Diagnose', hint: 'Test the posture against the pressures before writing' }] : []),
    ...(data?.authed ? [{ id: 'interview' as AuthorTab, label: '✦ Interview', hint: 'Answer the questions; a full strategy is written from them' }] : []),
    { id: 'draft', label: '✎ Draft', hint: 'Write the strategy, section by section' },
    { id: 'verify', label: '◈ Verify', hint: 'Coverage sweep, completeness checks and the deep review' },
    { id: 'plan', label: '▤ Plan', hint: 'Roadmap, risks, measures and consultation' },
    { id: 'export', label: '↓ Export', hint: 'Preview, download, snapshots' },
  ]);

  let titleEditing = $state(false);

  onMount(() => {
    author.load();
    const t = $page.url.searchParams.get('tab');
    if (t === 'draft' || t === 'verify' || t === 'plan' || t === 'export') author.tab = t;
    else if ((t === 'diagnose' || t === 'interview') && data?.authed) author.tab = t;
  });

  // persist on any state change (cheap JSON writes, debounced by microtask batching)
  $effect(() => {
    // touch the reactive bits we persist so the effect re-runs on change
    void author.doc;
    void author.snapshots;
    void author.milestones;
    void author.risks;
    void author.measures;
    void author.stakeholders;
    void author.review;
    void author.activeId;
    author.persist();
  });

  const verifyBadge = $derived(author.coverage.statutoryGaps.length);
</script>

<svelte:head><title>Workspace — Keystone</title></svelte:head>

<div class="pe-route wide au">
  <header class="au-head">
    <div class="au-title">
      <span class="pe-eyebrow">The workspace · diagnose → interview → draft → verify → plan</span>
      {#if titleEditing}
        <input
          class="title-in"
          value={author.doc.title}
          onblur={(e) => {
            author.setTitle((e.target as HTMLInputElement).value);
            titleEditing = false;
          }}
          onkeydown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      {:else}
        <button class="title-btn" onclick={() => (titleEditing = true)} title="Rename the document">
          <h1 class="pe-h1">{author.doc.title}</h1>
          <span class="pen">✎</span>
        </button>
      {/if}
    </div>
    <nav class="au-tabs" aria-label="Author tools">
      {#each TABS as t}
        <button class="au-tab" class:on={author.tab === t.id} class:diag={t.id === 'diagnose' || t.id === 'interview'} title={t.hint} onclick={() => author.setTab(t.id)}>
          {t.label}
          {#if t.id === 'verify' && verifyBadge > 0 && author.totalWords > 0}
            <i class="badge">{verifyBadge}</i>
          {/if}
        </button>
      {/each}
    </nav>
  </header>

  {#if author.tab === 'diagnose' && data?.authed}
    <DiagnosePanel />
  {:else if author.tab === 'interview' && data?.authed}
    <InterviewPanel />
  {:else if author.tab === 'draft' || ((author.tab === 'diagnose' || author.tab === 'interview') && !data?.authed)}
    <div class="draft-grid">
      <div class="col-rail"><SectionRail /></div>
      <div class="col-ed">
        <h2 class="sec-title">{author.active?.title}</h2>
        <SectionEditor />
      </div>
      <div class="col-guide"><GuidancePanel /></div>
    </div>
  {:else if author.tab === 'verify'}
    <VerifyPanel />
  {:else if author.tab === 'plan'}
    <PlanPanel />
  {:else}
    <ExportPanel />
  {/if}
</div>

<style>
  .au {
    padding-bottom: 30px;
  }
  .au-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px 18px;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }
  .au-title .pe-h1 {
    margin-bottom: 0;
  }
  .title-btn {
    display: inline-flex;
    align-items: baseline;
    gap: 9px;
    background: none;
    border: none;
    padding: 0;
    cursor: text;
    text-align: left;
  }
  .title-btn .pen {
    font-size: var(--fs-label);
    color: rgba(28, 22, 17, 0.35);
  }
  .title-btn:hover .pen {
    color: var(--accent-ink);
  }
  .title-in {
    font-family: var(--fs-serif);
    font-weight: 600;
    font-size: clamp(22px, 3.2vw, 32px);
    letter-spacing: -0.02em;
    color: var(--ink);
    background: rgba(255, 255, 255, 0.7);
    border: 1px solid var(--accent-ink);
    border-radius: var(--radius-sharp);
    padding: 2px 10px;
    width: min(640px, 90vw);
  }
  .au-tabs {
    display: inline-flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .au-tab {
    position: relative;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    font-weight: 500;
    padding: 8px 16px;
    border: 1px solid rgba(28, 22, 17, 0.25);
    border-radius: var(--radius-sharp);
    background: rgba(255, 255, 255, 0.55);
    color: var(--ink);
    cursor: pointer;
  }
  .au-tab:hover {
    background: rgba(28, 22, 17, 0.07);
  }
  .au-tab.on {
    background: var(--ink);
    color: var(--paper, #f1ead6);
    border-color: var(--ink);
  }
  .au-tab.diag {
    border-color: var(--accent-ink-tint-35);
    color: var(--accent-ink);
    background: var(--accent-ink-tint-06);
  }
  .au-tab.diag:hover {
    background: var(--accent-ink-tint-12);
  }
  .au-tab.diag.on {
    background: var(--accent-ink);
    color: var(--paper, #f1ead6);
    border-color: var(--accent-ink);
  }
  .badge {
    position: absolute;
    top: -7px;
    right: -6px;
    font-style: normal;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 600;
    background: #b04a2f;
    color: #fff;
    border-radius: var(--radius-pill, 99px);
    padding: 1px 6px;
  }

  .draft-grid {
    display: grid;
    grid-template-columns: 215px minmax(0, 1fr) 265px;
    gap: 18px;
    align-items: start;
  }
  .col-rail {
    position: sticky;
    top: calc(var(--topH, 90px) + 12px);
  }
  .col-guide {
    position: sticky;
    top: calc(var(--topH, 90px) + 12px);
    max-height: calc(100vh - var(--topH, 90px) - 24px);
    overflow-y: auto;
  }
  .sec-title {
    margin: 0 0 8px;
    font-family: var(--fs-serif);
    font-size: 21px;
    font-weight: 600;
    color: var(--ink);
  }
  @media (max-width: 1080px) {
    .draft-grid {
      grid-template-columns: 190px minmax(0, 1fr);
    }
    .col-guide {
      grid-column: 1 / -1;
      position: static;
      max-height: none;
    }
  }
  @media (max-width: 760px) {
    .draft-grid {
      grid-template-columns: 1fr;
    }
    .col-rail {
      position: static;
    }
  }
</style>
