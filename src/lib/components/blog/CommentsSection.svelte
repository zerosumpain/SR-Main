<script lang="ts">
  /**
   * Reader comments — a subtle feature, not a forum.
   *
   * The form is collapsed behind one line of text until someone asks for it,
   * so an article that nobody has commented on ends with a quiet invitation
   * rather than an empty box demanding to be filled.
   *
   * Bodies are rendered as TEXT, never `{@html}`. The article above is rendered
   * with `{@html}` because it is the owner's own sanitised prose; a stranger's
   * comment through the same path is stored XSS on the most-linked public page
   * on the site. `white-space: pre-wrap` preserves the paragraphing without a
   * renderer, and no auto-linking means nothing here is worth spamming.
   */
  import type { PublicComment } from '$lib/blog/comments';
  import { MAX_BODY_LENGTH, MAX_NAME_LENGTH, validateComment } from '$lib/blog/comments';

  let {
    slug,
    comments = [],
  }: {
    slug: string;
    comments?: PublicComment[];
  } = $props();

  let open = $state(false);
  let authorName = $state('');
  let body = $state('');
  /** The honeypot. Hidden from people, irresistible to naive bots. */
  let website = $state('');
  let replyTo = $state<number | null>(null);

  let submitting = $state(false);
  let error = $state<string | null>(null);
  let sent = $state(false);

  const top = $derived(comments.filter((c) => c.parentId === null));
  // A plain function, not a $derived: a derived holding a closure recomputes
  // the closure rather than the result, which buys nothing. The template re-runs
  // when `comments` changes either way.
  const repliesFor = (id: number) => comments.filter((c) => c.parentId === id);

  const remaining = $derived(MAX_BODY_LENGTH - body.length);

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (submitting) return;

    // The same validator the server runs. This is a courtesy — it saves a round
    // trip and gives a better message — never the check that counts.
    const check = validateComment({ authorName, body, website });
    if (!check.ok) {
      error = check.error === 'honeypot' ? null : check.error;
      if (check.error === 'honeypot') {
        sent = true;
        open = false;
      }
      return;
    }

    submitting = true;
    error = null;
    try {
      const res = await fetch(`/blog/${encodeURIComponent(slug)}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ authorName, body, website, parentId: replyTo }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        error = payload.error ?? 'That did not go through. Try again in a moment.';
        return;
      }
      sent = true;
      open = false;
      body = '';
      replyTo = null;
    } catch {
      error = 'That did not go through — check your connection and try again.';
    } finally {
      submitting = false;
    }
  }

  function startReply(id: number) {
    replyTo = id;
    open = true;
    sent = false;
    queueMicrotask(() => document.getElementById('comment-body')?.focus());
  }
</script>

<section class="comments" aria-labelledby="comments-heading">
  <h2 id="comments-heading" class="c-heading">
    {comments.length === 0 ? 'Responses' : `${comments.length} response${comments.length === 1 ? '' : 's'}`}
  </h2>

  {#if top.length > 0}
    <ol class="c-list">
      {#each top as comment (comment.id)}
        <li class="c-item">
          <div class="c-meta">
            <span class="c-author">{comment.authorName}</span>
            <span class="c-date">{formatDate(comment.createdAt)}</span>
          </div>
          <p class="c-body">{comment.body}</p>
          <button class="c-reply" onclick={() => startReply(comment.id)}>Reply</button>

          {#if repliesFor(comment.id).length > 0}
            <ol class="c-replies">
              {#each repliesFor(comment.id) as reply (reply.id)}
                <li class="c-item">
                  <div class="c-meta">
                    <span class="c-author">{reply.authorName}</span>
                    <span class="c-date">{formatDate(reply.createdAt)}</span>
                  </div>
                  <p class="c-body">{reply.body}</p>
                </li>
              {/each}
            </ol>
          {/if}
        </li>
      {/each}
    </ol>
  {/if}

  {#if sent}
    <p class="c-sent">
      Thanks — that is with John. Comments are read before they appear, so it will not show up
      straight away.
    </p>
  {/if}

  {#if !open}
    <button class="c-open" onclick={() => { open = true; sent = false; }}>
      {top.length === 0 ? 'Be the first to respond' : 'Add a response'}
    </button>
  {:else}
    <form class="c-form" onsubmit={submit}>
      {#if replyTo !== null}
        <p class="c-replying">
          Replying to {comments.find((c) => c.id === replyTo)?.authorName ?? 'a comment'}
          <button type="button" class="c-cancel-reply" onclick={() => (replyTo = null)}>cancel</button>
        </p>
      {/if}

      <label class="c-field">
        <span class="c-label">Name</span>
        <input
          class="c-input"
          type="text"
          bind:value={authorName}
          maxlength={MAX_NAME_LENGTH}
          autocomplete="name"
          required
        />
      </label>

      <label class="c-field">
        <span class="c-label">Response</span>
        <textarea
          id="comment-body"
          class="c-textarea"
          bind:value={body}
          maxlength={MAX_BODY_LENGTH}
          rows="5"
          required
        ></textarea>
        <span class="c-count" class:low={remaining < 200}>{remaining} left</span>
      </label>

      <!-- Honeypot. aria-hidden and off-screen rather than display:none, because
           some bots skip hidden inputs but not positioned ones. -->
      <div class="c-hp" aria-hidden="true">
        <label>
          Website
          <input type="text" tabindex="-1" autocomplete="off" bind:value={website} />
        </label>
      </div>

      {#if error}
        <p class="c-error">{error}</p>
      {/if}

      <div class="c-actions">
        <button class="c-submit" type="submit" disabled={submitting}>
          {submitting ? 'Sending…' : 'Post response'}
        </button>
        <button class="c-cancel" type="button" onclick={() => { open = false; error = null; }}>
          Cancel
        </button>
      </div>

      <p class="c-note">
        No account, no email address, nothing stored beyond your name and what you write.
        Responses are read before they appear.
      </p>
    </form>
  {/if}
</section>

<style>
  .comments {
    margin-top: 4rem;
    padding-top: 2rem;
    border-top: 2px solid var(--line-strong);
  }

  .c-heading {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-muted);
    margin: 0 0 1.5rem;
  }

  .c-list,
  .c-replies {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .c-item {
    padding: 1rem 0;
    border-bottom: 1px solid var(--card-border);
  }

  .c-replies {
    margin-top: 0.75rem;
    padding-left: 1.25rem;
    border-left: 2px solid var(--card-border);
  }

  .c-replies .c-item:last-child {
    border-bottom: none;
    padding-bottom: 0;
  }

  .c-meta {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    margin-bottom: 0.35rem;
  }

  .c-author {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
  }

  .c-date {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }

  .c-body {
    margin: 0;
    /* Paragraphing without a renderer. Nothing here is parsed as markup. */
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: var(--fs-body);
    line-height: 1.65;
    color: var(--text-secondary);
  }

  .c-reply,
  .c-cancel,
  .c-cancel-reply {
    background: none;
    border: none;
    padding: 0;
    margin-top: 0.5rem;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    cursor: pointer;
  }

  .c-reply:hover,
  .c-cancel:hover,
  .c-cancel-reply:hover {
    color: var(--accent);
  }

  .c-open {
    margin-top: 1.5rem;
    padding: 0.55rem 1rem;
    background: transparent;
    border: 1px solid var(--card-border);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-secondary);
    cursor: pointer;
    transition: border-color 0.15s ease-out, color 0.15s ease-out;
  }

  .c-open:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .c-form {
    margin-top: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .c-replying {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }

  .c-field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    position: relative;
  }

  .c-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
  }

  .c-input,
  .c-textarea {
    width: 100%;
    padding: 0.6rem 0.75rem;
    background: var(--bg);
    border: 1px solid var(--card-border);
    color: var(--text-primary);
    font-family: var(--font-body);
    /* 16px, not smaller: mobile Safari force-zooms the viewport on any focused
       field under 16px and strands the rest of the form off-screen. */
    font-size: var(--fs-body);
    line-height: 1.5;
  }

  .c-textarea {
    resize: vertical;
    min-height: 7rem;
  }

  .c-input:focus,
  .c-textarea:focus {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
    border-color: var(--accent);
  }

  .c-count {
    position: absolute;
    right: 0;
    top: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost, var(--text-muted));
  }

  .c-count.low {
    color: var(--warn);
  }

  .c-hp {
    position: absolute;
    left: -9999px;
    width: 1px;
    height: 1px;
    overflow: hidden;
  }

  .c-error {
    margin: 0;
    padding: 0.5rem 0.75rem;
    border-left: 3px solid var(--error);
    background: var(--card-bg);
    font-size: var(--fs-body-sm);
    color: var(--text-primary);
  }

  .c-actions {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .c-submit {
    padding: 0.55rem 1.1rem;
    background: var(--accent);
    border: 1px solid var(--accent);
    color: var(--bg);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    cursor: pointer;
  }

  .c-submit:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }

  .c-submit:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .c-cancel {
    margin-top: 0;
  }

  .c-note,
  .c-sent {
    margin: 0;
    font-size: var(--fs-body-sm);
    line-height: 1.5;
    color: var(--text-muted);
  }

  .c-sent {
    margin-top: 1.5rem;
    padding: 0.75rem 1rem;
    border-left: 3px solid var(--success);
    background: var(--card-bg);
  }

  @media print {
    .comments {
      display: none;
    }
  }
</style>
