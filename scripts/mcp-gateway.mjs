#!/usr/bin/env node
// jkai MCP availability gateway
//
// WHY THIS EXISTS
// Hermes connects to ONE MCP server URL and keeps a pooled HTTP connection to
// it. When that upstream is the SvelteKit service on :5173, every site restart,
// rebuild or slow boot is a window in which `mcp_jkai_*` tool calls fail — and
// the observed failure mode is not a loud error, it is jkai silently falling
// back to whatever it still has (Hermes' own `terminal`), grepping credentials
// off disk and answering from a hand-rolled curl. Measured 2026-07-26: the site
// service had NRestarts=0 and a 253MB peak against a 1GB cap, so this is not
// resource exhaustion — it is the client's view of a socket that went away.
//
// This process is what Hermes talks to instead. It has ZERO dependencies beyond
// node builtins and does not import a line of site code, so it never needs
// rebuilding or restarting when the site is deployed. Its listening socket stays
// up across site restarts; requests that arrive during one are held and retried
// until the site is back, so a restart becomes latency instead of an error.
//
// Deliberately NOT a general-purpose proxy:
//   - only POST /api/mcp (plus GET /healthz) is served;
//   - retries are gated on whether the request could have been executed already
//     (see canRetry) so a `tools/call` is never silently run twice;
//   - the exhausted-retry response is a JSON-RPC error whose message tells the
//     model to stop rather than improvise, because silent degradation is the
//     actual hazard.
//
// Env:
//   MCP_GATEWAY_PORT   listen port                   (default 5199)
//   MCP_GATEWAY_HOST   listen address                (default 127.0.0.1)
//   MCP_UPSTREAM       upstream MCP URL              (default http://127.0.0.1:5173/api/mcp)
//                      http: and https: are both supported — homeserv points this at
//                      production so there is a single API secret registry.
//   MCP_GATEWAY_HOLD_MS  how long to hold a request while upstream is down (default 180000)
//   MCP_GATEWAY_CALL_TIMEOUT_MS  per-attempt upstream timeout (default 900000, matches Hermes)

import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

const PORT = Number(process.env.MCP_GATEWAY_PORT ?? 5199);
const HOST = process.env.MCP_GATEWAY_HOST ?? '127.0.0.1';
const UPSTREAM = new URL(process.env.MCP_UPSTREAM ?? 'http://127.0.0.1:5173/api/mcp');
// The upstream is normally the local site over plain HTTP, but it can be pointed at
// production (https://strangeramblings.com/api/mcp) so that Hermes — and therefore
// WhatsApp — resolves API credentials against the SAME registry the website uses.
// Without this, homeserv answered from its own dev database and reported live
// credentials as missing. Pick the transport from the URL, not a hardcoded module.
const UPSTREAM_IS_TLS = UPSTREAM.protocol === 'https:';
const upstreamTransport = UPSTREAM_IS_TLS ? https : http;
const UPSTREAM_PORT = UPSTREAM.port || (UPSTREAM_IS_TLS ? 443 : 80);
const HOLD_MS = Number(process.env.MCP_GATEWAY_HOLD_MS ?? 180_000);
const CALL_TIMEOUT_MS = Number(process.env.MCP_GATEWAY_CALL_TIMEOUT_MS ?? 900_000);
const RETRY_BASE_MS = 250;
const RETRY_MAX_MS = 2_000;

const stats = {
  startedAt: new Date().toISOString(),
  requests: 0,
  forwarded: 0,
  heldThenSucceeded: 0,
  retryAttempts: 0,
  failedAfterHold: 0,
  notRetryable: 0,
  lastUpstreamErrorAt: null,
  lastUpstreamError: null,
  longestHoldMs: 0,
};

const log = (...a) => console.log(`[mcp-gateway]`, ...a);

/**
 * Connection-level failures mean the request never reached the site, so
 * replaying it cannot double-execute anything. Anything else (an HTTP response,
 * however bad) might have already run the tool.
 */
function isConnectionLevel(err) {
  const code = err?.code ?? '';
  return (
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH' ||
    code === 'EPIPE' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNABORTED' ||
    err?.message === 'socket hang up'
  );
}

/**
 * Whether a *response* status is safe to retry. Only for methods with no side
 * effects — a 503 on `tools/call` may mean the tool ran and the reply was lost,
 * and running a write tool twice is worse than surfacing an error.
 */
function methodIsSideEffectFree(method) {
  if (!method) return false;
  return (
    method === 'initialize' ||
    method === 'ping' ||
    method === 'tools/list' ||
    method === 'resources/list' ||
    method === 'prompts/list' ||
    method.startsWith('notifications/')
  );
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      // JSON-RPC bodies are small; refuse anything absurd rather than buffer it.
      if (total > 8 * 1024 * 1024) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function forwardOnce(body, headers) {
  return new Promise((resolve, reject) => {
    const upstreamReq = upstreamTransport.request(
      {
        protocol: UPSTREAM.protocol,
        hostname: UPSTREAM.hostname,
        port: UPSTREAM_PORT,
        path: UPSTREAM.pathname + UPSTREAM.search,
        method: 'POST',
        headers,
        timeout: CALL_TIMEOUT_MS,
      },
      (upstreamRes) => {
        const chunks = [];
        upstreamRes.on('data', (c) => chunks.push(c));
        upstreamRes.on('end', () =>
          resolve({
            status: upstreamRes.statusCode ?? 502,
            headers: upstreamRes.headers,
            body: Buffer.concat(chunks),
          }),
        );
        upstreamRes.on('error', reject);
      },
    );
    upstreamReq.on('timeout', () => {
      upstreamReq.destroy(Object.assign(new Error('upstream timeout'), { code: 'ETIMEDOUT' }));
    });
    upstreamReq.on('error', reject);
    upstreamReq.end(body);
  });
}

/** JSON-RPC error that tells the model to stop instead of working around it. */
function unavailableResponse(id, detail) {
  return Buffer.from(
    JSON.stringify({
      jsonrpc: '2.0',
      id: id ?? null,
      error: {
        code: -32001,
        message:
          'jkai site tools are temporarily unavailable (the site is restarting or unreachable). ' +
          'Do NOT attempt to work around this — do not read credentials from files or the environment, ' +
          'do not hand-roll an API call, and do not guess an answer. Tell the user the tools are ' +
          `briefly unavailable and stop. Detail: ${detail}`,
      },
    }),
  );
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/healthz' || req.url === '/')) {
    let upstreamOk = false;
    try {
      const probe = await forwardOnce(
        Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 'healthz', method: 'ping' })),
        { 'content-type': 'application/json', 'content-length': 48 },
      );
      upstreamOk = probe.status < 500;
    } catch {
      upstreamOk = false;
    }
    res.writeHead(upstreamOk ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: upstreamOk, upstream: UPSTREAM.href, ...stats }, null, 2));
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'POST' });
    res.end('Method Not Allowed');
    return;
  }

  stats.requests++;

  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: String(err?.message ?? err) }));
    return;
  }

  // Parse only to decide retry-safety and to echo the id back on failure.
  let rpcId = null;
  let rpcMethod = '';
  try {
    const parsed = JSON.parse(body.toString('utf8'));
    if (parsed && !Array.isArray(parsed)) {
      rpcId = parsed.id ?? null;
      rpcMethod = typeof parsed.method === 'string' ? parsed.method : '';
    }
  } catch {
    /* forward it anyway; upstream owns the parse error */
  }

  // Pass everything through except hop-by-hop / recomputed headers. The
  // Authorization bearer MUST survive verbatim — upstream gates tools/call on it.
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    const lower = k.toLowerCase();
    if (lower === 'host' || lower === 'connection' || lower === 'content-length') continue;
    headers[k] = v;
  }
  headers['content-length'] = Buffer.byteLength(body);
  headers['x-forwarded-by'] = 'jkai-mcp-gateway';

  const deadline = Date.now() + HOLD_MS;
  let attempt = 0;
  let lastDetail = 'unknown';

  while (true) {
    attempt++;
    try {
      const upstream = await forwardOnce(body, headers);

      const retryableStatus = upstream.status === 502 || upstream.status === 503 || upstream.status === 504;
      if (retryableStatus && methodIsSideEffectFree(rpcMethod) && Date.now() < deadline) {
        stats.retryAttempts++;
        lastDetail = `upstream HTTP ${upstream.status}`;
        await sleep(backoff(attempt));
        continue;
      }

      stats.forwarded++;
      if (attempt > 1) {
        stats.heldThenSucceeded++;
        const held = HOLD_MS - (deadline - Date.now());
        stats.longestHoldMs = Math.max(stats.longestHoldMs, held);
        log(`recovered after ${attempt} attempts (${held}ms) — ${rpcMethod || 'unknown method'}`);
      }

      const outHeaders = {};
      for (const [k, v] of Object.entries(upstream.headers)) {
        const lower = k.toLowerCase();
        if (lower === 'connection' || lower === 'transfer-encoding' || lower === 'content-length') continue;
        outHeaders[k] = v;
      }
      res.writeHead(upstream.status, outHeaders);
      res.end(upstream.body);
      return;
    } catch (err) {
      stats.lastUpstreamErrorAt = new Date().toISOString();
      stats.lastUpstreamError = `${err?.code ?? ''} ${err?.message ?? err}`.trim();
      lastDetail = stats.lastUpstreamError;

      const retryable = isConnectionLevel(err) || methodIsSideEffectFree(rpcMethod);
      if (!retryable) {
        stats.notRetryable++;
        log(`not retrying ${rpcMethod || 'unknown'} after ${lastDetail} — may already have executed`);
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(unavailableResponse(rpcId, lastDetail));
        return;
      }

      if (Date.now() >= deadline) {
        stats.failedAfterHold++;
        log(`gave up on ${rpcMethod || 'unknown'} after ${HOLD_MS}ms — ${lastDetail}`);
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(unavailableResponse(rpcId, lastDetail));
        return;
      }

      stats.retryAttempts++;
      if (attempt === 1) log(`upstream down (${lastDetail}) — holding ${rpcMethod || 'request'}`);
      await sleep(backoff(attempt));
    }
  }
});

function backoff(attempt) {
  return Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_MAX_MS);
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Hermes pools connections to us; don't be the reason one gets dropped.
server.keepAliveTimeout = 120_000;
server.headersTimeout = 125_000;
server.requestTimeout = 0; // a tool call may legitimately run for minutes

server.listen(PORT, HOST, () => {
  log(`listening on http://${HOST}:${PORT} -> ${UPSTREAM.href}`);
  log(`holding requests up to ${HOLD_MS}ms while upstream is down`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    log(`${sig} — closing`);
    server.close(() => process.exit(0));
  });
}
