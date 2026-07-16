import type { NodeDefinition } from '../types';

/**
 * D3 — whatsapp-trigger.
 *
 * Start node that fires when the OWNER sends a WhatsApp message matching a
 * configured keyword. The WhatsApp orchestrator bridge routes an inbound owner
 * message to the first matching workflow (see
 * `whatsapp/workflow-dispatch.ts`), forwarding the (optionally keyword-stripped)
 * remainder as `{{input.message}}`.
 *
 * Only ONE whatsapp-trigger workflow should own a given keyword — the bridge
 * dispatches the FIRST match and logs a warning if more than one matches.
 */
export const whatsappTriggerDef: NodeDefinition = {
  type: 'whatsapp-trigger',
  category: 'trigger',
  label: 'WhatsApp Trigger',
  description: 'Fires when an inbound WhatsApp message from the owner matches a keyword',
  defaultConfig: { keyword: '', matchMode: 'prefix', stripKeyword: true },
  inputs: [],
  outputs: [{ name: 'output', type: 'object', label: 'Message fields' }],
  configSchema: {
    type: 'object',
    properties: {
      keyword: {
        type: 'string',
        description:
          "The keyword that routes a WhatsApp message to this workflow (e.g. 'news'). Case-insensitive. Reserved words approve/deny/yes/no are never matched (they belong to the approval-reply flow).",
      },
      matchMode: {
        type: 'string',
        enum: ['prefix', 'exact', 'contains'],
        description:
          "How the message is matched against the keyword. prefix (default): message must START with the keyword. exact: message must equal the keyword. contains: keyword appears anywhere.",
      },
      stripKeyword: {
        type: 'boolean',
        description:
          'When true (default), the keyword is removed from the message before it is passed downstream as {{input.message}}. When false, the full message text is forwarded.',
      },
    },
    required: ['keyword'],
  },
  basicConfig: [
    {
      key: 'keyword',
      label: 'Keyword',
      type: 'text',
      placeholder: 'news',
      description:
        "The word that routes an inbound WhatsApp message to this workflow. Case-insensitive. Only ONE workflow should own a keyword. Reserved words (approve/deny/yes/no) can't be used — they belong to the approval flow.",
    },
    {
      key: 'matchMode',
      label: 'Match Mode',
      type: 'dropdown',
      options: [
        { value: 'prefix', label: 'Prefix — message starts with the keyword' },
        { value: 'exact', label: 'Exact — message equals the keyword' },
        { value: 'contains', label: 'Contains — keyword appears anywhere' },
      ],
      description: 'How the inbound message is matched against the keyword.',
    },
    {
      key: 'stripKeyword',
      label: 'Strip keyword from message',
      type: 'toggle',
      description:
        'Remove the keyword before forwarding the rest of the text as {{input.message}}. Turn off to forward the full message.',
    },
  ],
  llmDescription:
    'Start this workflow from a WhatsApp message: the message must start with the keyword (default prefix mode; exact/contains also available), and the rest of the text becomes {{input.message}}. Owner-only. Always the first node — nothing upstream of it. Output shape: { message, rawMessage, from, matchedKeyword }. Downstream nodes typically reference {{input.message}} (the keyword-stripped text). Only ONE whatsapp-trigger workflow should own a given keyword — the first match wins. Never uses the reserved words approve/deny/yes/no (those route to the approval-reply flow).',
  llmExamples: [
    { keyword: 'news' },
    { keyword: 'digest', matchMode: 'exact', stripKeyword: false },
    { keyword: 'note', matchMode: 'prefix', stripKeyword: true },
  ],
};
