import { describe, it, expect } from 'vitest';
import { classifyMail, classifyMailSubject, senderBrand, MAIL_FLOORS } from './classify';

// Every fixture below is a real subject line from the production corpus,
// pulled 2026-08-28. Addresses other than the owner's are redacted; nothing
// else is edited. A classifier tuned against invented examples would be tuned
// against the mail somebody imagined receiving.

describe('the mail that started this', () => {
  const cases = [
    'Personal Microsoft account security code',
    'Your account recovery request',
    'Unrecognized device signed in to your OpenRouter account',
    'Security alert',
    'Security alert for johnkelly.main@gmail.com',
    'New sign-in to your OpenAI account',
    'Did you sign in from a new device?',
    'Your single-use code',
    'Your Hetzner Verification Code is 012477',
    'Backblaze Account Login Notification',
    "Here's your access code",
    '[GitHub] A new SSH authentication public key was added to your account',
    '[GitHub] A passkey was added to your account',
    '[GitHub] Please download your two-factor recovery codes',
    'Please verify your info on Coinbase',
  ];

  for (const subject of cases) {
    it(`flags: ${subject}`, () => {
      const c = classifyMailSubject(subject);
      expect(c.category).toBe('security');
      expect(c.score).toBeGreaterThanOrEqual(MAIL_FLOORS.security);
    });
  }

  // "Regarding Your Microsoft Account" is the mail John actually named, and it
  // is the hardest one in the corpus: it contains no security verb at all. It
  // is only classifiable WITH the sender, and saying so in a test is more
  // useful than tuning the vocabulary until a bland subject happens to clear.
  it('needs the sender to classify a subject carrying no security verb', () => {
    const blind = classifyMailSubject('Regarding Your Microsoft Account');
    expect(blind.category).toBeNull();

    const withSender = classifyMail({
      subject: 'Regarding Your Microsoft Account',
      senderDomain: 'microsoft.com',
      emailKind: 'correspondence',
    });
    expect(withSender.category).toBe('security');
    expect(withSender.matched).toContain('identity_sender');
  });

  it('does not let an identity sender carry a subject that says nothing', () => {
    // Otherwise every newsletter from google.com scores for free.
    expect(
      classifyMail({ subject: 'Your weekly roundup', senderDomain: 'google.com' }).category,
    ).toBeNull();
  });

  it('scores an account recovery above a bare second factor', () => {
    // Both are security; the ranking decides which one gets the one push a
    // 20-hour cooldown allows.
    const recovery = classifyMailSubject('Your account recovery request');
    const code = classifyMailSubject('Your single-use code');
    expect(recovery.score).toBeGreaterThan(code.score);
  });
});

describe('money admin', () => {
  const cases = [
    'Your Direct Debit has been cancelled',
    'Your payment failed',
    'We were unable to process your payment — card declined',
    'Your subscription price is going up',
    'Your card is expiring soon',
    'Final reminder: invoice overdue',
    'Your free trial ends tomorrow',
  ];
  for (const subject of cases) {
    it(`flags: ${subject}`, () => {
      expect(classifyMailSubject(subject).category).toBe('money_admin');
    });
  }
});

describe('official post', () => {
  const cases = [
    'Check your PAYE code change online',
    'Your Self Assessment tax return is due',
    'Your MOT is due — vehicle tax reminder',
    'Your NHS appointment has been changed',
    'Council Tax: your new bill',
    'Your passport application update',
  ];
  for (const subject of cases) {
    it(`flags: ${subject}`, () => {
      expect(classifyMailSubject(subject).category).toBe('official');
    });
  }
});

describe('what must stay silent', () => {
  // These are the failure modes that would make the whole lane worth muting:
  // marketing wearing security vocabulary, and CI mail from an account that
  // also sends real security notices.
  const cases: Array<[string, string]> = [
    ["Time's Running Out: Use Code Freedel!", 'promo code'],
    ['Your mega savings code is here', 'marketing code'],
    ['🔑 You\'ve unlocked adiClub Level 2!', 'loyalty programme'],
    ['Discount Code Reminder', 'discount code'],
    ['[zerosumpain/SR-Main] PR run failed: CI - ci: verify the build', 'CI noise'],
    ['This week in Claude Code: /design, Concise output style, and more', 'newsletter'],
    ['Anthropic eyes $2T+ IPO 💰, Slack Code 👨‍💻, end of open source 💻', 'newsletter'],
    ['Perfect Python quickly—code naturally today!', 'marketing'],
    ['🎒 Back-to-school prep: Assign licenses and verify educators', 'marketing with "verify"'],
  ];

  for (const [subject, why] of cases) {
    it(`ignores (${why}): ${subject}`, () => {
      expect(classifyMailSubject(subject).category).toBeNull();
    });
  }

  it('ignores an empty or missing subject rather than guessing', () => {
    expect(classifyMailSubject('').category).toBeNull();
    expect(classifyMailSubject(null).category).toBeNull();
    expect(classifyMailSubject(undefined).category).toBeNull();
  });
});

describe('the code discrimination', () => {
  // The single hardest call in the file: these differ by one preceding word.
  it('separates a marketing code from an authentication code', () => {
    expect(classifyMailSubject('Use code SAVE20 at checkout').category).toBeNull();
    expect(classifyMailSubject('Your verification code is 123456').category).toBe('security');
  });

  it('still catches a real notice inside a marketing template', () => {
    // An anti-signal costs points; it does not veto. A strong enough security
    // phrase survives being wrapped in a newsletter.
    const c = classifyMailSubject('Weekly digest: your account was locked after unusual activity');
    expect(c.category).toBe('security');
    expect(c.blocked).toContain('digest');
  });
});

describe('multi-category subjects', () => {
  it('reports every lane that cleared, not just the winner', () => {
    const c = classifyMailSubject(
      'Your payment failed and your account has been locked',
    );
    expect(c.category).toBe('security');
    expect(c.alsoMatched).toContain('money_admin');
  });
});

describe('senderBrand', () => {
  it('names the brand a person would say', () => {
    expect(senderBrand('microsoft.com')).toBe('Microsoft');
    expect(senderBrand('security.microsoft.com')).toBe('Microsoft');
    expect(senderBrand('email.sportsdirect.com')).toBe('Sportsdirect');
    expect(senderBrand('uk-info.adidas.com')).toBe('Adidas');
    expect(senderBrand('noreply.github.com')).toBe('Github');
    expect(senderBrand('virginmoney.com')).toBe('Virginmoney');
    expect(senderBrand('send.brooktaverner.co.uk')).toBe('Brooktaverner');
  });

  it('has nothing to say about a missing or malformed domain', () => {
    expect(senderBrand(null)).toBeNull();
    expect(senderBrand('')).toBeNull();
    expect(senderBrand('localhost')).toBeNull();
  });

  it('does not return an empty string when every label is noise', () => {
    const brand = senderBrand('mail.email.notify.com');
    expect(brand).not.toBe('');
    expect(brand).toBeTruthy();
  });
});
