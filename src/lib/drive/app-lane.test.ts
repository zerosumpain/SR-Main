import { describe, expect, it } from 'vitest';
import {
  cleanFolder,
  cleanName,
  inScope,
  listFolder,
  mayDelete,
  parseSpace,
  rowScope,
  spaceScope,
  storedName,
  viewName,
  withSuffix,
  type AppDriveCaller,
} from './app-lane';
import { principalForName } from './namespace';

const OWNER: AppDriveCaller = { kind: 'owner', email: 'john@example.test' };
const ANN: AppDriveCaller = { kind: 'member', email: 'ann@example.test', principalId: 'u_ann0001' };
const BOB: AppDriveCaller = { kind: 'member', email: 'bob@example.test', principalId: 'u_bob0002' };

const row = (name: string, uploadedBy: string | null = null) => ({ name, principalId: principalForName(name), uploadedBy });

describe('the two spaces', () => {
  it('roots a member at their own folder and everyone at the household one', () => {
    expect(spaceScope(ANN, 'mine')).toEqual({ space: 'mine', principal: 'u_ann0001', root: 'members/u_ann0001/' });
    expect(spaceScope(ANN, 'shared')).toEqual({ space: 'shared', principal: 'household', root: 'members/household/' });
    expect(spaceScope(OWNER, 'shared')).toEqual(spaceScope(ANN, 'shared'));
    expect(spaceScope(OWNER, 'mine')).toEqual({ space: 'mine', principal: 'owner', root: '' });
  });

  it('gives a member with no real principal no "mine" — never someone else\'s', () => {
    for (const principalId of ['owner', 'household', '', '../u_bob0002', 'u_', 'U_ANN0001', 'u_ann/x']) {
      expect(spaceScope({ kind: 'member', email: 'x@example.test', principalId }, 'mine')).toBeNull();
    }
  });

  it('parses only the two space names', () => {
    expect(parseSpace('mine')).toBe('mine');
    expect(parseSpace('shared')).toBe('shared');
    for (const raw of [null, '', 'owner', 'all', 'members', 'Mine']) expect(parseSpace(raw)).toBeNull();
  });
});

describe('privacy: which rows a caller reaches by id', () => {
  const owners = row('Architecture/plan.md');
  const annPrivate = row('members/u_ann0001/diary.pdf');
  const bobPrivate = row('members/u_bob0002/photo.jpg');
  const shared = row('members/household/rota.xlsx', 'bob@example.test');

  it("never lets a member reach the owner's files or another member's", () => {
    expect(rowScope(owners, ANN)).toBeNull();
    expect(rowScope(bobPrivate, ANN)).toBeNull();
    expect(rowScope(annPrivate, BOB)).toBeNull();
  });

  it("never lets the owner's phone reach a member's private folder", () => {
    expect(rowScope(annPrivate, OWNER)).toBeNull();
    expect(rowScope(bobPrivate, OWNER)).toBeNull();
  });

  it('lets each caller reach their own and the shared folder', () => {
    expect(rowScope(annPrivate, ANN)?.space).toBe('mine');
    expect(rowScope(owners, OWNER)?.space).toBe('mine');
    for (const caller of [OWNER, ANN, BOB]) expect(rowScope(shared, caller)?.space).toBe('shared');
  });

  it('judges by principal AND name, so a mislabelled row reaches nobody it should not', () => {
    // A row whose principal disagrees with its name breaks the namespace
    // invariant; neither half alone is enough to see it.
    expect(rowScope({ name: 'members/u_ann0001/x', principalId: 'owner' }, OWNER)).toBeNull();
    expect(rowScope({ name: 'members/u_ann0001/x', principalId: 'owner' }, ANN)).toBeNull();
    expect(rowScope({ name: 'secret.pdf', principalId: 'u_ann0001' }, ANN)).toBeNull();
    expect(rowScope({ name: 'members/household/x', principalId: 'u_ann0001' }, ANN)).toBeNull();
    // A bare folder name is not a file in it.
    expect(inScope({ name: 'members/u_ann0001/', principalId: 'u_ann0001' }, spaceScope(ANN, 'mine')!)).toBe(false);
  });

  it('keeps a case-different Members/ folder as the owner\'s own', () => {
    expect(rowScope(row('Members/u_ann0001/a.pdf'), OWNER)?.space).toBe('mine');
    expect(rowScope(row('Members/u_ann0001/a.pdf'), ANN)).toBeNull();
  });
});

describe('deleting', () => {
  const shared = spaceScope(ANN, 'shared')!;

  it('anything in your own space', () => {
    expect(mayDelete({ uploadedBy: null }, spaceScope(ANN, 'mine')!, ANN)).toBe(true);
  });

  it('in the shared folder, only what you added — the owner may tidy any', () => {
    expect(mayDelete({ uploadedBy: 'ANN@example.test ' }, shared, ANN)).toBe(true);
    expect(mayDelete({ uploadedBy: 'bob@example.test' }, shared, ANN)).toBe(false);
    expect(mayDelete({ uploadedBy: null }, shared, ANN)).toBe(false);
    expect(mayDelete({ uploadedBy: 'bob@example.test' }, shared, OWNER)).toBe(true);
  });
});

describe('names the phone sends', () => {
  it('accepts plain folders and refuses anything that climbs or hides a separator', () => {
    expect(cleanFolder('')).toBe('');
    expect(cleanFolder(null)).toBe('');
    expect(cleanFolder('/Holiday/2026/')).toBe('Holiday/2026');
    for (const bad of ['..', 'a/../b', 'a//b', './a', 'a\\b', 'a\u0000', ' a', 'a/.keep', 'a/b/c/d/e/f/g/h/i']) {
      expect(cleanFolder(bad)).toBeNull();
    }
  });

  it('accepts a single file name only', () => {
    expect(cleanName(' IMG_0001.HEIC ')).toBe('IMG_0001.HEIC');
    for (const bad of ['', '.', '..', '.keep', 'a/b', 'a\\b', 'x'.repeat(121), 'a\nb']) expect(cleanName(bad)).toBeNull();
  });

  it('stores inside the scope and nowhere else', () => {
    const mine = spaceScope(ANN, 'mine')!;
    expect(storedName(mine, 'Holiday', 'a.jpg')).toBe('members/u_ann0001/Holiday/a.jpg');
    expect(storedName(spaceScope(ANN, 'shared')!, '', 'a.jpg')).toBe('members/household/a.jpg');
    expect(storedName(spaceScope(OWNER, 'mine')!, 'Phone', 'a.jpg')).toBe('Phone/a.jpg');
    // The owner's root can never be steered into the members' area.
    expect(storedName(spaceScope(OWNER, 'mine')!, 'members/u_ann0001', 'a.jpg')).toBeNull();
    expect(storedName(mine, 'x'.repeat(100), 'y'.repeat(100))).toBeNull();
    // Whatever goes in, the stored name's principal is the scope's.
    expect(principalForName(storedName(mine, 'a/b', 'c.txt')!)).toBe('u_ann0001');
  });

  it('numbers a name that is taken', () => {
    expect(withSuffix('photo.jpg', 1)).toBe('photo.jpg');
    expect(withSuffix('photo.jpg', 2)).toBe('photo (2).jpg');
    expect(withSuffix('README', 3)).toBe('README (3)');
    expect(withSuffix('.env', 2)).toBe('.env (2)');
  });
});

describe('listing one folder', () => {
  const scope = spaceScope(ANN, 'mine')!;
  const rows = [
    'members/u_ann0001/a.pdf',
    'members/u_ann0001/Holiday/b.jpg',
    'members/u_ann0001/Holiday/2026/c.jpg',
    'members/u_ann0001/Empty/.keep',
    'members/u_ann0001/.keep',
  ].map((name) => ({ name }));

  it('shows subfolders with their file counts and the files directly inside', () => {
    const top = listFolder(rows, scope, '');
    expect(top.folders).toEqual([
      { name: 'Empty', path: 'Empty', items: 0 },
      { name: 'Holiday', path: 'Holiday', items: 2 },
    ]);
    expect(top.files.map((f) => viewName(f.name, scope))).toEqual(['a.pdf']);
    const holiday = listFolder(rows, scope, 'Holiday');
    expect(holiday.folders).toEqual([{ name: '2026', path: 'Holiday/2026', items: 1 }]);
    expect(holiday.files.map((f) => f.name)).toEqual(['members/u_ann0001/Holiday/b.jpg']);
    expect(listFolder(rows, scope, 'Empty')).toEqual({ folders: [], files: [] });
  });
});
