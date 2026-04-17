<svelte:head><title>Quick Answer — Research</title></svelte:head>
<script lang="ts">
  import type { PageData, ActionData } from './$types';
  import { enhance } from '$app/forms';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let topic = $state('');
  let goals = $state<string[]>([]);

  function addGoal() {
    goals = [...goals, ''];
  }

  function removeGoal(index: number) {
    goals = goals.filter((_, i) => i !== index);
  }

  function statusColor(status: string): string {
    if (status === 'complete') return '#2d7d46';
    if (status === 'failed') return '#8b3a1a';
    return 'var(--accent)';
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  function formatDuration(ms: number | null): string {
    if (!ms) return '';
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  }
</script>

<div class="max-w-2xl mx-auto px-6 py-12">
  <div class="mb-10">
    <a href="/deepdive" class="back-link mb-4">Deep Dive</a>
    <h1
      class="text-3xl font-bold mb-2"
      style="font-family: var(--font-display); text-transform: uppercase; letter-spacing: -0.02em;"
    >
      Quick Answer
    </h1>
    <p
      class="text-sm"
      style="color: var(--text-muted); font-family: var(--font-mono);"
    >
      Fast synthesised answer with citations — under 2 minutes
    </p>
  </div>

  {#if form?.error}
    <div
      class="mb-6 p-4 rounded-lg text-sm"
      style="background: var(--card-bg); border: 1px solid var(--card-border); color: #8b3a1a; font-family: var(--font-mono);"
    >
      {form.error}
    </div>
  {/if}

  <form method="POST" use:enhance>
    <div class="mb-6">
      <label
        class="block text-[13px] uppercase tracking-[0.25em] mb-2"
        style="color: var(--text-muted); font-family: var(--font-mono);"
      >
        What do you want to know?
      </label>
      <input
        type="text"
        name="topic"
        bind:value={topic}
        placeholder="Enter a research topic..."
        class="w-full px-4 py-3 rounded-xl text-base"
        style="background: var(--card-bg); border: 2px solid var(--card-border); color: var(--text-primary); font-family: var(--font-body);"
      />
    </div>

    <div
      class="mb-6 p-5 rounded-xl border"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <p
        class="text-[13px] uppercase tracking-[0.25em] mb-3"
        style="color: var(--text-muted); font-family: var(--font-mono);"
      >
        Goals (optional)
      </p>

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
              type="button"
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
        type="button"
        onclick={addGoal}
        class="mt-3 text-[13px] uppercase tracking-[0.2em] px-3 py-1.5 rounded-lg"
        style="color: var(--text-muted); font-family: var(--font-mono);"
      >
        + Add goal
      </button>
    </div>

    <input type="hidden" name="goals" value={goals.filter(g => g.trim()).join('\n')} />

    <div class="mb-12">
      <button
        type="submit"
        disabled={!topic.trim()}
        class="w-full py-4 rounded-xl text-sm uppercase tracking-[0.2em] transition-colors disabled:opacity-50"
        style="background: var(--accent); color: white; font-family: var(--font-mono);"
      >
        Get Quick Answer
      </button>
    </div>
  </form>

  {#if data.answers.length > 0}
    <div>
      <p
        class="text-[13px] uppercase tracking-[0.25em] mb-4"
        style="color: var(--text-muted); font-family: var(--font-mono);"
      >
        Previous Answers
      </p>

      <div class="space-y-3">
        {#each data.answers as answer}
          <a
            href="/quickanswer/{answer.id}"
            class="block p-4 rounded-xl border transition-colors"
            style="background: var(--card-bg); border-color: var(--card-border);"
          >
            <p class="text-sm truncate" style="color: var(--text-primary);">
              {answer.topic}
            </p>
            <div class="flex items-center gap-3 mt-1">
              <span
                class="text-[13px] uppercase tracking-[0.2em]"
                style="font-family: var(--font-mono); color: {statusColor(answer.status)};"
              >
                {answer.status}
              </span>
              {#if answer.durationMs}
                <span
                  class="text-[11px]"
                  style="color: var(--text-muted); font-family: var(--font-mono);"
                >
                  {formatDuration(answer.durationMs)}
                </span>
              {/if}
              <span
                class="text-[11px] ml-auto"
                style="color: var(--text-muted); font-family: var(--font-mono);"
              >
                {formatDate(answer.createdAt)}
              </span>
            </div>
          </a>
        {/each}
      </div>
    </div>
  {/if}
</div>
