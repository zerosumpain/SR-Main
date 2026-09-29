<script lang="ts">
  // The chrome for /games and a table: `HealthShell` with `unifiedNav` (the
  // pattern /decks, /research and /news wear), inside a wrapper that carries
  // the page's day / night register.
  //
  // Night is the blog reader's palette (`html[data-reading-theme='night']` in
  // app.css), redefined as TOKENS on this wrapper so it can never follow the
  // reader off the page. Everything the shell paints as an ink band with
  // `--text-primary` — the site bar, the footer — would turn cream when that
  // token inverts, so those are relit onto `--chrome-bg` / `--chrome-ink`, the
  // names SR-Health's night theme uses for the same job (and that
  // `SiteHeader` already reads).
  import type { Snippet } from 'svelte';
  import HealthShell from '$lib/components/shell/HealthShell.svelte';

  interface Props {
    path: string;
    night: boolean;
    footer?: string[];
    children: Snippet;
  }

  let { path, night, footer = [], children }: Props = $props();
</script>

<div class="games-frame" class:night>
  <HealthShell {path} unifiedNav {footer} maxWidth={1200}>
    {@render children()}
  </HealthShell>
</div>

<style>
  .games-frame {
    --chrome-bg: #1a1008;
    --chrome-ink: #ede4d4;
    --chrome-muted: rgba(237, 228, 212, 0.62);
    --chrome-line: rgba(237, 228, 212, 0.16);
    --chrome-accent: var(--accent-on-dark);
    background: var(--bg);
  }
  .games-frame.night {
    --bg: #14100c;
    --bg-base: #14100c;
    --surface-elevated: #1e1913;
    --surface-card: #1e1913;
    --text-primary: #ece3d6;
    --text-secondary: #cdc2b2;
    --text-muted: rgba(236, 227, 214, 0.62);
    --text-ghost: rgba(236, 227, 214, 0.4);
    --card-bg: rgba(236, 227, 214, 0.06);
    --card-border: rgba(236, 227, 214, 0.18);
    --divider: rgba(236, 227, 214, 0.1);
    --bg-section: rgba(236, 227, 214, 0.04);
    --line-strong: rgba(236, 227, 214, 0.2);
    --accent: #e07b2a;
    --accent-hover: #f0913f;
    --accent-ink: #3fa3b0;
    --info: #3fa3b0;
    --success: #5eb36c;
    --warn: #d4ab4a;
    --error: #e06a6a;
    --chrome-bg: #0b0806;
    color-scheme: dark;
  }
  /* The two ink bands the shell and the layout paint with --text-primary. */
  .games-frame.night :global(.site-nav-bar),
  .games-frame.night :global(.hs-foot) {
    background: var(--chrome-bg);
    color: var(--chrome-ink);
  }
</style>
