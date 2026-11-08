// The page's words. Every sentence comes from WP8's copy file
// (engine/copy.ts over copy/en-GB.json, kid and adult levels), the same
// file the server and the app read, so harness mode says what the phone
// says. A key the file does not have yet falls back to plain words made from
// the key itself, so a gap shows up as slightly stiff English rather than as
// a raw key.

import { say, type CopyData, type CopyLevel } from '../../../src/lib/games/hometowns/engine/copy';

export type { CopyLevel };

/** "someCamelKey" → "some camel key". */
export function humanise(key: string): string {
  const last = key.split('.').pop() ?? key;
  return last.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

/** The words for `key` at `level`, or `fallback` (default: the key in plain words) when the copy file lacks it. */
export function words(key: string, level: CopyLevel, data: CopyData = {}, fallback?: string): string {
  const s = say(key, level, data);
  return s === key ? (fallback ?? humanise(key)) : s;
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
