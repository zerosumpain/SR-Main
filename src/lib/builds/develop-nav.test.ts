import { describe, expect, it } from 'vitest';
import { developRoomRail, developRooms } from './develop-nav';

describe('develop rooms', () => {
  it('links the backlog and the doctor under /jkai/develop', () => {
    expect(developRooms().map((t) => t.href)).toEqual(['/jkai/develop/backlog', '/jkai/develop/doctor']);
  });

  it('gives a room a way back to the portfolio and the archive', () => {
    expect(developRoomRail().map((t) => t.id)).toEqual(['features', 'archive', 'backlog', 'doctor']);
  });
});
