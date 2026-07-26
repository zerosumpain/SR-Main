import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutionContext } from '$lib/workflows/types';
import { makeExecutionContext } from '../../../support/execution-context';

// blog-ops routes through the site-tool executor; mock it so a dry run that
// leaks past the guard would be caught (the mock throws if invoked).
const mockExecuteSiteTool = vi.fn(async () => {
  throw new Error('executeSiteTool must NOT run during a dry run');
});
vi.mock('$lib/workflows/site-tools/executor', () => ({
  executeSiteTool: mockExecuteSiteTool,
  isRegisteredTool: () => true,
}));

// file-ops mutates the DB + disk; make both throw so a leak past the guard
// fails loudly instead of silently mutating.
const throwDb = () => {
  throw new Error('db must NOT be touched during a dry run');
};
vi.mock('$lib/db', () => ({
  db: {
    select: throwDb,
    insert: throwDb,
    update: throwDb,
    delete: throwDb,
    execute: throwDb,
  },
}));
vi.mock('$lib/file-store/storage', () => ({
  saveBuffer: async () => { throw new Error('saveBuffer during dry run'); },
  appendBuffer: async () => { throw new Error('appendBuffer during dry run'); },
  deleteFile: async () => { throw new Error('deleteFile during dry run'); },
  readBuffer: async () => { throw new Error('readBuffer during dry run'); },
  newDiskPath: () => '/tmp/x',
}));

const { blogCreateExecutor, blogUpdateExecutor } = await import('$lib/workflows/nodes/blog-ops');
const { fileWriteExecutor, fileDeleteExecutor } = await import('$lib/workflows/nodes/file-ops');
const { jkaiExecutor } = await import('$lib/workflows/nodes/jkai');

function ctx(dryRun: boolean): ExecutionContext {
  return makeExecutionContext({ runId: 'r', workflowId: 'wf', workspaceDir: '/tmp', dryRun });
}

beforeEach(() => vi.clearAllMocks());

describe('dryRun guards — blog ops', () => {
  it('blog-create simulates without invoking the tool', async () => {
    const r = await blogCreateExecutor.execute({}, { title: 'Hi', content: '<p>x</p>' }, ctx(true));
    expect(r.output).toMatchObject({ success: true, dryRun: true });
    expect(mockExecuteSiteTool).not.toHaveBeenCalled();
  });

  it('blog-update simulates without invoking the tool', async () => {
    const r = await blogUpdateExecutor.execute({}, { postId: 'p1', status: 'published' }, ctx(true));
    expect(r.output).toMatchObject({ success: true, dryRun: true });
    expect(mockExecuteSiteTool).not.toHaveBeenCalled();
  });
});

describe('dryRun guards — file ops', () => {
  it('file-write simulates without touching db/disk', async () => {
    const r = await fileWriteExecutor.execute({ content: 'x' }, { fileName: 'out.txt' }, ctx(true));
    expect(r.output).toMatchObject({ ok: true, dryRun: true, name: 'out.txt' });
  });

  it('file-write append mode is also guarded', async () => {
    const r = await fileWriteExecutor.execute({ content: 'x' }, { fileName: 'log.txt', append: true }, ctx(true));
    expect(r.output).toMatchObject({ ok: true, dryRun: true, mode: 'append' });
  });

  it('file-delete simulates without touching db/disk', async () => {
    const r = await fileDeleteExecutor.execute({}, { fileName: 'gone.csv' }, ctx(true));
    expect(r.output).toMatchObject({ ok: true, dryRun: true, deleted: false, name: 'gone.csv' });
  });
});

describe('dryRun guards — jkai builder ops', () => {
  it('jkai start does NOT spawn a real build during a dry run', async () => {
    const r = await jkaiExecutor.execute(
      { topic: 'a timer' },
      { operation: 'start', prompt: 'Build {{input.topic}}', title: 'Timer' },
      ctx(true),
    );
    expect(r.output).toMatchObject({ success: true, dryRun: true, wouldInvoke: 'build_create' });
    expect(mockExecuteSiteTool).not.toHaveBeenCalled();
  });

  it('jkai control (publish) does NOT publish to production during a dry run', async () => {
    const r = await jkaiExecutor.execute(
      {},
      { operation: 'control', buildId: 'b1', action: 'publish' },
      ctx(true),
    );
    expect(r.output).toMatchObject({ success: true, dryRun: true, wouldInvoke: 'build_control' });
    expect(mockExecuteSiteTool).not.toHaveBeenCalled();
  });
});
