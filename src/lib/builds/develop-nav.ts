// src/lib/builds/develop-nav.ts
//
// The build process's rooms beyond the portfolio. The backlog (what is queued
// to build), improvement (what the nightly run built and whether it is used)
// and the workflow doctor (what broke overnight and what it did about it)
// moved here from /jkai/daydreams on 2026-09-26: they are the build loop's
// intake, output and repair, and `intakeIdeas` feeds one queue from all three.
//
// PURE — the develop page imports it into the browser. Structurally the shell's
// `ShellTab`, declared here so the domain layer never imports a UI module.

export const DEVELOP_BASE = '/jkai/develop';

export interface DevelopRoomTab {
  id: 'backlog' | 'improvement' | 'doctor';
  label: string;
  href: string;
  count?: number;
  tone?: 'action' | 'watch' | 'quiet';
}

/** The rooms as real links, appended after the portfolio's in-page lanes. */
export function developRooms(): DevelopRoomTab[] {
  return [
    { id: 'backlog', label: 'Backlog', href: `${DEVELOP_BASE}/backlog` },
    { id: 'improvement', label: 'Improvement', href: `${DEVELOP_BASE}/improvement` },
    { id: 'doctor', label: 'Doctor', href: `${DEVELOP_BASE}/doctor` },
  ];
}

/** The rail a room wears: back to the portfolio and its archive, then the rooms. */
export function developRoomRail(): Array<{ id: string; label: string; href: string }> {
  return [
    { id: 'features', label: 'Features', href: DEVELOP_BASE },
    { id: 'archive', label: 'Archive', href: `${DEVELOP_BASE}?tab=archive` },
    ...developRooms(),
  ];
}
