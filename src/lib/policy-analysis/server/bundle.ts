/**
 * THE OFFLINE PACK — an assessment you can take into a room with no network.
 *
 * Print-to-PDF answers half of "give me something to take away" and the Word
 * export answers the half somebody edits. Neither answers the third: the
 * DASHBOARD — the grids, the drill, the stress lab, the interplay map — which
 * is where the assessment is actually read. This is that, as one file.
 *
 * ASSEMBLY IS STRING CONCATENATION, ON PURPOSE. The shell is compiled once at
 * deploy time by `npm run build:offline`; this module reads the two files it
 * produced, wraps them round a payload and zips the result. No headless
 * browser, no bundler in the request path, and the same input always produces
 * the same pack.
 *
 * WHERE THE SHELL LIVES AT RUNTIME: `static/` in a checkout, `build/client/`
 * once the adapter has copied it and ci-deploy has rsynced `build/`. Both are
 * tried, which is the pattern `buildExplainerAssets` already uses. A missing
 * shell fails loudly — a pack that opens to a blank page is worse than a button
 * that says it cannot build one.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import archiver from 'archiver';
import { offlineHtml, fontFaceCss, stripUnresolvableFonts, type EmbeddedFace } from '../offline/html';
import type { OfflinePayload } from '../offline/payload';
import { documentSlug, type DocMeta } from '../report-doc';
import { renderAssessment } from './export';
import type { Artefact } from '../contracts';

/**
 * The faces the dashboard actually sets text in.
 *
 * Without them `--font-display` falls through to Impact and every headline in
 * the pack is wrong — the exact failure that shipped to the live site in August
 * when a `@import` was dropped from the built CSS.
 *
 * DM Sans and JetBrains Mono are VARIABLE, so one file covers the whole weight
 * range and is declared once. Google's own stylesheet declares 400, 500 and 700
 * separately against the same URL; copying that would put the same 36 KB in the
 * pack three times. `--font-brand` (DM Mono) and `--font-read` (Selawik) are not
 * used on this page and are not carried.
 */
const FACES: { file: string; family: string; weight: string }[] = [
  { file: 'archivo-black-400.woff2', family: 'Archivo Black', weight: '400' },
  { file: 'dm-sans-var.woff2', family: 'DM Sans', weight: '100 1000' },
  { file: 'jetbrains-mono-var.woff2', family: 'JetBrains Mono', weight: '100 800' },
];

const SHELL_FILES = { js: 'policy-offline/app.js', css: 'policy-offline/app.css' };

async function readAsset(rel: string): Promise<Buffer> {
  const root = process.cwd();
  for (const candidate of [path.join(root, 'static', rel), path.join(root, 'build/client', rel)]) {
    const body = await readFile(candidate).catch(() => null);
    if (body) return body;
  }
  throw new Error(
    `Offline pack asset missing: ${rel}. Run \`npm run build:offline\` — the shell is built, not committed.`,
  );
}

export type OfflineShellAssets = { js: string; css: string; fontCss: string };

/** Read and assemble the compiled shell. Separate so a caller can cache it. */
export async function readOfflineShell(): Promise<OfflineShellAssets> {
  const [js, css, ...fonts] = await Promise.all([
    readAsset(SHELL_FILES.js),
    readAsset(SHELL_FILES.css),
    ...FACES.map((f) => readAsset(`fonts/policy-offline/${f.file}`)),
  ]);
  const faces: EmbeddedFace[] = FACES.map((f, i) => ({
    family: f.family,
    weight: f.weight,
    base64: fonts[i].toString('base64'),
  }));
  return {
    js: js.toString('utf8'),
    css: stripUnresolvableFonts(css.toString('utf8')),
    fontCss: fontFaceCss(faces),
  };
}

const README = (payload: OfflinePayload) => `POLICY ASSESSMENT — OFFLINE PACK
${payload.title}

WHAT THIS IS
  A red-team assessment of the policy paper named above, packaged so it can be
  read with no network of any kind. Open index.html in any modern browser — by
  double-clicking it, not by serving it — and you get the full dashboard: the
  verdict, the threat, what the policy rests on, and the assessment itself, with
  the same grids, drill-downs and stress test as the live page.

WHAT IS IN THE PACK
  index.html    The dashboard. Everything it draws is inside this one file.
  report.docx   The written assessment, for editing and marking up.
  report.md     The same text as markdown, for pasting into your own template.
  MANIFEST.json Digests of the three files above, so a copy can be checked.
  README.txt    This file.

WHAT IT IS NOT
  This is an adversarial reading, not an assurance review. It sets out to find
  how the paper can be beaten and by whom; it will not tell you the policy is
  fine, and a short list of plays is not a clean bill of health.
${
  payload.withheld.length
    ? `
  This is a SHARED copy. It leaves out the policy document itself — which the
  report cites in short spans rather than reproducing — and any comparison with
  the author's other assessments.
`
    : ''
}
HOW IT WAS MADE
  Pack made          ${payload.generatedAt}
  Assessment status  ${payload.status}
  Completed          ${payload.completedAt ?? 'not recorded'}
  Artefacts          ${payload.artefacts.length}
  Limits recorded    ${payload.warnings.length}
${payload.documentSha256 ? `  Source SHA-256     ${payload.documentSha256}\n` : ''}
  Produced by strangeramblings.com. Nothing in this pack reports back: it makes
  no request to any server, and it will read the same in five years as it does
  today.
`;

export type BundleInput = {
  payload: OfflinePayload;
  /** The artefacts the two documents are rendered from — the payload's own, already redacted for scope. */
  meta: DocMeta;
};

/**
 * Build the pack and wrap it in the response the browser will save.
 *
 * `content-disposition` uses the RFC 5987 form for the same reason the Word
 * export does: a policy title is prose, and quotes, em dashes and non-ASCII do
 * not survive the plain `filename=` parameter.
 */
export async function assessmentBundle({ payload, meta }: BundleInput): Promise<Response> {
  const shell = await readOfflineShell();
  const artefacts: Artefact[] = payload.artefacts;
  const [markdown, docx] = await Promise.all([
    renderAssessment(artefacts, meta, 'md'),
    renderAssessment(artefacts, meta, 'docx'),
  ]);

  const slug = documentSlug(payload.title);
  const entries: { name: string; body: Buffer }[] = [
    { name: 'index.html', body: Buffer.from(offlineHtml(payload, shell), 'utf8') },
    { name: 'report.docx', body: Buffer.from(docx.body as Uint8Array) },
    { name: 'report.md', body: Buffer.from(markdown.body as string, 'utf8') },
  ];
  const manifest = {
    kind: 'policy-assessment-offline-pack',
    version: payload.version,
    scope: payload.scope,
    title: payload.title,
    generatedAt: payload.generatedAt,
    documentSha256: payload.documentSha256,
    files: Object.fromEntries(
      entries.map((e) => [e.name, { bytes: e.body.byteLength, sha256: createHash('sha256').update(e.body).digest('hex') }]),
    ),
  };
  entries.push({ name: 'MANIFEST.json', body: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8') });
  entries.push({ name: 'README.txt', body: Buffer.from(README(payload), 'utf8') });

  const archive = archiver('zip', { zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  archive.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve, reject) => {
    archive.on('end', () => resolve());
    archive.on('warning', (err: unknown) => {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') reject(err);
    });
    archive.on('error', reject);
  });
  // A folder, not a scatter of loose files into whatever the reader unzipped
  // into. The name carries the date so two packs of the same paper do not
  // silently overwrite one another.
  const folder = `${slug}-${payload.generatedAt.slice(0, 10)}`;
  for (const entry of entries) archive.append(entry.body, { name: `${folder}/${entry.name}` });
  await archive.finalize();
  await done;

  const zip = Buffer.concat(chunks);
  return new Response(new Uint8Array(zip), {
    headers: {
      'content-type': 'application/zip',
      'content-length': String(zip.byteLength),
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${folder}.zip`)}`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store',
    },
  });
}
