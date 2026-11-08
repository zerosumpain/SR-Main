#!/usr/bin/env node
// A tiny read-only static server for the Lab's scorecards and HTML reports
// (spec §11.1, §14.1): the local preview's `hometowns-lab` service runs it
// on the preview image, so it needs nothing beyond Node itself.
//
//   node scripts/hometowns/serve-reports.mjs [--root <dir>] [--port <n>] [--host <addr>]
//
// It serves GET and HEAD only, from one folder (default
// scripts/hometowns/reports/), refuses any path that escapes that folder or
// names a dotfile, lists a folder that has no index.html, and says so
// plainly when the Lab has not written a report yet. The host-side bind
// address belongs to whoever runs it (the compose file publishes it on the
// tailnet address only). Inside a container it listens on all interfaces,
// which only the container's own network can reach; anywhere else --host is
// required, because porkserv also serves public production and an
// accidental all-interfaces bind there would publish the reports.

import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

/** @param {string} name @param {string} fallback */
function arg(name, fallback) {
  const k = process.argv.indexOf(`--${name}`);
  return k >= 0 && process.argv[k + 1] ? process.argv[k + 1] : fallback;
}

const ROOT = resolve(arg('root', join(here, 'reports')));
const PORT = Number(arg('port', process.env.PORT ?? '8080'));
const IN_CONTAINER = existsSync('/.dockerenv') || existsSync('/run/.containerenv');
const HOST = arg('host', IN_CONTAINER ? '0.0.0.0' : '');

/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/** @type {Record<string, string>} */
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** @param {string} s */
const escape = (s) => s.replace(/[&<>"']/g, (c) => ENTITIES[c]);

/** @param {string} title @param {string} body */
function page(title, body) {
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;margin:0 auto;max-width:720px;padding:16px;color:#2b2620;background:#fffaf0}a{color:#b4632e}li{margin:2px 0}code{font-size:13px}
@media (prefers-color-scheme:dark){body{color:#eee6d8;background:#1d1b18}a{color:#e08a52}}</style></head><body>${body}</body></html>`;
}

/**
 * Resolves a URL path inside `root`, or null if it escapes it or touches a dotfile.
 * @param {string} root
 * @param {string} urlPath
 * @returns {Promise<string | null>}
 */
export async function resolveInside(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const parts = decoded.split('/').filter(Boolean);
  if (parts.some((p) => p.startsWith('.'))) return null;
  const full = resolve(root, ...parts);
  const rel = relative(root, full);
  if (rel.startsWith('..') || rel.includes(`..${sep}`)) return null;
  try {
    // Symlinks must not lead out of the folder either.
    const real = await realpath(full);
    const realRoot = await realpath(root);
    if (real !== realRoot && !real.startsWith(realRoot + sep)) return null;
    return real;
  } catch {
    return full; // missing: the caller answers 404
  }
}

/** @param {string} dir @param {string} urlPath */
async function listing(dir, urlPath) {
  const names = (await readdir(dir, { withFileTypes: true })).filter((d) => !d.name.startsWith('.')).sort((a, b) => (a.name < b.name ? -1 : 1));
  const base = urlPath.endsWith('/') ? urlPath : `${urlPath}/`;
  const items = names.map((d) => `<li><a href="${escape(base + encodeURIComponent(d.name))}${d.isDirectory() ? '/' : ''}">${escape(d.name)}${d.isDirectory() ? '/' : ''}</a></li>`).join('');
  return page('Hometowns Lab reports', `<h1>Hometowns Lab reports</h1><p><code>${escape(base)}</code></p>${items ? `<ul>${items}</ul>` : '<p>This folder is empty.</p>'}`);
}

/** @param {string} [root] */
export function createReportServer(root = ROOT) {
  return createServer(async (req, res) => {
    /** @param {number} code @param {string} type @param {string | Buffer} body */
    const send = (code, type, body) => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'text/plain; charset=utf-8', 'Only GET and HEAD.\n');
    const url = req.url ?? '/';
    let rootStat = null;
    try {
      rootStat = await stat(root);
    } catch {
      /* no reports folder yet */
    }
    if (!rootStat?.isDirectory())
      return send(200, 'text/html; charset=utf-8', page('Hometowns Lab', '<h1>Hometowns Lab</h1><p>No Lab report has been written yet. Run the Lab (<code>scripts/hometowns/lab.ts</code>) and its scorecards and HTML reports appear here.</p>'));
    const file = await resolveInside(root, url);
    if (!file) return send(404, 'text/plain; charset=utf-8', 'Not found.\n');
    try {
      const s = await stat(file);
      if (s.isDirectory()) {
        try {
          const index = join(file, 'index.html');
          if ((await stat(index)).isFile()) return send(200, TYPES['.html'], await readFile(index));
        } catch {
          /* no index: list it */
        }
        return send(200, 'text/html; charset=utf-8', await listing(file, url.split('?')[0]));
      }
      return send(200, TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', await readFile(file));
    } catch {
      return send(404, 'text/plain; charset=utf-8', 'Not found.\n');
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!HOST) {
    console.error('serve-reports: say where to listen, e.g. --host 127.0.0.1 (or the tailnet address). Only a container defaults to all interfaces.');
    process.exit(2);
  }
  createReportServer().listen(PORT, HOST, () => console.log(`Hometowns Lab reports: serving ${ROOT} on ${HOST}:${PORT}`));
}
