<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';

  // Editor for the `blog-update` node.
  //
  // Executor (src/lib/workflows/nodes/blog-ops.ts → blogUpdateExecutor)
  // requires `postId` and passes through any of `title`, `content`,
  // `status`, `tags` that are set. Slug + excerpt are stored on the
  // config (preserved via spread) for forward compatibility with the
  // underlying site tool.

  let {
    config,
    onChange,
    definition,
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
    definition?: NodeDefinition;
  } = $props();

  const postId = $derived(String(config.postId ?? ''));
  const title = $derived(String(config.title ?? ''));
  const slug = $derived(String(config.slug ?? ''));
  const content = $derived(String(config.content ?? ''));
  const excerpt = $derived(String(config.excerpt ?? ''));
  // For update, status is "leave unchanged" unless the user picks one.
  const status = $derived(
    typeof config.status === 'string' && config.status ? String(config.status) : '',
  );

  const tagList = $derived.by(() => parseTags(config.tags));

  function parseTags(raw: unknown): string[] {
    if (Array.isArray(raw)) return raw.map((t) => String(t).trim()).filter(Boolean);
    if (typeof raw === 'string') return raw.split(',').map((t) => t.trim()).filter(Boolean);
    return [];
  }

  function joinTags(tags: string[]): string {
    return tags.join(', ');
  }

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  function unset(key: string) {
    const next = { ...config };
    delete next[key];
    onChange(next);
  }

  function setTags(next: string[]) {
    if (next.length === 0) unset('tags');
    else set('tags', joinTags(next));
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

  // Slug helpers (same as create panel)
  const slugHasSpaces = $derived(/\s/.test(slug));
  const slugHasUpper = $derived(/[A-Z]/.test(slug));
  const slugHasIssue = $derived(slugHasSpaces || slugHasUpper);
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

  function onStatusChange(v: string) {
    if (!v) unset('status');
    else set('status', v);
  }

  let showRawJson = $state(false);
  void definition;
</script>

<div class="bo">
  <!-- Target -->
  <section class="bo-sec">
    <header class="bo-sec-hdr"><span class="sr-label-tight">Target</span></header>
    <label class="bo-field">
      <span class="bo-label">Post ID <span class="bo-req">*</span></span>
      <input
        type="text"
        spellcheck="false"
        placeholder={'42  or  {{input.id}}'}
        value={postId}
        oninput={(e) => set('postId', (e.currentTarget as HTMLInputElement).value)}
      />
      <span class="bo-hint">Required. Templates supported: <code>{`{{input.id}}`}</code>.</span>
    </label>
  </section>

  <!-- Identity (optional changes) -->
  <section class="bo-sec">
    <header class="bo-sec-hdr">
      <span class="sr-label-tight">Identity</span>
      <span class="bo-sec-meta">leave blank to keep unchanged</span>
    </header>
    <label class="bo-field">
      <span class="bo-label">Title</span>
      <input
        type="text"
        spellcheck="false"
        placeholder={'New title  or  {{input.headline}}'}
        value={title}
        oninput={(e) => set('title', (e.currentTarget as HTMLInputElement).value)}
      />
    </label>
    <label class="bo-field">
      <span class="bo-label">Slug</span>
      <input
        type="text"
        spellcheck="false"
        placeholder={'my-post-slug'}
        value={slug}
        oninput={(e) => set('slug', (e.currentTarget as HTMLInputElement).value)}
        onblur={onSlugBlur}
      />
      {#if slugHasIssue && !slugIsTemplate}
        <span class="bo-warn">
          Slug should be lowercase with no spaces. Will auto-normalise on blur to
          <code>{normaliseSlug(slug)}</code>.
        </span>
      {/if}
    </label>
  </section>

  <!-- Content (optional changes) -->
  <section class="bo-sec">
    <header class="bo-sec-hdr">
      <span class="sr-label-tight">Content</span>
      <span class="bo-sec-meta">leave blank to keep unchanged</span>
    </header>
    <label class="bo-field">
      <span class="bo-label">Body</span>
      <textarea
        class="bo-code bo-content"
        rows="14"
        spellcheck="false"
        placeholder={'<p>Updated copy...</p>  or  {{input.body}}'}
        value={content}
        oninput={(e) => set('content', (e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
    </label>
    <label class="bo-field">
      <span class="bo-label">Excerpt</span>
      <textarea
        rows="2"
        spellcheck="false"
        value={excerpt}
        oninput={(e) => set('excerpt', (e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
    </label>
  </section>

  <!-- Tags + status -->
  <section class="bo-sec">
    <header class="bo-sec-hdr">
      <span class="sr-label-tight">Tags</span>
      <span class="bo-sec-meta">{tagList.length} {tagList.length === 1 ? 'tag' : 'tags'} · empty = unchanged</span>
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
  </section>

  <section class="bo-sec">
    <header class="bo-sec-hdr"><span class="sr-label-tight">Publish state</span></header>
    <label class="bo-field">
      <span class="bo-label">Status</span>
      <select
        value={status}
        onchange={(e) => onStatusChange((e.currentTarget as HTMLSelectElement).value)}
      >
        <option value="">Leave unchanged</option>
        <option value="draft">Draft</option>
        <option value="published">Published</option>
      </select>
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
