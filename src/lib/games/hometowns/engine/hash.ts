// The canonical state hash (spec §10.4 item 6, A25): FNV-1a 64 over a
// canonical serialisation with sorted keys and −0 written as 0. The page
// compares its predicted townHash with the server's at the same tick (the
// production determinism canary), so the serialisation must be identical in
// V8 and JavaScriptCore. Number→string and JSON string quoting are defined
// exactly by ECMAScript, which is why they are safe to use here; nothing
// locale-dependent is.
//
// FNV-1a 64 needs a 64-bit multiply, done here in four 16-bit limbs so it is
// exact without BigInt.

import { nz } from './num';

/** Canonical JSON: sorted object keys, −0 as 0, undefined members dropped. Throws on non-finite numbers. */
export function canonical(v: unknown): string {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'number':
      if (!Number.isFinite(v)) throw new Error('non-finite number in state');
      return String(nz(v));
    case 'boolean':
      return v ? 'true' : 'false';
    case 'string':
      return JSON.stringify(v);
    case 'object': {
      if (Array.isArray(v)) {
        let s = '[';
        for (let i = 0; i < v.length; i++) s += (i ? ',' : '') + (v[i] === undefined ? 'null' : canonical(v[i]));
        return s + ']';
      }
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o).sort();
      let s = '{';
      let first = true;
      for (const k of keys) {
        if (o[k] === undefined) continue;
        s += (first ? '' : ',') + JSON.stringify(k) + ':' + canonical(o[k]);
        first = false;
      }
      return s + '}';
    }
    default:
      throw new Error(`unhashable ${typeof v}`);
  }
}

/** FNV-1a 64 of a string's UTF-8 bytes, as 16 hex digits. */
export function fnv64(s: string): string {
  // Offset basis 0xcbf29ce484222325 in 16-bit limbs, least significant first.
  let h0 = 0x2325;
  let h1 = 0x8422;
  let h2 = 0x9ce4;
  let h3 = 0xcbf2;
  const byte = (b: number) => {
    h0 ^= b;
    // h × (2⁴⁰ + 0x1b3) mod 2⁶⁴
    const t0 = h0 * 0x1b3;
    const t1 = h1 * 0x1b3;
    const t2 = h2 * 0x1b3 + ((h0 << 8) & 0xffff);
    const t3 = h3 * 0x1b3 + (((h0 >>> 8) | (h1 << 8)) & 0xffff);
    h0 = t0 & 0xffff;
    const c1 = t1 + (t0 >>> 16);
    h1 = c1 & 0xffff;
    const c2 = t2 + (c1 >>> 16);
    h2 = c2 & 0xffff;
    h3 = (t3 + (c2 >>> 16)) & 0xffff;
  };
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d < 0xe000) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) byte(c);
    else if (c < 0x800) {
      byte(0xc0 | (c >> 6));
      byte(0x80 | (c & 63));
    } else if (c < 0x10000) {
      byte(0xe0 | (c >> 12));
      byte(0x80 | ((c >> 6) & 63));
      byte(0x80 | (c & 63));
    } else {
      byte(0xf0 | (c >> 18));
      byte(0x80 | ((c >> 12) & 63));
      byte(0x80 | ((c >> 6) & 63));
      byte(0x80 | (c & 63));
    }
  }
  const hex = (x: number) => (x + 0x10000).toString(16).slice(1);
  return hex(h3) + hex(h2) + hex(h1) + hex(h0);
}

/** The hash of any JSON-safe value. */
export function hashOf(v: unknown): string {
  return fnv64(canonical(v));
}
