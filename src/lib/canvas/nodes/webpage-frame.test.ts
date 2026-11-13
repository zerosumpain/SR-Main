import { describe, expect, it } from 'vitest';
import { isFrameableUrl, webpageFrameSandbox } from './webpage-frame';

const SITE = 'https://strangeramblings.com';

describe('webpage node frame boundary', () => {
  it('never gives the proxied render this origin', () => {
    expect(webpageFrameSandbox('proxied')).not.toContain('allow-same-origin');
    expect(webpageFrameSandbox('proxied')).toContain('allow-scripts');
  });

  it('lets a third-party page keep its own origin in direct mode', () => {
    expect(webpageFrameSandbox('direct')).toContain('allow-same-origin');
    expect(webpageFrameSandbox(null)).toContain('allow-same-origin');
  });

  it('refuses this site and non-web schemes for direct framing', () => {
    expect(isFrameableUrl('https://example.com/page', SITE)).toBe(true);
    expect(isFrameableUrl('https://strangeramblings.com/admin', SITE)).toBe(false);
    expect(isFrameableUrl('https://STRANGERAMBLINGS.com:443/x', SITE)).toBe(false);
    expect(isFrameableUrl('/admin', SITE)).toBe(false);
    expect(isFrameableUrl('javascript:alert(1)', SITE)).toBe(false);
    expect(isFrameableUrl('data:text/html,x', SITE)).toBe(false);
    // A subdomain is a different origin and is framed as a third party.
    expect(isFrameableUrl('https://preview-5281.strangeramblings.com/', SITE)).toBe(true);
  });
});
