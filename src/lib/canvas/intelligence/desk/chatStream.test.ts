import { describe, it, expect } from 'vitest';
import {
  parseSseFrames,
  type ChatFrame,
  type ChatSource,
  applyFrame,
  type ChatMessage,
} from './chatStream';

describe('parseSseFrames', () => {
  it('splits a buffer on blank lines and keeps the trailing partial', () => {
    const buf =
      'data: {"type":"token","token":"He"}\n\n' +
      'data: {"type":"token","token":"llo"}\n\n' +
      'data: {"type":"to';
    const { frames, rest } = parseSseFrames(buf);
    expect(frames).toEqual([
      { type: 'token', token: 'He' },
      { type: 'token', token: 'llo' },
    ]);
    expect(rest).toBe('data: {"type":"to');
  });

  it('ignores non-data lines and malformed JSON', () => {
    const buf =
      ': keep-alive comment\n\n' +
      'data: not-json\n\n' +
      'data: {"type":"done"}\n\n';
    const { frames, rest } = parseSseFrames(buf);
    expect(frames).toEqual([{ type: 'done' }]);
    expect(rest).toBe('');
  });

  it('parses a sources frame', () => {
    const src: ChatSource[] = [{ n: 1, title: 'A study', domain: 'gov.uk', url: 'https://gov.uk/x' }];
    const buf = `data: ${JSON.stringify({ type: 'sources', sources: src })}\n\n`;
    const { frames } = parseSseFrames(buf);
    expect(frames).toEqual([{ type: 'sources', sources: src }]);
  });
});

describe('applyFrame', () => {
  const baseAssistant = (): ChatMessage => ({ role: 'assistant', content: '', sources: undefined });

  it('appends a token to the assistant content', () => {
    const msg = baseAssistant();
    applyFrame(msg, { type: 'token', token: 'Hi' });
    applyFrame(msg, { type: 'token', token: ' there' });
    expect(msg.content).toBe('Hi there');
  });

  it('stashes sources without touching content', () => {
    const msg = baseAssistant();
    const sources: ChatSource[] = [{ n: 2, title: 'T', domain: 'd', url: null }];
    applyFrame(msg, { type: 'sources', sources });
    expect(msg.sources).toEqual(sources);
    expect(msg.content).toBe('');
  });

  it('appends an error note in italics', () => {
    const msg = baseAssistant();
    applyFrame(msg, { type: 'error', message: 'rate limited' } as ChatFrame);
    expect(msg.content).toContain('rate limited');
  });

  it('done is a no-op on content/sources', () => {
    const msg = baseAssistant();
    msg.content = 'final';
    applyFrame(msg, { type: 'done' });
    expect(msg.content).toBe('final');
  });
});
