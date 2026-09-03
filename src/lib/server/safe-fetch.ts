import { Agent, fetch as undiciFetch } from 'undici';
import { resolvePinnedUrl } from './ssrf-guard';

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export interface GuardedFetchResult {
  status: number;
  ok: boolean;
  headers: Headers;
  body: ArrayBuffer;
  finalUrl: string;
  truncated: boolean;
}

/**
 * Public-network fetch with DNS pinning, per-hop redirect validation, timeout,
 * and a hard streamed-body limit. This is the shared primitive for routes that
 * fetch a user-supplied URL.
 */
export async function guardedPublicFetch(
  input: string,
  options: {
    method?: 'GET' | 'HEAD';
    headers?: Record<string, string>;
    timeoutMs?: number;
    maxBytes?: number;
    maxRedirects?: number;
    allowUrl?: (url: URL) => boolean;
  } = {},
): Promise<GuardedFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);
  const maxBytes = options.maxBytes ?? 1024 * 1024;
  const maxRedirects = options.maxRedirects ?? 3;
  let current = input;

  try {
    for (let hop = 0; ; hop += 1) {
      const pinned = await resolvePinnedUrl(current);
      if (options.allowUrl && !options.allowUrl(pinned.url)) {
        throw new Error(`ssrf_blocked: destination not allow-listed (${pinned.url.hostname})`);
      }
      const dispatcher = new Agent({
        connect: {
          lookup: (_hostname, lookupOptions, callback) => {
            if (lookupOptions && (lookupOptions as { all?: boolean }).all) {
              callback(null, [{ address: pinned.address, family: pinned.family }]);
            } else {
              (callback as (err: Error | null, address: string, family: number) => void)(
                null,
                pinned.address,
                pinned.family,
              );
            }
          },
        },
      });
      let response: Awaited<ReturnType<typeof undiciFetch>>;
      try {
        response = await undiciFetch(current, {
          method: options.method ?? 'GET',
          headers: options.headers,
          redirect: 'manual',
          signal: controller.signal,
          dispatcher,
        });

        if (REDIRECTS.has(response.status)) {
          const location = response.headers.get('location');
          await response.body?.cancel();
          if (!location) throw new Error('redirect response missing Location');
          if (hop >= maxRedirects) throw new Error('too many redirects');
          current = new URL(location, current).toString();
          continue;
        }

        const chunks: Uint8Array[] = [];
        let size = 0;
        let truncated = false;
        if (maxBytes > 0 && response.body) {
          for await (const chunk of response.body) {
            const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBuffer);
            const room = maxBytes - size;
            if (bytes.byteLength > room) {
              if (room > 0) chunks.push(bytes.slice(0, room));
              size = maxBytes;
              truncated = true;
              await response.body.cancel().catch(() => {});
              break;
            }
            chunks.push(bytes);
            size += bytes.byteLength;
          }
        } else {
          await response.body?.cancel();
        }
        const body = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          body.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return {
          status: response.status,
          ok: response.ok,
          headers: new Headers(response.headers as unknown as HeadersInit),
          body: body.buffer as ArrayBuffer,
          finalUrl: current,
          truncated,
        };
      } finally {
        await dispatcher.close().catch(() => {});
      }
    }
  } finally {
    clearTimeout(timer);
  }
}
