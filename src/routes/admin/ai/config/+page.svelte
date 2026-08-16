<svelte:head><title>Agent Config — Admin</title></svelte:head>
<script lang="ts">
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let activeTab = $state<'prompt' | 'memory' | 'cron'>('prompt');

  // System prompt
  let systemPrompt = $state(data.systemPrompt);
  let promptSaving = $state(false);
  let promptSaved = $state(false);

  async function savePrompt() {
    promptSaving = true;
    const form = new FormData();
    form.set('key', 'system_prompt');
    form.set('value', systemPrompt);
    await fetch('?/save', { method: 'POST', body: form });
    promptSaving = false;
    promptSaved = true;
    setTimeout(() => promptSaved = false, 2000);
  }

  // Memory
  let memory = $state(data.memory);
  let memorySaving = $state(false);
  let memorySaved = $state(false);

  async function saveMemory() {
    memorySaving = true;
    const form = new FormData();
    form.set('key', 'memory');
    form.set('value', memory);
    await fetch('?/save', { method: 'POST', body: form });
    memorySaving = false;
    memorySaved = true;
    setTimeout(() => memorySaved = false, 2000);
  }

  // Cron / pulse (placeholder; UI preserved from previous implementation)
  let cronJobs = $state<Array<{ id: string; schedule: string; task: string; enabled: boolean; lastRun?: string }>>([]);
</script>

<PageWrap width="wide">
  <PageHeader
    kicker="Agent"
    title="Config"
    sub="System prompt injected into every agent conversation, persistent memory, and scheduled cron / pulse tasks."
  />

  <div class="nm-tabs">
    <button class="nm-tab" class:active={activeTab === 'prompt'} onclick={() => (activeTab = 'prompt')}>System prompt</button>
    <button class="nm-tab" class:active={activeTab === 'memory'} onclick={() => (activeTab = 'memory')}>Memory</button>
    <button class="nm-tab" class:active={activeTab === 'cron'} onclick={() => (activeTab = 'cron')}>Cron / Pulse <span class="nm-tab-count">{cronJobs.length}</span></button>
  </div>

  {#if activeTab === 'prompt'}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">System prompt</span>
        <span class="nm-sec-meta">{systemPrompt.length} chars · effective next conversation</span>
        <span style="margin-left: auto; display: flex; gap: 0.5rem; align-items: center;">
          {#if promptSaved}<span class="nm-pill" data-state="success">Saved</span>{/if}
          <button class="nm-save-btn" onclick={savePrompt} disabled={promptSaving}>{promptSaving ? 'Saving…' : 'Save'}</button>
        </span>
      </div>
      <textarea class="nm-textarea code-area" rows="20" bind:value={systemPrompt} spellcheck="false"></textarea>
    </section>
  {/if}

  {#if activeTab === 'memory'}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Persistent memory</span>
        <span class="nm-sec-meta">{memory.length} chars · read at the start of each conversation</span>
        <span style="margin-left: auto; display: flex; gap: 0.5rem; align-items: center;">
          {#if memorySaved}<span class="nm-pill" data-state="success">Saved</span>{/if}
          <button class="nm-save-btn" onclick={saveMemory} disabled={memorySaving}>{memorySaving ? 'Saving…' : 'Save'}</button>
        </span>
      </div>
      <textarea class="nm-textarea code-area" rows="20" bind:value={memory}
        placeholder="Add facts, preferences, and context the agent should remember across conversations…"
        spellcheck="false"
      ></textarea>
    </section>
  {/if}

  {#if activeTab === 'cron'}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Scheduled jobs</span>
        <span class="nm-sec-meta">{cronJobs.length}</span>
        <button
          class="nm-save-btn"
          style="margin-left: auto;"
          onclick={() => {
            cronJobs = [...cronJobs, {
              id: `cron-${Date.now()}`,
              schedule: '0 9 * * *',
              task: '',
              enabled: false,
            }];
          }}
        >+ New job</button>
      </div>

      {#if cronJobs.length === 0}
        <div class="nm-empty">No scheduled jobs yet. Create one to have the agent run tasks on a schedule — research updates, status checks, reports.</div>
      {:else}
        <div class="cron-list">
          {#each cronJobs as job}
            <div class="cron-card">
              <div class="cron-head">
                <button
                  class="nm-toggle"
                  role="switch"
                  aria-checked={job.enabled}
                  onclick={() => job.enabled = !job.enabled}
                ></button>
                <input class="nm-text-input cron-schedule" type="text" placeholder="0 9 * * *" bind:value={job.schedule} />
                <span class="cron-tag">cron</span>
                <button class="nm-link-btn danger" onclick={() => cronJobs = cronJobs.filter(j => j.id !== job.id)}>Remove</button>
              </div>
              <textarea class="nm-textarea" rows="3" bind:value={job.task}
                placeholder="What should the agent do? e.g. 'Check competitor pricing and report changes'"
              ></textarea>
              {#if job.lastRun}
                <p class="cron-foot">last run {job.lastRun}</p>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </section>
  {/if}
</PageWrap>

<style>
  .code-area { min-height: 420px; tab-size: 2; line-height: 1.55; }
  .cron-list { display: flex; flex-direction: column; gap: 0.5rem; }
  .cron-card {
    background: var(--bg);
    border: 1px solid var(--card-border);
    padding: 0.7rem 0.8rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .cron-head { display: flex; align-items: center; gap: 0.6rem; }
  .cron-schedule { width: 160px; flex-shrink: 0; }
  .cron-tag {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--text-ghost);
  }
  .cron-foot {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
</style>
