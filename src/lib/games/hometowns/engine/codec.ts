// Byte codecs for the stored strings (planes, land value, lag, history, Why,
// tile log). Our own base64 and run-length coder, so the engine needs no
// platform API (btoa/Buffer differ between Node, the page and tests) and the
// output is byte-identical everywhere.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

const B64_CODES = (() => {
  const t = new Uint8Array(64);
  for (let i = 0; i < 64; i++) t[i] = B64.charCodeAt(i);
  return t;
})();
/** Characters per String.fromCharCode call: well under every engine's argument limit. */
const CHUNK = 8192;

export function toBase64(bytes: Uint8Array): string {
  // Character codes into one buffer, then strings a chunk at a time: the
  // planes are encoded every tick, and four-character concatenations were
  // most of the cost. The output is the same string.
  const n = bytes.length;
  const codes = new Uint16Array(Math.ceil(n / 3) * 4);
  let o = 0;
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    codes[o++] = B64_CODES[(v >> 18) & 63];
    codes[o++] = B64_CODES[(v >> 12) & 63];
    codes[o++] = B64_CODES[(v >> 6) & 63];
    codes[o++] = B64_CODES[v & 63];
  }
  const left = n - i;
  if (left > 0) {
    const v = (bytes[i] << 16) | (left === 2 ? bytes[i + 1] << 8 : 0);
    codes[o++] = B64_CODES[(v >> 18) & 63];
    codes[o++] = B64_CODES[(v >> 12) & 63];
    codes[o++] = left === 2 ? B64_CODES[(v >> 6) & 63] : 61; // '='
    codes[o++] = 61;
  }
  let out = '';
  for (let k = 0; k < o; k += CHUNK) out += String.fromCharCode.apply(null, codes.subarray(k, Math.min(o, k + CHUNK)) as unknown as number[]);
  return out;
}

export function fromBase64(s: string): Uint8Array {
  let len = s.length;
  while (len > 0 && s[len - 1] === '=') len--;
  const out = new Uint8Array(Math.floor((len * 3) / 4));
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < len; i++) {
    const c = s.charCodeAt(i);
    const v = c < 128 ? B64_INDEX[c] : -1;
    if (v < 0) throw new Error('bad base64');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 255;
    }
  }
  return out.subarray(0, o);
}

/**
 * PackBits-style run-length coding. A control byte n < 128 is followed by
 * n + 1 literal bytes; n ≥ 128 means the next byte repeats n − 125 times
 * (3–130). Empty map rows compress to almost nothing.
 */
export function rleEncode(src: Uint8Array): Uint8Array {
  const n = src.length;
  // Worst case: all literals, one control byte per 128.
  const out = new Uint8Array(n + Math.ceil(n / 128) + 1);
  let o = 0;
  let i = 0;
  while (i < n) {
    let run = 1;
    while (i + run < n && run < 130 && src[i + run] === src[i]) run++;
    if (run >= 3) {
      out[o++] = run + 125;
      out[o++] = src[i];
      i += run;
      continue;
    }
    // A literal stretch, up to 128 bytes, stopping before the next run of 3.
    const start = i;
    let lit = 0;
    while (i < n && lit < 128) {
      if (i + 2 < n && src[i] === src[i + 1] && src[i] === src[i + 2]) break;
      i++;
      lit++;
    }
    out[o++] = lit - 1;
    for (let j = start; j < start + lit; j++) out[o++] = src[j];
  }
  return out.slice(0, o);
}

export function rleDecode(src: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let o = 0;
  let i = 0;
  while (i < src.length) {
    const c = src[i++];
    if (c < 128) {
      const n = c + 1;
      if (o + n > expected || i + n > src.length) throw new Error('bad rle');
      for (let j = 0; j < n; j++) out[o++] = src[i++];
    } else {
      const n = c - 125;
      if (o + n > expected || i >= src.length) throw new Error('bad rle');
      const v = src[i++];
      for (let j = 0; j < n; j++) out[o++] = v;
    }
  }
  if (o !== expected) throw new Error('bad rle length');
  return out;
}

/** Little-endian Int32 array ⇄ bytes (history rings). */
export function int32ToBytes(xs: Int32Array): Uint8Array {
  const out = new Uint8Array(xs.length * 4);
  for (let i = 0; i < xs.length; i++) {
    const v = xs[i];
    out[i * 4] = v & 255;
    out[i * 4 + 1] = (v >>> 8) & 255;
    out[i * 4 + 2] = (v >>> 16) & 255;
    out[i * 4 + 3] = (v >>> 24) & 255;
  }
  return out;
}

export function bytesToInt32(b: Uint8Array): Int32Array {
  const out = new Int32Array(b.length >> 2);
  for (let i = 0; i < out.length; i++) out[i] = b[i * 4] | (b[i * 4 + 1] << 8) | (b[i * 4 + 2] << 16) | (b[i * 4 + 3] << 24);
  return out;
}

/** A u8 plane (land value, pollution lag) as base64 of its RLE. */
export function encodeU8(plane: Uint8Array): string {
  return toBase64(rleEncode(plane));
}

export function decodeU8(s: string, n: number): Uint8Array {
  return rleDecode(fromBase64(s), n);
}
