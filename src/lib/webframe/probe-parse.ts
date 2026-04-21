export type ProbeResult = { canFrame: boolean; reason?: string };

export function parseFramePermissiveness(
  headers: Record<string, string>,
  targetUrl: string
): ProbeResult {
  const xfo = (headers['x-frame-options'] ?? '').toUpperCase().trim();
  if (xfo === 'DENY' || xfo === 'SAMEORIGIN') {
    return { canFrame: false, reason: `X-Frame-Options: ${xfo}` };
  }
  const csp = headers['content-security-policy'] ?? '';
  const match = csp.match(/frame-ancestors\s+([^;]+)/i);
  if (match) {
    const allowed = match[1].trim().split(/\s+/).filter(Boolean);
    if (allowed.length === 0) {
      return { canFrame: false, reason: 'CSP frame-ancestors: empty' };
    }
    if (allowed.some((a) => a === '*' || a === "'*'")) {
      return { canFrame: true };
    }
    let origin = '';
    try {
      origin = new URL(targetUrl).origin;
    } catch {
      return { canFrame: false, reason: 'invalid target URL' };
    }
    if (allowed.includes("'self'") || allowed.includes(origin)) {
      return { canFrame: true };
    }
    return { canFrame: false, reason: `CSP frame-ancestors: ${allowed.join(' ')}` };
  }
  return { canFrame: true };
}
