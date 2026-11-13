import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { buildConfinementEnabled, CONFINE_INTERPRETER, confinedArgs, DENIED_TCP_PORTS } from './build-confine';

describe('confinedArgs', () => {
  it('passes the command through as argv, after the deny list', () => {
    const args = confinedArgs(['bash', '-c', 'echo hi'], [1, 2]);
    expect(args.slice(0, 2)).toEqual(['-I', '-c']);
    expect(args.slice(3)).toEqual(['1,2', 'bash', '-c', 'echo hi']);
  });

  it('denies the unauthenticated loopback services by default', () => {
    expect(DENIED_TCP_PORTS).toEqual(expect.arrayContaining([3110, 5207]));
  });

  it('is on only inside the builder sidecar in host mode', () => {
    expect(buildConfinementEnabled({ JKAI_BUILDS_HOSTMODE: '1', JKAI_BUILDER_PROCESS: '1' })).toBe(true);
    expect(buildConfinementEnabled({ JKAI_BUILDS_HOSTMODE: '1' })).toBe(false);
    expect(buildConfinementEnabled({ JKAI_BUILDER_PROCESS: '1' })).toBe(false);
  });
});

// The real thing, where the kernel supports it (Linux with Landlock ABI >= 4).
const probe = spawnSync(CONFINE_INTERPRETER, [...confinedArgs(['true'])], { encoding: 'utf8' });
const landlock = probe.status === 0;

describe.skipIf(!landlock)('confinement on this kernel', () => {
  const run = (script: string, deny: number[] = [...DENIED_TCP_PORTS]) =>
    spawnSync(CONFINE_INTERPRETER, confinedArgs(['bash', '-c', script], deny), { encoding: 'utf8' });

  it('hides the environment of a process outside the domain', () => {
    const parent = process.pid;
    const r = run(`head -c0 /proc/${parent}/environ && echo READABLE || echo DENIED`);
    expect(r.stdout.trim()).toBe('DENIED');
  });

  it('still lets a command read its own children', () => {
    const r = run('sleep 1 & head -c0 /proc/$!/environ && echo READABLE');
    expect(r.stdout.trim()).toBe('READABLE');
  });

  it('refuses a TCP connect to a denied port and allows others', async () => {
    const server = createServer((s) => s.end());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const script = `exec 3<>/dev/tcp/127.0.0.1/${port} && echo CONNECTED || echo REFUSED`;
      expect(run(script, [port]).stdout.trim()).toBe('REFUSED');
      expect(run(script, []).stdout.trim()).toBe('CONNECTED');
    } finally {
      server.close();
    }
  });

  it('propagates the command exit status', () => {
    expect(run('exit 7').status).toBe(7);
    expect(execFileSync(CONFINE_INTERPRETER, confinedArgs(['echo', 'ok']), { encoding: 'utf8' }).trim()).toBe('ok');
  });
});
