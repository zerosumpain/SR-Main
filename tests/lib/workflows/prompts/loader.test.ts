import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

const mockSelect = vi.fn();
const mockInsert = vi.fn();

vi.mock('$lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => mockSelect(),
        }),
      }),
    }),
    insert: () => ({
      values: (v: any) => {
        mockInsert(v);
        return { onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) };
      },
    }),
  },
}));

vi.mock('$lib/db/schema', () => ({
  promptCache: { id: 'id' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
}));

import { BEHAVIOUR_POLICY } from '$lib/jkai/grounding/policy';
import { syncPrompts, getPromptFiles, compilePromptFiles } from '$lib/workflows/prompts/loader';

const TEST_DIR = join(process.cwd(), 'test-prompts-tmp');

describe('Prompt Loader', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('reads and concatenates .md files in filename order', () => {
    writeFileSync(join(TEST_DIR, '02-second.md'), 'Second file');
    writeFileSync(join(TEST_DIR, '01-first.md'), 'First file');
    writeFileSync(join(TEST_DIR, '03-third.md'), 'Third file');
    writeFileSync(join(TEST_DIR, 'not-md.txt'), 'Ignored');

    const result = compilePromptFiles(TEST_DIR);

    expect(result.compiled).toBe('First file\n\n---\n\nSecond file\n\n---\n\nThird file' + BEHAVIOUR_POLICY);
    expect(result.manifest).toHaveLength(3);
    expect(result.manifest[0].name).toBe('01-first.md');
    expect(result.manifest[1].name).toBe('02-second.md');
    expect(result.manifest[2].name).toBe('03-third.md');
  });

  it('returns empty string for empty directory', () => {
    const result = compilePromptFiles(TEST_DIR);
    expect(result.compiled).toBe('');
    expect(result.manifest).toHaveLength(0);
  });

  it('creates directory if it does not exist', () => {
    const nonExistent = join(TEST_DIR, 'sub', 'dir');
    const result = compilePromptFiles(nonExistent);
    expect(result.compiled).toBe('');
    expect(result.manifest).toHaveLength(0);
  });

  it('getPromptFiles returns file contents', () => {
    writeFileSync(join(TEST_DIR, '01-test.md'), 'Test content');
    const files = getPromptFiles(TEST_DIR);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('01-test.md');
    expect(files[0].content).toBe('Test content');
  });

  it('syncPrompts writes compiled prompt to DB', async () => {
    writeFileSync(join(TEST_DIR, '01-a.md'), 'Alpha');
    writeFileSync(join(TEST_DIR, '02-b.md'), 'Beta');

    await syncPrompts(TEST_DIR);

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'default',
        compiledPrompt: 'Alpha\n\n---\n\nBeta' + BEHAVIOUR_POLICY,
      }),
    );
  });
});
