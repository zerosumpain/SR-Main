import { beforeEach, describe, expect, it, vi } from 'vitest';

// A phone posting its UDID back from the enrolment profile: a good ticket
// starts ONE build that includes the phone and sends Safari to the install
// page; an expired or forged ticket starts nothing.

const SECRET = 'enrol-route-secret'.padEnd(40, 'x');
const UDID = '00008110-001A2C3E0E12801E';

const h = vi.hoisted(() => ({ builds: [] as unknown[], notes: [] as string[], fail: false }));

vi.mock('$env/dynamic/private', () => ({ env: { AUTH_SECRET: 'enrol-route-secret'.padEnd(40, 'x') } }));
vi.mock('$lib/server/adhoc-builds', () => ({
  startAdhocBuild: async (device: unknown) => {
    if (h.fail) throw new Error('GitHub down');
    h.builds.push(device);
  },
}));
vi.mock('$lib/server/notify', () => ({
  notifyOwner: async (n: { title: string; body: string }) => {
    h.notes.push(`${n.title} | ${n.body}`);
    return { raised: true };
  },
}));

const { GET, POST } = await import('./+server');
const { installToken, mintEnrolTicket } = await import('$lib/server/adhoc-install');

function body(udid = UDID): ArrayBuffer {
  const plist = `<?xml version="1.0"?><plist version="1.0"><dict><key>PRODUCT</key><string>iPhone15,2</string><key>UDID</key><string>${udid}</string><key>VERSION</key><string>23A341</string></dict></plist>`;
  const bytes = Buffer.concat([Buffer.from([0x30, 0x80]), Buffer.from(plist), Buffer.from([0x00, 0x00])]);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function event(ticket: string, payload?: ArrayBuffer) {
  return {
    params: { ticket },
    url: new URL(`https://strangeramblings.com/install/enroll/${ticket}`),
    request: { arrayBuffer: async () => payload ?? body() },
  };
}

async function post(ticket: string, payload?: ArrayBuffer): Promise<{ status: number; location?: string }> {
  try {
    await POST(event(ticket, payload) as never);
  } catch (r) {
    const x = r as { status: number; location?: string };
    return { status: x.status, location: x.location };
  }
  throw new Error('expected a redirect or an error');
}

describe('/install/enroll/<ticket>', () => {
  beforeEach(() => {
    h.builds = [];
    h.notes = [];
    h.fail = false;
  });

  it('hands Safari a profile for a live ticket, and nothing for a dead one', async () => {
    const ticket = mintEnrolTicket("Rory's iPhone", SECRET);
    const res = await GET(event(ticket) as never);
    expect(res.headers.get('content-type')).toBe('application/x-apple-aspen-config');
    expect(await res.text()).toContain(`/install/enroll/${ticket}`);
    await expect(GET(event(mintEnrolTicket('Rory', SECRET, Date.now() - 2 * 86_400_000)) as never)).rejects.toMatchObject({ status: 404 });
  });

  it('builds once for the phone that posted, then sends it to the install page', async () => {
    const ticket = mintEnrolTicket("Rory's iPhone", SECRET);
    const first = await post(ticket);
    expect(first.status).toBe(301);
    expect(first.location).toBe(`https://strangeramblings.com/install/${installToken(SECRET)}?enrolled=Rory's%20iPhone`);
    expect(h.builds).toEqual([{ udid: UDID, name: "Rory's iPhone" }]);
    // iOS posting again is not a second build.
    expect((await post(ticket)).status).toBe(301);
    expect(h.builds).toHaveLength(1);
    expect(h.notes[0]).toContain('asked to install the app');
  });

  it('starts nothing for a forged ticket or a post that is not a phone’s', async () => {
    expect((await post('bogus.ticket')).status).toBe(404);
    expect((await post(mintEnrolTicket('Rory', SECRET), body('nope'))).status).toBe(400);
    expect(h.builds).toEqual([]);
  });

  it('tells the owner the UDID when GitHub will not build, and lets the phone try again', async () => {
    h.fail = true;
    const ticket = mintEnrolTicket('Rory', SECRET);
    expect((await post(ticket)).status).toBe(301);
    expect(h.notes[0]).toContain(UDID);
    h.fail = false;
    await post(ticket);
    expect(h.builds).toHaveLength(1);
  });
});
