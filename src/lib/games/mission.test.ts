import { describe, expect, it } from 'vitest';
import {
  about,
  advance,
  again,
  autoTeam,
  createRoom,
  deadline,
  guess,
  join,
  leave,
  play,
  propose,
  ready,
  rolesFor,
  sabotagesNeeded,
  shuffle,
  start,
  standings,
  teamSize,
  toWire,
  vote,
  winners,
  CLOCKS,
  COUNTDOWN_MS,
  HUNT_MS,
  OUTCOME_MS,
  ROLES_MS,
  SPIES_FOR,
  TALLY_MS,
  TEAM_SIZES,
  type Difficulty,
  type Role,
  type Room,
} from './mission';

const T0 = 1_790_000_000_000;
const half = () => 0.5;
const NAMES = ['John', 'Sam', 'Kim', 'Robin', 'Alex', 'Jo', 'Max', 'Lee', 'Ash', 'Ray'];
const ids = (n: number) => NAMES.slice(0, n).map((x) => `p_${x.toLowerCase()}`);

function room(n = 5, difficulty: Difficulty = 'easy'): Room {
  const [host, ...rest] = NAMES.slice(0, n);
  return createRoom({
    id: 'g_m',
    host: { id: `p_${host.toLowerCase()}`, name: host },
    invite: rest.map((name) => ({ id: `p_${name.toLowerCase()}`, name })),
    difficulty,
    now: T0,
  });
}

/**
 * Everyone joins, the roles are dealt, and then set to `roles` (seat order) so
 * the test knows them; John leads first. Returns the room on the roles card.
 */
function dealt(roles: Role[], difficulty: Difficulty = 'easy'): { r: Room; now: number } {
  const r = room(roles.length, difficulty);
  for (const p of r.players) if (p.status === 'invited') join(r, p.id, T0);
  start(r, 'p_john', T0);
  advance(r, T0 + COUNTDOWN_MS, half);
  expect(r.phase).toBe('roles');
  r.players.forEach((p, i) => (p.role = roles[i]));
  r.leaderId = 'p_john';
  return { r, now: T0 + COUNTDOWN_MS };
}

/** Past the role cards, John to propose. */
function proposing(roles: Role[], difficulty: Difficulty = 'easy') {
  const { r, now } = dealt(roles, difficulty);
  for (const p of r.players) ready(r, p.id, now);
  expect(r.phase).toBe('proposing');
  expect(r.leaderId).toBe('p_john');
  return { r, now };
}

function status(fn: () => void): [number, string] {
  try {
    fn();
  } catch (e) {
    return [(e as { status: number }).status, (e as Error).message];
  }
  return [0, ''];
}

/** Everyone votes `approve` (or as `votes` says). */
function voteAll(r: Room, now: number, votes: Record<string, boolean> = {}, approve = true) {
  for (const p of r.players) {
    if (r.phase !== 'voting' || p.status !== 'joined' || p.vote !== null) continue;
    vote(r, p.id, { approve: votes[p.id] ?? approve }, now);
  }
}

/** Propose `team`, approve it, step past the tally: the team is on its mission. */
function sendTeam(r: Room, now: number, team: string[]) {
  propose(r, r.leaderId!, { team }, now);
  voteAll(r, now);
  expect(r.phase).toBe('tally');
  advance(r, now + TALLY_MS, half);
  expect(r.phase).toBe('mission');
}

/** Run one mission with `team`, the given members sabotaging, and step past the outcome. */
function runMission(r: Room, now: number, team: string[], saboteurs: string[] = []) {
  sendTeam(r, now, team);
  for (const id of team) {
    if (r.players.find((p) => p.id === id)?.status !== 'joined') continue;
    play(r, id, { card: saboteurs.includes(id) ? 'sabotage' : 'succeed' }, now);
  }
  expect(r.phase).toBe('outcome');
  advance(r, now + OUTCOME_MS, half);
}

// Five: John, Sam, Kim crew; Robin, Alex spies.
const FIVE: Role[] = ['crew', 'crew', 'crew', 'spy', 'spy'];
// Five with the specials: Kim the Lookout, Alex the Tracker.
const FIVE_SPECIAL: Role[] = ['crew', 'crew', 'lookout', 'spy', 'tracker'];

describe('the table', () => {
  it('has the standard spy counts and team sizes, and two sabotages on the fourth mission at seven or more', () => {
    expect([5, 6, 7, 8, 9, 10].map((n) => SPIES_FOR[n])).toEqual([2, 2, 3, 3, 3, 4]);
    expect(TEAM_SIZES[5]).toEqual([2, 3, 2, 3, 3]);
    expect(TEAM_SIZES[6]).toEqual([2, 3, 4, 3, 4]);
    expect(TEAM_SIZES[7]).toEqual([2, 3, 3, 4, 4]);
    for (const n of [8, 9, 10]) expect(TEAM_SIZES[n]).toEqual([3, 4, 4, 5, 5]);
    expect([0, 1, 2, 3, 4].map((i) => sabotagesNeeded(6, i))).toEqual([1, 1, 1, 1, 1]);
    expect([0, 1, 2, 3, 4].map((i) => sabotagesNeeded(7, i))).toEqual([1, 1, 1, 2, 1]);
  });

  it('deals one Tracker among the spies and one Lookout among the crew, on medium and hard only', () => {
    expect(rolesFor(5, false).sort()).toEqual(['crew', 'crew', 'crew', 'spy', 'spy']);
    expect(rolesFor(5, true).sort()).toEqual(['crew', 'crew', 'lookout', 'spy', 'tracker']);
    expect(rolesFor(10, true).filter((x) => x === 'spy' || x === 'tracker')).toHaveLength(4);
    for (const n of [5, 6, 7, 8, 9, 10]) {
      for (const d of ['easy', 'medium', 'hard'] as Difficulty[]) {
        const r = room(n, d);
        for (const p of r.players) if (p.status === 'invited') join(r, p.id, T0);
        start(r, 'p_john', T0);
        advance(r, T0 + COUNTDOWN_MS, Math.random);
        const roles = r.players.map((p) => p.role);
        expect(roles.filter((x) => x === 'spy' || x === 'tracker')).toHaveLength(SPIES_FOR[n]);
        expect(roles.includes('lookout')).toBe(d !== 'easy');
        expect(roles.includes('tracker')).toBe(d !== 'easy');
        expect(r.seats).toBe(n);
      }
    }
  });

  it('shuffles with the rng, keeping every item', () => {
    expect(shuffle([1, 2, 3, 4, 5], Math.random).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(shuffle([1, 2, 3], () => 0.999999)).toEqual([1, 2, 3]);
  });

  it('holds up to ten, starts at five, and says what the game is', () => {
    expect(() => room(10)).not.toThrow();
    expect(() =>
      createRoom({
        id: 'g',
        host: { id: 'p_h', name: 'H' },
        invite: Array.from({ length: 10 }, (_, i) => ({ id: `p_${i}`, name: `${i}` })),
        difficulty: 'easy',
        now: T0,
      }),
    ).toThrow(/Up to 10/);
    const r = room(5);
    for (const id of ids(4).slice(1)) join(r, id, T0);
    expect(status(() => start(r, 'p_john', T0))).toEqual([409, 'Secret Mission needs at least 5 players.']);
    join(r, 'p_alex', T0);
    expect(status(() => start(r, 'p_sam', T0))[0]).toBe(403);
    start(r, 'p_john', T0);
    expect(r.phase).toBe('countdown');
    expect(about(room(5, 'easy'))).toBe('Crew and spies only');
    expect(about(room(5, 'hard'))).toBe('With a Lookout and a Tracker');
  });

  it('goes back to the lobby if somebody leaves in the countdown and the table drops below five', () => {
    const r = room(5);
    for (const p of r.players) if (p.status === 'invited') join(r, p.id, T0);
    start(r, 'p_john', T0);
    leave(r, 'p_alex', T0 + 1);
    advance(r, T0 + COUNTDOWN_MS, half);
    expect(r.phase).toBe('lobby');
    expect(r.players.every((p) => p.role === null)).toBe(true);
  });
});

describe('what each phone sees', () => {
  it("never carries another player's role: a crew phone cannot tell who the spies are", () => {
    const { r, now } = dealt(FIVE);
    const viewer = 'p_john';
    const before = JSON.stringify(toWire(r, viewer, now));
    // Swap a spy and a crewmate John cannot see: his wire must not change.
    r.players[1].role = 'spy'; // Sam
    r.players[3].role = 'crew'; // Robin
    const after = JSON.stringify(toWire(r, viewer, now));
    expect(after).toBe(before);
    const w = toWire(r, viewer, now);
    expect(w.secret).toEqual({ role: 'crew', side: 'crew', spies: [], vote: null, card: null });
    expect(w.players.every((p) => p.role === null && p.side === null)).toBe(true);
    expect(before).not.toMatch(/"spy"/);
  });

  it('builds every seat\'s wire with only its own secret', () => {
    for (const roles of [FIVE, FIVE_SPECIAL]) {
      const { r, now } = dealt(roles, roles === FIVE ? 'easy' : 'medium');
      for (const me of r.players) {
        const w = toWire(r, me.id, now);
        const json = JSON.stringify(w);
        expect(w.secret?.role).toBe(me.role);
        // Exactly one role string on the wire — my own.
        const roleMentions = json.match(/"role":"[a-z]+"/g) ?? [];
        expect(roleMentions).toEqual([`"role":"${me.role}"`]);
        const spyIds = r.players.filter((p) => p.role === 'spy' || p.role === 'tracker').map((p) => p.id);
        if (me.role === 'crew') expect(w.secret?.spies).toEqual([]);
        else expect(new Set(w.secret?.spies)).toEqual(new Set(spyIds.filter((id) => id !== me.id)));
        // The Lookout is never named to anyone but themselves.
        const lookout = r.players.find((p) => p.role === 'lookout');
        if (lookout && lookout.id !== me.id) expect(json).not.toMatch(/"lookout"/);
      }
    }
  });

  it('hides votes until the tally, then shows them all together', () => {
    const { r, now } = proposing(FIVE);
    propose(r, 'p_john', { team: ['p_john', 'p_sam'] }, now);
    vote(r, 'p_sam', { approve: false }, now);
    const kim = toWire(r, 'p_kim', now);
    const sam = toWire(r, 'p_sam', now);
    expect(kim.players.find((p) => p.id === 'p_sam')?.voted).toBe(true);
    expect(kim.secret?.vote).toBeNull();
    expect(sam.secret?.vote).toBe(false);
    expect(JSON.stringify(kim)).not.toMatch(/"approve"|"reject"/);
    expect(kim.tallies).toEqual([]);
    for (const id of ['p_john', 'p_kim', 'p_robin', 'p_alex']) vote(r, id, { approve: true }, now);
    const shown = toWire(r, 'p_kim', now);
    expect(shown.phase).toBe('tally');
    expect(shown.tallies[0]).toMatchObject({ approve: ['p_john', 'p_kim', 'p_robin', 'p_alex'], reject: ['p_sam'], approved: true });
  });

  it("never sends a mission card but your own, and the result as a count only", () => {
    const { r, now } = proposing(FIVE);
    sendTeam(r, now, ['p_sam', 'p_robin']);
    play(r, 'p_robin', { card: 'sabotage' }, now);
    const robin = toWire(r, 'p_robin', now);
    const sam = toWire(r, 'p_sam', now);
    expect(robin.secret?.card).toBe('sabotage');
    expect(sam.secret?.card).toBeNull();
    expect(JSON.stringify(sam)).not.toMatch(/"sabotage"/);
    expect(sam.players.find((p) => p.id === 'p_robin')?.played).toBe(true);
    play(r, 'p_sam', { card: 'succeed' }, now);
    for (const id of ids(5)) {
      const w = toWire(r, id, now);
      expect(w.missions).toEqual([
        { mission: 1, leaderId: 'p_john', team: ['p_sam', 'p_robin'], needed: 1, sabotages: 1, succeeded: false },
      ]);
      expect(w.secret?.card).toBeNull();
      expect(JSON.stringify(w)).not.toMatch(/"card":"/);
    }
  });

  it('shows the spies to everyone in the hunt, and every role at the finish', () => {
    const { r, now } = proposing(FIVE_SPECIAL, 'medium');
    runMission(r, now, ['p_john', 'p_sam']);
    runMission(r, now, ['p_john', 'p_sam', 'p_kim']);
    runMission(r, now, ['p_john', 'p_sam']);
    expect(r.phase).toBe('hunt');
    const john = toWire(r, 'p_john', now);
    expect(john.trackerId).toBe('p_alex');
    expect(john.players.filter((p) => p.side === 'spies').map((p) => p.id)).toEqual(['p_robin', 'p_alex']);
    expect(JSON.stringify(john)).not.toMatch(/"lookout"/);
    guess(r, 'p_alex', { playerId: 'p_sam' }, now);
    const done = toWire(r, 'p_john', now);
    expect(done.players.map((p) => p.role)).toEqual(FIVE_SPECIAL);
  });
});

describe('proposals and votes', () => {
  it('lets only the leader propose, a team of the right size from the table', () => {
    const { r, now } = proposing(FIVE);
    expect(teamSize(r)).toBe(2);
    expect(status(() => propose(r, 'p_sam', { team: ['p_sam', 'p_kim'] }, now))).toEqual([409, 'You are not leading this time.']);
    expect(status(() => propose(r, 'p_john', { team: ['p_john'] }, now))).toEqual([400, 'This mission needs a team of 2.']);
    expect(status(() => propose(r, 'p_john', { team: ['p_john', 'p_john'] }, now))).toEqual([400, 'Pick each player once.']);
    expect(status(() => propose(r, 'p_john', { team: ['p_john', 'p_zed'] }, now))).toEqual([400, 'Pick players at this table.']);
    expect(status(() => propose(r, 'p_john', { team: 'p_john' }, now))).toEqual([400, 'Pick 2 players.']);
    propose(r, 'p_john', { team: ['p_kim', 'p_john'] }, now);
    expect(r.team).toEqual(['p_john', 'p_kim']);
    expect(r.phase).toBe('voting');
  });

  it('takes one boolean vote each, and a tie rejects and passes the lead on', () => {
    const { r, now } = proposing([...FIVE, 'crew']);
    propose(r, 'p_john', { team: ['p_john', 'p_sam'] }, now);
    expect(status(() => vote(r, 'p_sam', { approve: 'yes' }, now))).toEqual([400, 'Approve or reject.']);
    vote(r, 'p_sam', { approve: true }, now);
    expect(status(() => vote(r, 'p_sam', { approve: false }, now))).toEqual([409, 'You have voted.']);
    voteAll(r, now, { p_john: true, p_kim: true, p_robin: false, p_alex: false, p_jo: false });
    expect(r.tallies[0].approved).toBe(false);
    expect(r.rejections).toBe(1);
    advance(r, now + TALLY_MS, half);
    expect(r.phase).toBe('proposing');
    expect(r.leaderId).toBe('p_sam');
    expect(r.attempt).toBe(2);
  });

  it('gives the game to the spies on the fifth rejection in a row', () => {
    const { r, now } = proposing(FIVE);
    let t = now;
    for (let i = 0; i < 5; i++) {
      propose(r, r.leaderId!, { team: ['p_john', 'p_sam'] }, t);
      voteAll(r, t, {}, false);
      t += TALLY_MS;
      advance(r, t, half);
    }
    expect(r.phase).toBe('finished');
    expect(r.result).toEqual({ winner: 'spies', reason: 'rejections', guessId: null });
    expect(winners(r)).toEqual(['p_robin', 'p_alex']);
  });
});

describe('missions', () => {
  it('lets only the team play, and the crew only succeed', () => {
    const { r, now } = proposing(FIVE);
    sendTeam(r, now, ['p_sam', 'p_robin']);
    expect(status(() => play(r, 'p_kim', { card: 'succeed' }, now))).toEqual([409, 'You are not on this mission.']);
    expect(status(() => play(r, 'p_sam', { card: 'sabotage' }, now))).toEqual([400, 'The crew can only play Succeed.']);
    expect(status(() => play(r, 'p_sam', { card: 'oops' }, now))).toEqual([400, 'Play Succeed or Sabotage.']);
    play(r, 'p_sam', { card: 'succeed' }, now);
    expect(status(() => play(r, 'p_sam', { card: 'succeed' }, now))).toEqual([409, 'You have played your card.']);
    play(r, 'p_robin', { card: 'succeed' }, now);
    expect(r.missions[0].succeeded).toBe(true);
  });

  it('needs two sabotages to fail the fourth mission at seven', () => {
    const seven: Role[] = ['crew', 'crew', 'crew', 'crew', 'spy', 'spy', 'spy'];
    const { r, now } = proposing(seven);
    runMission(r, now, ['p_john', 'p_sam']);
    runMission(r, now, ['p_john', 'p_sam', 'p_alex'], ['p_alex']);
    runMission(r, now, ['p_john', 'p_sam', 'p_alex'], ['p_alex']);
    expect(teamSize(r)).toBe(4);
    runMission(r, now, ['p_john', 'p_sam', 'p_kim', 'p_alex'], ['p_alex']);
    expect(r.missions[3]).toMatchObject({ needed: 2, sabotages: 1, succeeded: true });
  });

  it('plays a whole easy game to three crew missions, the crew winning it', () => {
    const { r, now } = proposing(FIVE);
    runMission(r, now, ['p_john', 'p_sam']);
    expect(r.leaderId).toBe('p_sam');
    runMission(r, now, ['p_john', 'p_sam', 'p_robin'], ['p_robin']);
    runMission(r, now, ['p_john', 'p_kim']);
    runMission(r, now, ['p_john', 'p_sam', 'p_kim']);
    expect(r.phase).toBe('finished');
    expect(r.result).toEqual({ winner: 'crew', reason: 'missions', guessId: null });
    const w = toWire(r, 'p_robin', now);
    expect(w.score).toEqual({ crew: 3, spies: 1 });
    expect(w.winnerIds).toEqual(['p_john', 'p_sam', 'p_kim']);
    expect(w.standings?.map((s) => [s.id, s.place, s.side, s.won])).toEqual([
      ['p_john', 1, 'crew', true],
      ['p_sam', 1, 'crew', true],
      ['p_kim', 1, 'crew', true],
      ['p_robin', 2, 'spies', false],
      ['p_alex', 2, 'spies', false],
    ]);
  });

  it('gives the spies three sabotaged missions', () => {
    const { r, now } = proposing(FIVE);
    runMission(r, now, ['p_john', 'p_robin'], ['p_robin']);
    runMission(r, now, ['p_john', 'p_sam', 'p_alex'], ['p_alex']);
    runMission(r, now, ['p_john', 'p_robin'], ['p_robin']);
    expect(r.result).toEqual({ winner: 'spies', reason: 'sabotage', guessId: null });
  });
});

describe('the hunt', () => {
  function toHunt() {
    const { r, now } = proposing(FIVE_SPECIAL, 'hard');
    runMission(r, now, ['p_john', 'p_sam']);
    runMission(r, now, ['p_john', 'p_sam', 'p_kim']);
    runMission(r, now, ['p_john', 'p_sam']);
    expect(r.phase).toBe('hunt');
    return { r, now };
  }

  it('steals the win when the Tracker names the Lookout', () => {
    const { r, now } = toHunt();
    expect(status(() => guess(r, 'p_robin', { playerId: 'p_kim' }, now))[0]).toBe(403);
    expect(status(() => guess(r, 'p_alex', { playerId: 'p_robin' }, now))).toEqual([400, 'Pick one of the crew.']);
    guess(r, 'p_alex', { playerId: 'p_kim' }, now);
    expect(r.result).toEqual({ winner: 'spies', reason: 'hunt', guessId: 'p_kim' });
    expect(winners(r)).toEqual(['p_robin', 'p_alex']);
  });

  it('keeps the crew win on a wrong name, or none in time', () => {
    const a = toHunt();
    guess(a.r, 'p_alex', { playerId: 'p_sam' }, a.now);
    expect(a.r.result).toEqual({ winner: 'crew', reason: 'missions', guessId: 'p_sam' });
    const b = toHunt();
    const due = deadline(b.r)!;
    expect(due).toBe(b.now + OUTCOME_MS + HUNT_MS);
    expect(advance(b.r, due - 1, half)).toBe(false);
    advance(b.r, due, half);
    expect(b.r.result).toEqual({ winner: 'crew', reason: 'missions', guessId: null });
  });

  it('has no hunt on easy', () => {
    const { r, now } = proposing(FIVE);
    runMission(r, now, ['p_john', 'p_sam']);
    runMission(r, now, ['p_john', 'p_sam', 'p_kim']);
    runMission(r, now, ['p_john', 'p_sam']);
    expect(r.phase).toBe('finished');
  });
});

describe('the clock', () => {
  it('moves on from the role cards when time is up, or when everyone has tapped Got it', () => {
    const { r, now } = dealt(FIVE);
    ready(r, 'p_john', now);
    expect(r.phase).toBe('roles');
    advance(r, now + ROLES_MS, half);
    expect(r.phase).toBe('proposing');
  });

  it('draws a team for a stalled leader, approves for a stalled voter, succeeds for a stalled card', () => {
    const { r, now } = proposing(FIVE, 'hard');
    const c = CLOCKS.hard;
    let t = now + c.proposeMs;
    expect(advance(r, t - 1, half)).toBe(false);
    advance(r, t, half);
    expect(r.phase).toBe('voting');
    expect(r.autoTeam).toBe(true);
    expect(r.team).toHaveLength(2);
    vote(r, 'p_sam', { approve: false }, t);
    t += c.voteMs;
    advance(r, t, half);
    expect(r.tallies[0]).toMatchObject({ reject: ['p_sam'], approved: true, autoTeam: true });
    expect(r.tallies[0].auto).toHaveLength(4);
    t += TALLY_MS;
    advance(r, t, half);
    expect(r.phase).toBe('mission');
    t += c.missionMs;
    advance(r, t, half);
    expect(r.missions[0]).toMatchObject({ sabotages: 0, succeeded: true });
  });

  it('takes one step per call however late the clock, and nothing for NaN', () => {
    const { r } = proposing(FIVE);
    expect(advance(r, Number.NaN, half)).toBe(false);
    expect(r.phase).toBe('proposing');
    advance(r, T0 + 365 * 86_400_000, half);
    expect(r.phase).toBe('voting');
    expect(deadline(r)).toBe(T0 + 365 * 86_400_000 + CLOCKS.easy.voteMs);
  });

  it('draws a stalled leader a team of people still here before anyone gone', () => {
    const { r, now } = proposing(FIVE);
    leave(r, 'p_kim', now);
    const team = autoTeam(r, Math.random);
    expect(team).toHaveLength(2);
    expect(team).not.toContain('p_kim');
  });
});

describe('leaving', () => {
  it("plays for a leaver: their vote approves and their card succeeds", () => {
    const { r, now } = proposing(FIVE);
    propose(r, 'p_john', { team: ['p_john', 'p_robin'] }, now);
    leave(r, 'p_robin', now);
    voteAll(r, now);
    expect(r.phase).toBe('tally');
    expect(r.tallies[0].auto).toEqual(['p_robin']);
    advance(r, now + TALLY_MS, half);
    play(r, 'p_john', { card: 'succeed' }, now);
    expect(r.phase).toBe('outcome');
    expect(r.missions[0].sabotages).toBe(0);
  });

  it('passes the lead on when the leader leaves, and skips them after', () => {
    const { r, now } = proposing(FIVE);
    leave(r, 'p_john', now);
    expect(r.phase).toBe('proposing');
    expect(r.leaderId).toBe('p_sam');
    expect(r.hostId).toBe('p_sam');
  });

  it('ends the game with nobody winning when fewer than three are left', () => {
    const { r, now } = proposing(FIVE);
    leave(r, 'p_kim', now);
    leave(r, 'p_robin', now);
    expect(r.phase).toBe('proposing');
    leave(r, 'p_alex', now);
    expect(r.phase).toBe('finished');
    expect(r.result).toEqual({ winner: null, reason: 'abandoned', guessId: null });
    expect(winners(r)).toEqual([]);
    expect(standings(r).every((s) => s.place === 1 && !s.won)).toBe(true);
  });

  it('keeps the crew win when the Tracker leaves the hunt', () => {
    const { r, now } = proposing(FIVE_SPECIAL, 'medium');
    runMission(r, now, ['p_john', 'p_sam']);
    runMission(r, now, ['p_john', 'p_sam', 'p_kim']);
    runMission(r, now, ['p_john', 'p_sam']);
    leave(r, 'p_alex', now);
    expect(r.result).toEqual({ winner: 'crew', reason: 'missions', guessId: null });
  });

  it("does not count a leaver on the winning side as a winner", () => {
    const { r, now } = proposing(FIVE);
    leave(r, 'p_kim', now);
    runMission(r, now, ['p_john', 'p_sam']);
    runMission(r, now, ['p_john', 'p_sam', 'p_kim']);
    runMission(r, now, ['p_john', 'p_sam']);
    expect(winners(r)).toEqual(['p_john', 'p_sam']);
    expect(standings(r).find((s) => s.id === 'p_kim')).toMatchObject({ won: false, left: true, place: 2 });
  });
});

describe('a decided game is never abandoned', () => {
  it('keeps the spies their third sabotage when the table empties on the outcome screen', () => {
    const { r, now } = proposing(FIVE);
    runMission(r, now, ['p_john', 'p_robin'], ['p_robin']);
    runMission(r, now, ['p_john', 'p_sam', 'p_alex'], ['p_alex']);
    sendTeam(r, now, ['p_john', 'p_robin']);
    play(r, 'p_john', { card: 'succeed' }, now);
    play(r, 'p_robin', { card: 'sabotage' }, now);
    expect(r.phase).toBe('outcome');
    for (const id of ['p_kim', 'p_sam', 'p_john']) leave(r, id, now);
    expect(r.result).toEqual({ winner: 'spies', reason: 'sabotage', guessId: null });
    expect(winners(r)).toEqual(['p_robin', 'p_alex']);
  });

  it('keeps the crew their third success when the table empties on the outcome screen', () => {
    const { r, now } = proposing(FIVE);
    runMission(r, now, ['p_john', 'p_sam']);
    runMission(r, now, ['p_john', 'p_sam', 'p_kim']);
    sendTeam(r, now, ['p_john', 'p_sam']);
    play(r, 'p_john', { card: 'succeed' }, now);
    play(r, 'p_sam', { card: 'succeed' }, now);
    expect(r.phase).toBe('outcome');
    for (const id of ['p_robin', 'p_alex', 'p_john']) leave(r, id, now);
    expect(r.result).toEqual({ winner: 'crew', reason: 'missions', guessId: null });
    expect(winners(r)).toEqual(['p_sam', 'p_kim']);
  });

  it('keeps the spies the fifth rejection when the table empties on the tally', () => {
    const { r, now } = proposing(FIVE);
    let t = now;
    for (let i = 0; i < 5; i++) {
      propose(r, r.leaderId!, { team: ['p_john', 'p_sam'] }, t);
      voteAll(r, t, {}, false);
      if (i < 4) {
        t += TALLY_MS;
        advance(r, t, half);
      }
    }
    expect(r.phase).toBe('tally');
    for (const id of ['p_john', 'p_sam', 'p_kim']) leave(r, id, t);
    expect(r.result).toEqual({ winner: 'spies', reason: 'rejections', guessId: null });
  });

  it('still abandons on a tally that decided nothing', () => {
    const { r, now } = proposing(FIVE);
    propose(r, 'p_john', { team: ['p_john', 'p_sam'] }, now);
    voteAll(r, now, {}, false);
    expect(r.phase).toBe('tally');
    for (const id of ['p_kim', 'p_sam', 'p_robin']) leave(r, id, now);
    expect(r.result).toEqual({ winner: null, reason: 'abandoned', guessId: null });
  });

  it('keeps the crew their win when the table empties during the hunt', () => {
    const { r, now } = proposing(FIVE_SPECIAL, 'hard');
    runMission(r, now, ['p_john', 'p_sam']);
    runMission(r, now, ['p_john', 'p_sam', 'p_kim']);
    runMission(r, now, ['p_john', 'p_sam']);
    expect(r.phase).toBe('hunt');
    for (const id of ['p_john', 'p_sam', 'p_robin']) leave(r, id, now);
    expect(r.result).toEqual({ winner: 'crew', reason: 'missions', guessId: null });
    expect(winners(r)).toEqual(['p_kim']);
  });
});

describe('the results screen', () => {
  it('freezes the standings: a winner leaving afterwards is still a winner on every wire', () => {
    const { r, now } = proposing(FIVE);
    runMission(r, now, ['p_john', 'p_sam']);
    runMission(r, now, ['p_john', 'p_sam', 'p_kim']);
    runMission(r, now, ['p_john', 'p_sam']);
    expect(r.phase).toBe('finished');
    leave(r, 'p_john', now + 1);
    expect(winners(r)).toEqual(['p_john', 'p_sam', 'p_kim']);
    expect(standings(r).find((s) => s.id === 'p_john')).toMatchObject({ won: true, left: false, place: 1 });
    const w = toWire(r, 'p_sam', now + 1);
    expect(w.winnerIds).toContain('p_john');
  });
});

describe('again', () => {
  it('goes back to the lobby with fresh everything', () => {
    const { r, now } = proposing(FIVE);
    let t = now;
    for (let i = 0; i < 5; i++) {
      propose(r, r.leaderId!, { team: ['p_john', 'p_sam'] }, t);
      voteAll(r, t, {}, false);
      t += TALLY_MS;
      advance(r, t, half);
    }
    expect(status(() => again(r, 'p_sam', t))[0]).toBe(403);
    again(r, 'p_john', t);
    expect(r.phase).toBe('lobby');
    expect(r.players.every((p) => p.role === null && !p.seated)).toBe(true);
    expect(r.tallies).toEqual([]);
    expect(r.result).toBeNull();
  });
});
