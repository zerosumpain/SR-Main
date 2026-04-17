<svelte:head><title>Research in Progress — Deep Dive</title></svelte:head>
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const phases = [
    { key: 'phase1', label: 'Lead Generation' },
    { key: 'phase2', label: 'Deep Research' },
    { key: 'phase3', label: 'Red Teaming' },
    { key: 'post_processing', label: 'Post-processing' },
  ];

  let currentStatus = $state(data.session.status);
  let logs = $state<{ message: string; timestamp: number }[]>([]);
  let stats = $state({
    sourcesFound: 0,
    factsExtracted: 0,
    entitiesIdentified: 0,
    counterfactualsRaised: 0,
  });
  let stopping = $state(false);
  let skipping = $state(false);
  let elapsed = $state(0);

  let eventSource: EventSource | null = null;
  let elapsedInterval: ReturnType<typeof setInterval> | null = null;
  let logContainer: HTMLDivElement;

  const startTime = new Date(data.session.createdAt).getTime();

  onMount(() => {
    // Elapsed timer
    elapsedInterval = setInterval(() => {
      elapsed = Math.floor((Date.now() - startTime) / 1000);
    }, 1000);

    // SSE connection
    eventSource = new EventSource(`/api/deepdive/${data.session.id}/stream`);

    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);

        if (parsed.type === 'log' || parsed.type === 'error') {
          logs = [...logs.slice(-99), { message: parsed.message ?? '', timestamp: Date.now() }];
          // Auto-scroll
          requestAnimationFrame(() => {
            if (logContainer) logContainer.scrollTop = logContainer.scrollHeight;
          });
        }

        if (parsed.type === 'stats' && parsed.data) {
          stats = { ...stats, ...parsed.data };
        }

        if (parsed.type === 'status' && parsed.data?.status) {
          currentStatus = parsed.data.status as string;
          if (parsed.data.status === 'complete') {
            goto(`/deepdive/${data.session.id}/dashboard`);
          }
        }
      } catch {
        // Ignore parse errors (keepalive comments)
      }
    };

    eventSource.onerror = () => {
      // Reconnect handled by browser EventSource
    };
  });

  onDestroy(() => {
    eventSource?.close();
    if (elapsedInterval) clearInterval(elapsedInterval);
  });

  async function skipPhase() {
    skipping = true;
    await fetch(`/api/deepdive/${data.session.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'skip' }),
    });
    setTimeout(() => (skipping = false), 3000);
  }

  async function stopAndFinalise() {
    stopping = true;
    await fetch(`/api/deepdive/${data.session.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop' }),
    });
  }

  function formatElapsed(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function estimatedRemaining(): string | null {
    if (!data.session.timeLimitMinutes) return null;
    const limitSec = data.session.timeLimitMinutes * 60;
    const remaining = Math.max(0, limitSec - elapsed);
    return formatElapsed(remaining);
  }

  function phaseState(phaseKey: string): 'done' | 'active' | 'pending' {
    const order = ['phase1', 'phase2', 'phase3', 'post_processing', 'complete'];
    const currentIdx = order.indexOf(currentStatus);
    const phaseIdx = order.indexOf(phaseKey);
    if (phaseIdx < currentIdx) return 'done';
    if (phaseIdx === currentIdx) return 'active';
    return 'pending';
  }
</script>

<div class="max-w-2xl mx-auto px-6 py-12">
  <!-- Header -->
  <div class="flex items-center justify-between mb-6">
    <a href="/deepdive" class="back-link">Deep Dive</a>
    <span
      class="text-[13px] uppercase tracking-[0.3em]"
      style="color: var(--text-muted); font-family: var(--font-mono);"
    >
      {data.session.topic.slice(0, 40)}
    </span>
  </div>

  <!-- Phase indicator -->
  <div class="flex items-center gap-1 mb-8">
    {#each phases as phase, i}
      {@const state = phaseState(phase.key)}
      <div class="flex-1">
        <div
          class="h-1.5 rounded-full mb-2"
          style="background: {state === 'done' ? '#2d7d46' : state === 'active' ? 'var(--accent)' : 'var(--card-border)'};"
        ></div>
        <p
          class="text-[13px] uppercase tracking-[0.15em]"
          style="font-family: var(--font-mono); color: {state === 'active' ? 'var(--accent)' : state === 'done' ? '#2d7d46' : 'var(--text-ghost)'};"
        >
          {state === 'done' ? '\u2713 ' : ''}{phase.label}
        </p>
      </div>
      {#if i < phases.length - 1}
        <div class="w-2"></div>
      {/if}
    {/each}
  </div>

  <!-- Stats bar -->
  <div
    class="grid grid-cols-4 gap-3 mb-6 p-4 rounded-xl border"
    style="background: var(--card-bg); border-color: var(--card-border);"
  >
    {#each [
      { label: 'Sources', value: stats.sourcesFound },
      { label: 'Facts', value: stats.factsExtracted },
      { label: 'Entities', value: stats.entitiesIdentified },
      { label: 'Counters', value: stats.counterfactualsRaised },
    ] as stat}
      <div class="text-center">
        <p class="text-lg font-bold" style="color: var(--text-primary); font-family: var(--font-mono);">
          {stat.value}
        </p>
        <p class="text-[13px] uppercase tracking-[0.15em]" style="color: var(--text-muted); font-family: var(--font-mono);">
          {stat.label}
        </p>
      </div>
    {/each}
  </div>

  <!-- Time bar -->
  <div class="flex items-center justify-between mb-4">
    <span
      class="text-[13px] uppercase tracking-[0.2em]"
      style="color: var(--text-muted); font-family: var(--font-mono);"
    >
      Elapsed: {formatElapsed(elapsed)}
    </span>
    {#if estimatedRemaining() !== null}
      <span
        class="text-[13px] uppercase tracking-[0.2em]"
        style="color: var(--text-muted); font-family: var(--font-mono);"
      >
        Remaining: ~{estimatedRemaining()}
      </span>
    {/if}
  </div>

  <!-- Log feed -->
  <div
    bind:this={logContainer}
    class="h-80 overflow-y-auto p-4 rounded-xl border mb-6"
    style="background: var(--card-bg); border-color: var(--card-border);"
  >
    {#if logs.length === 0}
      <p
        class="text-xs"
        style="color: var(--text-muted); font-family: var(--font-mono);"
      >
        Waiting for events...
      </p>
    {:else}
      {#each logs as log}
        <p
          class="text-xs mb-1 leading-relaxed"
          style="color: var(--text-secondary); font-family: var(--font-mono);"
        >
          {log.message}
        </p>
      {/each}
    {/if}
  </div>

  <!-- Action buttons -->
  <div class="flex justify-end gap-3">
    <button
      onclick={skipPhase}
      disabled={skipping || stopping || currentStatus === 'post_processing' || currentStatus === 'complete'}
      class="text-[13px] uppercase tracking-[0.2em] px-5 py-3 rounded-lg transition-colors disabled:opacity-50"
      style="background: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
    >
      {skipping ? 'Skipping...' : 'Next Phase'}
    </button>
    <button
      onclick={stopAndFinalise}
      disabled={stopping || currentStatus === 'post_processing' || currentStatus === 'complete'}
      class="text-[13px] uppercase tracking-[0.2em] px-5 py-3 rounded-lg transition-colors disabled:opacity-50"
      style="background: #8b3a1a; color: white; font-family: var(--font-mono);"
    >
      {stopping ? 'Stopping...' : 'Stop & Finalise'}
    </button>
  </div>
</div>
