import { describe, expect, it, vi } from 'vitest';
import { JsonLines, PiRpc, instructionEnvelope, instructionIds } from './pi-rpc';

describe('Pi RPC protocol', () => {
  it('preserves Unicode separators and partial/multiple records', () => {
    const parser = new JsonLines();
    expect(parser.push('{"type":"message","text":"a\u2028')).toEqual([]);
    expect(parser.push('b"}\r\n{"type":"agent_end"}\n')).toEqual([
      { type: 'message', text: 'a\u2028b' }, { type: 'agent_end' },
    ]);
  });
  it('correlates acknowledgement without claiming the instruction was applied', async () => {
    const write = vi.fn();
    const rpc = new PiRpc(write);
    const reply = rpc.request('steer', { message: instructionEnvelope(8, 'Keep the controls visible') });
    const sent = JSON.parse(write.mock.calls[0][0]);
    expect(instructionIds(sent.message)).toEqual([8]);
    expect(rpc.receive({ type: 'response', id: sent.id, success: true })).toBe(true);
    expect((await reply).success).toBe(true);
    rpc.close();
  });
  it('rejects pending requests on disconnect and explicit rejection', async () => {
    const write = vi.fn();
    const rpc = new PiRpc(write);
    const first = rpc.request('prompt');
    rpc.receive({ type: 'response', id: 'sr-1', success: false, error: 'No model' });
    await expect(first).rejects.toThrow('No model');
    const second = rpc.request('steer');
    rpc.close();
    await expect(second).rejects.toThrow('disconnected');
    await expect(rpc.request('prompt')).rejects.toThrow('disconnected');
  });
  it('bounds missing acknowledgements', async () => {
    const rpc = new PiRpc(() => {}, 5);
    await expect(rpc.request('get_state')).rejects.toThrow('acknowledge');
    rpc.close();
  });
});
