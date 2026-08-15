/**
 * Keep Hermes' idea of a chat's model in step with ours across a restart.
 *
 * The per-chat model is pushed to Hermes exactly once — as a `/model` slash
 * command, when the user picks it in the UI. Hermes holds it in the live agent,
 * not in anything it re-reads on boot, so a restart rebuilds the agent from
 * `config.yaml`'s `model.default` and nothing re-asserts the pick.
 *
 * On 2026-08-09 the agent restarted its own `jkai-hermes` service mid-session.
 * Every turn from 11:44 to 14:34 then ran on `deepseek-v4-flash` while the site
 * DB, Hermes' own session row and the model picker all still said
 * `gpt-5.6-sol`. Nothing was wrong with the answers in a way you could see;
 * they were just from a different model than the one the user had chosen.
 *
 * Fix: Hermes' health endpoint publishes a per-process `boot_id`. We remember
 * which boot we last pinned each chat against, and re-push when it changes.
 * One extra round-trip per chat per Hermes restart, and none otherwise.
 */
import { hermesModelCommand } from './hermes-model-command';
import type { ModelProvider } from '$lib/server/models/types';
import type { HermesClient, HermesHealth } from './hermes-client';
import type { TokenKind } from '$lib/mcp/auth';

/** chatId → the Hermes boot id we last pinned this chat's model against. */
const pinnedAgainstBoot = new Map<string, string>();

/** Test seam. */
export function resetModelPinCache(): void {
  pinnedAgainstBoot.clear();
}

/**
 * The turn id a model re-pin sends under.
 *
 * Exported so the chat endpoint can name the same turn: the re-pin runs
 * concurrently with the message that triggered it, Hermes redirects that run to
 * answer the message, and the answer therefore comes out under THIS id. The
 * endpoint has to inherit it. Two hand-written copies of the string would drift.
 */
export function modelPinTurnId(chatId: string): string {
  return `model-pin:${chatId}`;
}

export interface EnsureModelPinnedArgs {
  client: Pick<HermesClient, 'health' | 'sendMessage'>;
  chatId: string;
  sessionId: string;
  kind: TokenKind;
  kindId: string;
  /** The conversation's pinned model, or null when it just uses the default. */
  model: { provider: ModelProvider; modelId: string } | null;
  /**
   * A health probe the caller has already made. The chat endpoint needs the same
   * response to decide whether the gateway's turn stamps can be trusted, so
   * passing it in saves a second round trip rather than adding one.
   */
  health?: HermesHealth | null;
}

/**
 * Re-push the chat's model if Hermes has restarted since we last pushed it.
 *
 * Deliberately best-effort: a probe failure, a missing boot id, or a failed
 * re-push all fall through to sending the turn anyway. Being on the wrong model
 * is bad; refusing to answer is worse.
 *
 * @returns true when a re-push was actually sent.
 */
export async function ensureModelPinned(args: EnsureModelPinnedArgs): Promise<boolean> {
  if (!args.model) return false;

  const health = args.health !== undefined ? args.health : await args.client.health();
  const bootId = health?.bootId;
  // No boot id means an older Hermes that doesn't publish one. Do nothing
  // rather than re-pushing on every single turn.
  if (!bootId) return false;

  if (pinnedAgainstBoot.get(args.chatId) === bootId) return false;

  try {
    await args.client.sendMessage({
      chatId: args.chatId,
      text: hermesModelCommand(args.model.provider, args.model.modelId),
      kind: args.kind,
      kindId: args.kindId,
      sessionId: args.sessionId,
      // A turn id of its own, so the notice this produces ("Model switched to
      // ...") is attributable and no chat job can mistake it for its answer. It
      // used to go out untagged, and an untagged frame was accepted by whichever
      // job was attached — so the re-pin notice got persisted as the reply to
      // whatever the user had just asked. It matches no job id by construction.
      turnId: modelPinTurnId(args.chatId),
    });
    pinnedAgainstBoot.set(args.chatId, bootId);
    console.log(
      `[hermes-model-pin] re-pinned ${args.chatId} to ${args.model.provider}:${args.model.modelId} after a Hermes restart`,
    );
    return true;
  } catch (err) {
    console.error('[hermes-model-pin] re-push failed:', err);
    return false;
  }
}
