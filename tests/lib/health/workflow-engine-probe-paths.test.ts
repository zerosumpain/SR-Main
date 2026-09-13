import { describe, expect, it } from 'vitest';
import { GET as platformGet } from '../../../src/routes/api/platform/workflow-engine/+server';
import { GET as healthGet } from '../../../src/routes/api/health/workflow-engine/+server';
import { GET as sharedGet } from '../../../src/lib/workflows/engine-probe';
import { HOOK_BYPASSES } from '../../../src/lib/server/gate-bypasses';

describe('workflow-engine probe paths', () => {
  it('serves both paths from one handler, so they cannot drift', () => {
    // strange-rambling-svelte-watchdog.service curls the historical path every
    // sixty seconds and runs `systemctl restart strange-rambling-svelte` on
    // anything but a 200. Two copies of this handler is a restart loop waiting
    // for one of them to be edited.
    expect(healthGet).toBe(sharedGet);
    expect(platformGet).toBe(sharedGet);
  });

  it('keeps both paths in the loopback bypass while the watchdog is repointed', () => {
    // Removing the historical entry before the VPS unit is updated locks the
    // watchdog out behind the owner gate, which it cannot pass.
    expect(HOOK_BYPASSES).toContain('/api/platform/workflow-engine');
    expect(HOOK_BYPASSES).toContain('/api/health/workflow-engine');
  });
});
