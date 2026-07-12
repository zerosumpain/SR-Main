// One-shot internal tokens letting the PDF export's headless browser open
// /decks/<slug>/print without a session. In-memory is correct here: the
// adapter-node deployment is a single process on both hosts, the export API
// mints a token and its own browser consumes it seconds later. Expired or
// re-used tokens fail closed (the print route then falls back to the owner
// check). Server-only.

import { randomBytes } from 'node:crypto';

const TTL_MS = 2 * 60 * 1000;
const tokens = new Map<string, { deckId: string; exp: number }>();

function sweep(): void {
  const now = Date.now();
  for (const [t, row] of tokens) if (row.exp < now) tokens.delete(t);
}

export function mintPrintToken(deckId: string): string {
  sweep();
  const t = randomBytes(24).toString('base64url');
  tokens.set(t, { deckId, exp: Date.now() + TTL_MS });
  return t;
}

export function consumePrintToken(token: string, deckId: string): boolean {
  sweep();
  const row = tokens.get(token);
  if (!row || row.deckId !== deckId || row.exp < Date.now()) return false;
  tokens.delete(token);
  return true;
}
