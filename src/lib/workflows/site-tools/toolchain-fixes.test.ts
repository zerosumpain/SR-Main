import { describe, it, expect } from 'vitest';
import { getTool, getToolsByToolset, getAvailableToolsets } from './registry';
import { isDestructive } from '$lib/workflows/chat/confirmation-gate';

describe('destructive flag (single source of truth)', () => {
  const shouldBeDestructive = [
    'publish_page',
    'build_delete',
    'node_builder_commit_and_deploy',
    'workflow_delete',
    'workflow_clear_data_store',
    'scraper_script_save',
    'scraper_script_delete',
    'gmail_send',
    'gmail_reply',
    'whatsapp_send',
  ];

  it.each(shouldBeDestructive)('flags %s as destructive', (name) => {
    expect(getTool(name)?.destructive).toBe(true);
    expect(isDestructive(name)).toBe(true);
  });

  it('leaves read-only tools ungated', () => {
    for (const name of ['health_stats', 'blog_list', 'file_read', 'live_walk_status', 'policy_engine_indicators']) {
      expect(getTool(name)?.destructive).toBeFalsy();
      expect(isDestructive(name)).toBe(false);
    }
  });

  it('leaves build_control ungated, and build_delete gated', () => {
    // Publishing a build is reversible and was gated until 2026-08-08, when two
    // publishes of the same app died at the prompt — one timing out against a
    // confirmer whose turn had already ended, one denied because it came from a
    // headless heartbeat — leaving a broken calculator live and the user with
    // no sign either had failed. What replaces the prompt is the slug-takeover
    // rule in builds.ts: a publish can create a page, but it cannot silently
    // overwrite one belonging to another build unless the slug is named.
    expect(getTool('build_control')?.destructive).toBeFalsy();
    expect(isDestructive('build_control')).toBe(false);
    expect(isDestructive('build_delete')).toBe(true);
  });

  it('has no phantom gate entries', () => {
    // These names were in the old hardcoded DESTRUCTIVE_TOOLS set but map to
    // no registered tool — they must not resurface.
    expect(getTool('web_app_publish')).toBeUndefined();
    expect(getTool('intel_note_delete')).toBeUndefined();
    expect(isDestructive('web_app_publish')).toBe(false);
  });
});

describe('toolset restructure', () => {
  it('split the system toolset into three', () => {
    expect(getToolsByToolset('system')).toHaveLength(0);
    expect(getToolsByToolset('followups').length).toBeGreaterThan(0);
    expect(getToolsByToolset('heartbeat').length).toBeGreaterThan(0);
    expect(getToolsByToolset('schedule').length).toBeGreaterThan(0);
    expect(getAvailableToolsets()).not.toContain('system');
  });

  it('re-filed publish_page into builds and ephemeral tools into custom-tools', () => {
    expect(getTool('publish_page')?.toolset).toBe('builds');
    expect(getTool('author_ephemeral_tool')?.toolset).toBe('custom-tools');
    expect(getTool('promote_ephemeral_tool')?.toolset).toBe('custom-tools');
  });
});

describe('long-running auto-heartbeat is universal across spawner tools', () => {
  it('every long-job spawner declares producesLongRunningTask with a known kind', () => {
    const expected: Record<string, string> = {
      build_create: 'build',
      build_tweak: 'build',
      research_start: 'research',
      research_branch: 'research',
      workflow_run: 'workflow_run',
    };
    for (const [name, kind] of Object.entries(expected)) {
      const p = getTool(name)?.producesLongRunningTask;
      expect(p, `${name} should auto-attach a heartbeat`).toBeDefined();
      expect(p?.kind).toBe(kind);
      expect(p?.idPath).toBeTruthy();
    }
  });
});

describe('site-signals coverage toolset', () => {
  it('registers the three read-only signal tools', () => {
    const names = getToolsByToolset('site-signals').map((t) => t.name).sort();
    expect(names).toEqual(['family_presence_current', 'live_walk_status', 'policy_engine_indicators']);
  });
});
