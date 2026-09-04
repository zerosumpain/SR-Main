<script lang="ts">
  import RawConfigEditor from './shared/RawConfigEditor.svelte';
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import ResourcePicker from './shared/ResourcePicker.svelte';
  import ChipInputField from './widgets/ChipInputField.svelte';

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

  async function fetchTagSuggestions(): Promise<string[]> {
    try {
      const res = await fetch('/api/admin/blog/tags');
      if (!res.ok) return [];
      const body = (await res.json()) as { tags?: Array<{ tag: string; count: number }> };
      return (body.tags ?? []).map((t) => t.tag).filter((t): t is string => typeof t === 'string');
    } catch {
      return [];
    }
  }

  async function fetchPosts() {
    const res = await fetch('/api/admin/blog');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const posts = (await res.json()) as Array<{
      id: number | string;
      slug: string;
      title: string;
      status?: string;
    }>;
    return posts.map((p) => ({
      value: String(p.id),
      label: p.title || p.slug || `#${p.id}`,
      meta: p.status,
    }));
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
  void definition;
</script>

<div class="bo">
  <!-- Target -->
  <section class="bo-sec">
    <header class="bo-sec-hdr"><span class="sr-label-tight">Target</span></header>
    <div class="bo-field">
      <ResourcePicker
        value={postId}
        fetcher={fetchPosts}
        onChange={(v) => set('postId', v)}
        label="Post *"
        placeholder="pick a post to update"
        emptyHint="No posts yet — type an ID."
      />
      <span class="bo-hint">Required. Templates supported: <code>{`{{input.id}}`}</code>.</span>
    </div>
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
    <ChipInputField
      value={tagList}
      placeholder={tagList.length === 0 ? 'add tags…  (Enter to commit)' : 'add tag…'}
      onChange={setTags}
      fetcher={fetchTagSuggestions}
    />
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
  <RawConfigEditor {config} {onChange} />
</div>

<style>
  .bo { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }
  .bo-sec { display: flex; flex-direction: column; gap: 8px; }
  .bo-sec-hdr {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 4px;
  }
  .bo-sec-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }
  .bo-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .bo-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .bo-req { color: var(--status-error, #c0392b); }
  .bo-hint { font-size: var(--fs-label); color: var(--text-ghost); }
  .bo-hint code, .bo-warn code { color: var(--text-muted); font-size: var(--fs-label); }
  .bo-warn { font-size: var(--fs-label); color: var(--status-error, #c0392b); }

  .bo-content { min-height: 180px; }

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
    font-family: var(--font-code); font-size: var(--fs-label);
    box-sizing: border-box;
    outline: none;
    resize: vertical;
  }
  .bo-code:focus { border-color: var(--text-muted); }
</style>
