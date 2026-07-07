<script lang="ts">
  import ChatMessage from '$lib/components/jkai/ChatMessage.svelte';

  let { data } = $props();

  function relTime(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
</script>

<svelte:head>
  <title>{data.title || 'Shared conversation'} — jkai</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="shared">
  <header class="hd">
    <a class="brand" href="/">sr.</a>
    <span class="badge">
      <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M7 10a3 3 0 0 1 3-3h2a3 3 0 0 1 0 6h-1"/><path d="M13 10a3 3 0 0 1-3 3H8a3 3 0 0 1 0-6h1"/></svg>
      Shared · read-only
    </span>
  </header>

  <main class="body">
    <h1 class="title">{data.title || 'Conversation'}</h1>
    <div class="sub">Shared from jkai · {relTime(data.updatedAt)}</div>

    <div class="messages">
      {#if data.messages.length === 0}
        <div class="empty">This conversation has no messages to show.</div>
      {:else}
        {#each data.messages as m (m.id)}
          <ChatMessage
            role={m.role}
            content={m.content}
            createdAt={m.createdAt}
            conversationId={null}
          />
        {/each}
      {/if}
    </div>

    <footer class="ft">
      A read-only snapshot shared from
      <a href="https://strangeramblings.com">strangeramblings.com</a>. Reply and
      the full assistant live at <a href="/jkai">jkai</a> (owner only).
    </footer>
  </main>
</div>

<style>
  .shared {
    min-height: 100dvh;
    background: var(--bg);
    color: var(--text-primary);
    font-family: var(--font-sans);
  }
  .hd {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
    border-bottom: 1px solid var(--card-border);
    position: sticky;
    top: 0;
    background: var(--bg);
    z-index: 5;
  }
  .brand {
    font-family: var(--font-brand, var(--font-mono));
    font-size: 20px;
    font-weight: 500;
    color: var(--text-primary);
    text-decoration: none;
    letter-spacing: -0.02em;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-secondary);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-round);
    padding: 4px 9px;
  }
  .body {
    max-width: 760px;
    margin: 0 auto;
    padding: 28px 20px 64px;
  }
  .title {
    font-family: var(--font-display);
    font-size: clamp(1.5rem, 4vw, 2.1rem);
    line-height: 1.1;
    color: var(--text-primary);
    margin: 0;
  }
  .sub {
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-ghost);
    margin-top: 8px;
    padding-bottom: 18px;
    border-bottom: 1px solid var(--card-border);
  }
  .messages {
    margin-top: 22px;
    display: flex;
    flex-direction: column;
  }
  .empty {
    color: var(--text-ghost);
    font-size: 14px;
    text-align: center;
    padding: 40px 0;
  }
  .ft {
    margin-top: 36px;
    padding-top: 18px;
    border-top: 1px solid var(--card-border);
    font-size: 12px;
    color: var(--text-ghost);
    line-height: 1.5;
  }
  .ft a {
    color: var(--accent);
    text-decoration: none;
  }
  .ft a:hover {
    text-decoration: underline;
  }
</style>
