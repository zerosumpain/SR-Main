<script lang="ts">
  // A plain <a href=".../gpx"> works in a browser tab, but in the installed
  // PWA there is no download manager — the webview just renders the raw XML
  // full-screen, which is how "Download GPX" produced a page of coordinates.
  // So: fetch the file ourselves, then hand it over the right way for the
  // context — the share sheet when standalone (Save to Files / AirDrop / a
  // GPS app), a programmatic download everywhere else. Never navigate to it.

  let { url, name, label = 'Download GPX' }: { url: string; name: string; label?: string } =
    $props();

  let busy = $state(false);
  let failed = $state<string | null>(null);

  function filename(): string {
    const safe =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'route';
    return `${safe}.gpx`;
  }

  async function download() {
    busy = true;
    failed = null;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`GPX fetch failed (${res.status})`);
      const blob = await res.blob();

      const standalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true);
      const file = new File([blob], filename(), { type: 'application/gpx+xml' });

      if (standalone && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: name });
          return;
        } catch (e) {
          // Cancelling the share sheet is a decision, not a failure.
          if (e instanceof Error && e.name === 'AbortError') return;
          // Anything else: fall through to the anchor download.
        }
      }

      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
    } catch (e) {
      failed = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<button type="button" class="row-link" onclick={download} disabled={busy}>
  {busy ? 'Preparing…' : label}
</button>
{#if failed}<span class="gpx-error">{failed}</span>{/if}

<style>
  .row-link {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--accent);
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
  }
  .row-link:hover {
    text-decoration: underline;
  }
  .row-link:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .gpx-error {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--error);
  }
</style>
