/** Read-only production verification using the release workflow's owner session. */
import assert from 'node:assert/strict';
import pg from 'pg';
import http from 'node:http';

// Native fetch does not reliably preserve Host overrides across Node versions.
// The loopback gateway requires the canonical public host, including anonymous requests.
/** @param {string} url @param {Record<string, string>} headers @returns {Promise<Response>} */
export function getPolicyResponse(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers: { ...headers, host: 'strangeramblings.com' }, timeout: 15000 }, response => {
      /** @type {Buffer[]} */
      const chunks = [];
      const replyHeaders = new Headers();
      for (let i = 0; i < response.rawHeaders.length; i += 2) {
        replyHeaders.append(response.rawHeaders[i], response.rawHeaders[i + 1]);
      }
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), {
        status: response.statusCode, headers: replyHeaders,
      })));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Policy gateway verification timed out')));
  });
}
/** @param {Record<string, string>} headers */
export async function verifyPolicyAnalysis(headers) {
  // Policy has its own origin; Main releases must verify through its gateway.
  const base = 'http://127.0.0.1:5290';
  const page = await getPolicyResponse(`${base}/policy-analysis`, headers);
  assert.equal(page.status, 200, 'Owner policy analysis page must load');
  assert.ok((await page.text()).includes('the policy meets its actors?'));
  const list = await getPolicyResponse(`${base}/api/policy-analysis`, headers);
  assert.equal(list.status, 200, 'Owner policy analysis API must query its schema');
  assert.match(list.headers.get('cache-control') ?? '', /private.*no-store/);
  const anonymous = await getPolicyResponse(`${base}/api/policy-analysis`);
  assert.ok([401, 403].includes(anonymous.status), 'Policy analyses remain private');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const names = ['policy_analyses', 'policy_documents', 'policy_stages', 'policy_executions', 'policy_artefacts', 'policy_provenance', 'policy_model_calls'];
    const { rows } = await client.query('select name, to_regclass(name) as relation from unnest($1::text[]) as name', [names]);
    assert.ok(rows.length === names.length && rows.every(row => row.relation), 'Every policy analysis table must exist');
  } finally { await client.end(); }
  console.log('PASS: owner policy page/API, private caching, anonymous denial and all seven production policy tables. No model calls or data writes.');
}
