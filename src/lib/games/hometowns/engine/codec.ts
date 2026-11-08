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

// Working buffers, reused between calls (grown when a longer input arrives):
// the planes, the history, the Why and the tile log are all encoded every
// month, and a fresh buffer per call was a large share of the month's
// allocations. Nothing returned aliases them.
let CODES = new Uint16Array(4096);
let RLE = new Uint8Array(8192);
let RAW = new Uint8Array(8192);

/** Base64 of bytes[0 .. n). */
function base64Of(bytes: Uint8Array, n: number): string {
  // Character codes into one buffer, then strings a chunk at a time: the
  // planes are encoded every tick, and four-character concatenations were
  // most of the cost. The output is the same string.
  const need = Math.ceil(n / 3) * 4;
  if (CODES.length < need) CODES = new Uint16Array(need + (need >> 1));
  const codes = CODES;
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

export function toBase64(bytes: Uint8Array): string {
  return base64Of(bytes, bytes.length);
}

/** Decodes base64 into RAW (grown as needed) and returns the byte count. */
function base64Into(s: string): number {
  let len = s.length;
  while (len > 0 && s.charCodeAt(len - 1) === 61) len--;
  const max = Math.floor((len * 3) / 4);
  if (RAW.length < max) RAW = new Uint8Array(max + (max >> 1));
  const out = RAW;
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < len; i++) {
    const c = s.charCodeAt(i);
    const v = c < 128 ? B64_INDEX[c] : -1;
    if (v < 0) throw new Error('bad base64');
    acc = ((acc << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 255;
    }
  }
  return o;
}

export function fromBase64(s: string): Uint8Array {
  const n = base64Into(s); // first: it may replace RAW
  return RAW.slice(0, n);
}

/** PackBits-style coding of src into RLE (grown as needed); returns the coded length. */
function rleInto(src: Uint8Array): number {
  const n = src.length;
  // Worst case: all literals, one control byte per 128.
  const need = n + Math.ceil(n / 128) + 1;
  if (RLE.length < need) RLE = new Uint8Array(need + (need >> 1));
  const out = RLE;
  let o = 0;
  let i = 0;
  while (i < n) {
    const v = src[i];
    let run = 1;
    while (i + run < n && run < 130 && src[i + run] === v) run++;
    if (run >= 3) {
      out[o++] = run + 125;
      out[o++] = v;
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
  return o;
}

/**
 * PackBits-style run-length coding. A control byte n < 128 is followed by
 * n + 1 literal bytes; n ≥ 128 means the next byte repeats n − 125 times
 * (3–130). Empty map rows compress to almost nothing.
 */
export function rleEncode(src: Uint8Array): Uint8Array {
  const n = rleInto(src); // first: it may replace RLE with a bigger buffer
  return RLE.slice(0, n);
}

/** toBase64(rleEncode(src)) without the intermediate copy. */
export function encodeRle64(src: Uint8Array): string {
  const n = rleInto(src); // first: it may replace RLE with a bigger buffer
  return base64Of(RLE, n);
}

/** Run-length decoding of src[0 .. len) into a fresh array of `expected` bytes. */
function rleDecodeRange(src: Uint8Array, len: number, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let o = 0;
  let i = 0;
  while (i < len) {
    const c = src[i++];
    if (c < 128) {
      const n = c + 1;
      if (o + n > expected || i + n > len) throw new Error('bad rle');
      for (let j = 0; j < n; j++) out[o++] = src[i++];
    } else {
      const n = c - 125;
      if (o + n > expected || i >= len) throw new Error('bad rle');
      const v = src[i++];
      for (let j = 0; j < n; j++) out[o++] = v;
    }
  }
  if (o !== expected) throw new Error('bad rle length');
  return out;
}

export function rleDecode(src: Uint8Array, expected: number): Uint8Array {
  return rleDecodeRange(src, src.length, expected);
}

/** rleDecode(fromBase64(s), expected) without the intermediate copy. */
export function decodeRle64(s: string, expected: number): Uint8Array {
  const n = base64Into(s); // first: it may replace RAW
  return rleDecodeRange(RAW, n, expected);
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
  return encodeRle64(plane);
}

export function decodeU8(s: string, n: number): Uint8Array {
  return decodeRle64(s, n);
}
