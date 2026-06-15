import { describe, it, expect, vi, beforeEach } from 'vitest';

let sessionRows: any[] = [{ topic: 'Acme Corp' }];
let mdResult: string | Error = '# Acme Corp\n\n## Executive Summary\n\nHi.';

vi.mock('$lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => sessionRows }),
      }),
    }),
  },
}));
vi.mock('$lib/db/schema', () => ({ researchSessions: { topic: {}, id: {} } }));
vi.mock('drizzle-orm', () => ({ eq: () => ({}) }));
vi.mock('$lib/deepdive/docx-export', () => ({
  generateReportMarkdown: vi.fn(async () => {
    if (mdResult instanceof Error) throw mdResult;
    return mdResult;
  }),
}));

import { GET } from './+server';

const makeEvent = (id: string) => ({ params: { id } }) as any;

beforeEach(() => {
  sessionRows = [{ topic: 'Acme Corp' }];
  mdResult = '# Acme Corp\n\n## Executive Summary\n\nHi.';
});

describe('GET /api/deepdive/[id]/export/md', () => {
  it('returns markdown with an attachment Content-Disposition', async () => {
    const res = await GET(makeEvent('sess-1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/markdown');
    const cd = res.headers.get('Content-Disposition') ?? '';
    expect(cd).toContain('attachment');
    expect(cd).toContain('deepdive-acme-corp-');
    expect(cd).toContain('.md');
    const body = await res.text();
    expect(body).toContain('# Acme Corp');
  });

  it('returns 409 when the report is not yet generated', async () => {
    mdResult = new Error('Report not yet generated');
    const res = await GET(makeEvent('sess-1'));
    expect(res.status).toBe(409);
    expect(await res.text()).toBe('Report not yet generated');
  });

  it('404s when the session is missing', async () => {
    sessionRows = [];
    const res = await GET(makeEvent('missing'));
    expect(res.status).toBe(404);
  });
});
