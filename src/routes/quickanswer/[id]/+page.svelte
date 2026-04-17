<svelte:head><title>Quick Answer — {data.answer.topic}</title></svelte:head>
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { PageData } from './$types';
  import type { QuickAnswerSource } from '$lib/db/schema';

  let { data }: { data: PageData } = $props();

  let status = $state(data.answer.status);
  let answer = $state(data.answer.answer ?? '');
  let sources = $state<QuickAnswerSource[]>((data.answer.sources as QuickAnswerSource[]) ?? []);
  let logs = $state<string[]>([]);
  let errorMessage = $state(data.answer.errorMessage ?? '');
  let durationMs = $state(data.answer.durationMs ?? 0);
  let elapsed = $state(0);
  let cancelling = $state(false);

  let eventSource: EventSource | null = null;
  let elapsedInterval: ReturnType<typeof setInterval> | null = null;

  const isLive = status !== 'complete' && status !== 'failed';

  onMount(() => {
    if (!isLive) return;

    elapsedInterval = setInterval(() => {
      elapsed = Math.floor((Date.now() - new Date(data.answer.createdAt).getTime()) / 1000);
    }, 1000);

    eventSource = new EventSource(`/quickanswer/${data.answer.id}/stream`);

    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);

        if (parsed.type === 'log') {
          logs = [...logs.slice(-19), parsed.message];
        }

        if (parsed.type === 'status' && parsed.data?.status) {
          status = parsed.data.status;
        }

        if (parsed.type === 'sources' && parsed.data?.sources) {
          sources = parsed.data.sources;
        }

        if (parsed.type === 'token' && parsed.data?.token) {
          answer += parsed.data.token;
        }

        if (parsed.type === 'complete') {
          durationMs = parsed.data.durationMs;
          eventSource?.close();
          if (elapsedInterval) clearInterval(elapsedInterval);
        }

        if (parsed.type === 'error') {
          errorMessage = parsed.message;
          eventSource?.close();
          if (elapsedInterval) clearInterval(elapsedInterval);
        }
      } catch {
        // keepalive
      }
    };
  });

  onDestroy(() => {
    eventSource?.close();
    if (elapsedInterval) clearInterval(elapsedInterval);
  });

  async function cancel() {
    cancelling = true;
    await fetch(`/api/quickanswer/${data.answer.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop' }),
    });
  }

  function formatDuration(ms: number): string {
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  function formatElapsed(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function credColor(score: number): string {
    if (score >= 0.8) return '#2d7d46';
    if (score >= 0.5) return 'var(--text-muted)';
    return '#8b3a1a';
  }

  function statusLabel(s: string): string {
    if (s === 'searching') return 'Searching...';
    if (s === 'synthesising') return 'Writing answer...';
    if (s === 'complete') return 'Complete';
    if (s === 'failed') return 'Failed';
    return 'Starting...';
  }
</script>

<div class="max-w-2xl mx-auto px-6 py-12">
  <!-- Header -->
  <div class="flex items-center justify-between mb-6">
    <a href="/quickanswer" class="back-link">Quick Answer</a>
    {#if status === 'complete' && durationMs}
      <span
        class="text-[13px] uppercase tracking-[0.2em]"
        style="color: var(--text-muted); font-family: var(--font-mono);"
      >
        {formatDuration(durationMs)}
      </span>
    {:else if isLive}
      <span
        class="text-[13px] uppercase tracking-[0.2em]"
        style="color: var(--accent); font-family: var(--font-mono);"
      >
        {formatElapsed(elapsed)}
      </span>
    {/if}
  </div>

  <!-- Topic -->
  <h1
    class="text-2xl font-bold mb-6"
    style="font-family: var(--font-display); letter-spacing: -0.02em;"
  >
    {data.answer.topic}
  </h1>

  <!-- Status bar (while live) -->
  {#if status !== 'complete' && status !== 'failed'}
    <div
      class="mb-6 p-4 rounded-xl border flex items-center justify-between"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <div>
        <p
          class="text-[13px] uppercase tracking-[0.2em] mb-1"
          style="color: var(--accent); font-family: var(--font-mono);"
        >
          {statusLabel(status)}
        </p>
        {#if logs.length > 0}
          <p
            class="text-xs"
            style="color: var(--text-muted); font-family: var(--font-mono);"
          >
            {logs[logs.length - 1]}
          </p>
        {/if}
      </div>
      <button
        onclick={cancel}
        disabled={cancelling}
        class="text-[13px] uppercase tracking-[0.15em] px-4 py-2 rounded-lg"
        style="background: #8b3a1a; color: white; font-family: var(--font-mono);"
      >
        {cancelling ? '...' : 'Cancel'}
      </button>
    </div>
  {/if}

  <!-- Error -->
  {#if errorMessage && status === 'failed'}
    <div
      class="mb-6 p-4 rounded-xl border"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <p
        class="text-sm"
        style="color: #8b3a1a; font-family: var(--font-mono);"
      >
        {errorMessage}
      </p>
    </div>
  {/if}

  <!-- Answer -->
  {#if answer}
    <div
      class="mb-8 p-6 rounded-xl border prose prose-sm max-w-none"
      style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-body);"
    >
      {@html renderMarkdown(answer)}
    </div>
  {/if}

  <!-- Sources -->
  {#if sources.length > 0}
    <div>
      <p
        class="text-[13px] uppercase tracking-[0.25em] mb-4"
        style="color: var(--text-muted); font-family: var(--font-mono);"
      >
        Sources ({sources.length})
      </p>

      <div class="space-y-2">
        {#each sources as source}
          <div
            class="p-3 rounded-xl border"
            style="background: var(--card-bg); border-color: var(--card-border);"
          >
            <div class="flex items-start gap-3">
              <span
                class="text-xs font-bold shrink-0 w-6 h-6 flex items-center justify-center rounded-full"
                style="background: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
              >
                {source.citationIndex}
              </span>
              <div class="min-w-0 flex-1">
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-sm block truncate hover:underline"
                  style="color: var(--accent);"
                >
                  {source.title}
                </a>
                <div class="flex items-center gap-2 mt-1">
                  <span
                    class="text-[11px]"
                    style="color: var(--text-muted); font-family: var(--font-mono);"
                  >
                    {source.domain}
                  </span>
                  <span
                    class="text-[10px] uppercase px-1.5 py-0.5 rounded"
                    style="font-family: var(--font-mono); color: {credColor(source.credibilityScore)}; background: {credColor(source.credibilityScore)}15;"
                  >
                    {source.credibilityType}
                  </span>
                </div>
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<script lang="ts" module>
  function renderMarkdown(text: string): string {
    // Lightweight markdown: headers, bold, italic, lists, citation links, line breaks
    return text
      // Code blocks (must come before other transforms)
      .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // Headers
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      // Bold and italic
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      // Lists
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
      .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
      // Citation markers [N] — make them superscript
      .replace(/\[(\d+)\]/g, '<sup class="text-xs" style="color: var(--accent); cursor: pointer;">[$1]</sup>')
      // Paragraphs
      .replace(/\n\n/g, '</p><p>')
      .replace(/^/, '<p>')
      .replace(/$/, '</p>');
  }
</script>
