import { describe, it, expect } from 'vitest';
import { getTools, getToolDefinitions, isRegisteredTool, buildSystemPromptSection } from '$lib/workflows/site-tools/registry';

describe('tool registry', () => {
  it('loads all domain modules and registers tools', () => {
    const tools = getTools();
    expect(tools.length).toBeGreaterThanOrEqual(40);
  });

  it('has tools from every domain', () => {
    const tools = getTools();
    const categories = new Set(tools.map((t) => t.category));
    expect(categories.has('Health Data')).toBe(true);
    expect(categories.has('Blog')).toBe(true);
    expect(categories.has('JKAI Builder')).toBe(true);
    expect(categories.has('Workflows')).toBe(true);
    expect(categories.has('Deep Dive Research')).toBe(true);
    expect(categories.has('WhatsApp')).toBe(true);
  });

  it('generates OpenAI-format tool definitions', () => {
    const defs = getToolDefinitions();
    expect(defs.length).toBeGreaterThan(0);
    for (const def of defs) {
      expect(def.type).toBe('function');
      expect(def.function.name).toBeTruthy();
      expect(def.function.description).toBeTruthy();
      expect(def.function.parameters.type).toBe('object');
    }
  });

  it('isRegisteredTool returns true for known tools', () => {
    expect(isRegisteredTool('workflow_inspect')).toBe(true);
    expect(isRegisteredTool('build_inspect')).toBe(true);
    expect(isRegisteredTool('research_query')).toBe(true);
    expect(isRegisteredTool('blog_unpublish')).toBe(true);
    expect(isRegisteredTool('health_stats')).toBe(true);
    expect(isRegisteredTool('whatsapp_send')).toBe(true);
  });

  it('isRegisteredTool returns false for unknown tools', () => {
    expect(isRegisteredTool('nonexistent_tool')).toBe(false);
  });

  it('no duplicate tool names', () => {
    const tools = getTools();
    const names = tools.map((t) => t.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('system prompt section includes all categories', () => {
    const prompt = buildSystemPromptSection();
    expect(prompt).toContain('Health Data');
    expect(prompt).toContain('Blog');
    expect(prompt).toContain('JKAI Builder');
    expect(prompt).toContain('Workflows');
    expect(prompt).toContain('Deep Dive Research');
    expect(prompt).toContain('WhatsApp');
  });

  it('uses new naming convention (no site_ or jkai_ prefix)', () => {
    expect(isRegisteredTool('health_stats')).toBe(true);
    expect(isRegisteredTool('site_health_stats')).toBe(false);
    expect(isRegisteredTool('build_create')).toBe(true);
    expect(isRegisteredTool('jkai_start_build')).toBe(false);
    expect(isRegisteredTool('blog_list')).toBe(true);
    expect(isRegisteredTool('site_blog_list')).toBe(false);
  });

  it('has workflow inspection and update tools', () => {
    const expected = [
      'workflow_inspect', 'workflow_get_run', 'workflow_get_generation_log',
      'workflow_update_metadata', 'workflow_update_node', 'workflow_add_node',
      'workflow_remove_node', 'workflow_add_edge', 'workflow_remove_edge',
      'workflow_update_edge', 'workflow_add_schedule', 'workflow_update_schedule',
      'workflow_remove_schedule',
    ];
    for (const name of expected) {
      expect(isRegisteredTool(name)).toBe(true);
    }
  });

  it('has build inspection and update tools', () => {
    const expected = [
      'build_inspect', 'build_get_iteration', 'build_get_plan',
      'build_get_logs', 'build_list_files', 'build_read_file',
      'build_tweak', 'build_write_file', 'build_delete',
    ];
    for (const name of expected) {
      expect(isRegisteredTool(name)).toBe(true);
    }
  });

  it('has research capability tools', () => {
    const expected = [
      'research_inspect', 'research_query', 'research_branch',
      'research_extract', 'research_web_search',
    ];
    for (const name of expected) {
      expect(isRegisteredTool(name)).toBe(true);
    }
  });

  it('has diagnostic tools', () => {
    expect(isRegisteredTool('scheduler_status')).toBe(true);
    expect(isRegisteredTool('scheduler_run_history')).toBe(true);
    expect(isRegisteredTool('system_logs')).toBe(true);
  });

  it('has System Diagnostics category', () => {
    const tools = getTools();
    const categories = new Set(tools.map((t) => t.category));
    expect(categories.has('System Diagnostics')).toBe(true);
  });
});
