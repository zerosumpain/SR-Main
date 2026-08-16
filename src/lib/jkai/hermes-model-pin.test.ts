import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ensureModelPinned, resetModelPinCache } from './hermes-model-pin';

/** Typed on the request so `mock.calls[0][0]` is reachable. */
function makeClient(bootId: string | null) {
  return {
    health: vi.fn(async () =>
      bootId === null
        ? null
        : { bootId, startedAt: 1, turnTagging: 'execution', busyInputMode: 'queue' },
    ),
    sendMessage: vi.fn(async (_req: { chatId: string; text: string }) => ({
      accepted: true,
      chatId: 'chat_1',
    })),
  };
}

const BASE = {
  chatId: 'chat_1',
  sessionId: 'sess_1',
  kind: 'manual' as const,
  kindId: '',
  model: { provider: 'codex' as const, modelId: 'codex/gpt-5.6-sol' },
};

describe('ensureModelPinned', () => {
  beforeEach(resetModelPinCache);

  it('pins once, then stays quiet while the boot id holds', async () => {
    const client = makeClient('boot-a');
    expect(await ensureModelPinned({ client, ...BASE })).toBe(true);
    expect(await ensureModelPinned({ client, ...BASE })).toBe(false);
    expect(await ensureModelPinned({ client, ...BASE })).toBe(false);
    expect(client.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('re-pins when Hermes restarts', async () => {
    // The regression: an agent restarted its own jkai-hermes service and every
    // turn for the next three hours ran on config.yaml's default while the
    // picker, the DB and Hermes' own session row all still said gpt-5.6-sol.
    const first = makeClient('boot-a');
    await ensureModelPinned({ client: first, ...BASE });
    const afterRestart = makeClient('boot-b');
    expect(await ensureModelPinned({ client: afterRestart, ...BASE })).toBe(true);
  });

  it('sends the provider-correct /model command', async () => {
    const client = makeClient('boot-a');
    await ensureModelPinned({ client, ...BASE });
    expect(client.sendMessage.mock.calls[0][0]).toMatchObject({
      chatId: 'chat_1',
      text: '/model gpt-5.6-sol --provider openai-codex',
    });
  });

  it('does nothing when the conversation has no pinned model', async () => {
    const client = makeClient('boot-a');
    expect(await ensureModelPinned({ client, ...BASE, model: null })).toBe(false);
    expect(client.health).not.toHaveBeenCalled();
  });

  it('stays quiet against a Hermes that publishes no boot id', async () => {
    // Older runtime: re-pushing on every turn would be worse than doing nothing.
    const client = makeClient(null);
    expect(await ensureModelPinned({ client, ...BASE })).toBe(false);
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it('sends the re-pin under a turn id of its own', async () => {
    // The notice this produces ("Model switched to ...") used to go out
    // untagged, and an untagged frame was accepted by whichever chat job was
    // attached — so the notice got persisted as the answer to whatever the user
    // had just asked, and every reply after it landed one message behind. The id
    // matches no job id by construction, so no job can claim it.
    const client = makeClient('boot-a');
    await ensureModelPinned({ client, ...BASE });
    const sent = client.sendMessage.mock.calls[0][0] as { turnId?: string };
    expect(sent.turnId).toBe('model-pin:chat_1');
  });

  it('reuses a health probe the caller already made rather than adding one', async () => {
    const client = makeClient('boot-a');
    const health = { bootId: 'boot-a', startedAt: 1, turnTagging: 'execution', busyInputMode: 'queue' };
    expect(await ensureModelPinned({ client, ...BASE, health })).toBe(true);
    expect(client.health).not.toHaveBeenCalled();
  });

  it('treats an explicitly null health as a failed probe, not as absent', async () => {
    // `health: null` is the caller saying "I probed and got nothing", which must
    // not silently trigger a second probe here.
    const client = makeClient('boot-a');
    expect(await ensureModelPinned({ client, ...BASE, health: null })).toBe(false);
    expect(client.health).not.toHaveBeenCalled();
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it('never throws when the re-push fails — a wrong model beats no answer', async () => {
    const client = makeClient('boot-a');
    client.sendMessage.mockRejectedValueOnce(new Error('hermes down'));
    expect(await ensureModelPinned({ client, ...BASE })).toBe(false);
    // Not recorded as pinned, so the next turn tries again.
    client.sendMessage.mockResolvedValueOnce({ accepted: true, chatId: 'chat_1' });
    expect(await ensureModelPinned({ client, ...BASE })).toBe(true);
  });
});
