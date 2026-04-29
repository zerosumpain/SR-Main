<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';

  // Editor for the `blog-create` node.
  //
  // Executor (src/lib/workflows/nodes/blog-ops.ts → blogCreateExecutor)
  // reads:
  //   - title    (string, required, supports templates)
  //   - content  (string, supports templates)
  //   - status   (passed through; site tool defaults to 'draft')
  //   - tags     (passed through as-is)
  //
  // The underlying site tool (`site_blog_create`) also accepts `slug` and
  // `excerpt`. We surface them in the UI so they're stored on the node
  // config — preserved via spread so future executor wiring picks them up
  // without losing values.

  let {
    config,
    onChange,
    definition,
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
    definition?: NodeDefinition;
  } = $props();

  const title = $derived(String(config.title ?? ''));
  const slug = $derived(String(config.slug ?? ''));
  const content = $derived(String(config.content ?? ''));
  const excerpt = $derived(String(config.excerpt ?? ''));
  const status = $derived(String(config.status ?? 'draft'));

  // Tags are stored on config as a comma-separated string (for executor
  // compatibility). Render as a chip list.
  const tagList = $derived.by(() => parseTags(config.tags));

  function parseTags(raw: unknown): string[] {
    if (Array.isArray(raw)) return raw.map((t) => String(t).trim()).filter(Boolean);
    if (typeof raw === 'string') {
      return raw.split(',').map((t) => t.trim()).filter(Boolean);
    }
    return [];
  }

  function joinTags(tags: string[]): string {
    return tags.join(', ');
  }

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  function setTags(next: string[]) {
    set('tags', joinTags(next));
  }

  let tagDraft = $state('');

  function commitTagDraft() {
    const v = tagDraft.trim().replace(/,+$/, '');
    if (!v) { tagDraft = ''; return; }
    if (tagList.includes(v)) { tagDraft = ''; return; }
    setTags([...tagList, v]);
    tagDraft = '';
  }

  function removeTag(i: number) {
    const next = tagList.slice();
    next.splice(i, 1);
    setTags(next);
  }

  function onTagKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commitTagDraft();
    } else if (e.key === 'Backspace' && tagDraft === '' && tagList.length > 0) {
      removeTag(tagList.length - 1);
    }
  }

  // Slug helpers
  const slugHasSpaces = $derived(/\s/.test(slug));
  const slugHasUpper = $derived(/[A-Z]/.test(slug));
  const slugHasIssue = $derived(slugHasSpaces || slugHasUpper);
  // Don't lint a template expression like `{{input.slug}}`.
  const slugIsTemplate = $derived(slug.includes('{{') || slug.includes('}}'));

  function normaliseSlug(raw: string): string {
    return raw
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function onSlugBlur() {
    if (!slug || slugIsTemplate) return;
    if (!slugHasIssue) return;
    const next = normaliseSlug(slug);
    if (next !== slug) set('slug', next);
  }

  let showRawJson = $state(false);
  void definition;
</script>

<div class="bo">
  <!-- Title + slug -->
  <section class="bo-sec">
    <header class="bo-sec-hdr"><span class="sr-label-tight">Identity</span></header>
    <label class="bo-field">
      <span class="bo-label">Title <span class="bo-req">*</span></span>
      <input
        type="text"
        spellcheck="false"
        placeholder={'Weekly update  or  {{input.headline}}'}
        value={title}
        oninput={(e) => set('title', (e.currentTarget as HTMLInputElement).value)}
      />
      <span class="bo-hint">Required. Templates supported: <code>{`{{input.field}}`}</code>.</span>
    </label>
    <label class="bo-field">
      <span class="bo-label">Slug</span>
      <input
        type="text"
        spellcheck="false"
        placeholder={'auto-generated from title  (or my-post-slug)'}
        value={slug}
        oninput={(e) => set('slug', (e.currentTarget as HTMLInputElement).value)}
        onblur={onSlugBlur}
      />
      {#if slugHasIssue && !slugIsTemplate}
        <span class="bo-warn">
          Slug should be lowercase with no spaces. Will auto-normalise on blur to
          <code>{normaliseSlug(slug)}</code>.
        </span>
      {:else}
        <span class="bo-hint">Optional. Auto-generated from title if omitted.</span>
      {/if}
    </label>
  </section>

  <!-- Content -->
  <section class="bo-sec">
    <header class="bo-sec-hdr"><span class="sr-label-tight">Content</span></header>
    <label class="bo-field">
      <span class="bo-label">Body (HTML or markdown)</span>
      <textarea
        class="bo-code bo-content"
        rows="14"
        spellcheck="false"
        placeholder={'<p>This week...</p>  or  {{input.body}}'}
        value={content}
        oninput={(e) => set('content', (e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
      <span class="bo-hint">Templates supported: <code>{`{{input.field}}`}</code>.</span>
    </label>
    <label class="bo-field">
      <span class="bo-label">Excerpt</span>
      <textarea
        rows="2"
        spellcheck="false"
        placeholder={'Optional short summary  (defaults to first 200 chars of body)'}
        value={excerpt}
        oninput={(e) => set('excerpt', (e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
    </label>
  </section>

  <!-- Tags + status -->
  <section class="bo-sec">
    <header class="bo-sec-hdr">
      <span class="sr-label-tight">Tags</span>
      <span class="bo-sec-meta">{tagList.length} {tagList.length === 1 ? 'tag' : 'tags'}</span>
    </header>
    <div class="bo-chips" role="list">
      {#each tagList as tag, i (tag + i)}
        <span class="bo-chip" role="listitem">
          {tag}
          <button type="button" class="bo-chip-rm" onclick={() => removeTag(i)} aria-label="remove tag">
            &times;
          </button>
        </span>
      {/each}
      <input
        type="text"
        class="bo-chip-input"
        spellcheck="false"
        placeholder={tagList.length === 0 ? 'add tags…  (Enter to commit)' : 'add tag…'}
        value={tagDraft}
        oninput={(e) => (tagDraft = (e.currentTarget as HTMLInputElement).value)}
        onkeydown={onTagKeydown}
        onblur={commitTagDraft}
      />
    </div>
    <span class="bo-hint">Press <code>Enter</code> or <code>,</code> to add. Backspace removes the last chip.</span>
  </section>

  <section class="bo-sec">
    <header class="bo-sec-hdr"><span class="sr-label-tight">Publish state</span></header>
    <label class="bo-toggle">
      <input
        type="checkbox"
        checked={status === 'published'}
        onchange={(e) =>
          set('status', (e.currentTarget as HTMLInputElement).checked ? 'published' : 'draft')}
      />
      <span class="bo-toggle-label">
        Publish immediately
        <span class="bo-toggle-meta">
          (current: <code>{status}</code>)
        </span>
      </span>
    </label>
  </section>

  <!-- On failure -->
  <OnErrorBlock
    value={config._onError as Record<string, unknown> | undefined}
    onChange={(v) => set('_onError', v)}
  />

  <!-- Advanced raw JSON -->
  <details class="bo-raw" bind:open={showRawJson}>
    <summary><span class="sr-label-tight">Advanced &mdash; raw JSON config</span></summary>
    <textarea
      class="bo-code"
      rows="10"
      spellcheck="false"
      value={JSON.stringify(config, null, 2)}
      oninput={(e) => {
        try {
          const next = JSON.parse((e.currentTarget as HTMLTextAreaElement).value);
          if (next && typeof next === 'object') onChange(next as Record<string, unknown>);
        } catch { /* invalid — keep typing */ }
      }}
    ></textarea>
  </details>
</div>

<style>
  .bo { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }
  .bo-sec { display: flex; flex-direction: column; gap: 8px; }
  .bo-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .bo-sec-meta { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); }
  .bo-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .bo-label {
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .bo-req { color: var(--status-error, #c0392b); }
  .bo-hint { font-size: 11px; color: var(--text-ghost); }
  .bo-hint code, .bo-warn code { color: var(--text-muted); font-size: 11px; }
  .bo-warn { font-size: 11px; color: var(--status-error, #c0392b); }

  .bo-content { min-height: 180px; }

  .bo-chips {
    display: flex; flex-wrap: wrap; gap: 4px;
    padding: 4px;
    border: 1px solid var(--card-border);
    background: var(--bg);
    min-height: 32px;
    align-items: center;
  }
  .bo-chip {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 2px 4px 2px 8px;
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--text-primary);
    font-family: var(--font-mono); font-size: 11px;
  }
  .bo-chip-rm {
    background: transparent; color: var(--text-muted);
    border: none; cursor: pointer;
    padding: 0 4px;
    font-size: 14px; line-height: 1;
  }
  .bo-chip-rm:hover { color: var(--status-error, #c0392b); }
  .bo-chip-input {
    flex: 1; min-width: 100px;
    padding: 4px 6px;
    background: transparent;
    border: none;
    color: var(--text-primary);
    font: inherit;
    outline: none;
  }

  .bo-toggle {
    display: flex; align-items: center; gap: 8px;
    cursor: pointer;
  }
  .bo-toggle-label { font-size: 12px; color: var(--text-primary); }
  .bo-toggle-meta { color: var(--text-muted); font-family: var(--font-mono); font-size: 11px; }

  input[type='text'], select, textarea {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    box-sizing: border-box;
    outline: none;
  }
  input[type='text']:focus, select:focus, textarea:focus { border-color: var(--text-muted); }

  .bo-code {
    width: 100%;
    padding: 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono); font-size: 11px;
    box-sizing: border-box;
    outline: none;
    resize: vertical;
  }
  .bo-code:focus { border-color: var(--text-muted); }

  .bo-raw {
    margin-top: 4px;
    border-top: 1px dashed var(--card-border);
    padding-top: 8px;
  }
  .bo-raw summary { cursor: pointer; }
</style>
