import { describe, it, expect, vi, beforeEach } from 'vitest';

const { execInSandbox, writeFileInSandbox, ensureSandboxRunning } = vi.hoisted(() => ({
  execInSandbox: vi.fn(),
  writeFileInSandbox: vi.fn(),
  ensureSandboxRunning: vi.fn(),
}));

vi.mock('$lib/jkai/sandbox', () => ({
  execInSandbox: (...a: any[]) => execInSandbox(...a),
  writeFileInSandbox: (...a: any[]) => writeFileInSandbox(...a),
  ensureSandboxRunning: () => ensureSandboxRunning(),
}));

const { loadCredentialForRunner } = vi.hoisted(() => ({
  loadCredentialForRunner: vi.fn(),
}));

vi.mock('$lib/workflows/scraper/credentials', () => ({
  loadCredentialForRunner: (...a: any[]) => loadCredentialForRunner(...a),
}));

const { insertRunLog, updateRunLog, db } = vi.hoisted(() => {
  const insertRunLog = vi.fn().mockResolvedValue([{ id: 42 }]);
  const updateRunLog = vi.fn().mockResolvedValue(undefined);
  const db: any = {
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: insertRunLog })) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateRunLog })) })),
  };
  return { insertRunLog, updateRunLog, db };
});

vi.mock('$lib/db', () => ({ db }));
vi.mock('$lib/db/schema', () => ({ scraperRunLog: { id: 'id' } }));
vi.mock('drizzle-orm', () => ({ eq: (a: any, b: any) => ({ a, b }) }));

import { runScrape } from '$lib/workflows/scraper/runner';

describe('runScrape', () => {
  beforeEach(() => {
    execInSandbox.mockReset();
    writeFileInSandbox.mockReset();
    ensureSandboxRunning.mockReset();
    loadCredentialForRunner.mockReset();
    insertRunLog.mockResolvedValue([{ id: 42 }]);
    // mkdir -p call returns a result too
    execInSandbox.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
  });

  it('writes the job + runner then parses JSON stdout', async () => {
    execInSandbox
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // mkdir
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ success: true, pages: [{ url: 'https://x', fields: { h: 'Hi' } }] }),
        stderr: '',
        exitCode: 0,
      });

    const res = await runScrape({
      url: 'https://x',
      profile: 'test',
      waitFor: { type: 'networkidle' },
      extract: [{ field: 'h', selector: 'h1' }],
    });

    expect(ensureSandboxRunning).toHaveBeenCalled();
    expect(writeFileInSandbox).toHaveBeenCalledTimes(2); // scrape.py + job.json
    expect(res.success).toBe(true);
    expect(res.pages[0].fields.h).toBe('Hi');
    expect(res.runLogId).toBe(42);
  });

  it('marks run log as failure when runner exits non-zero', async () => {
    execInSandbox
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // mkdir
      .mockResolvedValueOnce({ stdout: '', stderr: 'boom', exitCode: 1 });
    const res = await runScrape({
      url: 'https://x',
      profile: 'p',
      waitFor: { type: 'networkidle' },
      extract: [],
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain('boom');
  });

  it('resolves credentials when credentialId is set', async () => {
    loadCredentialForRunner.mockResolvedValue({
      id: 1, domain: 'x.com', loginUrl: 'https://x.com/login',
      loginStrategy: 'form', credential: { username: 'u', password: 'p' },
    });
    execInSandbox
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // mkdir
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ success: true, pages: [] }), stderr: '', exitCode: 0,
      });
    await runScrape({
      url: 'https://x.com/jobs', profile: 'x',
      waitFor: { type: 'networkidle' }, extract: [], credentialId: 1,
    });
    const written = writeFileInSandbox.mock.calls.find((c) => c[0].endsWith('job.json'));
    expect(written).toBeDefined();
    expect(written![1]).toContain('"_credential"');
    expect(written![1]).toContain('"username":"u"');
  });
});
