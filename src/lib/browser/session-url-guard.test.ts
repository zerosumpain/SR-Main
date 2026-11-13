import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

// The browser runner is Python (it lives beside Chromium in the sandbox), so
// its URL guard is exercised through python3 with the runner loaded as a
// module. DNS is stubbed: `resolves` is what the fake resolver returns.
const RUNNER = join(process.cwd(), 'src/lib/scraper/python/browser-session.py');

function refusal(url: string, resolves: string[] = ['93.184.215.14']): string | null {
  const script = [
    'import importlib.util, json, sys',
    'spec = importlib.util.spec_from_file_location("bs", sys.argv[1])',
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'addrs = json.loads(sys.argv[3])',
    'fake = lambda host, port: [(0, 0, 0, "", (a, 0)) for a in addrs]',
    'print(json.dumps(m.url_refusal(sys.argv[2], resolve=fake)))',
  ].join('\n');
  const out = execFileSync('python3', ['-I', '-B', '-c', script, RUNNER, url, JSON.stringify(resolves)], { encoding: 'utf8' });
  return JSON.parse(out) as string | null;
}

describe('browser_navigate URL guard', () => {
  it('allows a public http(s) URL', () => {
    expect(refusal('https://example.com/page')).toBeNull();
    expect(refusal('about:blank')).toBeNull();
  });

  it.each([
    'http://127.0.0.1:5173/',
    'http://[::1]/',
    'http://[::ffff:7f00:1]/',
    'http://10.0.0.2/',
    'http://172.17.0.1:5173/',
    'http://192.168.0.1/',
    'http://100.83.68.108/',
    'http://169.254.169.254/latest/meta-data/',
    'http://0.0.0.0/',
    'http://[fd00::1]/',
  ])('refuses the private literal %s', (url) => {
    expect(refusal(url)).toMatch(/private address/);
  });

  it.each(['http://localhost:3000/', 'http://box.local/', 'http://router.lan/', 'http://host.ts.net/', 'http://x.internal/'])(
    'refuses the private name %s without resolving it',
    (url) => {
      expect(refusal(url, [])).toMatch(/private host/);
    },
  );

  it('refuses a public-looking name that resolves to a private address', () => {
    expect(refusal('https://rebind.example/', ['93.184.215.14', '192.168.0.10'])).toMatch(/resolves to private address/);
  });

  it.each(['file:///etc/passwd', 'chrome://settings', 'view-source:https://example.com', 'data:text/html,hi'])(
    'refuses the non-web scheme %s',
    (url) => {
      expect(refusal(url)).toMatch(/only http\/https/);
    },
  );
});
