/** Read-only production verification using the release workflow's owner session. */
import assert from 'node:assert/strict';
import pg from 'pg';
export async function verifyPolicyAnalysis(headers) {
  const base = 'http://127.0.0.1:4173';
  const page = await fetch(`${base}/policy-analysis`, { headers, redirect: 'manual' });
  assert.equal(page.status, 200, 'Owner policy analysis page must load');
  assert.ok((await page.text()).includes('the policy meets its actors?'));
  const list = await fetch(`${base}/api/policy-analysis`, { headers, redirect: 'manual' });
  assert.equal(list.status, 200, 'Owner policy analysis API must query its schema');
  assert.match(list.headers.get('cache-control') ?? '', /private.*no-store/);
  const anonymous = await fetch(`${base}/api/policy-analysis`, { redirect: 'manual' });
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
