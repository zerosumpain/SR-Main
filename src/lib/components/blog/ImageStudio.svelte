<script lang="ts">
  /**
   * Article imagery.
   *
   * Three steps, deliberately separate: draft a scene from the article, choose
   * a theme, generate. The scene is a TEXTAREA the author edits — the model
   * proposes it and never gets to be the last word on it, which is what makes
   * the difference between a usable cover and a lucky one.
   *
   * The exact prompt that will be sent is shown before anything is spent. A
   * generation whose prompt you cannot read is a slot machine, and this one
   * costs real money per press.
   *
   * Results accumulate rather than replace, so two themes over one subject can
   * be compared side by side — which is the whole reason the theme is a picker
   * and not a guess.
   */
  import {
    DEFAULT_ASPECT,
    DEFAULT_STYLE,
    IMAGE_ASPECTS,
    IMAGE_STYLES,
    composePrompt,
    type ImageAspect,
  } from '$lib/blog/image-gen';

  let {
    postId,
    adminToken,
    onUseAsCover,
    onInsert,
  }: {
    postId: number;
    adminToken: string;
    onUseAsCover: (url: string) => void;
    onInsert: (item: { url: string; mimeType: string; altText?: string | null }) => void;
  } = $props();

  type Generated = { url: string; filename: string; prompt: string; model: string; bytes: number; mimeType: string };

  let subject = $state('');
  let style = $state<string>(DEFAULT_STYLE);
  let aspect = $state<ImageAspect>(DEFAULT_ASPECT);
  let showPrompt = $state(false);

  let drafting = $state(false);
  let generating = $state(false);
  let error = $state<string | null>(null);
  let note = $state<string | null>(null);
  /** Every image made this session, newest first, so two themes can be compared. */
  let results = $state<Generated[]>([]);

  const tokenQs = $derived(adminToken ? `token=${encodeURIComponent(adminToken)}` : '');
  const base = $derived(`/api/admin/blog/${postId}/generate-image`);
  const prompt = $derived(composePrompt(subject, style));
  const canGenerate = $derived(subject.trim().length > 0 && !generating && !drafting);

  async function draft() {
    if (drafting) return;
    drafting = true;
    error = null;
    note = null;
    try {
      const qs = ['step=brief', tokenQs].filter(Boolean).join('&');
      const res = await fetch(`${base}?${qs}`, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { subject?: string; reason?: string; error?: string };
      if (!res.ok) {
        error = body.error ?? `Could not read the post (${res.status}).`;
        return;
      }
      if (!body.subject) {
        note =
          body.reason === 'too-short'
            ? 'Too little written yet to picture. Write a bit more, or describe the scene yourself.'
            : 'Nothing came back — describe the scene yourself.';
        return;
      }
      subject = body.subject;
    } catch {
      error = 'Could not reach the drafting model.';
    } finally {
      drafting = false;
    }
  }

  async function generate() {
    if (!canGenerate) return;
    generating = true;
    error = null;
    note = null;
    try {
      const qs = tokenQs ? `?${tokenQs}` : '';
      const res = await fetch(`${base}${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, style, aspect }),
      });
      const body = (await res.json().catch(() => ({}))) as { image?: Generated; error?: string };
      if (!res.ok || !body.image) {
        error = body.error ?? `Generation failed (${res.status}).`;
        return;
      }
      results = [body.image, ...results];
    } catch {
      error = 'Could not reach the image service.';
    } finally {
      generating = false;
    }
  }

  function kb(bytes: number): string {
    return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
  }
</script>

<section class="nm-sec">
  <div class="nm-sec-hd">
    <span class="sr-label-tight">Article image</span>
    {#if generating}
      <span class="is-status">Drawing…</span>
    {:else if drafting}
      <span class="is-status">Reading the post…</span>
    {/if}
  </div>

  <!-- Step 1 — the scene -->
  <label class="nm-field">
    <span class="sr-label-tight">What the picture is of</span>
    <textarea
      class="nm-textarea"
      rows="3"
      bind:value={subject}
      placeholder="A cluttered workbench at night, lit by one anglepoise lamp…"
    ></textarea>
  </label>

  <div class="is-row">
    <button class="nm-btn-ghost" onclick={draft} disabled={drafting || generating}>
      {drafting ? 'Reading…' : 'Draft from the article'}
    </button>
    {#if subject}
      <button class="nm-link-btn" onclick={() => (subject = '')}>Clear</button>
    {/if}
  </div>

  <!-- Step 2 — the theme -->
  <div class="is-group">
    <span class="sr-label-tight">Theme</span>
    <div class="is-styles">
      {#each IMAGE_STYLES as s (s.key)}
        <button
          class="is-style"
          class:active={style === s.key}
          onclick={() => (style = s.key)}
          title={s.hint}
        >
          <span class="is-style-label">{s.label}</span>
          <span class="is-style-hint">{s.hint}</span>
        </button>
      {/each}
    </div>
  </div>

  <div class="is-group">
    <span class="sr-label-tight">Shape</span>
    <div class="is-aspects">
      {#each IMAGE_ASPECTS as a (a)}
        <button class="is-aspect" class:active={aspect === a} onclick={() => (aspect = a)}>
          {a}
        </button>
      {/each}
    </div>
  </div>

  <!-- Step 3 — generate. The prompt is visible first, on purpose. -->
  {#if prompt}
    <div class="is-prompt">
      <button class="is-prompt-toggle" onclick={() => (showPrompt = !showPrompt)} aria-expanded={showPrompt}>
        {showPrompt ? 'Hide' : 'Show'} the exact prompt
      </button>
      {#if showPrompt}
        <pre class="is-prompt-body">{prompt}</pre>
      {/if}
    </div>
  {/if}

  {#if error}
    <p class="is-error">{error}</p>
  {/if}
  {#if note}
    <p class="is-note">{note}</p>
  {/if}

  <div class="is-row">
    <button class="nm-save-btn" onclick={generate} disabled={!canGenerate}>
      {generating ? 'Drawing…' : results.length ? 'Generate another' : 'Generate image'}
    </button>
    <span class="is-cost">One image per press.</span>
  </div>

  {#if results.length > 0}
    <div class="is-results">
      {#each results as image (image.url)}
        <figure class="is-result">
          <img src={image.url} alt="Generated: {subject.slice(0, 80)}" loading="lazy" />
          <figcaption>
            <span class="is-result-meta">{kb(image.bytes)} · {image.model}</span>
            <span class="is-result-actions">
              <button class="row-link" onclick={() => onUseAsCover(image.url)}>Use as cover</button>
              <button
                class="row-link"
                onclick={() => onInsert({ url: image.url, mimeType: image.mimeType, altText: subject.slice(0, 200) })}
              >
                Insert into body
              </button>
            </span>
          </figcaption>
        </figure>
      {/each}
    </div>
    <p class="is-note">
      Every image is in this post's media library, whether or not you use it — including the ones you
      did not pick.
    </p>
  {/if}
</section>

<style>
  .is-status {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }

  .is-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-top: 0.75rem;
  }

  .is-group {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    margin-top: 1rem;
  }

  .is-styles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: 0.4rem;
  }

  .is-style {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.5rem 0.65rem;
    text-align: left;
    background: transparent;
    border: 1px solid var(--card-border);
    cursor: pointer;
    transition: border-color 0.15s ease-out;
  }

  .is-style:hover {
    border-color: var(--accent);
  }

  .is-style.active {
    border-color: var(--accent);
    background: var(--accent);
  }

  .is-style-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
  }

  .is-style-hint {
    font-size: var(--fs-label-xs);
    line-height: 1.35;
    color: var(--text-muted);
  }

  .is-style.active .is-style-label,
  .is-style.active .is-style-hint {
    color: var(--bg);
  }

  .is-aspects {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
  }

  .is-aspect {
    padding: 0.3rem 0.6rem;
    background: transparent;
    border: 1px solid var(--card-border);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
    cursor: pointer;
  }

  .is-aspect:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .is-aspect.active {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }

  .is-prompt {
    margin-top: 1rem;
  }

  .is-prompt-toggle {
    background: none;
    border: none;
    padding: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }

  .is-prompt-toggle:hover {
    color: var(--accent);
  }

  .is-prompt-body {
    margin: 0.5rem 0 0;
    padding: 0.7rem 0.85rem;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    font-family: var(--font-code, var(--font-mono));
    font-size: var(--fs-label);
    line-height: 1.55;
    color: var(--text-secondary);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .is-cost {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }

  .is-error,
  .is-note {
    margin: 0.75rem 0 0;
    font-size: var(--fs-body-sm);
    line-height: 1.5;
  }

  .is-error {
    padding: 0.5rem 0.75rem;
    border-left: 3px solid var(--error);
    background: var(--card-bg);
    color: var(--text-primary);
  }

  .is-note {
    color: var(--text-muted);
  }

  .is-results {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
    gap: 0.85rem;
    margin-top: 1rem;
  }

  .is-result {
    margin: 0;
    border: 1px solid var(--card-border);
  }

  .is-result img {
    display: block;
    width: 100%;
    height: auto;
  }

  .is-result figcaption {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.5rem 0.65rem;
    border-top: 1px solid var(--card-border);
  }

  .is-result-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }

  .is-result-actions {
    display: flex;
    gap: 0.85rem;
  }
</style>
