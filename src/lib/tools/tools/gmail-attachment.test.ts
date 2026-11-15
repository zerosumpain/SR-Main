import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('$lib/integrations/gmail/service', () => ({ gmailService: {} }));

const { pickAttachment } = await import('./gmail');

const voucher = { attachmentId: 'a1', filename: 'HotelVoucher.pdf', mimeType: 'application/pdf', sizeBytes: 1 };
const flight = { attachmentId: 'a2', filename: 'FlightTicket.pdf', mimeType: 'application/pdf', sizeBytes: 1 };

describe('pickAttachment', () => {
  it('matches the filename case-insensitively', () => {
    expect(pickAttachment([flight, voucher], 'hotelvoucher.pdf', '')).toBe(voucher);
  });

  it('prefers the filename over a stale id', () => {
    expect(pickAttachment([flight, voucher], 'HotelVoucher.pdf', 'a2')).toBe(voucher);
  });

  it('falls back to the id, then to the only attachment', () => {
    expect(pickAttachment([flight, voucher], '', 'a2')).toBe(flight);
    expect(pickAttachment([voucher], '', '')).toBe(voucher);
  });

  it('refuses to guess between several, or on an unknown name', () => {
    expect(pickAttachment([flight, voucher], '', '')).toBeUndefined();
    expect(pickAttachment([voucher], 'Other.pdf', '')).toBeUndefined();
  });
});
