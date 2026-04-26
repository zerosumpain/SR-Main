<script lang="ts">
  let {
    buildId,
    serveConfig,
    publishedSlug,
  }: {
    buildId: string;
    serveConfig: { port?: number; startCommand?: string } | null;
    publishedSlug: string | null;
  } = $props();

  let cacheBust = $state(Date.now());
  let fullscreen = $state(false);
  const proxyUrl = $derived(`/api/jkai/proxy/${buildId}/?v=${cacheBust}`);
  const liveUrl = $derived(publishedSlug ? `/projects/jkai/${publishedSlug}/` : null);

  function reload() {
    cacheBust = Date.now();
  }
</script>

<section class="nm-sec preview" class:fullscreen>
  <header class="nm-sec-hd">
    <span class="sr-label-tight">Preview</span>
    <div class="hdr-actions">
      {#if serveConfig?.port}
        <span class="dim">port {serveConfig.port}</span>
      {/if}
      <button class="row-link" onclick={reload} type="button">↻ reload</button>
      <a class="row-link" href={proxyUrl} target="_blank" rel="noreferrer">↗ open</a>
      {#if liveUrl}
        <a class="row-link" href={liveUrl} target="_blank" rel="noreferrer">↗ live</a>
      {/if}
      <button class="row-link" onclick={() => (fullscreen = !fullscreen)} type="button">
        {fullscreen ? 'exit fullscreen' : 'fullscreen'}
      </button>
    </div>
  </header>
  {#if !serveConfig?.port}
    <p class="dim">No serve.json detected yet — the build hasn't produced a runnable project. Once it writes serve.json the preview will appear here.</p>
  {:else}
    <iframe
      title="Build preview"
      src={proxyUrl}
      class="frame"
    ></iframe>
  {/if}
  {#if fullscreen}
    <button class="exit-fs" onclick={() => (fullscreen = false)} type="button" aria-label="Close fullscreen preview">×</button>
  {/if}
</section>

<style>
  .preview {
    position: relative;
  }
  .preview.fullscreen {
    position: fixed;
    inset: 0;
    z-index: 60;
    margin: 0;
    border: none;
    padding: 12px;
    background: var(--bg);
    display: flex;
    flex-direction: column;
  }
  .hdr-actions {
    display: flex;
    gap: 12px;
    align-items: center;
    margin-left: auto;
  }
  .dim {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .frame {
    width: 100%;
    height: 70vh;
    border: 1px solid var(--card-border);
    background: var(--bg);
  }
  .preview.fullscreen .frame {
    flex: 1;
    height: auto;
  }
  .exit-fs {
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 70;
    width: 36px;
    height: 36px;
    border: 1px solid var(--card-border);
    background: var(--accent);
    color: var(--bg);
    font-size: 18px;
    cursor: pointer;
    line-height: 1;
  }
</style>
