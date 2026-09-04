<script lang="ts">
  import RawConfigEditor from './shared/RawConfigEditor.svelte';
  import type { NodeDefinition } from '$lib/workflows/types';
  import OnErrorBlock from './shared/OnErrorBlock.svelte';
  import ResourcePicker from './shared/ResourcePicker.svelte';

  // Editor for the `blog-get` node.
  // Executor reads `config.postId` (string, may be a numeric ID or a slug
  // — the underlying site tool currently expects a numeric ID, but we
  // accept either input shape and let the executor decide).

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

  function set(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
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
  void definition;
</script>

<div class="bo">
  <!-- Lookup -->
  <section class="bo-sec">
    <header class="bo-sec-hdr"><span class="sr-label-tight">Lookup</span></header>
    <div class="bo-field">
      <ResourcePicker
        value={postId}
        fetcher={fetchPosts}
        onChange={(v) => set('postId', v)}
        label="Post"
        placeholder="pick a post"
        emptyHint="No posts yet — type an ID."
      />
      <span class="bo-hint">
        Templates supported: <code>{`{{input.id}}`}</code>.
      </span>
    </div>
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
  .bo-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
  .bo-label {
    font-family: var(--font-mono); font-size: var(--fs-label-xs);
    text-transform: uppercase; letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .bo-hint { font-size: var(--fs-label); color: var(--text-ghost); }
  .bo-hint code { color: var(--text-muted); }
  .bo-warn { color: var(--status-error, #c0392b); margin-left: 4px; }

  input[type='text'], textarea {
    width: 100%;
    padding: 6px 8px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    font: inherit;
    box-sizing: border-box;
    outline: none;
  }
  input[type='text']:focus, textarea:focus { border-color: var(--text-muted); }

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
