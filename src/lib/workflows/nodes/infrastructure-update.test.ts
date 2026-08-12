import { describe, expect, it, vi } from 'vitest';

vi.mock('../homeassistant/service', () => ({ getHomeAssistantService: vi.fn(() => ({ testConnection: vi.fn(async () => ({ success: false, error: 'offline' })) })) }));

import { infrastructureUpdateExecutor, validateUpdateManifest } from './infrastructure-update';

const manifest = { approved: true, manifest: { action: 'verify_only' } };

describe('infrastructure-update manifest allowlist', () => {
  it('accepts an exactly matching safe manifest', () => {
    expect(validateUpdateManifest(manifest, 'verify_only')).toBe('verify_only');
  });
  it('rejects arbitrary command-like manifest fields', () => {
    expect(() => validateUpdateManifest({ approved: true, manifest: { action: 'verify_only', command: 'rm -rf /' } }, 'verify_only')).toThrow(/only contain/i);
  });
  it('requires explicit approval', () => {
    expect(() => validateUpdateManifest({ manifest: { action: 'verify_only' } }, 'verify_only')).toThrow(/approved:true/i);
  });
  it('refuses execution unless an approval node is upstream', async () => {
    const context = {
      _currentNodeId: 'update', dryRun: false,
      getIncomingEdges: vi.fn(() => []), getNodeConfig: vi.fn(),
    };
    await expect(infrastructureUpdateExecutor.execute(manifest, { action: 'verify_only' }, context as never)).rejects.toThrow(/approval node/i);
  });
  it('reports rollback-needed when post-update health verification fails', async () => {
    const context = {
      _currentNodeId: 'update', dryRun: false,
      getIncomingEdges: vi.fn((id: string) => id === 'update' ? [{ sourceNodeId: 'approval' }] : []),
      getNodeConfig: vi.fn(() => ({ type: 'approval' })),
    };
    const result = await infrastructureUpdateExecutor.execute({ approved: true, manifest: { action: 'home_assistant_check' } }, { action: 'home_assistant_check' }, context as never);
    expect(result.output).toMatchObject({ verified: false, rollbackNeeded: true, failure: 'offline' });
  });
});
