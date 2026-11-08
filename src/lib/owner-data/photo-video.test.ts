import { beforeEach, describe, expect, it, vi } from 'vitest';

// On-request video analysis: photo_analyse_video, and the video block that
// photo_detail and photo_search gain. The Drive relay is mocked: these check
// which video Main picks, what it sends (method, path, JSON body), that a long
// video comes back as a question for John rather than a failure, and the
// per-person, per-text shape with time ranges. Fixtures are synthetic.

type Reply = { status: number; headers: Record<string, string>; body: Buffer };
const h = vi.hoisted(() => ({
  calls: [] as Array<{ app: string; method: string; path: string; headers: Record<string, string>; body?: string }>,
  reply: (_method: string, _path: string): Promise<Reply> => Promise.reject(new Error('unset')),
}));

vi.mock('$lib/server/extracted-app', () => ({
  requestExtracted: (app: string, method: string, path: string, opts: { headers?: Record<string, string>; body?: Buffer } = {}) => {
    h.calls.push({ app, method, path, headers: opts.headers ?? {}, ...(opts.body ? { body: opts.body.toString('utf8') } : {}) });
    return h.reply(method, path);
  },
}));

const json = (status: number, body: unknown) => async (): Promise<Reply> => ({ status, headers: {}, body: Buffer.from(JSON.stringify(body)) });

const VID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const VID2 = '9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f';
const VIDEO_ASSET = {
  id: VID,
  type: 'video',
  takenAt: '2026-06-20T15:04:00+01:00',
  durationSec: 95.4,
  location: { city: 'Bath', country: 'United Kingdom' },
  people: [{ id: 'p-sam', name: 'Sam' }],
  driveFile: { id: 'f9', name: 'Incoming photos/IMG_9.MOV' },
};
const RESULT = {
  analysedAt: '2026-11-02T10:00:00Z',
  durationSec: 95,
  blockSec: 10,
  framesSampled: 95,
  cpuSec: 140,
  people: [
    { personId: 'p-sam', name: 'Sam', ranges: [[0, 20], [70, 90]], label: '0:00–0:20, 1:10–1:30', frameHits: 30, bestFrame: { offsetSec: 4, box: {} }, link: `/drive?tab=people&video=${VID}&t=0` },
    { personId: 'p-anon', name: null, ranges: [[30, 40]], label: '0:30–0:40', frameHits: 4 },
  ],
  unknownFaces: [{ label: 'Unknown 1', ranges: [[50, 60]], rangesLabel: '0:50–1:00', frameHits: 3 }],
  text: [{ text: ' HAPPY BIRTHDAY ', ranges: [[60, 80]], label: '1:00–1:20', link: `/drive?tab=people&video=${VID}&t=60` }],
};
const state = (over: Record<string, unknown> = {}) => ({
  assetId: VID,
  status: 'queued',
  position: 2,
  progress: null,
  requestedAt: '2026-11-02T09:59:00Z',
  startedAt: null,
  finishedAt: null,
  attempts: 0,
  error: null,
  estimate: { durationSec: 95, frames: 95, estimatedCpuSec: 140 },
  result: null,
  link: `/drive?tab=people&video=${VID}`,
  ...over,
});

const { formatOffset, formatRanges, videoLink, videoPath, videoResolverPath, compactAssetVideo, compactMoments } = await import('./photos');
const { photoAnalyseVideoTool, sendDrive } = await import('./photo-video.server');
const { photoDetailTool, photoSearchTool } = await import('./photos.server');
const { tools } = await import('$lib/tools/registry-internal');
const { tierOf, MEMBER_SAFE_TOOLS } = await import('$lib/tools/invoke-contract');
const { MEMBER_FORBIDDEN_TOOLSETS } = await import('$lib/jkai/member-chat/policy');
await import('./chat-tools');

beforeEach(() => {
  h.calls = [];
  h.reply = json(200, { connected: true, analyser: true, video: state() });
});

describe('time labels', () => {
  it('writes m:ss, h:mm:ss past the hour, and ranges with an en dash', () => {
    expect(formatOffset(0)).toBe('0:00');
    expect(formatOffset(70.9)).toBe('1:10');
    expect(formatOffset(3725)).toBe('1:02:05');
    expect(formatOffset(-5)).toBe('0:00');
    expect(formatRanges([[0, 20], [70, 90]])).toBe('0:00–0:20, 1:10–1:30');
    expect(formatRanges([[3590, 3610]])).toBe('59:50–1:00:10');
    expect(formatRanges([[5, 1], 'x', [10, 20]])).toBe('0:10–0:20');
    expect(formatRanges(null)).toBe('');
    const many = Array.from({ length: 23 }, (_, i) => [i * 20, i * 20 + 10]);
    expect(formatRanges(many)).toMatch(/, 6:20–6:30 … \(\+3 more\)$/);
  });

  it('builds the deep link to a moment', () => {
    expect(videoLink(VID)).toBe(`/drive?tab=people&video=${VID}`);
    expect(videoLink(VID, 70.6)).toBe(`/drive?tab=people&video=${VID}&t=70`);
  });
});

describe('which video', () => {
  it('takes only a UUID as an id, and a description becomes a video-only search', () => {
    expect(videoPath(VID.toUpperCase())).toBe(`/api/photos/videos/${VID}`);
    expect(() => videoPath('../assets/x')).toThrow(/UUID/);
    expect(videoResolverPath({ text: 'cake', people: ['Sam'], from: '2026-06-20', to: '2026-06-20' })).toBe(
      '/api/photos/search?person=Sam&text=cake&from=2026-06-20&to=2026-06-20&type=video&limit=10',
    );
    expect(() => videoResolverPath({})).toThrow(/describe the video/);
  });

  it('acts on the one video a description finds', async () => {
    h.reply = async (method, path) =>
      path.startsWith('/api/photos/search') ? json(200, { connected: true, total: 1, assets: [VIDEO_ASSET] })() : json(202, { connected: true, analyser: true, video: state() })();
    const r = await photoAnalyseVideoTool({ text: 'cutting the cake' });
    expect(h.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /api/photos/search?text=cutting+the+cake&type=video&limit=10', `POST /api/photos/videos/${VID}`]);
    expect(r).toMatchObject({ success: true, data: { action: 'start', video: { id: VID, status: 'queued', position: 2 } } });
  });

  it('lists the candidates and starts nothing when more than one matches', async () => {
    h.reply = json(200, { connected: true, total: 3, assets: [VIDEO_ASSET, { ...VIDEO_ASSET, id: VID2, durationSec: 4000, people: [] }] });
    const r = await photoAnalyseVideoTool({ people: ['Sam'] });
    expect(h.calls).toHaveLength(1);
    expect(r).toEqual({
      success: true,
      data: {
        connected: true,
        found: 3,
        candidates: [
          { id: VID, takenAt: '2026-06-20T15:04:00+01:00', place: 'Bath, United Kingdom', length: '1:35', people: ['Sam'] },
          { id: VID2, takenAt: '2026-06-20T15:04:00+01:00', place: 'Bath, United Kingdom', length: '1:06:40' },
        ],
        answer: expect.stringMatching(/^3 videos match \(the first 2 are listed\), so nothing was started\. Ask John which/),
      },
    });
  });

  it('says so when no video matches, starting nothing', async () => {
    h.reply = json(200, { connected: true, total: 0, assets: [] });
    const r = await photoAnalyseVideoTool({ from: '2026-01-01', to: '2026-01-02' });
    expect(r).toMatchObject({ success: true, data: { found: 0, answer: expect.stringMatching(/No video matches/) } });
    expect(h.calls).toHaveLength(1);
  });

  it('fails a bad id or a missing description without calling Drive', async () => {
    expect(await photoAnalyseVideoTool({ id: 'nope' })).toMatchObject({ success: false, error: expect.stringMatching(/^photo_analyse_video: id must be/) });
    expect(await photoAnalyseVideoTool({})).toMatchObject({ success: false, error: expect.stringMatching(/describe the video/) });
    expect(await photoAnalyseVideoTool({ id: VID, action: 'delete-everything' })).toMatchObject({ success: false, error: expect.stringMatching(/action must be one of start, status, cancel/) });
    expect(h.calls).toHaveLength(0);
  });
});

describe('start, status and cancel', () => {
  it('start POSTs JSON with only the flags given, as the owner', async () => {
    await photoAnalyseVideoTool({ id: VID });
    await photoAnalyseVideoTool({ id: VID, action: 'start', confirm: true, force: true });
    expect(h.calls[0]).toEqual({ app: 'drive', method: 'POST', path: `/api/photos/videos/${VID}`, headers: { accept: 'application/json', 'content-type': 'application/json' }, body: '{}' });
    expect(h.calls[1]!.body).toBe('{"confirm":true,"force":true}');
    expect(h.calls.every((c) => !('x-sr-app-for' in c.headers))).toBe(true);
  });

  it('a queued start says where it is and to check back, not wait', async () => {
    const r = await photoAnalyseVideoTool({ id: VID });
    expect(r).toEqual({
      success: true,
      data: {
        connected: true,
        action: 'start',
        video: { id: VID, status: 'queued', position: 2, requestedAt: '2026-11-02T09:59:00Z', estimate: { videoLength: '1:35', frames: 95, cpuMinutes: 2.3 }, link: `/drive?tab=people&video=${VID}` },
        answer: expect.stringMatching(/^Queued \(position 2\)\. .*action 'status'/),
      },
    });
  });

  it('status GETs, and a finished analysis gives each person and text once with ranges and links', async () => {
    h.reply = json(200, { connected: true, analyser: true, video: state({ status: 'done', position: null, finishedAt: '2026-11-02T10:00:00Z', result: RESULT }) });
    const r = await photoAnalyseVideoTool({ id: VID, action: 'status' });
    expect(h.calls[0]).toMatchObject({ method: 'GET', path: `/api/photos/videos/${VID}` });
    expect(h.calls[0]!.body).toBeUndefined();
    expect((r as unknown as { data: { video: unknown } }).data.video).toEqual({
      id: VID,
      status: 'done',
      finishedAt: '2026-11-02T10:00:00Z',
      estimate: { videoLength: '1:35', frames: 95, cpuMinutes: 2.3 },
      result: {
        analysedAt: '2026-11-02T10:00:00Z',
        length: '1:35',
        people: [
          { person: 'Sam', when: '0:00–0:20, 1:10–1:30', link: `/drive?tab=people&video=${VID}&t=0` },
          { person: 'unnamed:p-anon', when: '0:30–0:40', link: `/drive?tab=people&video=${VID}&t=30` },
        ],
        text: [{ text: 'HAPPY BIRTHDAY', when: '1:00–1:20', link: `/drive?tab=people&video=${VID}&t=60` }],
        unknownFaces: [{ label: 'Unknown 1', when: '0:50–1:00' }],
      },
      link: `/drive?tab=people&video=${VID}`,
    });
    expect(r).toMatchObject({ data: { answer: expect.stringMatching(/^Done/) } });
  });

  it('a start on a finished video says it is already analysed and how to redo it', async () => {
    h.reply = json(202, { connected: true, analyser: true, video: state({ status: 'done', result: RESULT }) });
    expect(await photoAnalyseVideoTool({ id: VID })).toMatchObject({ data: { answer: expect.stringMatching(/Already analysed.*force true/) } });
  });

  it('running shows progress; cancel DELETEs', async () => {
    h.reply = json(200, { connected: true, analyser: true, video: state({ status: 'running', position: 1, progress: 0.426, startedAt: '2026-11-02T10:01:00Z' }) });
    expect(await photoAnalyseVideoTool({ id: VID, action: 'status' })).toMatchObject({ data: { video: { status: 'running', position: 1, progress: '43%' }, answer: expect.stringMatching(/^Running, 43% done/) } });
    h.reply = json(200, { connected: true, analyser: true, video: state({ status: 'cancelled', position: null, finishedAt: '2026-11-02T10:02:00Z' }) });
    const r = await photoAnalyseVideoTool({ id: VID, action: 'cancel' });
    expect(h.calls.at(-1)).toMatchObject({ method: 'DELETE', path: `/api/photos/videos/${VID}` });
    expect(r).toMatchObject({ success: true, data: { video: { status: 'cancelled' }, answer: expect.stringMatching(/^Cancelled/) } });
  });

  it('relays a long video (409 needsConfirm) as a question for John, not a failure', async () => {
    h.reply = json(409, { message: 'This video is 12 minutes long; confirm to analyse it', needsConfirm: true, estimate: { durationSec: 750, frames: 750, estimatedCpuSec: 1100 }, maxMinutes: 5 });
    const r = await photoAnalyseVideoTool({ id: VID });
    expect(r).toEqual({
      success: true,
      data: {
        connected: true,
        id: VID,
        started: false,
        needsConfirm: true,
        estimate: { videoLength: '12:30', frames: 750, cpuMinutes: 18.3 },
        noConfirmLimitMinutes: 5,
        drive: 'This video is 12 minutes long; confirm to analyse it',
        answer: expect.stringMatching(/\(12:30\).*about 18\.3 minutes.*Nothing was started\. Ask John; only if he agrees, call again with confirm true/),
      },
    });
  });

  it('relays 413 (over the hard cap) as a plain "cannot", and other refusals in Drive\'s words', async () => {
    h.reply = json(413, { message: 'Longer than 60 minutes' });
    expect(await photoAnalyseVideoTool({ id: VID, confirm: true })).toMatchObject({ success: true, data: { started: false, tooLong: true, drive: 'Longer than 60 minutes', answer: expect.stringMatching(/cannot be analysed/) } });
    h.reply = json(400, { message: 'Not a video' });
    expect(await photoAnalyseVideoTool({ id: VID })).toEqual({ success: false, error: 'photo_analyse_video: Not a video' });
    h.reply = json(409, { message: 'Busy' });
    expect(await photoAnalyseVideoTool({ id: VID })).toEqual({ success: false, error: 'photo_analyse_video: Busy' });
  });

  it('answers "not connected" for no library, no analyser, an unreachable Drive, an older Drive or a 5xx', async () => {
    for (const reply of [
      json(200, { connected: false, analyser: false, reason: 'Immich is not configured' }),
      json(200, { connected: true, analyser: false }),
      () => Promise.reject(new Error('DRIVE_SERVICE_TOKEN is not set')),
      async () => ({ status: 404, headers: {}, body: Buffer.from('<html>Not Found</html>') }),
      json(503, { message: 'analyser down' }),
    ]) {
      h.reply = reply;
      const r = await photoAnalyseVideoTool({ id: VID, action: 'status' });
      expect(r).toMatchObject({ success: true, data: { connected: false, answer: expect.stringMatching(/not connected/) } });
    }
    h.reply = json(200, { connected: true, analyser: false });
    expect(await sendDrive('GET', `/api/photos/videos/${VID}`)).toEqual({ kind: 'not_connected', reason: 'the video analyser is not set up on SR-Drive' });
  });
});

describe('photo_detail and photo_search gain the video', () => {
  it("photo_detail carries a video's analysis per person and per text", async () => {
    h.reply = json(200, { connected: true, asset: { ...VIDEO_ASSET, video: { status: 'done', analysedAt: RESULT.analysedAt, people: RESULT.people, text: [{ text: 'HAPPY BIRTHDAY', ranges: [[60, 80]], label: '1:00–1:20' }], unknownFaces: 1 } } });
    const r = await photoDetailTool({ id: VID });
    expect((r as unknown as { data: { asset: { video: unknown } } }).data.asset.video).toEqual({
      status: 'done',
      analysedAt: '2026-11-02T10:00:00Z',
      people: [
        { person: 'Sam', when: '0:00–0:20, 1:10–1:30', link: `/drive?tab=people&video=${VID}&t=0` },
        { person: 'unnamed:p-anon', when: '0:30–0:40', link: `/drive?tab=people&video=${VID}&t=30` },
      ],
      // No link from Drive: built from the first range.
      text: [{ text: 'HAPPY BIRTHDAY', when: '1:00–1:20', link: `/drive?tab=people&video=${VID}&t=60` }],
      unknownFaces: 1,
      link: `/drive?tab=people&video=${VID}`,
    });
  });

  it('an unanalysed video gets a hint to analyse it; a photo gets no video block', async () => {
    h.reply = json(200, { connected: true, asset: { ...VIDEO_ASSET, video: null } });
    expect(await photoDetailTool({ id: VID })).toMatchObject({ data: { asset: { video: { status: 'none', hint: expect.stringMatching(/photo_analyse_video/) } } } });
    expect(compactAssetVideo(VID, { status: 'none' })).toEqual({ status: 'none', hint: expect.stringMatching(/photo_analyse_video/), link: `/drive?tab=people&video=${VID}` });
    expect(compactAssetVideo(VID, { status: 'running' })).toMatchObject({ hint: expect.stringMatching(/action 'status'/) });
    h.reply = json(200, { connected: true, asset: { ...VIDEO_ASSET, type: 'photo' } });
    expect((await photoDetailTool({ id: VID }) as unknown as { data: { asset: Record<string, unknown> } }).data.asset).not.toHaveProperty('video');
  });

  it('photo_search passes on matching moments compactly, and nothing when there are none', async () => {
    h.reply = json(200, { connected: true, total: 0, page: 1, assets: [], moments: [
      { assetId: VID, offsetSec: 70, endSec: 80, score: 0.31234, link: `/drive?tab=people&video=${VID}&t=70`, asset: VIDEO_ASSET },
      { assetId: VID2, offsetSec: 3600, endSec: 3610, score: 0.2, link: 'javascript:alert(1)', asset: null },
      { assetId: VID2, offsetSec: 'x' },
    ] });
    const r = await photoSearchTool({ text: 'cutting the cake' });
    expect((r as unknown as { data: { moments: unknown } }).data.moments).toEqual([
      { assetId: VID, at: '1:10', until: '1:20', score: 0.31, takenAt: '2026-06-20T15:04:00+01:00', place: 'Bath, United Kingdom', link: `/drive?tab=people&video=${VID}&t=70` },
      { assetId: VID2, at: '1:00:00', until: '1:00:10', score: 0.2, link: `/drive?tab=people&video=${VID2}&t=3600` },
    ]);
    h.reply = json(200, { connected: true, total: 0, page: 1, assets: [], moments: [] });
    expect((await photoSearchTool({ text: 'x' }) as { data: Record<string, unknown> }).data).not.toHaveProperty('moments');
    expect(compactMoments(undefined)).toEqual({});
  });
});

describe('the registered tool', () => {
  const tool = () => tools.find((t) => t.name === 'photo_analyse_video')!;

  it('is an owner-only mutate in the people toolset, member-forbidden, with no card', () => {
    const t = tool();
    expect(t).toBeTruthy();
    expect(t.toolset).toBe('people');
    expect(tierOf(t)).toEqual({ effect: 'mutate', confirm: 'never', lane: 'standard' });
    expect(MEMBER_SAFE_TOOLS.includes('photo_analyse_video')).toBe(false);
    expect((MEMBER_FORBIDDEN_TOOLSETS as readonly string[]).includes('people')).toBe(true);
    expect(Object.keys(t.parameters.properties)).toEqual(['id', 'action', 'text', 'people', 'place', 'from', 'to', 'confirm', 'force']);
    expect(t.description).toMatch(/on request|only when asked/i);
    expect(t.description).toMatch(/one video at a time/);
    expect(t.description).toMatch(/action 'status'/);
  });

  it('refuses a member before anything reaches Drive, and answers the owner', async () => {
    const r = await tool().handler({ id: VID }, { emit: () => {}, principalId: 'u_member' });
    expect(r).toMatchObject({ success: false, error: expect.stringMatching(/owner/) });
    expect(h.calls).toHaveLength(0);
    expect(await tool().handler({ id: VID, action: 'status' }, { emit: () => {} })).toMatchObject({ success: true, data: { video: { status: 'queued' } } });
  });

  it('is on the household capability row', async () => {
    const { CAPABILITIES } = await import('$lib/capabilities/manifest');
    expect(CAPABILITIES.find((c) => c.id === 'household')!.tools).toContain('photo_analyse_video');
  });
});
