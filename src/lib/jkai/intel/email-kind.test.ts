import { describe, it, expect } from 'vitest';
import { classifyEmail, EMAIL_KINDS } from './email-kind';

const OWNER = ['johnkelly.main@gmail.com'];
const kind = (participants: string[]) => classifyEmail(participants, OWNER).kind;

describe('classifyEmail', () => {
  it('ignores the mailbox owner when picking the sender', () => {
    // The owner is on every thread by definition — classifying on them would
    // make every email identical.
    const result = classifyEmail(['johnkelly.main@gmail.com', 'katie@education.gov.uk'], OWNER);
    expect(result.sender).toBe('katie@education.gov.uk');
    expect(result.domain).toBe('education.gov.uk');
  });

  it('treats a thread with only the owner as correspondence, not bulk', () => {
    const result = classifyEmail(['johnkelly.main@gmail.com'], OWNER);
    expect(result.kind).toBe('correspondence');
    expect(result.sender).toBeNull();
  });

  describe('bulk', () => {
    // Every one of these is a real sender from the live mailbox.
    it.each([
      ['mailer.humblebundle.com', 'noreply@mailer.humblebundle.com'],
      ['send.nuubu.com', 'hello@send.nuubu.com'],
      ['immail.fanatical.com', 'news@immail.fanatical.com'],
      ['product.totallymoney.com', 'noreply@product.totallymoney.com'],
      ['eml.experian.co.uk', 'noreply@eml.experian.co.uk'],
      ['tldrnewsletter.com', 'newsletter@tldrnewsletter.com'],
    ])('classifies %s as bulk', (_domain, address) => {
      expect(kind([address, 'johnkelly.main@gmail.com'])).toBe('bulk');
    });

    it('catches a marketing local part on an ordinary domain', () => {
      expect(kind(['offers@somecompany.co.uk'])).toBe('bulk');
    });
  });

  describe('notification', () => {
    it.each([
      ['noreply.github.com', 'notifications@noreply.github.com'],
      ['rightmove', 'noreply@alert.rightmove.co.uk'],
      ['uber', 'no-reply@uber.com'],
      ['classdojo', 'donotreply@classdojo.com'],
    ])('classifies %s as a notification', (_name, address) => {
      expect(kind([address, 'johnkelly.main@gmail.com'])).toBe('notification');
    });
  });

  describe('correspondence', () => {
    it.each([
      'katie.kelly@education.gov.uk',
      'b.ashmore@cabinetoffice.gov.uk',
      'someone@ibca.org.uk',
      'a.person@gmail.com',
    ])('classifies %s as correspondence', (address) => {
      expect(kind([address, 'johnkelly.main@gmail.com'])).toBe('correspondence');
    });

    it('does not mistake a courier for a bulk mailer', () => {
      // "sendle" contains "send" — matching on substrings rather than labels
      // would misfile a real company.
      expect(kind(['tracking@sendle.com'])).toBe('correspondence');
    });

    it('does not mistake a newsagent for a newsletter', () => {
      expect(kind(['orders@newsagent.co.uk'])).toBe('correspondence');
    });
  });

  describe('robustness', () => {
    it('survives an empty or missing participant list', () => {
      expect(classifyEmail([], OWNER).kind).toBe('correspondence');
      expect(classifyEmail(null, OWNER).kind).toBe('correspondence');
      expect(classifyEmail(undefined, OWNER).kind).toBe('correspondence');
    });

    it('ignores entries that are not addresses', () => {
      expect(classifyEmail(['John Kelly', 'noreply@mailer.example.com'], OWNER).sender).toBe(
        'noreply@mailer.example.com',
      );
    });

    it('is case-insensitive', () => {
      expect(kind(['NoReply@Mailer.Humblebundle.COM'])).toBe('bulk');
    });

    it('handles an unparseable address without throwing', () => {
      const result = classifyEmail(['not-an-address@'], OWNER);
      expect(EMAIL_KINDS).toContain(result.kind);
    });

    it('always returns one of the declared kinds', () => {
      for (const address of ['a@b.com', 'noreply@x.io', 'news@send.y.com', '']) {
        expect(EMAIL_KINDS).toContain(classifyEmail([address], OWNER).kind);
      }
    });

    it('always reports the domain it decided from', () => {
      expect(classifyEmail(['noreply@alert.rightmove.co.uk'], OWNER).domain).toBe(
        'alert.rightmove.co.uk',
      );
    });
  });

  describe('domain overrides', () => {
    it('lets a curated verdict beat the heuristic', () => {
      // linkedin.com sends from an ordinary-looking address and no pattern can
      // tell it from a colleague. A rule can.
      const overrides = new Map([['linkedin.com', 'bulk' as const]]);
      expect(classifyEmail(['invitations@linkedin.com'], OWNER, overrides).kind).toBe('bulk');
    });

    it('overrides a heuristic that would have said bulk', () => {
      const overrides = new Map([['mailer.humblebundle.com', 'correspondence' as const]]);
      expect(classifyEmail(['noreply@mailer.humblebundle.com'], OWNER, overrides).kind).toBe(
        'correspondence',
      );
    });

    it('says the verdict came from a rule', () => {
      const overrides = new Map([['amazon.co.uk', 'notification' as const]]);
      expect(classifyEmail(['auto@amazon.co.uk'], OWNER, overrides).reason).toContain('rule you set');
    });

    it('falls back to the heuristic for an unlisted domain', () => {
      const overrides = new Map([['linkedin.com', 'bulk' as const]]);
      expect(classifyEmail(['noreply@mailer.example.com'], OWNER, overrides).kind).toBe('bulk');
    });
  });
});
