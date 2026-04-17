<svelte:head><title>Deep Dive — Research Agent</title></svelte:head>
<script lang="ts">
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let topic = $state('');
  let goals = $state<string[]>([]);
  let showAdvanced = $state(false);
  let starting = $state(false);
  let suggestingGoals = $state(false);
  let error = $state('');

  // Advanced options
  let timeLimit = $state<number | null>(null);
  let maxSources = $state(25);
  let diversityThreshold = $state<'low' | 'medium' | 'high'>('medium');
  let analysisDepth = $state<'shallow' | 'standard' | 'deep'>('standard');
  let redTeamAggression = $state<'gentle' | 'standard' | 'aggressive'>('standard');
  let maxFactsBeforePhase3 = $state(200);

  async function suggestGoals() {
    if (!topic.trim()) return;
    suggestingGoals = true;
    try {
      const res = await fetch('/api/deepdive/suggest-goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic }),
      });
      const result = await res.json();
      if (result.goals) {
        goals = result.goals;
      }
    } catch (e: any) {
      error = e.message ?? 'Failed to suggest goals';
    } finally {
      suggestingGoals = false;
    }
  }

  function addGoal() {
    goals = [...goals, ''];
  }

  function removeGoal(index: number) {
    goals = goals.filter((_, i) => i !== index);
  }

  async function startResearch() {
    if (!topic.trim()) {
      error = 'Please enter a research topic';
      return;
    }
    starting = true;
    error = '';
    try {
      const res = await fetch('/api/deepdive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topic.trim(),
          goals: goals.filter((g) => g.trim()),
          timeLimitMinutes: timeLimit,
          config: {
            maxSources,
            diversityThreshold,
            analysisDepth,
            redTeamAggression,
            maxFactsBeforePhase3,
          },
        }),
      });

      if (!res.ok) {
        const body = await res.json();
        error = body.error ?? 'Failed to start research';
        return;
      }

      const session = await res.json();
      goto(`/deepdive/${session.id}/progress`);
    } catch (e: any) {
      error = e.message ?? 'Network error';
    } finally {
      starting = false;
    }
  }

  function statusColor(status: string): string {
    if (status === 'complete') return '#2d7d46';
    if (status === 'failed') return '#8b3a1a';
    if (status === 'draft') return 'var(--text-ghost)';
    return 'var(--accent)';
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  let deletingId = $state<string | null>(null);
  let confirmDeleteId = $state<string | null>(null);

  async function deleteSession(id: string) {
    deletingId = id;
    try {
      const res = await fetch(`/api/deepdive/${id}`, { method: 'DELETE' });
      if (res.ok) {
        data.sessions = data.sessions.filter((s) => s.id !== id);
      }
    } finally {
      deletingId = null;
      confirmDeleteId = null;
    }
  }
</script>

<div class="max-w-2xl mx-auto px-6 py-12">
  <!-- Header -->
  <div class="mb-10">
    <a href="/projects" class="back-link mb-4">Projects</a>
    <h1
      class="text-3xl font-bold mb-2"
      style="font-family: var(--font-display); text-transform: uppercase; letter-spacing: -0.02em;"
    >
      Deep Dive
    </h1>
    <p
      class="text-sm"
      style="color: var(--text-muted); font-family: var(--font-mono);"
    >
      Research Agent
    </p>
    <a
      href="/quickanswer"
      class="inline-block mt-3 text-[13px] uppercase tracking-[0.2em] px-4 py-2 rounded-lg"
      style="background: var(--card-bg); border: 1px solid var(--card-border); color: var(--accent); font-family: var(--font-mono);"
    >
      Quick Answer &rarr;
    </a>
  </div>

  <!-- Error banner -->
  {#if error}
    <div
      class="mb-6 p-4 rounded-lg text-sm"
      style="background: var(--card-bg); border: 1px solid var(--card-border); color: #8b3a1a; font-family: var(--font-mono);"
    >
      {error}
    </div>
  {/if}

  <!-- Topic input -->
  <div class="mb-6">
    <label
      class="block text-[13px] uppercase tracking-[0.25em] mb-2"
      style="color: var(--text-muted); font-family: var(--font-mono);"
    >
      What do you want to research?
    </label>
    <input
      type="text"
      bind:value={topic}
      placeholder="Enter a research topic..."
      class="w-full px-4 py-3 rounded-xl text-base"
      style="background: var(--card-bg); border: 2px solid var(--card-border); color: var(--text-primary); font-family: var(--font-body);"
    />
  </div>

  <!-- Goals section -->
  <div
    class="mb-6 p-5 rounded-xl border"
    style="background: var(--card-bg); border-color: var(--card-border);"
  >
    <div class="flex items-center justify-between mb-3">
      <p
        class="text-[13px] uppercase tracking-[0.25em]"
        style="color: var(--text-muted); font-family: var(--font-mono);"
      >
        Research Goals
      </p>
      <button
        onclick={suggestGoals}
        disabled={suggestingGoals || !topic.trim()}
        class="text-[13px] uppercase tracking-[0.2em] px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
        style="background: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
      >
        {suggestingGoals ? 'Thinking...' : 'Suggest goals'}
      </button>
    </div>

    <div class="space-y-2">
      {#each goals as goal, i}
        <div class="flex gap-2">
          <input
            type="text"
            bind:value={goals[i]}
            class="flex-1 px-3 py-2 rounded-lg text-sm"
            style="background: var(--bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
          />
          <button
            onclick={() => removeGoal(i)}
            class="text-xs px-2 rounded"
            style="color: var(--text-ghost);"
          >
            x
          </button>
        </div>
      {/each}
    </div>

    <button
      onclick={addGoal}
      class="mt-3 text-[13px] uppercase tracking-[0.2em] px-3 py-1.5 rounded-lg"
      style="color: var(--text-muted); font-family: var(--font-mono);"
    >
      + Add goal
    </button>
  </div>

  <!-- Advanced options -->
  <div class="mb-6">
    <button
      onclick={() => (showAdvanced = !showAdvanced)}
      class="text-[13px] uppercase tracking-[0.25em] mb-3"
      style="color: var(--text-muted); font-family: var(--font-mono);"
    >
      {showAdvanced ? '- Hide' : '+'} Advanced options
    </button>

    {#if showAdvanced}
      <div
        class="p-5 rounded-xl border space-y-5"
        style="background: var(--card-bg); border-color: var(--card-border);"
      >
        <!-- Time limit -->
        <div>
          <p class="text-[13px] uppercase tracking-[0.2em] mb-2" style="color: var(--text-muted); font-family: var(--font-mono);">
            Time limit
          </p>
          <div class="flex flex-wrap gap-2">
            {#each [{ v: 15, l: '15 min' }, { v: 30, l: '30 min' }, { v: 60, l: '1 hour' }, { v: 120, l: '2 hours' }, { v: null, l: 'Run to completion' }] as opt}
              <button
                onclick={() => (timeLimit = opt.v as number | null)}
                class="text-[13px] uppercase tracking-[0.15em] px-3 py-1.5 rounded-lg"
                style="font-family: var(--font-mono); background: {timeLimit === opt.v ? 'var(--accent)' : 'var(--bg)'}; color: {timeLimit === opt.v ? 'white' : 'var(--text-muted)'}; border: 1px solid var(--card-border);"
              >
                {opt.l}
              </button>
            {/each}
          </div>
        </div>

        <!-- Max sources -->
        <div>
          <p class="text-[13px] uppercase tracking-[0.2em] mb-2" style="color: var(--text-muted); font-family: var(--font-mono);">
            Phase 1 — Max sources: {maxSources}
          </p>
          <input
            type="range"
            bind:value={maxSources}
            min="10"
            max="100"
            step="5"
            class="w-full"
          />
        </div>

        <!-- Diversity threshold -->
        <div>
          <p class="text-[13px] uppercase tracking-[0.2em] mb-2" style="color: var(--text-muted); font-family: var(--font-mono);">
            Phase 1 — Diversity threshold
          </p>
          <div class="flex gap-2">
            {#each ['low', 'medium', 'high'] as opt}
              <button
                onclick={() => (diversityThreshold = opt as any)}
                class="text-[13px] uppercase tracking-[0.15em] px-3 py-1.5 rounded-lg capitalize"
                style="font-family: var(--font-mono); background: {diversityThreshold === opt ? 'var(--accent)' : 'var(--bg)'}; color: {diversityThreshold === opt ? 'white' : 'var(--text-muted)'}; border: 1px solid var(--card-border);"
              >
                {opt}
              </button>
            {/each}
          </div>
        </div>

        <!-- Analysis depth -->
        <div>
          <p class="text-[13px] uppercase tracking-[0.2em] mb-2" style="color: var(--text-muted); font-family: var(--font-mono);">
            Phase 2 — Analysis depth
          </p>
          <div class="flex gap-2">
            {#each ['shallow', 'standard', 'deep'] as opt}
              <button
                onclick={() => (analysisDepth = opt as any)}
                class="text-[13px] uppercase tracking-[0.15em] px-3 py-1.5 rounded-lg capitalize"
                style="font-family: var(--font-mono); background: {analysisDepth === opt ? 'var(--accent)' : 'var(--bg)'}; color: {analysisDepth === opt ? 'white' : 'var(--text-muted)'}; border: 1px solid var(--card-border);"
              >
                {opt}
              </button>
            {/each}
          </div>
        </div>

        <!-- Red team aggression -->
        <div>
          <p class="text-[13px] uppercase tracking-[0.2em] mb-2" style="color: var(--text-muted); font-family: var(--font-mono);">
            Phase 3 — Red team aggression
          </p>
          <div class="flex gap-2">
            {#each ['gentle', 'standard', 'aggressive'] as opt}
              <button
                onclick={() => (redTeamAggression = opt as any)}
                class="text-[13px] uppercase tracking-[0.15em] px-3 py-1.5 rounded-lg capitalize"
                style="font-family: var(--font-mono); background: {redTeamAggression === opt ? 'var(--accent)' : 'var(--bg)'}; color: {redTeamAggression === opt ? 'white' : 'var(--text-muted)'}; border: 1px solid var(--card-border);"
              >
                {opt}
              </button>
            {/each}
          </div>
        </div>

        <!-- Max facts before phase 3 -->
        <div>
          <p class="text-[13px] uppercase tracking-[0.2em] mb-2" style="color: var(--text-muted); font-family: var(--font-mono);">
            Max facts before Phase 3
          </p>
          <input
            type="number"
            bind:value={maxFactsBeforePhase3}
            min="50"
            max="1000"
            step="10"
            class="w-24 px-3 py-2 rounded-lg text-sm"
            style="background: var(--bg); border: 1px solid var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
          />
        </div>
      </div>
    {/if}
  </div>

  <!-- Start button -->
  <div class="mb-12">
    <button
      onclick={startResearch}
      disabled={starting || !topic.trim()}
      class="w-full py-4 rounded-xl text-sm uppercase tracking-[0.2em] transition-colors disabled:opacity-50"
      style="background: var(--accent); color: white; font-family: var(--font-mono);"
    >
      {starting ? 'Starting...' : 'Start Research'}
    </button>
  </div>

  <!-- Previous sessions -->
  {#if data.sessions.length > 0}
    <div>
      <p
        class="text-[13px] uppercase tracking-[0.25em] mb-4"
        style="color: var(--text-muted); font-family: var(--font-mono);"
      >
        Previous Sessions
      </p>

      <div class="space-y-3">
        {#each data.sessions as session}
          <div
            class="p-4 rounded-xl border transition-colors"
            style="background: var(--card-bg); border-color: var(--card-border);"
          >
            <div class="flex items-start justify-between">
              <a
                href={session.status === 'complete'
                  ? `/deepdive/${session.id}/dashboard`
                  : `/deepdive/${session.id}/progress`}
                class="flex-1 min-w-0"
              >
                <p class="text-sm truncate" style="color: var(--text-primary);">
                  {#if session.parentSessionId}
                    <span class="text-[10px] mr-1" style="color: var(--text-muted);">&hookrightarrow;</span>
                  {/if}
                  {session.topic}
                </p>
                <div class="flex items-center gap-3 mt-1">
                  <span
                    class="text-[13px] uppercase tracking-[0.2em] px-2 py-0.5 rounded"
                    style="font-family: var(--font-mono); color: {statusColor(session.status)};"
                  >
                    {session.status}
                  </span>
                  <span
                    class="text-[11px]"
                    style="color: var(--text-muted); font-family: var(--font-mono);"
                  >
                    {session.factCount} facts &middot; {session.entityCount} entities
                  </span>
                </div>
              </a>
              <div class="flex items-center gap-2 ml-3 shrink-0">
                <span
                  class="text-[11px]"
                  style="color: var(--text-muted); font-family: var(--font-mono);"
                >
                  {formatDate(session.createdAt)}
                </span>
                {#if confirmDeleteId === session.id}
                  <button
                    onclick={() => deleteSession(session.id)}
                    disabled={deletingId === session.id}
                    class="text-[10px] uppercase tracking-[0.15em] px-2 py-1 rounded"
                    style="background: #8b3a1a; color: white; font-family: var(--font-mono);"
                  >
                    {deletingId === session.id ? '...' : 'Confirm'}
                  </button>
                  <button
                    onclick={() => (confirmDeleteId = null)}
                    class="text-[10px] px-1"
                    style="color: var(--text-muted); font-family: var(--font-mono);"
                  >
                    x
                  </button>
                {:else}
                  <button
                    onclick={() => (confirmDeleteId = session.id)}
                    class="text-[10px] px-1.5 py-0.5 rounded opacity-40 hover:opacity-100 transition-opacity"
                    style="color: #8b3a1a; font-family: var(--font-mono);"
                    title="Delete session"
                  >
                    del
                  </button>
                {/if}
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
