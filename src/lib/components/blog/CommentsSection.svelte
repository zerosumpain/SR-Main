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
  import { snapToRule } from '$lib/components/notes-paper/snap';

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
    <div class="c-sent" use:snapToRule>
      <p class="np-sticky">
        Thanks — that is with John. Comments are read before they appear, so it will not show up
        straight away.
      </p>
    </div>
  {/if}

  {#if !open}
    <button class="c-open" onclick={() => { open = true; sent = false; }}>
      {top.length === 0 ? 'Be the first to respond' : 'Add a response'}
    </button>
  {:else}
    <form class="c-form" onsubmit={submit} use:snapToRule>
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
  /* Notes paper: responses are letters written on the page's rules. Every
     line here is one rule tall (names, dates, bodies, the reply and open
     buttons, whose 44px hit areas are pseudo-elements that leave the pitch
     alone), and the section carries the page's ruled band from its own top,
     so the writing sits on the lines. The form is a card laid on the page,
     opaque, and kept whole rules tall by snapToRule. */
  .comments {
    position: relative;
    display: flex;
    flex-direction: column;
    padding-top: var(--np-l, 32px);
    border-image: var(--pp-band) fill 0 / 0 / 0 var(--np-bleed, 100vw);
  }

  /* The heading is a margin kicker, as Sources above it is, so the foot of
     the sheet reads as one system: mono caps right up against the margin
     rule, on the line beside the first response. The sheet's columns
     (--rule-gap, --pp-kick, --rail-col) place it; it takes no line of the
     column itself. */
  .c-heading {
    position: absolute;
    top: var(--np-l, 32px);
    right: calc(100% + var(--rule-gap, 2rem) + var(--pp-kick, 22px));
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 400;
    line-height: var(--np-l, 32px);
    text-align: right;
    text-transform: uppercase;
    white-space: nowrap;
    letter-spacing: 0.14em;
    color: var(--np-pen-text, var(--accent-hover));
  }

  /* Where the margin is narrow it runs down it, centred in the margin. */
  @media (max-width: 1180px) {
    .c-heading {
      right: auto;
      left: calc(-1 * (var(--rule-gap, 2rem) + var(--rail-col, 56px)));
      display: flex;
      align-items: center;
      width: var(--rail-col, 56px);
      padding: 4px 0 0;
      line-height: 1.4;
      writing-mode: vertical-rl;
      transform: rotate(180deg);
    }
  }

  .c-list,
  .c-replies {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .c-item {
    padding: 0 0 var(--np-l, 32px);
  }

  /* Replies indented behind a double petrol rule, the margin's echo. */
  .c-replies {
    position: relative;
    padding-left: 1.5rem;
  }

  .c-replies::before {
    content: '';
    position: absolute;
    top: 6px;
    bottom: 6px;
    left: 0.25rem;
    width: 4px;
    border-left: 1px solid var(--np-pen-ink, var(--accent-ink));
    border-right: 1px solid var(--np-pen-ink, var(--accent-ink));
    opacity: 0.55;
  }

  .c-replies .c-item:last-child {
    padding-bottom: 0;
  }

  .c-meta {
    display: flex;
    align-items: baseline;
    gap: 0.9rem;
    height: var(--np-l, 32px);
    line-height: var(--np-l, 32px);
  }

  .c-author {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--np-pen-ink, var(--accent-ink));
  }

  .c-date {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }

  .c-body {
    margin: 0;
    /* Paragraphing without a renderer. Nothing here is parsed as markup. */
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-family: var(--font-body);
    font-size: var(--fs-body);
    line-height: var(--np-l, 32px);
    color: var(--text-primary);
  }

  .c-reply,
  .c-cancel,
  .c-cancel-reply,
  .c-open {
    position: relative;
    display: inline-flex;
    align-items: center;
    height: var(--np-l, 32px);
    margin: 0;
    padding: 0;
    background: none;
    border: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--np-pen-ink, var(--accent-ink));
    text-decoration: underline;
    text-decoration-color: var(--np-pen, var(--accent));
    text-underline-offset: 5px;
    cursor: pointer;
  }

  /* 44px targets without growing the line. */
  .c-reply::after,
  .c-cancel::after,
  .c-cancel-reply::after,
  .c-open::after {
    content: '';
    position: absolute;
    inset: -6px -4px;
  }

  .c-reply:hover,
  .c-cancel:hover,
  .c-cancel-reply:hover,
  .c-open:hover {
    color: var(--text-primary);
  }

  .c-open {
    align-self: flex-start;
    padding: 0 0.9rem;
    background: var(--np-card, var(--surface-card));
    box-shadow: inset 0 0 0 1px var(--line-strong);
    text-decoration: none;
  }

  .c-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin: 0 0 calc(var(--np-l, 32px) + var(--np-snap, 0px));
    padding: 18px 20px;
    background: var(--np-card, var(--surface-card));
    box-shadow:
      0 0 0 1px var(--line-strong),
      0 14px 26px -20px rgba(26, 16, 8, 0.4);
  }

  .c-replying {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
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
    letter-spacing: 0.14em;
    color: var(--np-pen-ink, var(--accent-ink));
  }

  .c-input,
  .c-textarea {
    width: 100%;
    padding: 0.6rem 0.75rem;
    background: var(--np-paper, var(--bg));
    /* Petrol, not the hairline: a field's edge has to clear three to one
       against the card (WCAG 1.4.11); at three quarters it is about 3.6:1 in
       every reading theme. */
    border: 1px solid color-mix(in srgb, var(--np-pen-ink, var(--accent-ink)) 75%, var(--np-card, var(--surface-card)));
    border-radius: 0;
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

  .c-input:focus-visible,
  .c-textarea:focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 4px;
    border-radius: 2px;
    border-color: var(--np-pen-ink, var(--accent-ink));
  }

  .c-count {
    position: absolute;
    right: 0;
    top: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }

  .c-count.low {
    color: var(--accent-hover);
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
    box-shadow: inset 3px 0 0 var(--error);
    background: var(--np-paper, var(--bg));
    font-size: var(--fs-body-sm);
    color: var(--text-primary);
  }

  .c-actions {
    display: flex;
    align-items: center;
    gap: 1.25rem;
  }

  .c-submit {
    min-height: 44px;
    padding: 0 1.1rem;
    background: var(--np-pen-ink, var(--accent-ink));
    border: 1px solid var(--np-pen-ink, var(--accent-ink));
    color: var(--np-paper, var(--bg));
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    cursor: pointer;
  }

  .c-submit:hover:not(:disabled) {
    background: var(--text-primary);
    border-color: var(--text-primary);
  }

  .c-submit:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .c-note {
    margin: 0;
    font-size: var(--fs-body-sm);
    line-height: 1.5;
    color: var(--text-secondary);
  }

  /* Thanks, on a sticky note (fixed light, so fixed ink). */
  .c-sent {
    align-self: flex-start;
    margin: 0 0 calc(var(--np-l, 32px) + var(--np-snap, 0px));
    padding: 0;
  }

  .c-sent p {
    margin: 0;
    font-size: var(--fs-body-sm);
    line-height: 1.5;
  }

  .comments :is(button, input, textarea):focus-visible {
    outline: 2px solid var(--accent-hover);
    outline-offset: 4px;
    border-radius: 2px;
  }

  @media print {
    .comments {
      display: none;
    }
  }
</style>
