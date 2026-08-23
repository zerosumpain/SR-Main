import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

const { execInContainer, writeFileInContainer, ensureContainerRunning } = vi.hoisted(() => ({
  execInContainer: vi.fn(),
  writeFileInContainer: vi.fn(),
  ensureContainerRunning: vi.fn(),
}));

vi.mock('$lib/jkai/sandbox', () => ({
  execInContainer: (...a: any[]) => execInContainer(...a),
  writeFileInContainer: (...a: any[]) => writeFileInContainer(...a),
  ensureContainerRunning: () => ensureContainerRunning(),
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
  beforeAll(() => {
    // These tests exercise the LOCAL sandbox path (mocked sandbox calls). On a
    // non-homeserv host with SCRAPER_SERVICE_URL set, runScrape() proxies to a
    // real remote homeserv instead of using the mocked sandbox. Force local
    // execution so the mock assertions are deterministic on any host.
    vi.stubEnv('SCRAPER_ALLOW_NON_HOMESERV', '1');
  });

  beforeEach(() => {
    execInContainer.mockReset();
    writeFileInContainer.mockReset();
    ensureContainerRunning.mockReset();
    loadCredentialForRunner.mockReset();
    insertRunLog.mockResolvedValue([{ id: 42 }]);
    // mkdir -p call returns a result too
    execInContainer.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
  });

  it('writes the job + runner then parses JSON stdout', async () => {
    execInContainer
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

    expect(ensureContainerRunning).toHaveBeenCalled();
    expect(writeFileInContainer).toHaveBeenCalledTimes(2); // scrape.py + job.json
    expect(res.success).toBe(true);
    expect(res.pages[0].fields.h).toBe('Hi');
    expect(res.runLogId).toBe(42);
  });

  it('marks run log as failure when runner exits non-zero', async () => {
    execInContainer
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
    execInContainer
      .mockResolvedValueOnce({ stdout: '', stderr: '', exitCode: 0 }) // mkdir
      .mockResolvedValueOnce({
        stdout: JSON.stringify({ success: true, pages: [] }), stderr: '', exitCode: 0,
      });
    await runScrape({
      url: 'https://x.com/jobs', profile: 'x',
      waitFor: { type: 'networkidle' }, extract: [], credentialId: 1,
    });
    const written = writeFileInContainer.mock.calls.find((c) => c[0].endsWith('job.json'));
    expect(written).toBeDefined();
    expect(written![1]).toContain('"_credential"');
    expect(written![1]).toContain('"username":"u"');
  });
});
