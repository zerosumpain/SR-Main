/** Owner-surface smoke. Tokens stay in memory and expire after three minutes. */
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { encode } from '@auth/core/jwt';
import { verifyPolicyAnalysis } from './qa/production-policy-analysis.mjs';
import { verifyGrooming } from './qa/production-development-grooming.mjs';
const email = process.env.AUTH_ALLOWED_EMAILS?.split(',')[0]?.trim();
assert.ok(email && process.env.AUTH_SECRET, 'Owner authentication must be configured');
const cookies = [];
for (const salt of ['authjs.session-token', '__Secure-authjs.session-token']) {
  cookies.push(`${salt}=${await encode({ secret: process.env.AUTH_SECRET, salt, maxAge: 180, token: { email, name: 'Deployment verification', sub: 'deployment-verification' } })}`);
}
const headers = { host: 'strangeramblings.com', 'x-forwarded-proto': 'https', cookie: cookies.join('; ') };
const page = await fetch('http://127.0.0.1:4173/jkai/develop', { headers, redirect: 'manual' });
assert.equal(page.status, 200, 'Owner development page must load');
// Match the rendered SENTENCE, not the raw HTML. The cover's headline arrives
// as an array of lines — where it folds is a typographic decision — so the
// words are separated by a `<br />` in the markup and a raw `includes` on the
// document fails on a change that is purely visual. Stripping tags and
// collapsing whitespace keeps this a check that the page rendered.
const rendered = (await page.text()).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
assert.ok(rendered.includes('What should the site do next?'), 'The owner development page must render its headline');
// The archive is the other half of the merged journey: it carries the record of
// every earlier build and the only route from a finished build to a /projects
// card. A develop page that renders without it has lost the backlog.
assert.ok(rendered.includes('Archive'), 'The development page must offer the build archive');
// /jkai/builds and /jkai/builds/new are 308 stubs now. Absolute URLs to the
// old list are in notifications and bookmarks, so the redirect is part of the
// contract, not a convenience.
for (const path of ['/jkai/builds', '/jkai/builds/new']) {
  const retired = await fetch(`http://127.0.0.1:4173${path}`, { headers, redirect: 'manual' });
  assert.equal(retired.status, 308, `${path} must redirect to the development journey`);
  assert.ok(retired.headers.get('location')?.startsWith('/jkai/develop'), `${path} must land on /jkai/develop`);
}
console.log('PASS: the retired builds pages redirect and the archive is present.');
const models = await fetch('http://127.0.0.1:4173/api/jkai/development/models', { headers });
assert.equal(models.status, 200, 'Owner model catalogue must load');
const catalogue = await models.json();
assert.ok(catalogue.models.some(model => model.id.startsWith('codex/')) && catalogue.defaultModel.modelId, 'Build models and default must be available');
const anonymousModels = await fetch('http://127.0.0.1:4173/api/jkai/development/models');
assert.ok([401, 403].includes(anonymousModels.status), 'Model catalogue remains owner-only');
console.log('Production development model catalogue verified.');
const api = await fetch('http://127.0.0.1:4173/api/jkai/development', { headers, redirect: 'manual' });
assert.equal(api.status, 200, 'Delivery schema and owner API must be usable');
assert.ok(Array.isArray(await api.json()));
const anonymous = await fetch('http://127.0.0.1:4173/api/jkai/development', { headers: { host: 'strangeramblings.com', 'x-forwarded-proto': 'https' }, redirect: 'manual' });
assert.ok([401, 403].includes(anonymous.status), 'Anonymous delivery API access must be denied');
console.log('PASS: owner development page, delivery database/API and anonymous denial.');
for (const [path, heading] of [['sources', 'Code sources'], ['improvement', 'Improve the evidence']]) {
  const response = await fetch(`http://127.0.0.1:4173/jkai/codegraph/${path}`, { headers });
  assert.equal(response.status, 200, `CodeGraph ${path} and its database queries must load`);
  assert.ok((await response.text()).includes(heading), `CodeGraph ${path} must render its surface`);
}
const anonymousContext = await fetch('http://127.0.0.1:4173/api/jkai/development/release-smoke/context');
assert.equal(anonymousContext.status, 401, 'Code context must remain owner-only');
console.log('PASS: CodeGraph sources, improvement queries and anonymous context denial.');
function capabilities() {
  return new Promise(resolve => {
    const req = request({ socketPath: '/run/jkai-builder/jkai-builder.sock', path: '/rpc', method: 'POST', headers: { 'content-type': 'application/json' }, timeout: 5000 }, res => {
      let raw = ''; res.on('data', c => raw += c); res.on('end', () => { try { resolve(JSON.parse(raw).result); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null)); req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end(JSON.stringify({ method: 'developmentCapabilities', args: [] }));
  });
}
let ready = false;
for (let attempt = 0; attempt < 24; attempt++) {
  const result = await capabilities();
  if (result?.persistentSessions && result?.brokerConfigured) { ready = true; break; }
  await new Promise(resolve => setTimeout(resolve, 5000));
}
assert.ok(ready, 'Updated development builder is still pending; preserve any active build and check apply-when-idle status.');
console.log('PASS: production builder reports persistent Pi sessions and a configured workspace broker.');

await verifyPolicyAnalysis(headers);
await verifyGrooming(headers);
