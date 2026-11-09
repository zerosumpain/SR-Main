// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { makeAnalyticsHelpers } from './umami';
import { projectTrackerScript } from './project-tracker';

const CFG = { siteId: 'site-1', scriptUrl: 'https://analytics.example/script.js', domains: 'example.org' };

describe('serialised helpers', () => {
  it('run with nothing from their module in scope', () => {
    // A bare context: if the factory touched a module constant it would throw here.
    const helpers = vm.runInNewContext(`(${makeAnalyticsHelpers.toString()})()`, { URL, URLSearchParams });
    expect(helpers.redactUrl('/install/Zk3x9QpLm2Vb7RtY0aWc4d?t=abc&view=map')).toBe('/install/:token?t=:redacted&view=map');
    expect(helpers.classifyLink('https://gov.uk/x?y=1', 'example.org', false)).toEqual({
      event: 'outbound-link',
      data: { host: 'gov.uk', url: 'https://gov.uk/x' },
    });
  });
});

describe('project tracker script', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    delete (window as unknown as Record<string, unknown>).__srProjectTracker;
  });

  function run(attrs: Record<string, string>, href = '/projects/spine/intro?t=SECRETTOKENxxxxxxxxxxxx&pane=2#top') {
    history.replaceState(null, '', href);
    const tag = document.createElement('script');
    for (const [k, v] of Object.entries(attrs)) tag.setAttribute(`data-${k}`, v);
    document.head.appendChild(tag);
    Object.defineProperty(document, 'currentScript', { value: tag, configurable: true });
    new Function(projectTrackerScript(CFG))();
    Object.defineProperty(document, 'currentScript', { value: null, configurable: true });
    return [...document.head.querySelectorAll('script[src]')] as HTMLScriptElement[];
  }

  it('strips the share token, labels the visit by link and browser, and records', () => {
    const scripts = run({ access: 'share', project: 'spine', 'share-ref': '3f9a2c1b', 'share-label': 'DfE team', visitor: 'ab12cd34', record: '1' });
    expect(location.search).toBe('?pane=2');
    expect(location.hash).toBe('#top');
    const umami = scripts.find((s) => s.src.endsWith('/script.js'))!;
    expect(umami.getAttribute('data-tag')).toBe('project:spine');
    expect(umami.getAttribute('data-distinct-id')).toBe('link-3f9a2c1b-ab12cd34');
    expect(umami.getAttribute('data-domains')).toBe('example.org');
    expect(scripts.some((s) => s.src.endsWith('/recorder.js'))).toBe(true);
    const send = (window as unknown as { __srUmamiBeforeSend: (t: string, p: object) => { url: string } }).__srUmamiBeforeSend;
    expect(send('event', { url: 'https://example.org/projects/spine?t=abc' }).url).toBe('https://example.org/projects/spine?t=:redacted');
  });

  it('never records the owner, labels them owner, and leaves their address alone', () => {
    const scripts = run({ access: 'owner', project: 'spine', record: '0' }, '/projects/spine?t=keep');
    expect(location.search).toBe('?t=keep');
    expect(scripts.find((s) => s.src.endsWith('/script.js'))!.getAttribute('data-distinct-id')).toBe('owner');
    expect(scripts.some((s) => s.src.endsWith('/recorder.js'))).toBe(false);
  });

  it('adds an alias host to the domain lock', () => {
    const scripts = run({ access: 'public', project: 'data-spine', alias: '1' }, '/');
    expect(scripts[0].getAttribute('data-domains')).toBe(`example.org,${location.hostname}`);
    expect(scripts[0].hasAttribute('data-distinct-id')).toBe(false);
  });
});
