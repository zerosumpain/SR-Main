import { beforeEach, describe, expect, it, vi } from 'vitest';

// A phone posting its UDID back from the one-time profile: a good join code
// starts ONE build that includes the phone, named for its person, and sends
// Safari to /app; an expired or forged code starts nothing.

const SECRET = 'app-profile-secret'.padEnd(40, 'x');
const UDID = '00008110-001A2C3E0E12801E';

const h = vi.hoisted(() => ({ builds: [] as unknown[], notes: [] as string[], enrolled: [] as unknown[], fail: false }));

vi.mock('$env/dynamic/private', () => ({ env: { AUTH_SECRET: 'app-profile-secret'.padEnd(40, 'x') } }));
vi.mock('$lib/github/adhoc-builds', () => ({
  startAdhocBuild: async (device: unknown) => {
    if (h.fail) throw new Error('GitHub down');
    h.builds.push(device);
  },
}));
vi.mock('$lib/server/app-devices', () => ({
  joinCandidates: async () => ['owner@example.test', 'rory@example.test', 'fintan@example.test'],
  recordEnrolment: async (row: unknown) => {
    h.enrolled.push(row);
  },
}));
vi.mock('$lib/server/notify', () => ({
  notifyOwner: async (n: { title: string; body: string }) => {
    h.notes.push(`${n.title} | ${n.body}`);
    return { raised: true };
  },
}));

const { GET, POST } = await import('./+server');
const { mintJoinCode } = await import('$lib/server/adhoc-install');

function body(udid = UDID, product = 'iPhone15,2'): ArrayBuffer {
  const plist = `<?xml version="1.0"?><plist version="1.0"><dict><key>PRODUCT</key><string>${product}</string><key>UDID</key><string>${udid}</string><key>VERSION</key><string>23A341</string></dict></plist>`;
  const bytes = Buffer.concat([Buffer.from([0x30, 0x80]), Buffer.from(plist), Buffer.from([0x00, 0x00])]);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function event(code: string, payload?: ArrayBuffer) {
  return {
    params: { code },
    url: new URL(`https://strangeramblings.com/app/${code}/profile`),
    request: { arrayBuffer: async () => payload ?? body() },
  };
}

async function post(code: string, payload?: ArrayBuffer): Promise<{ status: number; location?: string }> {
  try {
    await POST(event(code, payload) as never);
  } catch (r) {
    const x = r as { status: number; location?: string };
    return { status: x.status, location: x.location };
  }
  throw new Error('expected a redirect or an error');
}

describe('/app/<code>/profile', () => {
  beforeEach(() => {
    h.builds = [];
    h.notes = [];
    h.enrolled = [];
    h.fail = false;
  });

  it('hands Safari a profile for a live code, and nothing for a dead one', async () => {
    const code = mintJoinCode('Rory', SECRET, 'rory@example.test');
    const res = await GET(event(code) as never);
    expect(res.headers.get('content-type')).toBe('application/x-apple-aspen-config');
    expect(await res.text()).toContain(`/app/${code}/profile`);
    await expect(GET(event(mintJoinCode('Rory', SECRET, 'rory@example.test', 'identity', Date.now() - 8 * 86_400_000)) as never)).rejects.toMatchObject({ status: 404 });
  });

  it('builds once for the phone that posted, named for its person, then sends it to /app', async () => {
    const code = mintJoinCode('Rory', SECRET, 'rory@example.test');
    const first = await post(code);
    expect(first.status).toBe(301);
    expect(first.location).toBe(`https://strangeramblings.com/app?added=Rory's%20iPhone&join=${code}`);
    expect(h.builds).toEqual([{ udid: UDID, name: "Rory's iPhone" }]);
    // Recorded as RORY's phone — the person the link was signed for, not a first name's.
    expect(h.enrolled).toEqual([{ udid: UDID, email: 'rory@example.test', name: "Rory's iPhone", product: 'iPhone15,2', osVersion: '23A341' }]);
    expect((await post(code)).status).toBe(301);
    expect(h.builds).toHaveLength(1);
    expect(h.enrolled).toHaveLength(2);
    // The same link on their iPad is a second phone, and a second build.
    await post(code, body('00008103-000A1B2C3D4E5F60', 'iPad13,1'));
    expect(h.builds[1]).toEqual({ udid: '00008103-000A1B2C3D4E5F60', name: "Rory's iPad" });
  });

  it('starts nothing for a forged code or a post that is not a phone’s', async () => {
    expect((await post('rory-0123456789')).status).toBe(404);
    // A link made for someone the site does not know is nobody's.
    expect((await post(mintJoinCode('Rory', SECRET, 'stranger@example.test'))).status).toBe(404);
    expect((await post(mintJoinCode('Rory', SECRET, 'rory@example.test'), body('nope'))).status).toBe(400);
    expect(h.builds).toEqual([]);
  });

  it('tells the owner the UDID when GitHub will not build, and lets the phone try again', async () => {
    h.fail = true;
    const code = mintJoinCode('Fintan', SECRET, 'fintan@example.test');
    const udid = '00008110-0000000000000001';
    expect((await post(code, body(udid))).status).toBe(301);
    expect(h.notes[0]).toContain(udid);
    h.fail = false;
    await post(code, body(udid));
    expect(h.builds).toHaveLength(1);
  });
});
