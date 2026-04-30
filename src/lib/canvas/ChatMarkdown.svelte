<script lang="ts" module>
  import { Marked } from 'marked';
  import { sanitizeChatHtml } from '$lib/security/sanitize-chat';
  // Module-singleton so every chat message shares the same renderer.
  const marked = new Marked({ gfm: true, breaks: true });
  export function renderMarkdown(src: string): string {
    if (!src) return '';
    try {
      return sanitizeChatHtml(marked.parse(src) as string);
    } catch {
      return sanitizeChatHtml(src);
    }
  }
</script>

<script lang="ts">
  let {
    content,
    role = 'assistant',
  }: {
    content: string;
    role?: 'user' | 'assistant' | 'system';
  } = $props();

  const rendered = $derived(role === 'assistant' ? renderMarkdown(content) : '');
</script>

{#if role === 'assistant' && rendered}
  <div class="chat-md">{@html rendered}</div>
{:else}
  <div class="chat-plain">{content}</div>
{/if}

<style>
  .chat-plain {
    white-space: pre-wrap;
    word-break: break-word;
  }
  .chat-md {
    font-size: 12px;
    line-height: 1.55;
    color: var(--text-primary);
    word-break: break-word;
  }
  .chat-md :global(p) {
    margin: 0 0 0.5em;
  }
  .chat-md :global(p:last-child) {
    margin-bottom: 0;
  }
  .chat-md :global(strong) {
    font-weight: 600;
  }
  .chat-md :global(em) {
    font-style: italic;
  }
  .chat-md :global(code) {
    font-family: var(--font-mono);
    font-size: 0.9em;
    background: var(--bg-section);
    border: 1px solid var(--card-border);
    padding: 0 4px;
    border-radius: 2px;
  }
  .chat-md :global(pre) {
    margin: 0.6em 0;
    padding: 8px 10px;
    background: #1a1008;
    color: #ede4d4;
    border: 1px solid var(--card-border);
    overflow-x: auto;
    font-size: 11px;
    line-height: 1.5;
    border-radius: 2px;
  }
  .chat-md :global(pre code) {
    background: none;
    border: none;
    padding: 0;
    color: inherit;
    font-size: inherit;
  }
  .chat-md :global(ul) {
    margin: 0 0 0.5em;
    padding-left: 1.3em;
    list-style: disc outside;
  }
  .chat-md :global(ol) {
    margin: 0 0 0.5em;
    padding-left: 1.3em;
    list-style: decimal outside;
  }
  .chat-md :global(ul:last-child),
  .chat-md :global(ol:last-child) {
    margin-bottom: 0;
  }
  .chat-md :global(li) {
    margin: 0 0 0.12em;
  }
  .chat-md :global(li:last-child) {
    margin-bottom: 0;
  }
  .chat-md :global(li > p) {
    margin: 0 0 0.12em;
  }
  .chat-md :global(li > p:last-child) {
    margin-bottom: 0;
  }
  .chat-md :global(li > ul),
  .chat-md :global(li > ol) {
    margin: 0.12em 0 0;
  }
  .chat-md :global(h1),
  .chat-md :global(h2),
  .chat-md :global(h3),
  .chat-md :global(h4) {
    font-weight: 600;
    margin: 0.6em 0 0.3em;
    line-height: 1.3;
  }
  .chat-md :global(h1:first-child),
  .chat-md :global(h2:first-child),
  .chat-md :global(h3:first-child),
  .chat-md :global(h4:first-child) {
    margin-top: 0;
  }
  .chat-md :global(h1) {
    font-size: 1.15em;
  }
  .chat-md :global(h2) {
    font-size: 1.08em;
  }
  .chat-md :global(h3) {
    font-size: 1em;
  }
  .chat-md :global(h4) {
    font-size: 0.95em;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }
  .chat-md :global(blockquote) {
    border-left: 3px solid var(--accent-tint-35, rgba(196, 87, 10, 0.35));
    padding-left: 10px;
    margin: 0.5em 0;
    color: var(--text-muted);
  }
  .chat-md :global(a) {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .chat-md :global(a:hover) {
    text-decoration-thickness: 2px;
  }
  .chat-md :global(hr) {
    border: none;
    border-top: 1px solid var(--divider);
    margin: 0.8em 0;
  }
  .chat-md :global(table) {
    border-collapse: collapse;
    margin: 0.5em 0;
    font-size: 11px;
    width: 100%;
  }
  .chat-md :global(th),
  .chat-md :global(td) {
    border: 1px solid var(--card-border);
    padding: 4px 8px;
    text-align: left;
  }
  .chat-md :global(th) {
    background: var(--bg-section);
    font-weight: 600;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .chat-md :global(img) {
    max-width: 100%;
    height: auto;
    border: 1px solid var(--card-border);
  }
</style>
