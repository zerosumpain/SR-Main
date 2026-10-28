// The metadata a caller writes on the assistant row of a turn Core ran for it
// (`chatTurn`): the memory stamp, the channel it answered on, and which soul
// spoke. PURE, and apart from `./turn` so a test that fakes the turn keeps it.
import type { MemoryTurnStamp } from '$lib/jkai/memory/contracts';

export function assistantTurnMetadata(
  turn: { memory: MemoryTurnStamp | null; identityVersion?: string | null },
  channel: string,
): Record<string, unknown> {
  return {
    ...(turn.memory ? { memory: turn.memory } : {}),
    channel,
    ...(turn.identityVersion ? { identityVersion: turn.identityVersion } : {}),
  };
}
