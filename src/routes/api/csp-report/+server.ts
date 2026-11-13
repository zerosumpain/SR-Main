import type { RequestHandler } from './$types';
import { assertPublicRequestBudget } from '$lib/server/public-request-guard';
import { readLimitedText } from '$lib/server/service-auth';

/**
 * Receives the browser's Content-Security-Policy-Report-Only violations
 * (`report-uri` in svelte.config.js) and writes one log line per report.
 *
 * Listed exactly in PUBLIC_API_PATHS: a browser posts these without the
 * session cookie being any guarantee, and anonymous readers' violations are the
 * ones worth seeing. It is write-only and stores nothing: the body is capped,
 * both budgets are small, and only the directive and the ORIGIN of the blocked
 * resource are logged — never a full URL, which could carry a token.
 */
const MAX_REPORT_BYTES = 8 * 1024;

function originOf(value: unknown): string {
  if (typeof value !== 'string' || !value) return '-';
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'wss:' || url.protocol === 'ws:'
      ? url.origin
      : url.protocol;
  } catch {
    // Keywords such as `inline`, `eval` or `self`.
    return value.slice(0, 40).replace(/[^\w:-]/g, '');
  }
}

function pathOf(value: unknown): string {
  if (typeof value !== 'string') return '-';
  try {
    return new URL(value).pathname.slice(0, 120);
  } catch {
    return '-';
  }
}

export const POST: RequestHandler = async (event) => {
  assertPublicRequestBudget(event, {
    scope: 'csp-report',
    perClient: { capacity: 10, refillPerSecond: 10 / 60 },
    global: { capacity: 60, refillPerSecond: 60 / 60 },
  });
  const raw = await readLimitedText(event.request, MAX_REPORT_BYTES);
  let report: Record<string, unknown> | undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    const body = (parsed as { 'csp-report'?: unknown })?.['csp-report'];
    if (body && typeof body === 'object') report = body as Record<string, unknown>;
  } catch {
    report = undefined;
  }
  if (report) {
    const directive = String(report['effective-directive'] ?? report['violated-directive'] ?? '-')
      .split(' ')[0]
      .slice(0, 40)
      .replace(/[^\w-]/g, '');
    console.warn(
      `[csp-report] ${directive} blocked=${originOf(report['blocked-uri'])} page=${pathOf(report['document-uri'])}`,
    );
  }
  return new Response(null, { status: 204 });
};
