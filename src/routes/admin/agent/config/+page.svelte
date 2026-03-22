<svelte:head><title>Agent Config — Strange Ramblings</title></svelte:head>
<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let activeTab = $state<'prompt' | 'memory' | 'cron'>('prompt');

  // System Prompt
  let systemPrompt = $state(data.systemPrompt);
  let promptSaving = $state(false);
  let promptSaved = $state(false);

  async function savePrompt() {
    promptSaving = true;
    await fetch('/api/agent/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'system_prompt', value: systemPrompt }),
    });
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
    await fetch('/api/agent/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'memory', value: memory }),
    });
    memorySaving = false;
    memorySaved = true;
    setTimeout(() => memorySaved = false, 2000);
  }

  // Cron/Pulse placeholder
  let cronJobs = $state<Array<{ id: string; schedule: string; task: string; enabled: boolean; lastRun?: string }>>([]);
</script>

<div class="max-w-4xl mx-auto px-6 py-12">
  <div class="flex items-center justify-between mb-10">
    <a href="/admin/agent" class="text-[10px] uppercase tracking-[0.3em]" style="color: var(--text-ghost); font-family: var(--font-mono);">
      &larr; Dashboard
    </a>
    <h1 class="text-lg font-light tracking-wide" style="color: var(--text-primary);">Agent Config</h1>
    <span></span>
  </div>

  <!-- Tabs -->
  <div class="flex gap-2 mb-8">
    {#each [['prompt', 'System Prompt'], ['memory', 'Memory'], ['cron', 'Cron / Pulse']] as [id, label]}
      <button
        class="text-[10px] uppercase tracking-wider px-3 py-1.5 rounded transition-colors"
        style="background: {activeTab === id ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)'}; color: {activeTab === id ? 'var(--text-primary)' : 'var(--text-ghost)'}; font-family: var(--font-mono); border: 1px solid {activeTab === id ? 'rgba(255,255,255,0.1)' : 'transparent'};"
        onclick={() => activeTab = id as 'prompt' | 'memory' | 'cron'}
      >{label}</button>
    {/each}
  </div>

  <!-- System Prompt -->
  {#if activeTab === 'prompt'}
    <div>
      <div class="flex items-center justify-between mb-3">
        <p class="text-xs" style="color: var(--text-ghost);">
          This prompt is injected into every agent conversation. It defines how the agent thinks and behaves.
        </p>
        <div class="flex items-center gap-2">
          {#if promptSaved}
            <span class="text-[10px] uppercase" style="color: #3d8b3d; font-family: var(--font-mono);">Saved</span>
          {/if}
          <button
            class="text-[10px] uppercase tracking-wider px-3 py-1.5 rounded"
            style="background: var(--accent); color: white; font-family: var(--font-mono);"
            onclick={savePrompt}
            disabled={promptSaving}
          >{promptSaving ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
      <textarea
        bind:value={systemPrompt}
        class="w-full rounded-lg p-4 text-sm leading-relaxed resize-y"
        style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); color: var(--text-secondary); font-family: var(--font-mono); min-height: 400px; tab-size: 2;"
        spellcheck="false"
      ></textarea>
      <p class="text-[10px] mt-2" style="color: var(--text-ghost); font-family: var(--font-mono);">
        {systemPrompt.length} characters | Changes take effect on next conversation
      </p>
    </div>
  {/if}

  <!-- Memory -->
  {#if activeTab === 'memory'}
    <div>
      <div class="flex items-center justify-between mb-3">
        <p class="text-xs" style="color: var(--text-ghost);">
          Long-term memory that persists across conversations. The agent can read this to recall past context, preferences, and facts.
        </p>
        <div class="flex items-center gap-2">
          {#if memorySaved}
            <span class="text-[10px] uppercase" style="color: #3d8b3d; font-family: var(--font-mono);">Saved</span>
          {/if}
          <button
            class="text-[10px] uppercase tracking-wider px-3 py-1.5 rounded"
            style="background: var(--accent); color: white; font-family: var(--font-mono);"
            onclick={saveMemory}
            disabled={memorySaving}
          >{memorySaving ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
      <textarea
        bind:value={memory}
        class="w-full rounded-lg p-4 text-sm leading-relaxed resize-y"
        style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); color: var(--text-secondary); font-family: var(--font-mono); min-height: 400px; tab-size: 2;"
        placeholder="Add facts, preferences, and context the agent should remember across conversations..."
        spellcheck="false"
      ></textarea>
      <p class="text-[10px] mt-2" style="color: var(--text-ghost); font-family: var(--font-mono);">
        {memory.length} characters | The agent reads this at the start of each conversation
      </p>
    </div>
  {/if}

  <!-- Cron / Pulse -->
  {#if activeTab === 'cron'}
    <div>
      <div class="flex items-center justify-between mb-6">
        <p class="text-xs" style="color: var(--text-ghost);">
          Scheduled tasks and pulse checks. These run automatically on a schedule.
        </p>
        <button
          class="text-[10px] uppercase tracking-wider px-3 py-1.5 rounded"
          style="background: var(--accent); color: white; font-family: var(--font-mono);"
          onclick={() => {
            cronJobs = [...cronJobs, {
              id: `cron-${Date.now()}`,
              schedule: '0 9 * * *',
              task: '',
              enabled: false,
            }];
          }}
        >+ New Job</button>
      </div>

      {#if cronJobs.length === 0}
        <div class="text-center py-16">
          <p class="text-sm mb-2" style="color: var(--text-ghost);">No scheduled jobs yet.</p>
          <p class="text-xs" style="color: var(--text-ghost);">
            Create a cron job to have the agent run tasks on a schedule — research updates, status checks, reports.
          </p>
        </div>
      {:else}
        <div class="space-y-3">
          {#each cronJobs as job}
            <div class="p-4 rounded-lg" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);">
              <div class="flex items-center gap-3 mb-3">
                <button
                  class="w-8 h-4 rounded-full relative transition-colors"
                  style="background: {job.enabled ? 'var(--accent)' : 'rgba(255,255,255,0.1)'};"
                  onclick={() => job.enabled = !job.enabled}
                  aria-label="Toggle job"
                >
                  <span
                    class="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform"
                    style="left: {job.enabled ? '16px' : '2px'};"
                  ></span>
                </button>
                <input
                  type="text"
                  bind:value={job.schedule}
                  placeholder="0 9 * * *"
                  class="px-2 py-1 rounded text-xs w-32"
                  style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); color: var(--text-secondary); font-family: var(--font-mono);"
                />
                <span class="text-[10px]" style="color: var(--text-ghost); font-family: var(--font-mono);">cron</span>
                <button
                  class="ml-auto text-[10px] uppercase"
                  style="color: #8b3a3a; font-family: var(--font-mono);"
                  onclick={() => cronJobs = cronJobs.filter(j => j.id !== job.id)}
                >Remove</button>
              </div>
              <textarea
                bind:value={job.task}
                placeholder="What should the agent do? e.g. 'Check competitor pricing and report changes'"
                class="w-full rounded p-3 text-xs resize-y"
                style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); color: var(--text-secondary); font-family: var(--font-mono); min-height: 60px;"
              ></textarea>
              {#if job.lastRun}
                <p class="text-[10px] mt-1" style="color: var(--text-ghost); font-family: var(--font-mono);">
                  Last run: {job.lastRun}
                </p>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>
