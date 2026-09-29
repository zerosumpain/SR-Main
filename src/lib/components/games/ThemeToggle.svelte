<script lang="ts">
  // Day / night for /games — a cookie on the /games path, read by the
  // layout's load so the next page paints in the right register first time.
  interface Props {
    night: boolean;
    onchange: (night: boolean) => void;
  }
  let { night, onchange }: Props = $props();

  function flip() {
    const next = !night;
    document.cookie = `sr_games_theme=${next ? 'night' : 'day'}; path=/games; max-age=31536000; samesite=lax`;
    onchange(next);
  }
</script>

<button type="button" class="theme" onclick={flip} aria-pressed={night}>
  {night ? 'Day' : 'Night'}
</button>

<style>
  .theme {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label-wide);
    text-transform: uppercase;
    color: var(--chrome-ink);
    background: transparent;
    border: 1px solid var(--chrome-line);
    border-radius: 0;
    padding: 6px 10px;
    cursor: pointer;
  }
  .theme:hover {
    border-color: var(--chrome-accent);
    color: var(--chrome-accent);
  }
</style>
