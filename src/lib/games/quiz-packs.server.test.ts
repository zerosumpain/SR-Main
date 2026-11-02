// Kelly's Quiz Night packs: a draft's photo labels become photo ids, bad
// questions are dropped, an approved pack loads into a room with signed photo
// URLs, and a signed URL shows its photo only while it is valid.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ env: { AUTH_SECRET: 'test-secret-for-packs' } as Record<string, string>, files: new Map<string, Buffer>() }));
vi.mock('$env/dynamic/private', () => ({ env: h.env }));
vi.mock('$lib/datastore', () => ({ DatastoreError: class extends Error {}, deleteRecord: vi.fn(), ensureCollection: vi.fn(), getRecordByKey: vi.fn(), queryRecords: vi.fn(), upsertRecord: vi.fn() }));
vi.mock('$lib/llm/client', () => ({ getLLMClient: vi.fn() }));
vi.mock('$lib/server/models/workload-settings', () => ({ resolveGamesQuizModel: vi.fn() }));
vi.mock('$lib/jkai/media/storage', () => ({
  saveBuffer: async (buf: Buffer, ext: string) => {
    const diskPath = `2026/11/${h.files.size}.${ext}`;
    h.files.set(diskPath, buf);
    return { diskPath, sizeBytes: buf.byteLength };
  },
  readBuffer: async (p: string) => h.files.get(p)!,
  deleteByDiskPath: async (p: string) => void h.files.delete(p),
}));

import { _setPackStore, addPhoto, createPack, getPack, loadPackQuiz, memoryPackStore, photoUrl, readDraft, signedPhoto, updatePack } from './quiz-packs.server';
import { createRoom, type Room } from './quiz-night';

const q = (n: number, photo: string | null = null) => ({ prompt: `Question number ${n}?`, options: ['A one', 'B two', 'C three', 'D four'], answerIndex: n % 4, explain: 'Because.', photo });

beforeEach(() => _setPackStore(memoryPackStore()));
afterEach(() => _setPackStore(null));

describe('reading a draft', () => {
  it('maps photo labels to the pack photo ids and drops what cannot be a question', () => {
    const labels = new Map([['P1', 'ph_0123456789ab']]);
    const out = readDraft({ questions: [q(1, 'P1'), q(2, 'P9'), { prompt: 'x' }, q(1), { ...q(3), options: ['a', 'a', 'b', 'c'] }] }, labels);
    expect(out).toHaveLength(2);
    expect(out[0].photoId).toBe('ph_0123456789ab');
    expect(out[1].photoId).toBeNull();
    expect(out[0].id).toMatch(/^pq_/u);
  });
});

describe('playing a pack', () => {
  async function approvedPack() {
    const pack = await createPack({ title: 'Whitby 2015', subject: 'Holidays', notes: 'We went to Whitby.' });
    const photo = await addPhoto(pack.id, Buffer.from('jpegbytes'), 'image/jpeg', 'Rory on the pier', '2015');
    await updatePack(pack.id, (p) => {
      p.questions = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ id: `pq_00000000000${n}`, prompt: `Q${n}?`, options: ['a', 'b', 'c', 'd'], answerIndex: 0, explain: null, photoId: n === 1 ? photo.id : null }));
      p.status = 'approved';
    }, { keepStatus: true });
    return { pack: await getPack(pack.id), photo };
  }

  function room(pack: string): Room {
    return createRoom({ id: 'g_000000000001', host: { id: 'p_a', name: 'A' }, invite: [], difficulty: 'medium', options: { pack }, now: Date.now() });
  }

  it('loads an approved pack with its photo as a signed URL', async () => {
    const { pack, photo } = await approvedPack();
    const r = room(pack.id);
    expect(r.pack).toBe(pack.id);
    await loadPackQuiz(r, () => 0.3);
    expect(r.prep).toBe('ready');
    expect(r.title).toBe('Whitby 2015');
    expect(r.questions).toHaveLength(7);
    const withPhoto = r.questions.find((x) => x.photo);
    expect(withPhoto?.photo).toContain(`/api/games/photos/${pack.id}/${photo.id}?e=`);
    for (const x of r.questions) expect(x.options[x.answerIndex]).toBe('a');
  });

  it('refuses a pack that is not approved', async () => {
    const pack = await createPack({ title: 'Draft', subject: '', notes: '' });
    const r = room(pack.id);
    await loadPackQuiz(r);
    expect(r.prep).toBe('failed');
  });

  it('a signed photo URL shows the photo, and nothing once tampered or expired', async () => {
    const { pack, photo } = await approvedPack();
    const url = new URL(photoUrl(pack.id, photo.id), 'https://x.test');
    const e = url.searchParams.get('e');
    const s = url.searchParams.get('s');
    expect((await signedPhoto(pack.id, photo.id, e, s))?.bytes.toString()).toBe('jpegbytes');
    expect(await signedPhoto(pack.id, photo.id, e, s!.replace(/.$/u, (c) => (c === '0' ? '1' : '0')))).toBeNull();
    expect(await signedPhoto(pack.id, photo.id, e, s, Date.now() + 13 * 3_600_000)).toBeNull();
  });

  it('refuses a photo type a TV cannot show', async () => {
    const pack = await createPack({ title: 'P', subject: '', notes: '' });
    await expect(addPhoto(pack.id, Buffer.from('x'), 'image/heic', '', null)).rejects.toThrow(/JPEG, PNG or WebP/u);
  });

  it('editing an approved pack sends it back to draft', async () => {
    const { pack } = await approvedPack();
    const edited = await updatePack(pack.id, (p) => {
      p.title = 'Whitby';
    });
    expect(edited.status).toBe('draft');
  });
});
