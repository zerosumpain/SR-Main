<script lang="ts">
  /**
   * Promote a build to a project — pick its address and write its card.
   *
   * Publishing already existed as a one-click button, but it gave the page no
   * identity of its own: the /projects card led with the raw prompt that had
   * been typed to start the build. This is the step between "the files are
   * live" and "it reads like a project", and it is also the only way to publish
   * a build the old button refused to offer (see `canPublish` in
   * BuildsListV2 — it was gated on serveConfig, which only describes how to RUN
   * something and hid every static site the builder ever made).
   *
   * Two verbs, deliberately separate:
   *  - Promote (POST)  copies the workspace to /projects/<slug>/. Minutes, and
   *                    it re-runs the project's own build inside the sandbox.
   *  - Save card (PATCH) writes copy only. Instant, and cannot break a live page.
   */
  import { slugifyTitle } from '$lib/jkai/publish-slug';
  import { publishedLink } from './published-link';
  import { resolveProjectCard } from '$lib/jkai/project-card';

  interface PromotableBuild {
    id: string;
    title: string | null;
    prompt: string;
    publishedSlug: string | null;
    projectSlug?: string | null;
    cardTitle?: string | null;
    cardBlurb?: string | null;
    cardTag?: string | null;
    createdAt: string | Date;
  }

  /** What the card's top-right corner falls back to when no tag is written —
   *  matched to /projects' own `formatDate` so the preview doesn't lie. */
  function formatDate(d: string | Date): string {
    return new Date(d).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  let {
    build,
    onClose,
    ondone,
    /**
     * Which lane produced the thing being carded.
     *
     * 'app'  — a sandbox build. Promoting COPIES its workspace to /projects.
     * 'repo' — a change request. Its page is already in the repo and already
     *          deployed, so there is nothing to copy: only the card is missing,
     *          and the address is read off the PR rather than invented from the
     *          title.
     */
    kind = 'app',
  }: {
    build: PromotableBuild;
    onClose: () => void;
    /** Fired after a successful write so the list can refresh its rows. */
    ondone: (result: { slug: string; url: string }) => void;
    kind?: 'app' | 'repo';
  } = $props();

  const isRepo = $derived(kind === 'repo');
  // A repo card is never "published" in the copy-the-files sense, so the
  // address stays editable and the verb stays "Add card".
  const isPublished = $derived(!isRepo && !!build.publishedSlug);

  // A repo build's address is a fact about the PR, not a guess from the title —
  // it is filled in by the detect call below. Leaving it blank until then is
  // deliberate: a plausible wrong address is worse than an empty field.
  let slug = $state(
    kind === 'repo'
      ? (build.projectSlug ?? '')
      : (build.publishedSlug ?? slugifyTitle(build.title ?? build.prompt.slice(0, 60)) ?? ''),
  );
  let detecting = $state(kind === 'repo' && !build.projectSlug);
  let candidates = $state<string[]>([]);
  let detectNote = $state<string | null>(null);

  $effect(() => {
    if (kind !== 'repo' || !detecting) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/jkai/builds/${build.id}/project-card`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (data.slug) slug = data.slug;
        candidates = Array.isArray(data.candidates) ? data.candidates : [];
        detectNote = data.reason ?? null;
      } catch {
        if (!cancelled) detectNote = 'Could not read the pull request — enter the address by hand.';
      } finally {
        if (!cancelled) detecting = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  });
  let cardTitle = $state(build.cardTitle ?? build.title ?? '');
  let cardBlurb = $state(build.cardBlurb ?? '');
  let cardTag = $state(build.cardTag ?? '');
  let busy = $state(false);
  let err = $state<string | null>(null);

  const MAX_BLURB = 400;
  const MAX_TITLE = 120;

  /** Same normalisation the server applies, shown live so the address in the
   *  field is the address you get. */
  const cleanSlug = $derived(slugifyTitle(slug));

  /** What /projects will actually render, fallbacks and all. */
  const preview = $derived(
    resolveProjectCard({
      title: build.title,
      prompt: build.prompt,
      cardTitle,
      cardBlurb,
      cardTag,
    }),
  );

  const canSubmit = $derived(
    !busy && !detecting && cleanSlug.length > 0 && cardBlurb.length <= MAX_BLURB,
  );

  async function submit(mode: 'promote' | 'card' | 'repo-card') {
    if (!canSubmit) return;
    busy = true;
    err = null;
    try {
      if (mode === 'repo-card') {
        const res = await fetch(`/api/jkai/builds/${build.id}/project-card`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: cleanSlug, cardTitle, cardBlurb, cardTag }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          err = data.error ?? 'Could not add the card';
          return;
        }
        ondone({ slug: data.slug, url: data.url });
        onClose();
        return;
      }
      const res = await fetch(`/api/jkai/builds/${build.id}/publish`, {
        method: mode === 'promote' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(mode === 'promote' ? { slug: cleanSlug } : {}),
          cardTitle,
          cardBlurb,
          cardTag,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        err = data.error ?? (mode === 'promote' ? 'Promote failed' : 'Save failed');
        return;
      }
      ondone({ slug: data.slug, url: data.url });
      onClose();
    } catch {
      err = 'Request failed';
    } finally {
      busy = false;
    }
  }

  function onKey(e: KeyboardEvent) {
    // Escape is a trap while a promote is copying files — the request carries
    // on server-side and closing hides the outcome.
    if (e.key === 'Escape' && !busy) onClose();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="pm-backdrop" role="presentation" onclick={() => !busy && onClose()}>
  <div
    class="pm"
    role="dialog"
    aria-modal="true"
    aria-label={isRepo ? 'Add this build to the projects index' : 'Promote build to a project'}
    onclick={(e) => e.stopPropagation()}
  >
    <header class="pm-head">
      <div>
        <span class="pm-eyebrow"
          >{isRepo ? 'Add to /projects' : isPublished ? 'Project card' : 'Promote to project'}</span
        >
        <h2 class="pm-title">{build.title || build.prompt.slice(0, 60)}</h2>
      </div>
      <button class="pm-x" onclick={onClose} disabled={busy} aria-label="Close">✕</button>
    </header>

    <p class="pm-blurb">
      {#if isRepo}
        This page is already in the repo and already deployed — nothing is copied. Adding a card
        only lists <b>/projects/{cleanSlug || '…'}/</b> on the projects index, and it starts
        <b>private</b>: you'll see it, nobody else will, until you flip it public there.
      {:else if isPublished}
        Live at <a href={publishedLink(build.publishedSlug)?.href ?? '#'} target="_blank" rel="noopener"
          >{publishedLink(build.publishedSlug)?.href ?? build.publishedSlug}</a
        >. Editing the card changes only the copy on the projects index — the page itself is
        untouched.
      {:else}
        Copies this build to <b>/projects/{cleanSlug || '…'}/</b> and lists it on the projects
        index. Without a card it would show the prompt you started the build with.
      {/if}
    </p>

    <label class="pm-field">
      <span class="pm-lab">Address</span>
      <input
        class="pm-in mono"
        bind:value={slug}
        disabled={busy || isPublished || detecting}
        placeholder={isRepo ? 'family-life360-history' : 'graphing-calculator'}
        maxlength="60"
      />
      {#if detecting}
        <span class="pm-hint">Reading the pull request…</span>
      {:else if isRepo && candidates.length > 1}
        <span class="pm-hint">
          This PR touched more than one page —
          {#each candidates as c (c)}
            <button class="pm-pick" type="button" onclick={() => (slug = c)}>{c}</button>
          {/each}
        </span>
      {:else if isRepo && detectNote}
        <span class="pm-hint">{detectNote}</span>
      {:else if isRepo && slug}
        <span class="pm-hint">Detected from the pull request. Change it if that's the wrong page.</span>
      {:else if isPublished}
        <span class="pm-hint">
          Re-addressing a live page would orphan any link to it — unpublish first to move it.
        </span>
      {:else if cleanSlug && cleanSlug !== slug}
        <span class="pm-hint">Will publish as <b class="mono">{cleanSlug}</b></span>
      {/if}
    </label>

    <label class="pm-field">
      <span class="pm-lab">Title</span>
      <input
        class="pm-in"
        bind:value={cardTitle}
        disabled={busy}
        placeholder={build.title ?? 'Graphing Calculator'}
        maxlength={MAX_TITLE}
      />
    </label>

    <label class="pm-field">
      <span class="pm-lab">
        Blurb
        <span class="pm-count" class:over={cardBlurb.length > MAX_BLURB}
          >{cardBlurb.length}/{MAX_BLURB}</span
        >
      </span>
      <textarea
        class="pm-in pm-area"
        bind:value={cardBlurb}
        disabled={busy}
        rows="3"
        placeholder="What it does and why it's worth opening. Three lines show on the card."
      ></textarea>
    </label>

    <label class="pm-field">
      <span class="pm-lab">Tag line</span>
      <input
        class="pm-in"
        bind:value={cardTag}
        disabled={busy}
        placeholder="Interactive · Maths"
        maxlength="60"
      />
      <span class="pm-hint">Small text on the card's top right. Blank shows the build date.</span>
    </label>

    <div class="pm-preview">
      <span class="pm-lab">On /projects</span>
      <div class="pm-card">
        <div class="pm-card-top">
          <span class="pm-card-eyebrow">AI Built</span>
          <span class="pm-card-meta">{preview.tag || formatDate(build.createdAt)}</span>
        </div>
        <h3 class="pm-card-title">{preview.heading}</h3>
        <p class="pm-card-blurb" class:raw={!preview.curated}>{preview.blurb}</p>
      </div>
      {#if !preview.curated}
        <span class="pm-hint">Still showing the build prompt — write a title and blurb.</span>
      {/if}
    </div>

    {#if err}<p class="pm-err">{err}</p>{/if}

    <div class="pm-actions">
      <button class="pm-ghost" onclick={onClose} disabled={busy}>Cancel</button>
      {#if isRepo}
        <button class="pm-go" onclick={() => submit('repo-card')} disabled={!canSubmit}>
          {busy ? 'Adding…' : build.projectSlug ? 'Save card' : 'Add card'}
        </button>
      {:else if isPublished}
        <button class="pm-go" onclick={() => submit('card')} disabled={!canSubmit}>
          {busy ? 'Saving…' : 'Save card'}
        </button>
      {:else}
        <button class="pm-go" onclick={() => submit('promote')} disabled={!canSubmit}>
          {busy ? 'Promoting…' : 'Promote'}
        </button>
      {/if}
    </div>
    {#if busy && !isPublished && !isRepo}
      <p class="pm-hint pm-wait">
        Building and copying the project — this can take a couple of minutes. Leave this open.
      </p>
    {/if}
  </div>
</div>

<style>
  .pm-pick {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    border: 1px solid var(--line);
    background: none;
    color: var(--accent);
    padding: 0.1rem 0.35rem;
    margin-left: 0.35rem;
    cursor: pointer;
  }
  .pm-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 6vh 16px 16px;
    background: rgba(20, 16, 12, 0.55);
    backdrop-filter: blur(3px);
  }
  .pm {
    width: min(560px, 100%);
    max-height: 88vh;
    overflow-y: auto;
    /* Opaque, not translucent — a see-through panel over the builds grid makes
       the form unreadable. */
    background: var(--surface-elevated);
    border: 2px solid var(--card-border);
    border-radius: var(--radius-round);
    padding: 18px 20px 20px;
  }
  .pm-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  .pm-eyebrow {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .pm-title {
    margin: 2px 0 0;
    font-size: 19px;
    font-weight: 600;
    color: var(--text-primary);
    line-height: 1.2;
    word-break: break-word;
  }
  .pm-x {
    flex-shrink: 0;
    background: none;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    width: 28px;
    height: 28px;
    cursor: pointer;
    color: var(--text-secondary);
    font-size: 13px;
  }
  .pm-x:hover:not(:disabled) {
    color: var(--text-primary);
  }
  .pm-blurb {
    margin: 10px 0 14px;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--text-secondary);
  }
  .pm-blurb b {
    color: var(--text-primary);
    font-family: var(--font-mono);
  }
  .pm-blurb a {
    color: var(--accent);
  }

  .pm-field {
    display: block;
    margin-bottom: 11px;
  }
  .pm-lab {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-secondary);
    margin-bottom: 4px;
  }
  .pm-count {
    letter-spacing: 0;
  }
  .pm-count.over {
    color: var(--error);
  }
  .pm-in {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    padding: 7px 10px;
    /* 16px floor on inputs — anything smaller makes iOS zoom on focus. */
    font-size: 16px;
    color: var(--text-primary);
  }
  .pm-in.mono {
    font-family: var(--font-mono);
  }
  .pm-area {
    resize: vertical;
    line-height: 1.45;
  }
  .pm-in:disabled {
    opacity: 0.55;
  }
  .pm-hint {
    display: block;
    margin-top: 4px;
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
  }
  .pm-hint b {
    color: var(--text-primary);
  }

  .pm-preview {
    margin: 14px 0 4px;
  }
  .pm-card {
    margin-top: 5px;
    padding: 12px 14px;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-round);
    background: var(--bg);
  }
  .pm-card-top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }
  .pm-card-eyebrow {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.25em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .pm-card-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  .pm-card-title {
    margin: 8px 0 6px;
    font-size: 17px;
    font-weight: 500;
    color: var(--text-primary);
    line-height: 1.25;
  }
  .pm-card-blurb {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--text-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .pm-card-blurb.raw {
    font-style: italic;
    color: var(--text-ghost);
  }

  .pm-err {
    margin: 10px 0 0;
    font-size: 12px;
    color: var(--error);
  }

  .pm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 14px;
  }
  .pm-ghost {
    background: none;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    padding: 7px 14px;
    font-size: 12.5px;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .pm-ghost:hover:not(:disabled) {
    color: var(--text-primary);
  }
  .pm-go {
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: var(--radius-sharp);
    padding: 7px 16px;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    transition: background var(--t-fast) var(--ease-out);
  }
  .pm-go:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  .pm-go:disabled,
  .pm-ghost:disabled,
  .pm-x:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .pm-wait {
    text-align: right;
  }
</style>
