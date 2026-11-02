<script lang="ts">
  // Stub: replaced by the Snap Happy TV board.
  import type { ScreenRoom } from '$lib/games/snap-happy';
  let { room, skewMs = 0 }: { room: ScreenRoom; skewMs?: number } = $props();
  void skewMs;
</script>

<p>{room.phase}</p>
