// src/lib/workflows/site-tools/meta-tools.ts

import { getToolsetManifest, getAvailableToolsets } from './registry';

const TOOLSET_NAMES = [
  'health', 'blog', 'builds', 'research',
  'workflows', 'home', 'whatsapp', 'diagnostics',
] as const;

export const META_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'activate_toolset',
      description:
        'Load a category of tools into the current conversation. Call this before using domain-specific tools. You can activate multiple toolsets by calling this multiple times in the same turn.',
      parameters: {
        type: 'object',
        properties: {
          toolset: {
            type: 'string',
            enum: TOOLSET_NAMES,
            description: 'The toolset to activate',
          },
        },
        required: ['toolset'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'jkai_help',
      description:
        'See what capabilities and tools are available. Returns all toolsets with their tool names and descriptions. Use this when unsure which toolset to activate.',
      parameters: {
        type: 'object',
        properties: {
          toolset: {
            type: 'string',
            enum: TOOLSET_NAMES,
            description: 'Optional: filter to a specific toolset for detailed info',
          },
        },
      },
    },
  },
];

export function handleJkaiHelp(args: Record<string, unknown>): {
  success: boolean;
  data: unknown;
} {
  const toolset = args.toolset as string | undefined;
  const manifest = getToolsetManifest();

  if (toolset) {
    const entry = manifest.find((m) => m.toolset === toolset);
    if (!entry) {
      return {
        success: false,
        data: {
          error: `Unknown toolset: ${toolset}`,
          available: getAvailableToolsets(),
        },
      };
    }
    return { success: true, data: entry };
  }

  return { success: true, data: manifest };
}
