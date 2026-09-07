import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ exec: vi.fn(async (_command: string) => ({ stdout: '', stderr: '' })), broker: vi.fn(async () => ({})), delivery: vi.fn() }));
vi.mock('child_process', () => ({ exec: Object.assign(() => {}, { [Symbol.for('nodejs.util.promisify.custom')]: mocks.exec }) }));
vi.mock('./development-workspace.server', () => ({ workspaceBroker: mocks.broker }));
vi.mock('./development-state.server', () => ({ loadDelivery: mocks.delivery }));
vi.mock('./log-emitter', () => ({ emitLog: vi.fn(async () => {}) }));
vi.stubEnv('JKAI_BUILDS_HOSTMODE', '1');
vi.stubEnv('BUILDER_WORKSPACE_BROKER_URL', 'http://broker.test');
vi.stubEnv('FORGE_GITHUB_TOKEN', '');
const { ensureGitWorkspace } = await import('./sandbox');
const { SR_MAIN_GIT_TARGET } = await import('./git-targets');
afterAll(() => vi.unstubAllEnvs());
beforeEach(() => vi.clearAllMocks());
const commands = () => mocks.exec.mock.calls.map(([command]) => Buffer.from(String(command).match(/echo '([^']+)'/)![1], 'base64').toString()).join('\n');
describe('production broker opt-in', () => {
  it('keeps legacy repository cloning and its origin when a broker is configured', async () => {
    mocks.delivery.mockResolvedValue(null);
    await ensureGitWorkspace('legacy-build', SR_MAIN_GIT_TARGET);
    expect(mocks.broker).toHaveBeenCalledWith('allocate', 'legacy-build');
    expect(mocks.broker).not.toHaveBeenCalledWith('prepare', expect.anything());
    expect(commands()).toContain('git clone');
  });
  it('uses the retained broker workspace for delivery-managed builds', async () => {
    mocks.delivery.mockResolvedValue({ state: { version: 1 } });
    await ensureGitWorkspace('delivery-build', SR_MAIN_GIT_TARGET);
    expect(mocks.broker).toHaveBeenCalledWith('prepare', 'delivery-build');
    expect(commands()).not.toContain('git clone');
    expect(commands()).not.toContain('rm -rf');
  });
});
