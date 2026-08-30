<script lang="ts">
  /**
   * The media library panel — everything uploaded against one post, in a grid,
   * with alt text editable in place.
   *
   * Presentational: it owns no editor state and inserts nothing itself. The
   * caller passes `onInsert` and decides what "insert" means for its editor.
   *
   * The listing comes from the blog_media TABLE, not a directory read. The
   * image store has two interchangeable backends (filesystem, Azure Blob) and
   * neither exposes a list primitive — see the header of $lib/blog/media.server
   * for why that rules a readdir-backed gallery out entirely.
   *
   * The alt-text COUNT in the header is the point of this panel as much as the
   * grid is. Alt-text coverage is a publish-gate check on the writing desk, and
   * the cheapest way to raise a number is to put it in front of the person who
   * can move it, next to the field that moves it.
   */
  import { getContext } from 'svelte';
  import type { MediaItem } from '$lib/blog/media';

  let {
    postId,
    open,
    onInsert,
    onClose,
  }: {
    postId: number;
    open: boolean;
    onInsert: (item: MediaItem) => void;
    onClose: () => void;
  } = $props();

  const ENDPOINT = '/api/admin/blog/media';

  /**
   * The owner gate in hooks.server.ts takes a session OR `?token=`; the admin
   * layout puts that token in context and every other admin fetch in this tree
   * appends it. Absent (mounted outside the admin layout, or a session-authed
   * visit with no token in the URL) it is simply omitted and the session
   * carries the request.
   */
  const adminToken = getContext<string>('adminToken') ?? '';
  const tokenParam = adminToken ? `token=${encodeURIComponent(adminToken)}` : '';
  const writeUrl = tokenParam ? `${ENDPOINT}?${tokenParam}` : ENDPOINT;

  let items = $state<MediaItem[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);
  /** Filename of the row mid-delete, so only its own button goes quiet. */
  let removing = $state<string | null>(null);

  /**
   * Plain `let`, deliberately NOT $state: the effect below both reads and
   * writes it, and a rune there would re-enter the effect on every write. It is
   * a latch, nothing renders it, so it has no business being reactive.
   */
  let loadedFor: number | null = null;

  const withAlt = $derived(items.filter((i) => (i.altText ?? '').trim().length > 0).length);

  // Fetch on OPEN, not on mount. The panel is mounted alongside the editor and
  // spends most of its life shut; loading a post's whole media list on every
  // editor page load would be a request nobody asked for.
  $effect(() => {
    if (!open) {
      // Reset the latch so the next open refetches — uploads made from the
      // editor while this was shut have to show up. The stale list is left on
      // screen so a reopen paints immediately instead of flashing empty.
      loadedFor = null;
      return;
    }
    if (loadedFor === postId) return;
    loadedFor = postId;
    void load();
  });

  async function load() {
    loading = true;
    error = null;
    try {
      const res = await fetch(`${ENDPOINT}?postId=${postId}${tokenParam ? `&${tokenParam}` : ''}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      items = Array.isArray(data?.media) ? (data.media as MediaItem[]) : [];
    } catch (err) {
      error = 'Could not load the media library.';
      console.error('[MediaLibrary] load failed', err);
    } finally {
      loading = false;
    }
  }

  async function saveAlt(item: MediaItem, raw: string) {
    const next = raw.trim();
    // Blur fires whether or not anything was typed. Without this every tab
    // through the grid would be a write.
    if (next === (item.altText ?? '')) return;

    // Optimistic: the coverage count is the reason this field exists, so it
    // moves on blur rather than on the round trip. A failed write reloads and
    // the count corrects itself.
    item.altText = next.length > 0 ? next : null;

    try {
      const res = await fetch(writeUrl, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ postId, filename: item.filename, altText: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.error('[MediaLibrary] alt text save failed', err);
      error = 'Alt text did not save.';
      loadedFor = null;
      void load();
    }
  }

  async function remove(item: MediaItem) {
    removing = item.filename;
    try {
      const res = await fetch(writeUrl, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ postId, filename: item.filename }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      items = items.filter((i) => i.id !== item.id);
    } catch (err) {
      console.error('[MediaLibrary] remove failed', err);
      error = 'Could not remove that item.';
    } finally {
      removing = null;
    }
  }

  const isVideo = (item: MediaItem) => item.mimeType.startsWith('video/');

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function onKeydown(e: KeyboardEvent) {
    if (!open || e.key !== 'Escape') return;
    e.preventDefault();
    onClose();
  }

  /**
   * Local portal, and it must stay local. $lib/canvas/portal's destroy()
   * REMOVES the node but its `false` path re-parents to the original parent —
   * and for an overlay wrapped in {#if open} that parent is still connected, so
   * a close re-appends the overlay and strands a modal whose ✕ is already gone.
   * Two lines here beats a shared action with a lifecycle we do not want.
   */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="ml-ovl" use:portal onclick={onClose} role="presentation">
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="ml-panel"
      role="dialog"
      aria-modal="true"
      aria-label="Media library"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="ml-hd">
        <div class="ml-hd-text">
          <span class="sr-label-tight">Media library</span>
          <h2>Assets on this post</h2>
        </div>
        <button type="button" class="ml-x" onclick={onClose} aria-label="Close">
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"
            ><path d="M5 5l10 10M15 5L5 15" /></svg
          >
        </button>
      </div>

      <p class="ml-cover">
        {#if items.length === 0}
          Nothing uploaded yet.
        {:else}
          {withAlt} of {items.length} have alt text
        {/if}
      </p>

      {#if error}
        <p class="ml-err">{error}</p>
      {/if}

      <div class="ml-body">
        {#if loading && items.length === 0}
          <p class="ml-note">Loading…</p>
        {:else if items.length === 0}
          <p class="ml-note">
            Images and video uploaded from the editor land here. Drop one into the post and it will
            show up on the next open.
          </p>
        {:else}
          <ul class="ml-grid">
            {#each items as item (item.id)}
              <li class="ml-item">
                <button
                  type="button"
                  class="ml-thumb-btn"
                  onclick={() => onInsert(item)}
                  title="Insert {item.filename} into the post"
                >
                  {#if isVideo(item)}
                    <!-- The `#t=0.1` media fragment makes the browser seek to and
                         paint the frame at 0.1s, which is a poster image without
                         having to generate one. Some browsers refuse and leave it
                         black, so the badge below labels it either way. -->
                    <!-- svelte-ignore a11y_media_has_caption -->
                    <video
                      class="ml-thumb"
                      src={`${item.url}#t=0.1`}
                      preload="metadata"
                      muted
                      playsinline
                    ></video>
                    <span class="ml-badge">Video</span>
                  {:else}
                    <img class="ml-thumb" src={item.url} alt={item.altText ?? ''} loading="lazy" />
                  {/if}
                </button>

                <input
                  class="nm-text-input ml-alt"
                  value={item.altText ?? ''}
                  maxlength={500}
                  placeholder="Alt text"
                  aria-label="Alt text for {item.filename}"
                  onblur={(e) => saveAlt(item, e.currentTarget.value)}
                />

                <div class="ml-foot">
                  <span class="ml-size">{formatBytes(item.bytes)}</span>
                  <button
                    type="button"
                    class="ml-rm"
                    onclick={() => remove(item)}
                    disabled={removing === item.filename}
                  >
                    {removing === item.filename ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .ml-ovl {
    position: fixed;
    inset: 0;
    background: rgba(26, 16, 8, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    z-index: 200;
  }

  /* OPAQUE on purpose. --card-bg is a 7% tint of the ink colour and would show
     the editor straight through the panel. */
  .ml-panel {
    width: 100%;
    max-width: 860px;
    max-height: min(84vh, 760px);
    display: flex;
    flex-direction: column;
    background: var(--surface-elevated);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    padding: 18px 20px 20px;
  }

  .ml-hd {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding-bottom: 12px;
    border-bottom: 2px solid var(--line-strong);
  }
  .ml-hd-text {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .ml-hd h2 {
    font-family: var(--font-display);
    font-size: var(--fs-display-xs);
    font-weight: 400;
    line-height: 1.1;
    margin: 0;
    color: var(--text-primary);
  }
  .ml-x {
    flex: none;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    background: transparent;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .ml-x:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  .ml-cover {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-secondary);
    margin: 12px 0 0;
  }
  .ml-err {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--error);
    margin: 8px 0 0;
  }

  /* overflow-y only. `overflow-x: auto` here would clip the Y axis too and eat
     the scroll this panel depends on. */
  .ml-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    margin-top: 14px;
  }

  .ml-note {
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    color: var(--text-muted);
    margin: 0;
    max-width: 46ch;
  }

  .ml-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 14px;
  }
  .ml-item {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    padding: 8px;
    background: var(--bg);
  }

  .ml-thumb-btn {
    position: relative;
    display: block;
    width: 100%;
    padding: 0;
    background: var(--surface-overlay);
    border: 1px solid var(--card-border);
    border-radius: 0;
    cursor: pointer;
    overflow: hidden;
  }
  .ml-thumb-btn:hover {
    border-color: var(--accent);
  }
  .ml-thumb {
    display: block;
    width: 100%;
    aspect-ratio: 4 / 3;
    object-fit: cover;
    background: var(--surface-overlay);
  }
  .ml-badge {
    position: absolute;
    left: 6px;
    bottom: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    padding: 2px 6px;
    background: var(--accent-ink);
    color: var(--bg);
  }

  .ml-alt {
    /* .nm-text-input already sets --fs-body; a typed field below 16px makes
       mobile Safari zoom the viewport and strand the rest of the panel. */
    padding: 6px 8px;
  }

  .ml-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .ml-size {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
  .ml-rm {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    padding: 3px 8px;
    background: transparent;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .ml-rm:hover:not(:disabled) {
    color: var(--error);
    border-color: var(--error);
  }
  .ml-rm:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
