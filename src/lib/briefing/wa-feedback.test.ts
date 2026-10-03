import { describe, expect, it } from 'vitest';
import { matchBriefingReply } from './wa-feedback';

describe('matchBriefingReply', () => {
  it('reads more/less with a topic', () => {
    expect(matchBriefingReply('briefing less weather')).toEqual({ vote: 'down', what: 'weather' });
    expect(matchBriefingReply('Briefing: more about calendar!')).toEqual({ vote: 'up', what: 'calendar' });
    expect(matchBriefingReply('briefing no more news')).toEqual({ vote: 'down', what: 'news' });
  });
  it('reads a vote on the whole briefing', () => {
    expect(matchBriefingReply('briefing 👍')).toEqual({ vote: 'up', what: '' });
    expect(matchBriefingReply('briefing meh')).toEqual({ vote: 'down', what: '' });
  });
  it('leaves ordinary conversation alone', () => {
    expect(matchBriefingReply('less weather')).toBeNull();
    expect(matchBriefingReply('the briefing was odd today')).toBeNull();
    expect(matchBriefingReply('briefing')).toBeNull();
    expect(matchBriefingReply('briefing less ' + 'x'.repeat(60))).toBeNull();
  });
});
