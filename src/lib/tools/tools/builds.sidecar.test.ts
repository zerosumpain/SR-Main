// The chat build tools must drive the builder sidecar, never an in-process loop.
//
// The web app runs as `sr-main`, which cannot write the build workspace. When
// build_create imported `$lib/jkai/orchestrator` directly, every iteration of a
// chat-started build failed in milliseconds and retried every 30s past its
// iteration cap: build 915fae11 (2026-10-03) logged 36 zero-token iterations
// while chat reported "iteration 13". The module-boundary gate refuses the
// import (scripts/check-module-boundaries.mjs, R6); these tests pin the
// behaviour: each tool reaches builderClient, and loading the orchestrator
// fails the test outright.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  tools: new Map<string, { handler: (args: Record<string, unknown>, ctx?: unknown) => Promise<unknown> }>(),
  client: {
    startBuild: vi.fn(),
    pauseBuild: vi.fn(),
    resumeBuild: vi.fn(),
    stopBuild: vi.fn(),
    continueBuild: vi.fn(),
  },
  inserted: [] as Record<string, unknown>[],
  existing: null as Record<string, unknown> | null,
}));

vi.mock('../registry-internal', () => ({
  register: (tool: { name: string; handler: never }) => mock.tools.set(tool.name, tool),
}));
vi.mock('$lib/jkai/builder-client', () => ({ builderClient: mock.client }));
vi.mock('$lib/jkai/orchestrator', () => {
  throw new Error('the in-process orchestrator was imported');
});
vi.mock('$lib/server/models/workload-settings', () => ({
  resolveBuilderModel: async () => ({ provider: 'openrouter', modelId: 'stub/builder' }),
}));
vi.mock('$lib/jkai/sandbox', () => ({ ensureWorkspace: vi.fn(), writeFileInSandbox: vi.fn(), execInSandbox: vi.fn() }));
vi.mock('$lib/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (mock.existing ? [mock.existing] : []) }) }) }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        mock.inserted.push(v);
        return { returning: async () => [{ id: 'build-1', ...v }] };
      },
    }),
  },
}));

await import('./builds');
const tool = (name: string) => {
  const t = mock.tools.get(name);
  if (!t) throw new Error(`${name} is not registered`);
  return t;
};

beforeEach(() => {
  mock.inserted.length = 0;
  for (const fn of Object.values(mock.client)) fn.mockReset().mockResolvedValue(undefined);
});

describe('chat build tools', () => {
  it('build_create starts the build in the sidecar and stamps it origin chat', async () => {
    const res = await tool('build_create').handler(
      { prompt: 'a countdown timer app' },
      { conversationId: 'chat_6f1c2a7e-3a64-4f52-9c1e-0b1d2e3f4a5b' },
    );
    expect(res).toMatchObject({ success: true, data: { id: 'build-1' } });
    expect(mock.client.startBuild).toHaveBeenCalledWith('build-1');
    expect(mock.inserted[0]).toMatchObject({
      origin: 'chat',
      prompt: 'a countdown timer app',
      conversationId: '6f1c2a7e-3a64-4f52-9c1e-0b1d2e3f4a5b',
      modelId: 'stub/builder',
    });
  });

  it('build_create surfaces a sidecar that cannot be reached', async () => {
    mock.client.startBuild.mockRejectedValueOnce(new Error('builder rpc startBuild: socket error: ENOENT'));
    await expect(tool('build_create').handler({ prompt: 'x' })).rejects.toThrow(/socket error/);
  });

  it.each([
    ['pause', 'pauseBuild'],
    ['resume', 'resumeBuild'],
    ['stop', 'stopBuild'],
  ] as const)('build_control %s goes through builderClient.%s', async (action, method) => {
    await tool('build_control').handler({ id: 'build-1', action });
    expect(mock.client[method]).toHaveBeenCalledWith('build-1');
  });

  it('build_tweak continues the build in the sidecar', async () => {
    const res = await tool('build_tweak').handler({ id: 'build-1', instruction: 'make it blue' });
    expect(res).toMatchObject({ success: true });
    expect(mock.client.continueBuild).toHaveBeenCalledWith('build-1', 'make it blue');
  });
});

describe('register_chat_build', () => {
  // build_create now stamps origin 'chat', which register_chat_build used to
  // read as "a build I filed myself". Replacing a builder-run build's files
  // would overwrite its workspace and relabel it 'registered'.
  it('refuses to replace the files of a build the builder ran', async () => {
    mock.existing = { id: 'build-1', origin: 'chat', status: 'running', outcome: null };
    const res = await tool('register_chat_build').handler({
      prompt: 'a timer',
      updateBuildId: 'build-1',
      files: [{ path: 'index.html', content: '<!doctype html><p>hi</p>' }],
    });
    expect(res).toMatchObject({ success: false, error: expect.stringContaining('build_tweak') });
    mock.existing = null;
  });
});

describe('daydream prototype', () => {
  // startPrototype runs inside a note transaction; the integration test
  // (follow.integration.test.ts) drives it against a real database. This pins
  // the import so a unit run catches a regression too.
  it('starts its build through builderClient', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../daydream/act/follow.server.ts', import.meta.url)),
      'utf8',
    );
    expect(source).not.toMatch(/\$lib\/jkai\/orchestrator['"]/);
    expect(source).toContain('builderClient.startBuild(buildId)');
  });
});
