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
      expect(src.includes('withDevice(') || src.includes('withNativeAccess(')).toBe(true);
      // Exported without the wrapper round it — the shape that would answer
      // anyone who could reach the path.
      expect(src).not.toMatch(/export const (GET|POST|PUT|PATCH|DELETE)[^=]*=\s*async/);
    },
  );

  /**
   * The routes a MEMBER's phone may reach, named. `withNativeAccess` is how a
   * route opts in, and each one here was converted to scope itself exactly as
   * its web twin does; everything else stays on owner-only `withDevice`. A new
   * entry must be a deliberate edit to this list, not a wrapper swapped in
   * passing.
   */
  it('opens only the converted routes to members', () => {
    const opened = handlers
      .filter((p) => readFileSync(join(process.cwd(), p), 'utf8').includes('withNativeAccess('))
      .map((p) => p.slice(NATIVE_ROUTES.length))
      .sort();
    expect(opened).toEqual(
      [
        '/chat/attachments/+server.ts',
        '/chat/attachments/[id]/+server.ts',
        '/chat/conversations/+server.ts',
        '/chat/conversations/[id]/+server.ts',
        '/chat/conversations/[id]/messages/+server.ts',
        '/chat/conversations/[id]/model/+server.ts',
        '/games/+server.ts',
        '/games/[id]/+server.ts',
        '/games/[id]/stream/+server.ts',
        '/me/+server.ts',
        '/news/+server.ts',
        '/news/actions/+server.ts',
        '/news/story/[source]/[id]/+server.ts',
      ].sort(),
    );
    // And none of them keeps an owner-only handler beside it by accident.
    for (const p of handlers.filter((h) => opened.includes(h.slice(NATIVE_ROUTES.length)))) {
      expect(readFileSync(join(process.cwd(), p), 'utf8')).not.toContain('withDevice(');
    }
  });

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

/**
 * The device lanes must be rate-limited too.
 *
 * The orchestrator's 10/min cap lives INSIDE the owner-gate block, and both
 * native lanes return before reaching it. Without an explicit limit a paired
 * phone could start chat turns without a ceiling — and every turn is a paid
 * model call, on a client that retries. This asserts the hook actually applies
 * one on both lanes rather than trusting the comment that says it does.
 */
describe('the phone is capped like a browser', () => {
  const hook = readFileSync(join(process.cwd(), 'src/hooks.server.ts'), 'utf8');

  it('applies a limit on the native tree and the orchestrator lane', () => {
    // Both bypasses must consult the shared limiter before resolving.
    const nativeLane = hook.slice(hook.indexOf("pathname.startsWith('/api/native/')"));
    expect(nativeLane.slice(0, 600)).toContain('rateLimited(');

    const chatLane = hook.slice(hook.indexOf("'/api/workflows/orchestrator/chat/stream'"));
    expect(chatLane.slice(0, 900)).toContain('rateLimited(');
  });

  it('keys the bucket on the DEVICE, not on a shared name', () => {
    // One phone stuck in a retry loop must not consume the browser's allowance.
    expect(hook).toContain('`device:${device.id}`');
  });

  it('has exactly one implementation of the limit decision', () => {
    // The owner gate had its own copy; two copies is how a ceiling drifts from
    // the table it is meant to enforce.
    //
    // Comments are stripped first: the RATE_LIMITS table's own note mentions
    // `RATE_LIMITS.find()` in prose, and counting that found a duplicate
    // implementation that does not exist.
    const code = hook
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    expect(code.match(/function rateLimited\(/g)?.length).toBe(1);
    expect(code.match(/RATE_LIMITS\.find\(/g)?.length).toBe(1);
  });

  it('sends a member device through the member gate, never the sessionless resolve', () => {
    // Sessionless is the OWNER to every chat helper. A member's phone that
    // reached `resolve(event)` from this lane would chat as John.
    const lane = hook.slice(hook.indexOf('const held = await memberDevice(event.request)'));
    const branch = lane.slice(0, lane.indexOf('// API routes return 401'));
    expect(branch.length).toBeGreaterThan(0);
    expect(branch).toContain("'jkai.chat:self'");
    expect(branch).toContain('actAsDeviceMember(event.locals, held)');
    expect(branch).toContain('`device:${held.identity.id}`');
    expect(branch).not.toContain('resolve(event)');
  });

  it('still exempts the pairing endpoint, which has its own ceiling', () => {
    expect(hook).toContain("pathname !== '/api/native/pair'");
  });
});
