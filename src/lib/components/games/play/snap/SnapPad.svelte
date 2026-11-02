<script lang="ts">
  // Stub: replaced by the Snap Happy controller.
  import type { WireRoom } from '$lib/games/snap-happy';
  let { code, room, skewMs = 0 }: { code: string; room: WireRoom; skewMs?: number } = $props();
  void code; void skewMs;
</script>

<p>{room.phase}</p>
