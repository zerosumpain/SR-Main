// What the rambler says when a visitor opens a private project on /projects.
// jk's voice, as in $lib/landing/ramblers/talk: dry, British, lower case, no
// exclamation marks and no colons. Unlike his landing-page lines these talk to
// the visitor — he is standing in front of them, so "you" means them.

import type { Face } from '$lib/landing/ramblers/rig';

export interface LockedLine {
  text: string;
  face: Face;
}

export const LOCKED_LINES: LockedLine[] = [
  { text: "nope. this one's not for you", face: 'happy' },
  { text: "private. jk hasn't even let me in, and i live here", face: 'confused' },
  { text: "you'd need to be jk for this one. you're not, i checked", face: 'happy' },
  { text: "members only. there aren't any members", face: 'neutral' },
  { text: "locked. i'd let you in but i've not got a key either", face: 'confused' },
  { text: "still in its pants. come back when it's dressed", face: 'happy' },
  { text: "nothing to see here. well, there is. you just can't see it", face: 'neutral' },
  { text: 'off limits. jk says it builds character', face: 'happy' },
];

export function pickLockedLine(roll = Math.random()): LockedLine {
  return LOCKED_LINES[Math.min(LOCKED_LINES.length - 1, Math.floor(roll * LOCKED_LINES.length))];
}
