import { describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'svelte';
import { render } from 'svelte/server';
import HeroTaglineControls from './HeroTaglineControls.svelte';
import { DEFAULT_LANDING_TAGLINE } from '$lib/constants/landing-tagline';

// enhance never runs in a server render; faked so the import stays light.
vi.mock('$app/forms', () => ({ enhance: () => ({}) }));

function html(props: ComponentProps<typeof HeroTaglineControls>) {
  return render(HeroTaglineControls, { props }).body;
}

/** The "Reset to default" button's opening tag. */
function resetButton(body: string) {
  return body.match(/<button[^>]*>Reset to default<\/button>/)?.[0] ?? '';
}

describe('HeroTaglineControls', () => {
  it('says the default shows, and offers no reset, while nothing is saved', () => {
    const body = html({ tagline: null });
    expect(body).toContain('Showing the default.');
    expect(body).not.toContain('Unsaved');
    expect(resetButton(body)).toMatch(/\bdisabled\b/);
    expect(resetButton(body)).toContain('type="button"');
    expect(body).toContain(`placeholder="${DEFAULT_LANDING_TAGLINE}"`);
  });

  it('fills the box with the saved line and lets Reset empty it', () => {
    const body = html({ tagline: 'x' });
    expect(body).toContain('Showing your saved line.');
    expect(body).toMatch(/<input[^>]*value="x"/);
    expect(resetButton(body)).not.toMatch(/\bdisabled\b/);
  });

  it('shows the error as an alert and keeps the typed line in the box', () => {
    const body = html({ tagline: 'x', result: { taglineError: 'Keep the tagline short.', taglineValue: 'typed but refused' } });
    expect(body).toMatch(/<p role="alert"[^>]*>Keep the tagline short\.<\/p>/);
    expect(body).toMatch(/<input[^>]*value="typed but refused"/);
    expect(body).toContain('Unsaved: press Save tagline.');
    expect(body).not.toContain('role="status"');
  });

  it('confirms a save, and a reset, as a status line', () => {
    expect(html({ tagline: 'x', result: { taglineSaved: true, taglineReset: false } })).toMatch(/<p role="status"[^>]*>Tagline saved\.<\/p>/);
    expect(html({ tagline: null, result: { taglineSaved: true, taglineReset: true } })).toMatch(/<p role="status"[^>]*>Tagline reset to the default\.<\/p>/);
  });
});
