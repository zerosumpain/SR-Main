import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nativeCredentials } from '$lib/db/schema';
import { DEVICE_TOKEN_TTL_MS, PAIR_CODE_TTL_MS } from './native-auth';
import { clampLimit, isOwnerEmail } from './native-handler';
import { BYPASS_GUARDS, HOOK_BYPASSES, HOOK_EXACT_BYPASSES } from './gate-bypasses';

const NATIVE_ROUTES = 'src/routes/api/native';

/** Every `+server.ts` under the native tree, relative to the repo root. */
function nativeHandlers(dir = NATIVE_ROUTES): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(process.cwd(), dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(process.cwd(), rel)).isDirectory()) found.push(...nativeHandlers(rel));
    else if (entry === '+server.ts') found.push(rel);
  }
  return found;
}

describe('the native credential table', () => {
  it('stores a hash and a lifetime, never a secret', () => {
    expect(nativeCredentials.tokenHash).toBeDefined();
    expect(nativeCredentials.expiresAt).toBeDefined();
    expect(nativeCredentials.revokedAt).toBeDefined();
    expect(nativeCredentials.ownerEmail).toBeDefined();
    expect(nativeCredentials.kind).toBeDefined();
    // The column that would make the device list a credential store.
    expect((nativeCredentials as unknown as Record<string, unknown>).token).toBeUndefined();
  });

  it('cannot mint a row without an expiry', () => {
    // Drive's first capability table had this nullable and never wrote it, so
    // every link it minted was permanent and unkillable. `notNull` is what stops
    // a forgotten argument becoming a credential that outlives the phone.
    expect(nativeCredentials.expiresAt.notNull).toBe(true);
  });

  it('gives a pairing code minutes and a device token months', () => {
    expect(PAIR_CODE_TTL_MS).toBe(10 * 60 * 1000);
    expect(DEVICE_TOKEN_TTL_MS).toBe(90 * 24 * 60 * 60 * 1000);
    expect(PAIR_CODE_TTL_MS).toBeLessThan(DEVICE_TOKEN_TTL_MS);
  });
});

/**
 * The test that makes the tree bypass safe.
 *
 * `hooks.server.ts` lets everything under `/api/native/` past the session gate.
 * That is only defensible while every handler under it resolves its own
 * identity, so this asserts the property rather than trusting the next person
 * who adds a file to remember it.
 */
describe('every native route gates itself', () => {
  const handlers = nativeHandlers();

  it('finds the handlers at all', () => {
    // A traversal that silently found nothing would make every case below pass.
    expect(handlers.length).toBeGreaterThan(3);
  });

  it.each(handlers.filter((p) => !p.endsWith('native/pair/+server.ts')))(
    '%s resolves a device identity',
    (path) => {
      const src = readFileSync(join(process.cwd(), path), 'utf8');
      expect(src).toContain('withDevice');
      // Exported without the wrapper round it — the shape that would answer
      // anyone who could reach the path.
      expect(src).not.toMatch(/export const (GET|POST|PUT|PATCH|DELETE)[^=]*=\s*async/);
    },
  );

  it('keeps /pair as the only ungated path, and gates it another way', () => {
    const src = readFileSync(join(process.cwd(), `${NATIVE_ROUTES}/pair/+server.ts`), 'utf8');
    // It must answer a caller with no device token — that is what it is for —
    // so its guards are the single-use code, the allow-list re-check, and a
    // ceiling on guesses.
    expect(src).toContain('redeemPairingCode');
    expect(src).toContain('isOwnerEmail');
    expect(src).toContain('rateLimit');
  });

  it('keeps credential MINTING off the bypassed tree entirely', () => {
    // Minting lives at /api/admin/native-devices, behind the ordinary owner
    // gate. An endpoint that issues credentials must not sit behind the
    // exemption those credentials open.
    expect(handlers.some((p) => p.includes('devices'))).toBe(false);
  });
});

describe('the bypass is declared', () => {
  it('catalogues the native tree as a PREFIX', () => {
    expect(HOOK_BYPASSES).toContain('/api/native');
    expect(BYPASS_GUARDS['/api/native']).toBeTruthy();
  });

  /**
   * The orchestrator paths must stay EXACT.
   *
   * Listed as prefixes they drag `chat/active`, `chat/presence` and
   * `chat/[workflowId]` onto the anonymous surface with them — three routes
   * `hooks.server.ts` never opened, because it compares with `===`.
   * `check-public-routes` caught it; this keeps it caught.
   */
  it.each(['/api/workflows/orchestrator/chat', '/api/workflows/orchestrator/chat/stream'])(
    '%s is an exact bypass, never a prefix',
    (path) => {
      expect(HOOK_EXACT_BYPASSES).toContain(path);
      expect(HOOK_BYPASSES).not.toContain(path);
      expect(BYPASS_GUARDS[path]).toBeTruthy();
    },
  );

  it('never opens the orchestrator paths the phone does not use', () => {
    for (const sibling of [
      '/api/workflows/orchestrator/chat/active',
      '/api/workflows/orchestrator/chat/presence',
    ]) {
      expect(HOOK_BYPASSES).not.toContain(sibling);
      expect(HOOK_EXACT_BYPASSES).not.toContain(sibling);
    }
  });
});

describe('the owner re-check', () => {
  it('fails closed when the allow-list is empty or the email is blank', () => {
    // A token minted before an address left AUTH_ALLOWED_EMAILS must stop
    // working when the address does; the row cannot know that happened.
    expect(isOwnerEmail('')).toBe(false);
    expect(isOwnerEmail('   ')).toBe(false);
  });
});

describe('a caller cannot ask for an unbounded page', () => {
  it('clamps, floors and falls back', () => {
    expect(clampLimit('20', 40, 100)).toBe(20);
    expect(clampLimit('5000', 40, 100)).toBe(100);
    expect(clampLimit('0', 40, 100)).toBe(1);
    expect(clampLimit('-3', 40, 100)).toBe(1);
    expect(clampLimit('12.7', 40, 100)).toBe(12);
    expect(clampLimit(null, 40, 100)).toBe(40);
    expect(clampLimit('banana', 40, 100)).toBe(40);
  });
});
