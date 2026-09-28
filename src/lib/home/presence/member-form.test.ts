import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/db', () => ({ db: {} }));

const { normaliseWhatsApp, readMemberForm } = await import('./member-form');

function form(fields: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const one of Array.isArray(v) ? v : [v]) f.append(k, one);
  return f;
}

const others = [
  { subject: 'rory', email: null, displayName: 'Rory', source: 'life360' as const, haPersonEntity: null, whatsapp: null, alerts: {} },
];
const base = { displayName: 'Sam', email: 'sam@example.test', source: 'life360' };

describe('the household form', () => {
  it('reads a follow list, WhatsApp number and switch', () => {
    const r = readMemberForm(form({ ...base, whatsapp: '07700 900123', whatsappOn: 'on', follow: ['rory', 'forged'] }), others);
    expect(r).toEqual({
      patch: {
        displayName: 'Sam',
        email: 'sam@example.test',
        source: 'life360',
        whatsapp: '447700900123',
        guardianOf: [],
        alerts: { follow: ['rory'], whatsapp: true },
      },
    });
  });

  it('stores no follow list for "everyone"', () => {
    const r = readMemberForm(form({ ...base, followAll: 'on' }), others);
    expect('patch' in r && r.patch.alerts).toEqual({ whatsapp: false });
  });

  it('changes the Home Assistant link only when the form carries the field', () => {
    const without = readMemberForm(form(base), others);
    expect('patch' in without && 'haPersonEntity' in without.patch).toBe(false);
    const cleared = readMemberForm(form({ ...base, haPersonEntity: '' }), others);
    expect('patch' in cleared && cleared.patch.haPersonEntity).toBeNull();
    expect(readMemberForm(form({ ...base, haPersonEntity: 'sensor.x' }), others)).toHaveProperty('error');
  });

  it('refuses a bad number, a bad source and someone on the app with no email', () => {
    expect(readMemberForm(form({ ...base, whatsapp: '12' }), others)).toHaveProperty('error');
    expect(readMemberForm(form({ ...base, source: 'gps' }), others)).toHaveProperty('error');
    expect(readMemberForm(form({ ...base, email: '', source: 'companion' }), others)).toHaveProperty('error');
    expect(readMemberForm(form({ ...base, displayName: ' ' }), others)).toHaveProperty('error');
  });
});

describe('WhatsApp numbers', () => {
  it('stores E.164 digits whatever way the number was typed', () => {
    for (const typed of ['07700 900123', '+44 7700 900123', '0044 7700-900-123', '(07700) 900123']) {
      expect(normaliseWhatsApp(typed), typed).toBe('447700900123');
    }
    expect(normaliseWhatsApp('+1 415 555 0100')).toBe('14155550100');
    expect(normaliseWhatsApp('12345')).toBeNull();
  });
});
