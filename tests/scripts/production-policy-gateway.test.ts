import assert from 'node:assert/strict';
import { test } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { getPolicyResponse } from '../../scripts/qa/production-policy-analysis.mjs';

test('gateway probes preserve the canonical host and owner cookie over loopback', async () => {
  const server = http.createServer((req, res) => {
    if (req.headers.host !== 'strangeramblings.com') { res.writeHead(400); res.end(); return; }
    res.writeHead(req.headers.cookie === 'synthetic=owner' ? 200 : 401, { 'cache-control': 'private, no-store' });
    res.end(JSON.stringify({ path: req.url }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/policy-analysis`;
    const owner = await getPolicyResponse(url, { cookie: 'synthetic=owner', host: 'ignored.example' });
    assert.equal(owner.status, 200);
    assert.equal(owner.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await owner.json(), { path: '/api/policy-analysis' });
    assert.equal((await getPolicyResponse(url)).status, 401);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
