<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { ChatMessage, Conversation } from '$lib/jkai/types';
  let Prism: any = null;

  // State
  let messages = $state<ChatMessage[]>([]);
  let input = $state('');
  let isStreaming = $state(false);
  let thinkingEnabled = $state(false);
  let conversationId = $state<string | null>(null);
  let conversations = $state<Conversation[]>([]);
  let sidebarOpen = $state(false);
  let streamingContent = $state('');
  let streamingThinking = $state('');
  let showThinking = $state(false);
  let executions = $state<Array<{ lang: string; code: string; output: string | null; exitCode?: number; running: boolean }>>([]);

  // Code drawer
  interface CodeArtifact {
    id: string;
    lang: string;
    code: string;
    title: string;
    output?: string | null;
    exitCode?: number;
    running?: boolean;
    timestamp: Date;
    type: 'block' | 'exec';
  }
  let artifacts = $state<CodeArtifact[]>([]);
  let drawerOpen = $state(false);
  let expandedArtifact = $state<string | null>(null);

  let chatContainer: HTMLDivElement;
  let inputEl: HTMLTextAreaElement;

  function scrollToBottom() {
    if (chatContainer) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  }

  async function highlightCode() {
    await tick();
    if (!Prism || !chatContainer) return;
    chatContainer.querySelectorAll('pre code[class*="language-"]').forEach((el) => {
      if (!(el as HTMLElement).dataset.highlighted) {
        Prism.highlightElement(el);
        (el as HTMLElement).dataset.highlighted = 'true';
      }
    });
  }

  async function loadConversations() {
    const res = await fetch('/api/jkai/conversations');
    if (res.ok) conversations = await res.json();
  }

  async function loadConversation(id: string) {
    const res = await fetch(`/api/jkai/conversations?id=${id}`);
    if (res.ok) {
      const conv = await res.json();
      conversationId = conv.id;
      messages = conv.messages.map((m: any) => ({
        role: m.role,
        content: m.content,
        thinking: m.thinking,
        attachments: m.attachments,
        createdAt: m.createdAt,
      }));
      sidebarOpen = false;
      collectArtifactsFromMessages();
      await tick();
      scrollToBottom();
      highlightCode();
    }
  }

  function newConversation() {
    conversationId = null;
    messages = [];
    streamingContent = '';
    streamingThinking = '';
    artifacts = [];
    drawerOpen = false;
    expandedArtifact = null;
    sidebarOpen = false;
    inputEl?.focus();
  }

  function collectArtifactsFromMessages() {
    artifacts = [];
    const collector: Array<{ id: string; lang: string; code: string; title: string }> = [];
    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.content) {
        renderMarkdown(msg.content, collector);
      }
    }
    artifacts = collector.map(c => ({
      ...c,
      timestamp: new Date(),
      type: 'block' as const,
    }));
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || isStreaming) return;

    const userMsg: ChatMessage = { role: 'user', content: text };
    messages = [...messages, userMsg];
    input = '';
    isStreaming = true;
    streamingContent = '';
    streamingThinking = '';
    executions = [];

    await tick();
    scrollToBottom();

    if (inputEl) inputEl.style.height = 'auto';

    try {
      const res = await fetch('/api/jkai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          conversationId,
          thinkingEnabled,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = JSON.parse(line.slice(6));

          if (data.type === 'meta') {
            conversationId = data.conversationId;
          } else if (data.type === 'text') {
            streamingContent += data.content;
            await tick();
            scrollToBottom();
          } else if (data.type === 'thinking') {
            streamingThinking += data.content;
          } else if (data.type === 'exec_start') {
            const artifact: CodeArtifact = {
              id: `exec-${Date.now()}-${artifacts.length}`,
              lang: data.lang,
              code: data.code,
              title: summariseCode(data.lang, data.code),
              running: true,
              timestamp: new Date(),
              type: 'exec',
            };
            artifacts = [...artifacts, artifact];
            executions = [...executions, { lang: data.lang, code: data.code, output: null, running: true }];
            drawerOpen = true;
            expandedArtifact = artifact.id;
            await tick();
            scrollToBottom();
          } else if (data.type === 'exec_result') {
            if (executions.length > 0) {
              const last = executions[executions.length - 1];
              executions = [...executions.slice(0, -1), { ...last, output: data.output, exitCode: data.exitCode, running: false }];
            }
            // Update the matching artifact
            const lastArtifact = artifacts.findLast(a => a.type === 'exec' && a.running);
            if (lastArtifact) {
              artifacts = artifacts.map(a => a.id === lastArtifact.id
                ? { ...a, output: data.output, exitCode: data.exitCode, running: false }
                : a
              );
            }
            await tick();
            scrollToBottom();
          } else if (data.type === 'exec_status') {
            streamingContent += `\n\n${data.content}`;
          } else if (data.type === 'error') {
            streamingContent += `\n\n**Error:** ${data.content}`;
          }
        }
      }

      // Collect code blocks from the response as artifacts
      const inlineCollector: Array<{ id: string; lang: string; code: string; title: string }> = [];
      renderMarkdown(streamingContent, inlineCollector);
      if (inlineCollector.length > 0) {
        artifacts = [...artifacts, ...inlineCollector.map(c => ({
          ...c,
          timestamp: new Date(),
          type: 'block' as const,
        }))];
      }

      messages = [
        ...messages,
        {
          role: 'assistant',
          content: streamingContent,
          thinking: streamingThinking || undefined,
        },
      ];
      streamingContent = '';
      streamingThinking = '';
      loadConversations();
      highlightCode();
    } catch (err: any) {
      messages = [
        ...messages,
        { role: 'assistant', content: `**Error:** ${err.message}` },
      ];
    } finally {
      isStreaming = false;
      await tick();
      inputEl?.focus();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function autoResize(e: Event) {
    const el = e.target as HTMLTextAreaElement;
    el.style.height = '24px';
    const h = Math.min(el.scrollHeight, 200);
    el.style.height = h + 'px';
    el.style.overflowY = h >= 200 ? 'auto' : 'hidden';
  }

  async function deleteConversation(id: string, e: Event) {
    e.stopPropagation();
    await fetch(`/api/jkai/conversations?id=${id}`, { method: 'DELETE' });
    if (conversationId === id) newConversation();
    loadConversations();
  }

  onMount(async () => {
    const mod = await import('prismjs');
    Prism = mod.default;
    await import('prismjs/components/prism-python');
    await import('prismjs/components/prism-bash');
    await import('prismjs/components/prism-javascript');
    await import('prismjs/components/prism-typescript');
    await import('prismjs/components/prism-json');
    await import('prismjs/components/prism-yaml');
    await import('prismjs/components/prism-css');
    await import('prismjs/components/prism-markup');
    loadConversations();
    inputEl?.focus();

    function handleOpenArtifact(e: Event) {
      const id = (e as CustomEvent).detail;
      drawerOpen = true;
      expandedArtifact = id;
    }
    window.addEventListener('open-artifact', handleOpenArtifact);
    return () => window.removeEventListener('open-artifact', handleOpenArtifact);
  });
</script>

<div class="flex h-full">
  <!-- Sidebar -->
  <div class="sidebar" class:open={sidebarOpen}>
    <div class="sidebar-header">
      <button class="new-chat-btn" onclick={newConversation}>+ New Chat</button>
      <button class="close-sidebar" aria-label="Close sidebar" onclick={() => (sidebarOpen = false)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
      </button>
    </div>
    <div class="conversation-list">
      {#each conversations as conv}
        <div
          class="conv-item"
          class:active={conv.id === conversationId}
          role="button"
          tabindex="0"
          onclick={() => loadConversation(conv.id)}
          onkeydown={(e) => e.key === 'Enter' && loadConversation(conv.id)}
        >
          <span class="conv-title">{conv.title || 'Untitled'}</span>
          <button class="conv-delete" aria-label="Delete conversation" onclick={(e) => deleteConversation(conv.id, e)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      {/each}
    </div>
  </div>

  <!-- Main chat area -->
  <div class="chat-main">
    <!-- Top bar -->
    <div class="top-bar">
      <div class="top-bar-left">
        <button class="icon-btn" aria-label="Toggle sidebar" onclick={() => (sidebarOpen = !sidebarOpen)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
        </button>
        <span class="logo">JKAI <span class="version">2.0</span></span>
      </div>
      <div class="top-bar-right">
        <a href="/admin/agent" class="admin-link">Dashboard</a>
        <a href="/admin/agent/tasks" class="admin-link">Tasks</a>
        <a href="/admin/agent/actions" class="admin-link">Actions</a>
        <a href="/admin/agent/costs" class="admin-link">Costs</a>
        <a href="/jkai/admin" class="admin-link">Sandbox</a>
      </div>
    </div>

    <!-- Messages -->
    <div class="messages-container" bind:this={chatContainer}>
      {#if messages.length === 0 && !isStreaming}
        <div class="empty-state">
          <div class="empty-logo">JKAI</div>
          <p class="empty-subtitle">Autonomous assistant. Ask me to do anything.</p>
          <div class="empty-hints">
            <button class="hint" onclick={() => { input = 'Write a Python script to analyze CSV data'; inputEl?.focus(); }}>Analyze CSV data</button>
            <button class="hint" onclick={() => { input = 'Set up a scheduled task to check a website every hour'; inputEl?.focus(); }}>Schedule a task</button>
            <button class="hint" onclick={() => { input = 'Research the latest developments in WebAssembly'; inputEl?.focus(); }}>Research a topic</button>
          </div>
        </div>
      {:else}
        {#each messages as msg, i}
          <div class="message" class:user={msg.role === 'user'} class:assistant={msg.role === 'assistant'}>
            <div class="message-avatar">
              {#if msg.role === 'user'}
                <div class="avatar user-avatar">J</div>
              {:else}
                <div class="avatar ai-avatar">JK</div>
              {/if}
            </div>
            <div class="message-body">
              {#if msg.thinking}
                <button class="thinking-btn" onclick={() => (showThinking = !showThinking)}>
                  {showThinking ? 'Hide' : 'Show'} thinking
                </button>
                {#if showThinking}
                  <div class="thinking-block">{msg.thinking}</div>
                {/if}
              {/if}
              <div class="message-content">{@html renderMarkdown(msg.content)}</div>
            </div>
          </div>
        {/each}

        {#if isStreaming}
          <div class="message assistant">
            <div class="message-avatar">
              <div class="avatar ai-avatar streaming-pulse">JK</div>
            </div>
            <div class="message-body">
              {#if streamingThinking}
                <div class="thinking-block">{streamingThinking}</div>
              {/if}
              {#if streamingContent}
                <div class="message-content">{@html renderMarkdown(streamingContent)}</div>
              {/if}

              {#if executions.length > 0}
                {@const anyRunning = executions.some(e => e.running)}
                {@const completedCount = executions.filter(e => !e.running).length}
                {@const failedCount = executions.filter(e => e.exitCode !== undefined && e.exitCode !== 0).length}
                <button class="exec-status-pill" onclick={() => drawerOpen = true}>
                  {#if anyRunning}
                    <span class="exec-spinner"></span>
                    <span>Running step {completedCount + 1} of {executions.length}...</span>
                  {:else}
                    <span class="exec-icon" class:exec-ok={failedCount === 0} class:exec-err={failedCount > 0}>
                      {failedCount === 0 ? 'ok' : 'err'}
                    </span>
                    <span>{completedCount} step{completedCount !== 1 ? 's' : ''} completed</span>
                  {/if}
                  <span class="exec-status-arrow">→</span>
                </button>
              {/if}

              {#if !streamingContent && executions.length === 0}
                <div class="typing-indicator">
                  <span></span><span></span><span></span>
                </div>
              {/if}
            </div>
          </div>
        {/if}
      {/if}
    </div>

    <!-- Input area -->
    <div class="input-area">
      <div class="input-wrapper">
        <textarea
          bind:this={inputEl}
          bind:value={input}
          onkeydown={handleKeydown}
          oninput={autoResize}
          placeholder="Ask JKAI anything..."
          rows="1"
          disabled={isStreaming}
        ></textarea>
        <button
          class="send-btn"
          onclick={sendMessage}
          disabled={isStreaming || !input.trim()}
        >
          {#if isStreaming}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
          {:else}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
          {/if}
        </button>
      </div>
      <p class="input-hint">Enter to send, Shift+Enter for new line</p>
    </div>
  </div>

  <!-- Code Drawer -->
  {#if artifacts.length > 0}
    <button class="drawer-toggle" class:drawer-active={drawerOpen} onclick={() => drawerOpen = !drawerOpen} aria-label="Toggle code drawer">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 18l2-2-2-2"/><path d="M8 18l-2-2 2-2"/><path d="M12 2v20"/></svg>
      <span class="drawer-toggle-count">{artifacts.length}</span>
    </button>
  {/if}

  <div class="code-drawer" class:open={drawerOpen}>
    <div class="drawer-header">
      <span class="drawer-title">Code &amp; Artifacts</span>
      <button class="drawer-close" onclick={() => drawerOpen = false} aria-label="Close drawer">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="drawer-body">
      {#each [...artifacts].reverse() as artifact}
        <button
          class="artifact-item"
          class:artifact-running={artifact.running}
          class:artifact-error={artifact.exitCode !== undefined && artifact.exitCode !== 0}
          class:artifact-expanded={expandedArtifact === artifact.id}
          onclick={() => expandedArtifact = expandedArtifact === artifact.id ? null : artifact.id}
        >
          <div class="artifact-header">
            <div class="artifact-status">
              {#if artifact.running}
                <span class="exec-spinner"></span>
              {:else if artifact.type === 'exec'}
                <span class="exec-icon" class:exec-ok={artifact.exitCode === 0} class:exec-err={artifact.exitCode !== 0}>
                  {artifact.exitCode === 0 ? 'ok' : 'err'}
                </span>
              {:else}
                <span class="artifact-type-icon">&#x25B6;</span>
              {/if}
            </div>
            <div class="artifact-info">
              <span class="artifact-title">{artifact.title}</span>
              <span class="artifact-time">{artifact.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>

          {#if expandedArtifact === artifact.id}
            <div class="artifact-content" onclick={(e) => e.stopPropagation()}>
              <div class="artifact-code-header">
                <span class="artifact-code-lang">{artifact.lang || 'code'}</span>
                <button class="copy-btn-sm" onclick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(artifact.code).then(() => { (e.target as HTMLElement).textContent = 'Copied'; setTimeout(() => { (e.target as HTMLElement).textContent = 'Copy'; }, 1500); }); }}>Copy</button>
              </div>
              <pre class="artifact-code"><code>{artifact.code}</code></pre>
              {#if artifact.output !== undefined && artifact.output !== null}
                <div class="artifact-output-label">Output</div>
                <pre class="artifact-output">{artifact.output}</pre>
              {/if}
            </div>
          {/if}
        </button>
      {/each}
    </div>
  </div>
</div>

<script lang="ts" module>
  let codeBlockId = 0;

  function summariseCode(lang: string, code: string): string {
    const lines = code.trim().split('\n');
    const lineCount = lines.length;
    const langLabel = lang || 'code';

    // Try to extract a meaningful summary from the code
    const firstMeaningful = lines.find(l => l.trim() && !l.trim().startsWith('#') && !l.trim().startsWith('//') && !l.trim().startsWith('import'));
    const comments = lines.filter(l => l.trim().startsWith('#') || l.trim().startsWith('//'));
    const firstComment = comments[0]?.trim().replace(/^[#/]+\s*/, '');

    if (firstComment && firstComment.length > 5) {
      return `${langLabel} — ${firstComment} (${lineCount} lines)`;
    }

    // Look for function/class definitions
    const defLine = lines.find(l => /^(def |class |function |const |export |async )/.test(l.trim()));
    if (defLine) {
      const name = defLine.trim().slice(0, 60);
      return `${langLabel} — ${name}... (${lineCount} lines)`;
    }

    return `${langLabel} — ${lineCount} lines`;
  }

  function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderMarkdown(text: string, artifactCollector?: Array<{ id: string; lang: string; code: string; title: string }>): string {
    if (!text) return '';
    // Replace code blocks with inline reference pills that point to the drawer
    let result = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
      const id = `codeblock-${++codeBlockId}`;
      const title = summariseCode(lang, code);
      if (artifactCollector) {
        artifactCollector.push({ id, lang, code: code.trimEnd(), title });
      }
      return `<button class="code-ref-pill" data-artifact-id="${id}" onclick="window.dispatchEvent(new CustomEvent('open-artifact',{detail:'${id}'}))"><span class="code-ref-icon">&#x25B6;</span> ${escapeHtml(title)}</button>`;
    });

    result = result
      .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>');

    // Wrap consecutive <li> in <ul> so list spacing is controlled
    result = result.replace(/((?:<li>.*?<\/li>\n?)+)/g, '<ul>$1</ul>');

    // Protect block-level HTML (details, pre, ul) from paragraph wrapping
    const blocks: string[] = [];
    result = result.replace(/<(details|pre|ul|div)[\s\S]*?<\/\1>/g, (match) => {
      blocks.push(match);
      return `\x00BLOCK${blocks.length - 1}\x00`;
    });

    result = result
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')
      .replace(/^(.+)/, '<p>$1</p>');

    // Restore protected blocks
    result = result.replace(/\x00BLOCK(\d+)\x00/g, (_, i) => blocks[parseInt(i)]);

    return result;
  }
</script>

<style>
  /* Prism syntax theme — warm brutalist */
  :global(.code-block code[class*="language-"] .token.comment),
  :global(.code-block code[class*="language-"] .token.prolog),
  :global(.code-block code[class*="language-"] .token.doctype),
  :global(.code-block code[class*="language-"] .token.cdata) { color: #8a7a66; font-style: italic; }
  :global(.code-block code[class*="language-"] .token.punctuation) { color: #7a6b58; }
  :global(.code-block code[class*="language-"] .token.property),
  :global(.code-block code[class*="language-"] .token.tag),
  :global(.code-block code[class*="language-"] .token.boolean),
  :global(.code-block code[class*="language-"] .token.number),
  :global(.code-block code[class*="language-"] .token.constant),
  :global(.code-block code[class*="language-"] .token.symbol) { color: #c4570a; }
  :global(.code-block code[class*="language-"] .token.selector),
  :global(.code-block code[class*="language-"] .token.attr-name),
  :global(.code-block code[class*="language-"] .token.string),
  :global(.code-block code[class*="language-"] .token.char),
  :global(.code-block code[class*="language-"] .token.builtin) { color: #8a6d3b; }
  :global(.code-block code[class*="language-"] .token.operator),
  :global(.code-block code[class*="language-"] .token.entity),
  :global(.code-block code[class*="language-"] .token.url) { color: #7a6b58; }
  :global(.code-block code[class*="language-"] .token.atrule),
  :global(.code-block code[class*="language-"] .token.attr-value),
  :global(.code-block code[class*="language-"] .token.keyword) { color: #a84808; font-weight: 700; }
  :global(.code-block code[class*="language-"] .token.function),
  :global(.code-block code[class*="language-"] .token.class-name) { color: #5a4a38; font-weight: 700; }
  :global(.code-block code[class*="language-"] .token.regex),
  :global(.code-block code[class*="language-"] .token.important),
  :global(.code-block code[class*="language-"] .token.variable) { color: #c4570a; }

  /* Sidebar */
  .sidebar {
    width: 0;
    overflow: hidden;
    background: rgba(26, 16, 8, 0.04);
    border-right: 2px solid var(--card-border, rgba(26, 16, 8, 0.18));
    transition: width 0.2s ease;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }
  .sidebar.open { width: 280px; }
  .sidebar-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px;
    border-bottom: 2px solid var(--card-border);
  }
  .new-chat-btn {
    background: var(--card-bg, rgba(26, 16, 8, 0.07));
    color: var(--text-primary);
    border: 2px solid var(--card-border);
    padding: 8px 16px;
    border-radius: 0;
    cursor: pointer;
    font-size: 13px;
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    transition: background 0.15s;
  }
  .new-chat-btn:hover { background: rgba(26, 16, 8, 0.12); }
  .close-sidebar {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 4px;
  }
  .close-sidebar:hover { color: var(--text-primary); }
  .conversation-list { flex: 1; overflow-y: auto; padding: 8px; }
  .conv-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 10px 12px;
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 0;
    font-size: 13px;
    text-align: left;
    transition: background 0.15s;
  }
  .conv-item:hover { background: rgba(26, 16, 8, 0.06); color: var(--text-primary); }
  .conv-item.active { background: rgba(26, 16, 8, 0.1); color: var(--text-primary); border-left: 3px solid var(--accent); }
  .conv-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .conv-delete {
    background: none; border: none; color: var(--text-ghost); cursor: pointer;
    padding: 2px; opacity: 0; transition: opacity 0.15s;
  }
  .conv-item:hover .conv-delete { opacity: 1; }
  .conv-delete:hover { color: #c0392b; }

  /* Main */
  .chat-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .top-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 16px;
    border-bottom: 2px solid var(--card-border);
    background: rgba(26, 16, 8, 0.03);
  }
  .top-bar-left { display: flex; align-items: center; gap: 12px; }
  .top-bar-right { display: flex; align-items: center; gap: 16px; }
  .icon-btn {
    background: none; border: none; color: var(--text-muted); cursor: pointer;
    padding: 6px; border-radius: 0; transition: color 0.15s, background 0.15s;
  }
  .icon-btn:hover { color: var(--text-primary); background: rgba(26, 16, 8, 0.06); }
  .logo {
    font-family: var(--font-display, 'Archivo Black', sans-serif);
    font-weight: 900;
    font-size: 16px;
    color: var(--text-primary);
    letter-spacing: -0.02em;
    text-transform: uppercase;
  }
  .version { color: var(--accent); font-size: 11px; font-family: var(--font-mono); }
  .admin-link {
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    text-decoration: none;
    transition: color 0.15s;
  }
  .admin-link:hover { color: var(--accent); }

  /* Messages */
  .messages-container { flex: 1; overflow-y: auto; padding: 24px 0; }
  .message {
    display: flex; gap: 16px; padding: 16px 24px;
    max-width: 900px; margin: 0 auto; width: 100%; box-sizing: border-box;
  }
  .message.user { background: rgba(26, 16, 8, 0.03); }
  .message-avatar { flex-shrink: 0; }
  .avatar {
    width: 32px; height: 32px; border-radius: 0;
    display: flex; align-items: center; justify-content: center;
    font-family: var(--font-mono); font-size: 12px; font-weight: 700;
    border: 2px solid var(--card-border);
  }
  .user-avatar { background: rgba(26, 16, 8, 0.07); color: var(--text-primary); }
  .ai-avatar { background: var(--accent); color: white; border-color: var(--accent); }
  .streaming-pulse { animation: pulse 1.5s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
  .message-body { flex: 1; min-width: 0; line-height: 1.4; font-size: 14px; }

  /* Thinking block */
  .thinking-btn {
    background: none; border: 2px solid var(--card-border); color: var(--text-muted);
    font-family: var(--font-mono); font-size: 11px; padding: 4px 10px;
    border-radius: 0; cursor: pointer; margin-bottom: 8px;
    text-transform: uppercase; letter-spacing: 0.05em;
  }
  .thinking-btn:hover { color: var(--text-primary); border-color: var(--text-secondary); }
  .thinking-block {
    background: rgba(26, 16, 8, 0.04); border-left: 3px solid var(--accent);
    padding: 12px 16px; margin-bottom: 12px; font-size: 13px;
    color: var(--text-muted); font-family: var(--font-mono); white-space: pre-wrap;
  }

  /* Execution blocks */
  .exec-block {
    margin: 12px 0;
    border: 2px solid var(--card-border);
    background: rgba(26, 16, 8, 0.03);
  }
  .exec-block.exec-running { border-color: var(--accent); }
  .exec-block.exec-fail { border-left: 3px solid #c0392b; }
  .exec-details, .exec-output-details { }
  .exec-summary {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-muted);
    list-style: none;
    user-select: none;
  }
  .exec-summary::-webkit-details-marker { display: none; }
  .exec-spinner {
    width: 12px; height: 12px;
    border: 2px solid var(--card-border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .exec-icon {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    padding: 1px 6px;
    border: 1px solid;
  }
  .exec-ok { color: #27ae60; border-color: #27ae60; }
  .exec-err { color: #c0392b; border-color: #c0392b; }
  .exec-lang {
    color: var(--accent);
    text-transform: uppercase;
    font-weight: 700;
    letter-spacing: 0.05em;
  }
  .exec-label { color: var(--text-ghost); }
  .exec-code {
    margin: 0;
    padding: 14px 16px;
    background: #1a1008;
    border-top: 1px solid var(--card-border);
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.5;
    color: #ede4d4;
    overflow-x: auto;
    white-space: pre;
    tab-size: 4;
  }
  .exec-code code { font-family: inherit; white-space: pre; }
  .exec-output-summary {
    display: flex;
    align-items: center;
    padding: 6px 12px;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-ghost);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-top: 1px solid var(--card-border);
    list-style: none;
    user-select: none;
  }
  .exec-output-summary::-webkit-details-marker { display: none; }
  .exec-output {
    margin: 0;
    padding: 14px 16px;
    background: #1a1008;
    color: #ede4d4;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.5;
    overflow-x: auto;
    white-space: pre;
    max-height: 400px;
    overflow-y: auto;
  }

  /* Execution group — collapsed coding activity */
  .exec-group {
    margin: 12px 0;
    border: 2px solid var(--card-border);
    background: rgba(26, 16, 8, 0.03);
  }
  .exec-group-summary {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-muted);
    list-style: none;
    user-select: none;
  }
  .exec-group-summary::-webkit-details-marker { display: none; }
  .exec-group-label { color: var(--text-ghost); }
  .exec-group-body {
    border-top: 1px solid var(--card-border);
    padding: 4px 0;
  }
  .exec-group-body .exec-block {
    margin: 4px 8px;
    border-width: 1px;
  }
  .exec-output-inline {
    border-top: 1px solid var(--card-border);
  }
  .exec-output-inline .exec-output {
    max-height: 200px;
  }

  /* Rendered markdown */
  .message-content :global(p) { margin: 0 0 4px 0; }
  .message-content :global(p:last-child) { margin-bottom: 0; }
  .message-content :global(h1),
  .message-content :global(h2),
  .message-content :global(h3) {
    font-family: var(--font-display); font-weight: 900;
    margin: 8px 0 4px; color: var(--text-primary); text-transform: uppercase;
  }
  .message-content :global(h1) { font-size: 18px; }
  .message-content :global(h2) { font-size: 16px; }
  .message-content :global(h3) { font-size: 14px; }
  .message-content :global(strong) { color: var(--text-primary); }
  .message-content :global(ul) { margin: 2px 0; padding-left: 20px; list-style: disc; }
  .message-content :global(li) { margin: 0; padding: 0; line-height: 1.4; }
  .message-content :global(.code-collapse) {
    margin: 12px 0;
    border: 2px solid var(--card-border);
    background: rgba(26, 16, 8, 0.04);
  }
  .message-content :global(.code-summary) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-muted);
    user-select: none;
    list-style: none;
    gap: 12px;
  }
  .message-content :global(.code-summary::-webkit-details-marker) { display: none; }
  .message-content :global(.code-summary::before) {
    content: '\25B6';
    font-size: 9px;
    color: var(--text-ghost);
    transition: transform 0.15s;
    flex-shrink: 0;
  }
  .message-content :global(details[open] > .code-summary::before) {
    transform: rotate(90deg);
  }
  .message-content :global(.code-summary:hover) {
    color: var(--text-primary);
    background: rgba(26, 16, 8, 0.03);
  }
  .message-content :global(.code-summary-text) {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .message-content :global(.copy-btn) {
    background: none;
    border: 1px solid var(--card-border);
    color: var(--text-ghost);
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 3px 10px;
    cursor: pointer;
    flex-shrink: 0;
    transition: color 0.15s, border-color 0.15s;
  }
  .message-content :global(.copy-btn:hover) {
    color: var(--accent);
    border-color: var(--accent);
  }
  .message-content :global(.code-block) {
    background: #1a1008;
    border-top: 1px solid var(--card-border);
    padding: 14px 16px;
    overflow-x: auto;
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
    white-space: pre;
    tab-size: 4;
  }
  .message-content :global(.code-block code) {
    font-family: var(--font-mono);
    color: #ede4d4;
    white-space: pre;
  }
  .message-content :global(.inline-code) {
    background: rgba(26, 16, 8, 0.08);
    padding: 2px 6px;
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--accent);
    border: 1px solid var(--card-border);
  }
  .message-content :global(.code-activity-group) {
    margin: 12px 0;
    border: 2px solid var(--card-border);
    background: rgba(26, 16, 8, 0.03);
  }
  .message-content :global(.code-activity-summary) {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-muted);
    list-style: none;
    user-select: none;
  }
  .message-content :global(.code-activity-summary::-webkit-details-marker) { display: none; }
  .message-content :global(.code-activity-icon) {
    font-size: 9px;
    color: var(--text-ghost);
    transition: transform 0.15s;
  }
  .message-content :global(details[open] > .code-activity-summary .code-activity-icon) {
    transform: rotate(90deg);
  }
  .message-content :global(.code-activity-body) {
    border-top: 1px solid var(--card-border);
    padding: 4px 8px;
  }
  .message-content :global(.code-activity-body .code-collapse) {
    margin: 4px 0;
    border-width: 1px;
  }

  /* Typing indicator */
  .typing-indicator { display: flex; gap: 4px; padding: 4px 0; }
  .typing-indicator span {
    width: 6px; height: 6px; background: var(--text-ghost);
    border-radius: 50%; animation: typing 1.4s ease-in-out infinite;
  }
  .typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
  .typing-indicator span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes typing {
    0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
    30% { transform: translateY(-6px); opacity: 1; }
  }

  /* Empty state */
  .empty-state {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; height: 100%; padding: 48px; text-align: center;
  }
  .empty-logo {
    font-family: var(--font-display); font-size: 64px; font-weight: 900;
    color: rgba(26, 16, 8, 0.08); letter-spacing: -0.02em;
    text-transform: uppercase; margin-bottom: 16px;
  }
  .empty-subtitle { color: var(--text-muted); font-size: 16px; margin-bottom: 32px; }
  .empty-hints { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
  .hint {
    background: var(--card-bg); border: 2px solid var(--card-border);
    color: var(--text-muted); padding: 10px 18px; border-radius: 0;
    cursor: pointer; font-size: 13px; transition: border-color 0.15s, color 0.15s;
  }
  .hint:hover { border-color: var(--accent); color: var(--text-primary); }

  /* Input */
  .input-area {
    padding: 16px 24px 12px;
    border-top: 2px solid var(--card-border);
    background: rgba(26, 16, 8, 0.03);
  }
  .input-wrapper {
    max-width: 900px; margin: 0 auto; display: flex;
    align-items: flex-end; gap: 8px;
    background: white; border: 2px solid var(--card-border);
    padding: 6px 10px; transition: border-color 0.15s;
  }
  .input-wrapper:focus-within { border-color: var(--accent); }
  textarea {
    flex: 1; background: none; border: none; color: var(--text-primary);
    font-family: var(--font-body); font-size: 15px; line-height: 1.5;
    resize: none; outline: none;
    height: 24px; min-height: 24px; max-height: 200px;
    overflow-y: hidden;
  }
  textarea::placeholder { color: var(--text-ghost); }
  textarea:disabled { opacity: 0.5; }
  .send-btn {
    background: var(--accent); border: none; color: white;
    width: 24px; height: 24px; border-radius: 0; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    padding: 0;
    flex-shrink: 0; transition: background 0.15s;
  }
  .send-btn:hover:not(:disabled) { background: var(--accent-hover); }
  .send-btn:disabled { opacity: 0.3; cursor: default; }
  .input-hint {
    text-align: center; font-size: 11px; color: var(--text-ghost);
    margin-top: 8px; font-family: var(--font-mono);
  }

  /* Inline code reference pill */
  .message-content :global(.code-ref-pill) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin: 6px 0;
    padding: 6px 12px;
    background: rgba(26, 16, 8, 0.06);
    border: 1px solid var(--card-border);
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: 12px;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
    width: 100%;
    text-align: left;
  }
  .message-content :global(.code-ref-pill:hover) {
    background: rgba(26, 16, 8, 0.1);
    border-color: var(--accent);
  }
  .message-content :global(.code-ref-icon) {
    font-size: 9px;
    color: var(--text-ghost);
  }

  /* Exec status pill (inline in chat) */
  .exec-status-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin: 8px 0;
    padding: 8px 14px;
    background: rgba(26, 16, 8, 0.04);
    border: 1px solid var(--card-border);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 12px;
    cursor: pointer;
    transition: background 0.15s;
    width: 100%;
    text-align: left;
  }
  .exec-status-pill:hover {
    background: rgba(26, 16, 8, 0.08);
  }
  .exec-status-arrow {
    margin-left: auto;
    color: var(--text-ghost);
  }

  /* Drawer toggle button */
  .drawer-toggle {
    position: fixed;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 10px 8px;
    background: rgba(26, 16, 8, 0.9);
    border: 2px solid var(--card-border);
    border-right: none;
    border-radius: 6px 0 0 6px;
    color: var(--text-muted);
    cursor: pointer;
    transition: color 0.15s, background 0.15s;
    flex-direction: column;
  }
  .drawer-toggle:hover, .drawer-toggle.drawer-active {
    color: var(--accent);
    background: rgba(26, 16, 8, 0.95);
  }
  .drawer-toggle-count {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
  }

  /* Code drawer */
  .code-drawer {
    position: fixed;
    top: 0;
    right: 0;
    width: 0;
    height: 100vh;
    background: rgba(10, 8, 6, 0.97);
    border-left: 2px solid var(--card-border);
    z-index: 25;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transition: width 0.2s ease;
  }
  .code-drawer.open {
    width: 420px;
  }
  .drawer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 16px;
    border-bottom: 1px solid var(--card-border);
    flex-shrink: 0;
  }
  .drawer-title {
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    color: var(--text-ghost);
  }
  .drawer-close {
    background: none;
    border: none;
    color: var(--text-ghost);
    cursor: pointer;
    padding: 4px;
  }
  .drawer-close:hover { color: var(--text-primary); }
  .drawer-body {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    scrollbar-width: thin;
  }

  /* Artifact items in drawer */
  .artifact-item {
    width: 100%;
    text-align: left;
    padding: 10px 12px;
    margin-bottom: 4px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid transparent;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }
  .artifact-item:hover {
    background: rgba(255, 255, 255, 0.04);
  }
  .artifact-item.artifact-expanded {
    border-color: var(--card-border);
    background: rgba(255, 255, 255, 0.03);
  }
  .artifact-item.artifact-running {
    border-left: 2px solid var(--accent);
  }
  .artifact-item.artifact-error {
    border-left: 2px solid #c0392b;
  }
  .artifact-header {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
  .artifact-status {
    flex-shrink: 0;
    margin-top: 1px;
  }
  .artifact-type-icon {
    font-size: 8px;
    color: var(--text-ghost);
  }
  .artifact-info {
    flex: 1;
    min-width: 0;
  }
  .artifact-title {
    display: block;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.3;
  }
  .artifact-time {
    display: block;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-ghost);
    margin-top: 2px;
  }

  /* Expanded artifact content */
  .artifact-content {
    margin-top: 10px;
    border-top: 1px solid var(--card-border);
    padding-top: 8px;
  }
  .artifact-code-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  }
  .artifact-code-lang {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--accent);
    font-weight: 700;
  }
  .copy-btn-sm {
    background: none;
    border: 1px solid var(--card-border);
    color: var(--text-ghost);
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    padding: 2px 8px;
    cursor: pointer;
  }
  .copy-btn-sm:hover { color: var(--accent); border-color: var(--accent); }
  .artifact-code {
    margin: 0;
    padding: 10px 12px;
    background: #1a1008;
    border: 1px solid var(--card-border);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.5;
    color: #ede4d4;
    overflow-x: auto;
    white-space: pre;
    max-height: 300px;
    overflow-y: auto;
  }
  .artifact-code code { font-family: inherit; white-space: pre; }
  .artifact-output-label {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
    margin-top: 8px;
    margin-bottom: 4px;
  }
  .artifact-output {
    margin: 0;
    padding: 10px 12px;
    background: #1a1008;
    border: 1px solid var(--card-border);
    color: #ede4d4;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.4;
    overflow-x: auto;
    white-space: pre;
    max-height: 200px;
    overflow-y: auto;
  }
</style>
