/**
 * Browser boundary for the canvas Webpage node's iframe.
 *
 * Direct mode frames a third-party page, which keeps its own origin
 * (`allow-same-origin`) so ordinary sites still work. That flag is only safe
 * while the page really is third-party: on a URL of this site it plus
 * `allow-scripts` lets the frame reach into the canvas and lift its own
 * sandbox, so a same-origin URL is refused rather than framed.
 *
 * Proxied mode renders through /api/webframe/render, which is on this origin.
 * It talks to the canvas by postMessage only and is already served under the
 * generated-content sandbox; the attribute matches that so it never runs with
 * the site's origin even if the response policy were missing.
 */
const DIRECT_SANDBOX = 'allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox';
const PROXIED_SANDBOX = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox';

export function webpageFrameSandbox(mode: 'direct' | 'proxied' | null): string {
  return mode === 'proxied' ? PROXIED_SANDBOX : DIRECT_SANDBOX;
}

/** An absolute http(s) URL on another origin — the only thing direct mode may frame. */
export function isFrameableUrl(value: string, siteOrigin: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return url.origin !== siteOrigin;
}
