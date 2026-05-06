import type { ToolProgressStep } from './job-store';

/**
 * Args-derived label shown on a tool step while it's still running. Lets
 * the user see *what* a tool is currently doing (e.g. which workflow,
 * which file, which query) instead of a bare spinner. Keep it short.
 */
export function summarizeRunningTool(tool: string, args: Record<string, unknown>): string {
  const a = args as Record<string, unknown>;
  const str = (k: string): string | undefined => {
    const v = a[k];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  };
  const trim = (s: string, n = 60) => (s.length > n ? s.slice(0, n) + '…' : s);

  switch (tool) {
    case 'activate_toolset': return str('toolset') ? `loading ${str('toolset')}` : '';
    case 'jkai_help': return str('toolset') ? `help: ${str('toolset')}` : '';
    case 'workflow_inspect':
      return str('id') ? `inspecting canvas ${str('id')!.slice(0, 8)}…` : 'inspecting canvas';
    case 'workflow_get_run':
      return str('id') ? `fetching run ${str('id')!.slice(0, 8)}…` : 'fetching run';
    case 'workflow_get_generation_log':
      return str('id') ? `replaying canvas build ${str('id')!.slice(0, 8)}…` : 'replaying canvas build';
    case 'workflow_lint':
      return 'linting workflow';
    case 'workflow_add_schedule':
      return 'activating schedule';
    case 'workflow_remove_schedule':
      return 'pausing schedule';
    case 'workflow_run':
      return str('id') ? `running canvas ${str('id')!.slice(0, 8)}…` : 'running canvas';
    case 'workflow_list': return 'listing canvases';
    case 'workflow_list_node_types': return 'fetching node types';
    case 'workflow_create': return str('name') ? `creating ${str('name')}` : 'creating canvas';
    case 'workflow_delete': return str('id') ? `deleting ${str('id')!.slice(0, 8)}…` : 'deleting canvas';
    case 'workflow_update_metadata': return str('name') ? `→ ${str('name')}` : 'updating metadata';
    case 'workflow_add_node': return str('type') ? `+${str('type')} node` : 'adding node';
    case 'workflow_remove_node': return 'removing node';
    case 'workflow_update_node': return str('id') ? `node ${str('id')!.slice(0, 8)}…` : 'updating node';
    case 'workflow_add_edge': return 'wiring edge';
    case 'workflow_remove_edge': return 'removing edge';
    case 'file_list': return str('prefix') ? `prefix ${str('prefix')}` : 'listing files';
    case 'file_read': return str('name') ?? (str('id') ? `id ${str('id')!.slice(0, 8)}…` : 'reading file');
    case 'scraper_script_list': return 'listing scripts';
    case 'scraper_script_read':
    case 'scraper_script_save':
    case 'scraper_script_test':
      return str('profile') ? `profile ${str('profile')}` : '';
    case 'scraper_target_knowledge_lookup': {
      const domains = a.domains;
      if (Array.isArray(domains) && typeof domains[0] === 'string') return trim(domains[0] as string, 50);
      return 'looking up target';
    }
    case 'web_search':
    case 'intel_search':
    case 'gmail_search':
      return str('query') ? `“${trim(str('query')!, 40)}”` : '';
    case 'webpage_fetch': return str('url') ? trim(str('url')!, 50) : '';
    case 'stealth_scrape':
    case 'stealth_scrape_llm':
      return str('url') ? trim(str('url')!, 50) : (str('profile') ? `profile ${str('profile')}` : '');
    case 'gmail_fetch': return str('threadId') ? `thread ${str('threadId')!.slice(0, 8)}…` : '';
    case 'gmail_send':
    case 'gmail_reply':
      return str('to') ? `→ ${str('to')}` : '';
    case 'blog_get':
    case 'blog_update':
      return str('id') ? `post ${str('id')}` : '';
    case 'memory_recall': return str('query') ? `“${trim(str('query')!, 40)}”` : '';
    case 'render_chart':
    case 'render_map':
    case 'render_table':
      return str('title') ? trim(str('title')!, 50) : '';
    default: {
      // Generic fallback: take the first short string arg, if any
      for (const v of Object.values(a)) {
        if (typeof v === 'string' && v.length > 0 && v.length < 80) return trim(v, 50);
      }
      return '';
    }
  }
}

/**
 * Human-friendly one-liner for a completed tool call. Shown next to the
 * status pill in the step card. Keeps output under ~120 chars so the
 * card stays on one line at normal viewport widths.
 */
export function summarizeToolResult(step: ToolProgressStep): string {
  const { tool, args, result, status } = step;
  if (status === 'error') {
    const errMsg = (result as { error?: string } | undefined)?.error;
    return errMsg ? `${tool} failed: ${errMsg.slice(0, 80)}` : `${tool} failed`;
  }

  const r = result as { data?: Record<string, unknown>; results?: unknown[]; count?: number } | undefined;
  const query = (args.query as string | undefined)?.slice(0, 40);
  const url = (args.url as string | undefined)?.slice(0, 50);

  switch (tool) {
    case 'workflow_create': {
      const id = (r?.data as { workflowId?: string } | undefined)?.workflowId;
      return id ? `Created canvas ${id}` : 'Created canvas';
    }
    case 'workflow_modify':
      return 'Updated canvas';
    case 'workflow_delete':
      return 'Deleted canvas';
    case 'intel_search': {
      const n = (r?.results as unknown[] | undefined)?.length ?? 0;
      return query ? `Found ${n} intel result${n === 1 ? '' : 's'} for "${query}"` : `Found ${n} intel results`;
    }
    case 'intel_note_create':
      return 'Created intel note';
    case 'intel_note_delete':
      return 'Deleted intel note';
    case 'web_search': {
      const n = (r?.results as unknown[] | undefined)?.length ?? 0;
      return query ? `Searched the web for "${query}" (${n} results)` : `Searched the web (${n} results)`;
    }
    case 'webpage_fetch':
      return url ? `Fetched ${url}` : 'Fetched webpage';
    case 'gmail_search': {
      const n = (r?.results as unknown[] | undefined)?.length ?? 0;
      return query ? `Searched Gmail for "${query}" (${n} threads)` : `Searched Gmail (${n} threads)`;
    }
    case 'gmail_fetch': {
      const n = ((r?.data as { messages?: unknown[] } | undefined)?.messages)?.length;
      return n != null ? `Fetched ${n} message${n === 1 ? '' : 's'}` : 'Fetched messages';
    }
    case 'gmail_send':
      return 'Sent Gmail message';
    case 'gmail_reply':
      return 'Sent Gmail reply';
    case 'gmail_label':
      return 'Updated Gmail labels';
    case 'stealth_scrape':
      return url ? `Scraped ${url}` : 'Scraped page';
    case 'stealth_scrape_llm':
      return url ? `Extracted fields from ${url}` : 'Extracted fields';
    case 'activate_toolset': {
      const toolset = args.toolset as string | undefined;
      return toolset ? `Loaded ${toolset} toolset` : 'Loaded toolset';
    }
    default:
      return `${tool} completed`;
  }
}
