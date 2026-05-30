// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useIsMobile } from '$lib/canvas/use-mobile.svelte';

describe('useIsMobile', () => {
  let originalMatchMedia: typeof window.matchMedia;
  let mockMq: {
    matches: boolean;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    mockMq = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    window.matchMedia = vi.fn(() => mockMq) as never;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('returns false when viewport is above 768px', () => {
    mockMq.matches = false;
    const get = useIsMobile();
    expect(get()).toBe(false);
  });

  it('returns true when viewport matches mobile breakpoint', () => {
    mockMq.matches = true;
    const get = useIsMobile();
    expect(get()).toBe(true);
  });

  it('registers a change listener on the matchMedia query', () => {
    useIsMobile();
    expect(mockMq.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('queries the 768px breakpoint exactly', () => {
    useIsMobile();
    expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 768px)');
  });
});
