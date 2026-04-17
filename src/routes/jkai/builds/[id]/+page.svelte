<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { tick } from 'svelte';
  import type { PageData } from './$types';

  let { data } = $props();
  let activeTab = $state<'activity' | 'iterations' | 'preview' | 'controls'>('activity');
  let logs = $state(data.logs);
  let build = $state(data.build);
  let budget = $derived(build.budgetConfig as { maxIterations?: number; maxTotalMinutes?: number } | null);
  let eventSource: EventSource | null = null;
  let logContainer: HTMLDivElement;
  let Prism: any = null;

  onMount(async () => {
    // Dynamic import to avoid SSR issues
    const mod = await import('prismjs');
    Prism = mod.default || mod;
    // Load extra languages
    await import('prismjs/components/prism-bash');
    await import('prismjs/components/prism-python');
    await import('prismjs/components/prism-javascript');
    await import('prismjs/components/prism-typescript');
    await import('prismjs/components/prism-json');
    await import('prismjs/components/prism-markup');
    highlightAll();
  });

  onMount(() => {
    if (build.status === 'running') {
      connectSSE();
    }
  });

  onDestroy(() => {
    closed = true;
    eventSource?.close();
  });

  function highlightAll() {
    if (!Prism || !logContainer) return;
    tick().then(() => {
      logContainer?.querySelectorAll('pre code[class*="language-"]').forEach((el: Element) => {
        if (!(el as HTMLElement).dataset.highlighted) {
          Prism.highlightElement(el);
          (el as HTMLElement).dataset.highlighted = 'true';
        }
      });
    });
  }

  function parseCodeLog(content: string): { lang: string; code: string } | null {
    const match = content.match(/^```(\w+)\n([\s\S]*?)```$/);
    if (!match) return null;
    return { lang: match[1], code: match[2].trimEnd() };
  }

  function prismLang(lang: string): string {
    const map: Record<string, string> = {
      bash: 'bash', sh: 'bash', python: 'python', py: 'python',
      javascript: 'javascript', js: 'javascript', typescript: 'typescript',
      ts: 'typescript', node: 'javascript', json: 'json', html: 'markup',
    };
    return map[lang] || 'bash';
  }

  function connectSSE() {
    if (closed) return;
    eventSource = new EventSource(`/api/jkai/builds/${build.id}/stream`);

    eventSource.onmessage = (e) => {
      const log = JSON.parse(e.data);
      logs = [...logs, { ...log, id: parseInt(e.lastEventId) }];
      requestAnimationFrame(() => {
        logContainer?.scrollTo({ top: logContainer.scrollHeight, behavior: 'smooth' });
      });
      highlightAll();
      // Reset backoff on successful message
      reconnectDelay = 3000;
    };

    eventSource.onerror = () => {
      eventSource?.close();
      // Exponential backoff: 3s → 6s → 12s → 24s → 60s max
      setTimeout(connectSSE, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 60000);
    };
  }

  // Poll build data to keep counters fresh
  let pollTimer: ReturnType<typeof setInterval>;
  onMount(() => {
    pollTimer = setInterval(async () => {
      if (build.status !== 'running') return;
      try {
        const res = await fetch(`/api/jkai/builds/${build.id}`);
        if (res.ok) {
          const fresh = await res.json();
          build = { ...fresh };
        }
      } catch {}
    }, 10000);
  });
  onDestroy(() => clearInterval(pollTimer));

  let reconnectDelay = $state(3000);
  let closed = $state(false);
  let activeIteration = $state<number | null>(null);
  let activating = $state(false);
  let fullscreen = $state(false);
  let publishing = $state(false);
  let publishedUrl = $state<string | null>(build.publishedSlug ? `/projects/jkai/${build.publishedSlug}/` : null);
  let continuePrompt = $state('');
  let continuing = $state(false);

  async function activateIteration(iterationNumber: number) {
    activating = true;
    try {
      const res = await fetch(`/api/jkai/builds/${build.id}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ iterationNumber }),
      });
      if (res.ok) {
        activeIteration = iterationNumber;
      }
    } catch (err) {
      console.error('Failed to activate iteration:', err);
    } finally {
      activating = false;
    }
  }

  async function controlAction(action: 'pause' | 'resume' | 'stop') {
    try {
      const res = await fetch(`/api/jkai/builds/${build.id}/${action}`, { method: 'POST' });
      if (res.ok) {
        const statusMap = { pause: 'paused', resume: 'running', stop: 'completed' } as const;
        build = { ...build, status: statusMap[action] };

        if (action === 'resume') { reconnectDelay = 3000; connectSSE(); }
        if (action === 'pause' || action === 'stop') eventSource?.close();
      }
    } catch (err) {
      console.error(`Failed to ${action} build:`, err);
    }
  }

  async function publishProject() {
    publishing = true;
    try {
      const res = await fetch(`/api/jkai/builds/${build.id}/publish`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.url) {
        publishedUrl = data.url;
        build = { ...build, publishedSlug: data.slug };
      } else {
        console.error('Publish failed:', data.error);
      }
    } catch (err) {
      console.error('Publish failed:', err);
    } finally {
      publishing = false;
    }
  }

  async function continueProject() {
    if (!continuePrompt.trim()) return;
    continuing = true;
    try {
      const res = await fetch(`/api/jkai/builds/${build.id}/continue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: continuePrompt }),
      });
      if (res.ok) {
        build = { ...build, status: 'running' };
        continuePrompt = '';
        reconnectDelay = 3000;
        connectSSE();
        activeTab = 'activity';
      } else {
        const data = await res.json();
        console.error('Continue failed:', data.error);
      }
    } catch (err) {
      console.error('Continue failed:', err);
    } finally {
      continuing = false;
    }
  }

  function logTypeColor(type: string): string {
    const colors: Record<string, string> = {
      system: 'var(--text-ghost)',
      text: 'var(--text-primary)',
      code: '#6a9955',
      output: '#569cd6',
      error: '#f44747',
      thinking: 'var(--text-ghost)',
    };
    return colors[type] || 'var(--text-primary)';
  }

  function budgetPercent(used: number, config: any, key: string): number | null {
    const max = config?.[key];
    if (!max) return null;
    return Math.min(100, (used / max) * 100);
  }
</script>

<svelte:head>
  <title>{build.title || 'Build'} — JKAI</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/prismjs@1/themes/prism-tomorrow.min.css" />
</svelte:head>

<div class="p-6 sm:p-10 max-w-5xl mx-auto">
  <div class="mb-6">
    <a href="/jkai/builds" class="back-link mb-3">Builds</a>
    <div class="flex items-start justify-between">
      <div>
        <h1 class="display text-[24px] sm:text-[32px]" style="color: var(--text-primary);">
          {build.title || build.prompt.slice(0, 60)}
        </h1>
        <p class="text-sm mt-1 max-w-xl" style="color: var(--text-secondary);">{build.prompt}</p>
        {#if publishedUrl}
          <a href={publishedUrl} target="_blank" class="text-xs mt-1 inline-block underline" style="color: var(--accent);">
            Published at {publishedUrl}
          </a>
        {/if}
      </div>
      <div class="flex items-center gap-2 shrink-0">
        {#if build.status === 'completed' || build.status === 'paused'}
          <button
            onclick={publishProject}
            disabled={publishing}
            class="px-3 py-1 rounded text-[11px] uppercase tracking-wider border transition-colors"
            style="border-color: var(--accent); color: var(--accent); opacity: {publishing ? 0.5 : 1};"
          >
            {publishing ? 'Publishing...' : publishedUrl ? 'Re-publish' : 'Publish'}
          </button>
        {/if}
        <span
          class="text-[10px] uppercase tracking-[0.2em] px-2 py-1 rounded"
          style="font-family: var(--font-mono); background: rgba(100,100,100,0.1); color: var(--text-ghost);"
        >
          {build.status}
          {#if build.status === 'running'}
            <span class="inline-block w-1.5 h-1.5 rounded-full ml-1 animate-pulse" style="background: #2d7d46;"></span>
          {/if}
        </span>
      </div>
    </div>
  </div>

  <div class="flex gap-1 mb-4 border-b" style="border-color: var(--card-border);">
    {#each ['activity', 'iterations', 'preview', 'controls'] as tab}
      <button
        onclick={() => activeTab = tab as any}
        class="px-4 py-2 text-sm capitalize transition-colors"
        style="color: {activeTab === tab ? 'var(--accent)' : 'var(--text-ghost)'}; border-bottom: 2px solid {activeTab === tab ? 'var(--accent)' : 'transparent'};"
      >
        {tab}
      </button>
    {/each}
  </div>

  {#if activeTab === 'activity'}
    <div
      bind:this={logContainer}
      class="rounded-lg border p-4 overflow-y-auto"
      style="background: var(--card-bg); border-color: var(--card-border); max-height: 70vh; font-family: var(--font-mono); font-size: 12px; line-height: 1.6;"
    >
      {#if logs.length === 0}
        <p style="color: var(--text-ghost);">No activity yet...</p>
      {:else}
        {#each logs as log}
          <div class="mb-1" style="color: {logTypeColor(log.type)};">
            {#if log.type === 'code'}
              {@const parsed = parseCodeLog(log.content)}
              {#if parsed}
                <pre class="code-block rounded my-1 !bg-[#1e1e1e] !p-3 overflow-x-auto"><code class="language-{prismLang(parsed.lang)}">{parsed.code}</code></pre>
              {:else}
                <pre class="whitespace-pre-wrap bg-black/5 p-2 rounded my-1">{log.content}</pre>
              {/if}
            {:else if log.type === 'output'}
              <pre class="whitespace-pre-wrap bg-blue-500/5 p-2 rounded my-1">{log.content}</pre>
            {:else if log.type === 'error'}
              <pre class="whitespace-pre-wrap bg-red-500/5 p-2 rounded my-1">{log.content}</pre>
            {:else}
              <p class="whitespace-pre-wrap">{log.content}</p>
            {/if}
          </div>
        {/each}
      {/if}
    </div>

  {:else if activeTab === 'iterations'}
    <div class="space-y-3">
      {#if data.iterations.length === 0}
        <p class="text-sm" style="color: var(--text-ghost);">No iterations completed yet.</p>
      {/if}
      {#each data.iterations as iter}
        <details class="rounded-lg border p-4" style="background: var(--card-bg); border-color: var(--card-border);">
          <summary class="cursor-pointer flex items-center justify-between">
            <span class="text-sm font-medium" style="color: var(--text-primary);">
              Iteration #{iter.number}
              <span class="text-[10px] uppercase ml-2 px-1.5 py-0.5 rounded"
                style="font-family: var(--font-mono); background: rgba(100,100,100,0.1); color: var(--text-ghost);">
                {iter.status}
              </span>
              {#if activeIteration === iter.number}
                <span class="text-[10px] uppercase ml-2 px-1.5 py-0.5 rounded"
                  style="font-family: var(--font-mono); background: rgba(45, 125, 70, 0.12); color: #2d7d46;">
                  active
                </span>
              {/if}
            </span>
            <div class="flex items-center gap-3">
              <span class="text-[11px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
                {iter.durationMs ? `${(iter.durationMs / 1000).toFixed(0)}s` : '...'} · {iter.tokensUsed} tokens
              </span>
              {#if iter.status === 'completed' && build.serveConfig}
                <button
                  onclick={(e) => { e.stopPropagation(); activateIteration(iter.number); }}
                  disabled={activating || activeIteration === iter.number}
                  class="px-2 py-0.5 rounded text-[10px] uppercase tracking-wider border transition-colors disabled:opacity-40"
                  style="border-color: var(--accent); color: var(--accent);"
                >
                  {activating ? '...' : activeIteration === iter.number ? 'Active' : 'Activate'}
                </button>
              {/if}
            </div>
          </summary>

          <div class="mt-3 space-y-3 text-sm" style="color: var(--text-secondary);">
            {#if iter.goals}
              <div>
                <h4 class="text-xs uppercase tracking-wider mb-1" style="color: var(--text-ghost);">Goals</h4>
                <p class="whitespace-pre-wrap">{iter.goals}</p>
              </div>
            {/if}
            {#if iter.evaluation}
              <div>
                <h4 class="text-xs uppercase tracking-wider mb-1" style="color: var(--text-ghost);">Evaluation</h4>
                <p class="whitespace-pre-wrap">{iter.evaluation}</p>
              </div>
            {/if}
            {#if iter.nextSteps}
              <div>
                <h4 class="text-xs uppercase tracking-wider mb-1" style="color: var(--text-ghost);">Next Steps</h4>
                <p class="whitespace-pre-wrap">{iter.nextSteps}</p>
              </div>
            {/if}
            {#if Array.isArray(iter.actions) && iter.actions.length > 0}
              <div>
                <h4 class="text-xs uppercase tracking-wider mb-1" style="color: var(--text-ghost);">Actions ({iter.actions.length})</h4>
                {#each iter.actions as action}
                  <pre class="whitespace-pre-wrap bg-black/5 p-2 rounded my-1 text-xs" style="font-family: var(--font-mono);">{action.code}</pre>
                {/each}
              </div>
            {/if}
          </div>
        </details>
      {/each}
    </div>

  {:else if activeTab === 'preview'}
    {#if build.serveConfig}
      <div class="relative" class:fullscreen-preview={fullscreen}>
        <!-- Toolbar -->
        <div class="flex items-center justify-between mb-2 px-1">
          <div class="flex items-center gap-2">
            <span class="text-[11px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
              {activeIteration ? `Viewing iteration #${activeIteration}` : 'Latest (live)'}
            </span>
          </div>
          <div class="flex items-center gap-2">
            <button
              onclick={() => fullscreen = !fullscreen}
              class="px-2 py-1 rounded text-[11px] border transition-colors"
              style="border-color: var(--card-border); color: var(--text-ghost);"
            >
              {fullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            </button>
          </div>
        </div>
        <iframe
          src={`/api/jkai/proxy/${build.id}/`}
          class="w-full rounded-lg border"
          style="height: {fullscreen ? '100vh' : '70vh'}; border-color: var(--card-border);"
          title="Project preview"
        ></iframe>
        {#if fullscreen}
          <button
            onclick={() => fullscreen = false}
            class="fixed top-4 right-4 z-[60] px-3 py-1.5 rounded-lg text-sm font-medium shadow-lg"
            style="background: var(--accent); color: white;"
          >
            Exit Fullscreen
          </button>
        {/if}
      </div>
    {:else}
      <div class="text-center py-16 rounded-lg border" style="background: var(--card-bg); border-color: var(--card-border);">
        <p class="text-sm" style="color: var(--text-ghost);">
          Project is not serving yet. The build will create a serve.json when it's ready.
        </p>
      </div>
    {/if}

  {:else if activeTab === 'controls'}
    <div class="space-y-6 max-w-md">
      <div class="p-4 rounded-lg border" style="background: var(--card-bg); border-color: var(--card-border);">
        <h3 class="text-sm font-medium mb-3" style="color: var(--text-secondary);">Actions</h3>
        <div class="flex gap-2">
          {#if build.status === 'running'}
            <button onclick={() => controlAction('pause')} class="px-3 py-1.5 rounded text-sm border" style="border-color: var(--card-border);">Pause</button>
            <button onclick={() => controlAction('stop')} class="px-3 py-1.5 rounded text-sm border" style="border-color: #b43232; color: #b43232;">Stop</button>
          {:else if build.status === 'paused'}
            <button onclick={() => controlAction('resume')} class="px-3 py-1.5 rounded text-sm" style="background: var(--accent); color: white;">Resume</button>
            <button onclick={() => controlAction('stop')} class="px-3 py-1.5 rounded text-sm border" style="border-color: #b43232; color: #b43232;">Stop</button>
          {:else}
            <p class="text-sm" style="color: var(--text-ghost);">Build is {build.status}.</p>
          {/if}
        </div>
      </div>

      {#if build.status === 'completed'}
        <div class="p-4 rounded-lg border" style="background: var(--card-bg); border-color: var(--card-border);">
          <h3 class="text-sm font-medium mb-3" style="color: var(--text-secondary);">Continue Improving</h3>
          <p class="text-xs mb-3" style="color: var(--text-ghost);">
            Describe what you'd like to improve or add. A new planning cycle will review the existing project and propose further iterations.
          </p>
          <textarea
            bind:value={continuePrompt}
            placeholder="e.g., Add dark mode, improve the charts, make it mobile-responsive..."
            class="w-full px-3 py-2 rounded-lg border text-sm resize-none"
            style="background: var(--bg); border-color: var(--card-border); color: var(--text-primary); min-height: 80px;"
            disabled={continuing}
          ></textarea>
          <button
            onclick={continueProject}
            disabled={continuing || !continuePrompt.trim()}
            class="mt-2 px-4 py-1.5 rounded text-sm font-medium transition-colors"
            style="background: var(--accent); color: white; opacity: {continuing || !continuePrompt.trim() ? 0.5 : 1};"
          >
            {continuing ? 'Starting...' : 'Continue Build'}
          </button>
        </div>
      {/if}

      <div class="p-4 rounded-lg border" style="background: var(--card-bg); border-color: var(--card-border);">
        <h3 class="text-sm font-medium mb-3" style="color: var(--text-secondary);">Share</h3>
        <div class="flex items-center gap-3">
          <button
            onclick={publishProject}
            disabled={publishing}
            class="px-3 py-1.5 rounded text-sm"
            style="background: var(--accent); color: white; opacity: {publishing ? 0.5 : 1};"
          >
            {publishing ? 'Publishing...' : publishedUrl ? 'Re-publish' : 'Publish'}
          </button>
          {#if publishedUrl}
            <a
              href={publishedUrl}
              target="_blank"
              class="text-sm underline"
              style="color: var(--accent);"
            >
              {publishedUrl}
            </a>
          {/if}
        </div>
        {#if !publishedUrl}
          <p class="text-xs mt-2" style="color: var(--text-ghost);">
            Copies the live project files to a public URL at /projects/jkai/
          </p>
        {/if}
      </div>

      <div class="p-4 rounded-lg border" style="background: var(--card-bg); border-color: var(--card-border);">
        <h3 class="text-sm font-medium mb-3" style="color: var(--text-secondary);">Budget Usage</h3>
        <div class="space-y-2 text-sm" style="font-family: var(--font-mono);">
          <div class="flex justify-between" style="color: var(--text-ghost);">
            <span>Iterations</span>
            <span>{build.iterationsCompleted}{budget?.maxIterations ? ` / ${budget.maxIterations}` : ''}</span>
          </div>
          <div class="flex justify-between" style="color: var(--text-ghost);">
            <span>Active time</span>
            <span>{build.activeMinutesUsed.toFixed(1)}m{budget?.maxTotalMinutes ? ` / ${budget.maxTotalMinutes}m` : ''}</span>
          </div>
          <div class="flex justify-between" style="color: var(--text-ghost);">
            <span>Tokens</span>
            <span>{build.tokensUsed.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .code-block {
    font-size: 12px;
    line-height: 1.5;
    tab-size: 2;
  }
  .code-block code {
    font-family: var(--font-mono), 'JetBrains Mono', monospace;
    white-space: pre;
  }
  :global(.code-block .token.comment) { color: #6a9955; }
  :global(.code-block .token.string) { color: #ce9178; }
  :global(.code-block .token.keyword) { color: #569cd6; }
  :global(.code-block .token.function) { color: #dcdcaa; }
  :global(.code-block .token.number) { color: #b5cea8; }
  :global(.code-block .token.operator) { color: #d4d4d4; }
  :global(.code-block .token.punctuation) { color: #d4d4d4; }
  .fullscreen-preview {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: var(--bg, #ede4d4);
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .fullscreen-preview iframe {
    flex: 1;
    border-radius: 0 !important;
    height: 100% !important;
  }
</style>
