<script lang="ts">
  // The read-only public view of a shared jkai conversation, and the ONE
  // anonymous surface under /jkai ('/jkai/shared' is a PUBLIC prefix in
  // $lib/auth.ts; per-conversation visibility is enforced in +page.server.ts).
  //
  // `+page@.svelte` (not `+page.svelte`) resets to the ROOT layout on purpose,
  // exactly as /jkai/run does. /jkai/+layout.svelte draws HubHeader, which puts
  // the day's token count, the GBP spend, the OpenRouter credit balance and the
  // Codex subscription quota in front of whoever is holding the share link —
  // the hub shell has no owner check of its own, because every other route
  // beneath it is owner-gated by the hook. It also drops the tab bar, the
  // command palette and the jkai PWA/service-worker registration, none of which
  // belong on a page a stranger opens once.
  import SiteHeader from '$lib/components/SiteHeader.svelte';
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

<!-- `.jkai-shared` is the type hook, and it is here for the same reason
     `/jkai/run` carries `.jkai-runner`: resetting to the root layout drops
     `.jkai-root`, and app.css keys jkai's reading face off the hook classes,
     not off the URL. Without it this page renders the ChatMessage component
     in site type while every other copy of the same conversation is in
     Selawik — a snapshot that does not look like the thing it snapshots. -->
<div class="shared jkai-shared">
  <!-- Ordinary site chrome in place of the hub masthead: the home icon, the
       section cell, and the read-only badge this page has always carried.
       `isOwner={false}` and `items={[]}` because the visitor here is not the
       owner and every /jkai cell would 302 them to /login — the jkai section is
       `ownerOnly` as a whole, so its items carry no per-item flag for
       `visibleItems` to filter on. `showBack={false}` because there is nothing
       above this page for a share-link holder: `parentHref` steps over
       /jkai/shared (a GROUPING_SEGMENT, no page behind it) and lands on /jkai,
       which for an anonymous visitor is the auth gate. A back cell here would
       read "← JKAI" and 302 them to /login. -->
  <SiteHeader title="Shared conversation" isOwner={false} showBack={false} items={[]}>
    {#snippet right()}
      <span class="badge">
        <svg
          width="12"
          height="12"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          aria-hidden="true"
        >
          <path d="M7 10a3 3 0 0 1 3-3h2a3 3 0 0 1 0 6h-1" />
          <path d="M13 10a3 3 0 0 1-3 3H8a3 3 0 0 1 0-6h1" />
        </svg>
        Shared · read-only
      </span>
    {/snippet}
  </SiteHeader>

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
            canRun={false}
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
    font-family: var(--font-body);
  }
  /* Inside .site-nav-bar, so every colour here is written for the INK ground:
     cream-alpha for the text and the hairline, never --line-hair (ink on ink)
     and never --accent (2.6:1 on #1a1008). */
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-code);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: rgba(237, 228, 212, 0.72);
    border: 1px solid rgba(237, 228, 212, 0.14);
    border-radius: var(--radius-round);
    padding: 3px 9px;
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
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-ghost);
    margin-top: 8px;
    padding-bottom: 18px;
    border-bottom: 1px solid var(--line-strong);
  }
  .messages {
    margin-top: 22px;
    display: flex;
    flex-direction: column;
  }
  .empty {
    color: var(--text-ghost);
    font-size: var(--fs-body-sm);
    text-align: center;
    padding: 40px 0;
  }
  .ft {
    margin-top: 36px;
    padding-top: 18px;
    border-top: 1px solid var(--line-strong);
    font-size: var(--fs-label);
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
