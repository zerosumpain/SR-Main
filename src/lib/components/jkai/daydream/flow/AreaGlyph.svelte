<script lang="ts">
  // One small line glyph per part of life a note starts from — the phone uses
  // SF Symbols for the same seven (heart, house, envelope, bubble, book,
  // sterling, magnifier), so a note carries the same mark on both. SVG, never
  // emoji; stroke follows `currentColor` so the caller picks the ink.
  let { area, size = 18 }: { area: string | null; size?: number } = $props();
</script>

<svg
  class="glyph"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.7"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if area === 'health'}
    <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
  {:else if area === 'home'}
    <path d="M4 11 12 4l8 7" /><path d="M6 10v10h12V10" /><path d="M10 20v-5h4v5" />
  {:else if area === 'mail'}
    <rect x="3.5" y="6" width="17" height="12" /><path d="m4 7 8 6 8-6" />
  {:else if area === 'chat'}
    <path d="M4 5h16v11H9l-5 4z" />
  {:else if area === 'diary'}
    <rect x="4" y="5" width="16" height="15" /><path d="M4 10h16M9 3v4M15 3v4" />
  {:else if area === 'money'}
    <circle cx="12" cy="12" r="8.5" /><path d="M14.5 8.5a2.5 2.5 0 0 0-4.5 1.5V15M8.5 12.5h5M8.5 15.5h7" />
  {:else if area === 'research'}
    <circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5 5" />
  {:else}
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
  {/if}
</svg>

<style>
  .glyph {
    flex: none;
    display: block;
  }
</style>
