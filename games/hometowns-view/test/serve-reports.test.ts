// The Lab report server (scripts/hometowns/serve-reports.mjs): read-only,
// confined to its folder, and friendly when the Lab has written nothing yet.
// The test server listens on an ephemeral loopback port for the test only.

import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createReportServer, resolveInside } from '../../../scripts/hometowns/serve-reports.mjs';

const base = mkdtempSync(join(tmpdir(), 'hometowns-reports-'));
const root = join(base, 'reports');
const outside = join(base, 'secret.txt');
mkdirSync(join(root, 'run-1'), { recursive: true });
writeFileSync(join(root, 'index.html'), '<h1>Scorecard</h1>');
writeFileSync(join(root, 'run-1', 'scorecard.json'), '{"g1":true}');
writeFileSync(join(root, '.hidden'), 'no');
writeFileSync(outside, 'keep out');
symlinkSync(outside, join(root, 'escape.txt'));

let url = '';
const server = createReportServer(root);
const empty = createReportServer(join(base, 'missing'));
let emptyUrl = '';

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  await new Promise<void>((r) => empty.listen(0, '127.0.0.1', () => r()));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  emptyUrl = `http://127.0.0.1:${(empty.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  empty.close();
  rmSync(base, { recursive: true, force: true });
});

describe('serve-reports', () => {
  it('serves the index and files with their types', async () => {
    const a = await fetch(`${url}/`);
    expect(a.status).toBe(200);
    expect(await a.text()).toContain('Scorecard');
    const b = await fetch(`${url}/run-1/scorecard.json`);
    expect(b.headers.get('content-type')).toContain('application/json');
    expect(await b.json()).toEqual({ g1: true });
  });

  it('lists a folder without an index, hiding dotfiles', async () => {
    const r = await fetch(`${url}/run-1/`);
    expect(await r.text()).toContain('scorecard.json');
  });

  it('refuses traversal, dotfiles, symlinks out of the folder and writes', async () => {
    expect((await fetch(`${url}/..%2Fsecret.txt`)).status).toBe(404);
    expect((await fetch(`${url}/.hidden`)).status).toBe(404);
    expect((await fetch(`${url}/escape.txt`)).status).toBe(404);
    expect((await fetch(`${url}/`, { method: 'POST', body: 'x' })).status).toBe(405);
    expect(await resolveInside(root, '/../secret.txt')).toBeNull();
  });

  it('says so when the Lab has not written a report yet', async () => {
    const r = await fetch(`${emptyUrl}/`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('No Lab report has been written yet');
  });
});
