import { describe, it, expect } from 'vitest';
import { parseEmail } from '$lib/jkai/intel/preprocess';

describe('parseEmail', () => {
  it('extracts subject, from, and body', () => {
    const raw = `From: sarah@example.com
Subject: Q3 Planning Update

Hey team,

Just wanted to share the latest timeline for Q3.
The vendor delivery is now expected by May 15.

--
Sarah Chen
Engineering Lead`;

    const result = parseEmail(raw);
    expect(result.from).toBe('sarah@example.com');
    expect(result.subject).toBe('Q3 Planning Update');
    expect(result.body).toContain('vendor delivery');
    expect(result.body).not.toContain('Engineering Lead');
  });

  it('handles emails without headers', () => {
    const raw = 'Just a plain text note with no headers.';
    const result = parseEmail(raw);
    expect(result.subject).toBe('');
    expect(result.from).toBe('');
    expect(result.body).toBe('Just a plain text note with no headers.');
  });

  it('strips Sent from signatures', () => {
    const raw = `From: test@test.com
Subject: Quick note

Important info here.

Sent from my iPhone`;

    const result = parseEmail(raw);
    expect(result.body).toBe('Important info here.');
  });
});
