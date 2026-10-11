// http.server.ts — reading a body from Wildmind without trusting its size.
//
// Shared by the landing page's public snapshot read ($lib/landing) and the
// owner lane (./owner.server.ts). Lives here, in a domain module, so the
// landing reader (ui) may import it while the owner lane never has to reach
// up into $lib/landing for it.

/** The body as text, refused once it passes `max` bytes. */
export async function cappedText(res: Response, max: number): Promise<string> {
  const length = Number(res.headers.get('content-length'));
  if (Number.isFinite(length) && length > max) {
    await res.body?.cancel().catch(() => {});
    throw new Error('too large');
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new Error('too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
