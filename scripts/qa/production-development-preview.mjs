/** Runs inside the trusted production broker. No model calls or production DB access. */
import assert from 'node:assert/strict';
import { Agent } from 'undici';
const dispatcher = new Agent({ headersTimeout: 900000, bodyTimeout: 900000 });
const buildId = `release-${process.argv[2]?.slice(0, 12) ?? Date.now()}`;
async function call(action, fields = {}) {
  const response = await fetch(`http://127.0.0.1:5280/${action}`, { dispatcher, method: 'POST',
    headers: { authorization: `Bearer ${process.env.BUILDER_WORKSPACE_BROKER_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ buildId, ...fields }), signal: AbortSignal.timeout(900000) });
  // Carry the broker's own message. Without it a failed release says only
  // "HTTP 400" and the reason — a feature build that died, a slot that was
  // taken, a workspace that moved — is left on a container nobody thinks to
  // open. That cost an hour of archaeology on 2026-09-09.
  const body = await response.text();
  if (!response.ok) throw new Error(`Broker ${action} failed with HTTP ${response.status}: ${body.slice(0, 1200)}`);
  return JSON.parse(body);
}
try {
  await call('prepare');
  const { revision } = await call('snapshot');
  const preview = await call('preview', { revision });
  const base = new URL(preview.url).origin;
  const anonymous = await fetch(base, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
  assert.equal(anonymous.status, 401, 'Anonymous preview access must be denied');
  const grant = await fetch(preview.url, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
  assert.equal(grant.status, 303, 'Preview capability exchange must succeed');
  const cookie = grant.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  assert.ok(cookie.startsWith('__Host-sr-development='));
  const page = await fetch(`${base}/jkai/develop`, { headers: { cookie }, redirect: 'manual', signal: AbortSignal.timeout(60000) });
  assert.equal(page.status, 200, 'Isolated authenticated site must load');
  // Headline line breaks belong to the layout; assert the rendered sentence.
  const rendered = (await page.text()).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  assert.ok(rendered.includes('What should the site do next?'), 'Development UI must render in the isolated site');
  await call('close-preview');
  assert.equal((await fetch(base, { headers: { cookie }, redirect: 'manual', signal: AbortSignal.timeout(30000) })).status, 401, 'Closing a preview must revoke its access');
  console.log('PASS: production broker, isolated site build, HTTPS preview, anonymous denial, capability access and revocation. No paid model or production database was used.');
} finally {
  await call('close-preview').catch(() => {});
  await dispatcher.close();
}
