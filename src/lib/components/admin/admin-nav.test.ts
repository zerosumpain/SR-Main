import { describe, expect, it } from 'vitest';
import { ADMIN_SECTIONS, resolveAdminRedirect } from './admin-nav';

describe('folded control pages', () => {
  it('sends the old improvement and doctor admin pages to their /jkai/develop ledgers', () => {
    expect(resolveAdminRedirect('/admin/ai/improvement')).toBe('/jkai/develop/improvement');
    expect(resolveAdminRedirect('/admin/ai/doctor')).toBe('/jkai/develop/doctor');
  });

  it('no longer lists them in the admin AI strip', () => {
    const hrefs = ADMIN_SECTIONS.flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs).not.toContain('/admin/ai/improvement');
    expect(hrefs).not.toContain('/admin/ai/doctor');
  });
});
