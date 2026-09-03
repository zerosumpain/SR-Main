import { describe, expect, it } from 'vitest';
import { assertBearerSecret, readLimitedJson, readLimitedText } from './service-auth';

describe('service authentication', () => {
  it('fails closed when configuration is absent and rejects a wrong bearer', () => {
    const missing = new Request('https://example.test', {
      headers: { authorization: 'Bearer anything' },
    });
    expect(() => assertBearerSecret(missing, undefined, 'TEST_TOKEN')).toThrow();
    expect(() => assertBearerSecret(missing, 'configured', 'TEST_TOKEN')).toThrow();
  });

  it('accepts the exact configured bearer', () => {
    const request = new Request('https://example.test', {
      headers: { authorization: 'Bearer configured' },
    });
    expect(() => assertBearerSecret(request, 'configured', 'TEST_TOKEN')).not.toThrow();
  });
});

describe('bounded request bodies', () => {
  it('parses JSON below the byte limit', async () => {
    const request = new Request('https://example.test', { method: 'POST', body: '{"ok":true}' });
    await expect(readLimitedJson(request, 64)).resolves.toEqual({ ok: true });
  });

  it('stops streamed bodies as soon as they exceed the limit', async () => {
    const request = new Request('https://example.test', {
      method: 'POST',
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('1234'));
          controller.enqueue(new TextEncoder().encode('5678'));
          controller.close();
        },
      }),
      // Required by Node for streaming request bodies.
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    await expect(readLimitedText(request, 6)).rejects.toMatchObject({ status: 413 });
  });
});
