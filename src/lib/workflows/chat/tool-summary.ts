import type { ToolProgressStep } from './job-store';

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
