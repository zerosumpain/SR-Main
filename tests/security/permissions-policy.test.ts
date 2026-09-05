import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Read the source rather than import it: hooks.server.ts starts the health
// scheduler, the forge scheduler, the dependency monitor and every integration
// adapter on import, and none of that belongs in a header assertion.
const hooks = () => readFileSync(join(process.cwd(), 'src/hooks.server.ts'), 'utf8');
const generated = () =>
  readFileSync(join(process.cwd(), 'src/lib/server/generated-content.ts'), 'utf8');

const policyLine = (src: string) => src.match(/'geolocation=[^']*'/)?.[0] ?? '';

describe('first-party Permissions-Policy', () => {
  it('allows the microphone for this origin', () => {
    // `microphone=()` is an EMPTY allowlist — it disables the feature for every
    // origin including this one, and the policy is checked before the permission
    // prompt. getUserMedia then rejects with NotAllowedError, the browser never
    // asks, and the site setting stays on "Ask" — which looks exactly like a user
    // denial that site settings cannot fix. It shipped that way in #2, before the
    // site had a microphone, and silently broke the notebook's voice notes,
    // /capture and the chat recorder until 2026-09-05.
    const line = policyLine(hooks());
    expect(line).toContain('microphone=(self)');
    expect(line).not.toContain('microphone=()');
  });

  it('keeps the features nothing first-party uses closed', () => {
    const line = policyLine(hooks());
    expect(line).toContain('camera=()');
    expect(line).toContain('payment=()');
    expect(line).toContain('usb=()');
  });
});

describe('generated-content Permissions-Policy', () => {
  it('still denies the microphone to untrusted builder output', () => {
    // The asymmetry is deliberate: builder-generated apps are served from these
    // headers and must not reach the microphone just because the first-party
    // site may. Widening the one above must never widen this one.
    expect(generated()).toContain('microphone=()');
    expect(generated()).not.toContain('microphone=(self)');
  });
});
