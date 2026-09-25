import type { NodeDefinition } from '../types';
import { NOTIFICATION_CATEGORIES } from '$lib/constants/notification-categories';

const categoryOptions = NOTIFICATION_CATEGORIES.map((c) => ({ value: c.id, label: c.label }));

export const notifyDef: NodeDefinition = {
  type: 'notify',
  sideEffects: true,
  label: 'Notify me',
  category: 'integration',
  description: 'Tell the owner something under a notification category. The category\'s route (set on the phone) decides WhatsApp, iPhone, both or neither, and every raise is written to the notification ledger.',
  configSchema: {
    type: 'object',
    properties: {
      channel: { type: 'string', description: 'route | whatsapp | iphone | both. Default route (the category decides). Set it whenever the user names a channel ("to my WhatsApp" → whatsapp).' },
      category: { type: 'string', description: `Notification category: ${categoryOptions.map((o) => o.value).join(' | ')}. Default system.` },
      title: { type: 'string', description: 'Short headline. Supports {{input.field}} templates.' },
      body: { type: 'string', description: 'The message. Supports {{input.field}} templates.' },
      url: { type: 'string', description: 'Site-relative link to act on it, e.g. /health. Optional.' },
      severity: { type: 'string', description: 'info | warn | alert. Default info.' },
      dedupeKey: { type: 'string', description: 'Collapse repeats with the same key inside the category floor. Supports templates.' },
      minIntervalSeconds: { type: 'number', description: 'Not more often than this for this node (combined with the category floor by max).' },
    },
    required: ['title'],
  },
  defaultConfig: { channel: 'route', category: 'system', title: '', body: '', severity: 'info' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Delivery' }],
  summarize: (config) => {
    const title = String(config.title ?? '').trim();
    const cat = categoryOptions.find((o) => o.value === config.category)?.label ?? 'Everything else';
    return {
      line: title ? `Notify me (${cat}): "${title.length > 50 ? `${title.slice(0, 47)}…` : title}"` : 'Notify me (set a title first)',
      preview: { kind: 'message', details: { Category: cat, Title: title || '—' } },
    };
  },
  basicConfig: [
    {
      key: 'channel', label: 'Send to', type: 'dropdown',
      options: [
        { value: 'route', label: 'Wherever the category routes' },
        { value: 'whatsapp', label: 'WhatsApp' },
        { value: 'iphone', label: 'iPhone' },
        { value: 'both', label: 'WhatsApp and iPhone' },
      ],
    },
    { key: 'category', label: 'Category', type: 'dropdown', options: categoryOptions, description: 'Routes to WhatsApp and/or the iPhone per the category\'s settings, unless "Send to" names a channel.' },
    { key: 'title', label: 'Title', type: 'template-textarea', placeholder: 'Build shipped: {{input.title}}' },
    { key: 'body', label: 'Message', type: 'template-textarea', placeholder: '{{input.summary}}' },
    { key: 'url', label: 'Link', type: 'text', placeholder: '/jkai/builds', section: 'OPTIONS' },
    {
      key: 'severity', label: 'Severity', type: 'dropdown', section: 'OPTIONS',
      options: [{ value: 'info', label: 'Info' }, { value: 'warn', label: 'Warning' }, { value: 'alert', label: 'Alert' }],
    },
    { key: 'dedupeKey', label: 'Dedupe key', type: 'text', placeholder: 'build:{{input.id}}', section: 'OPTIONS', advancedOnly: true },
    { key: 'minIntervalSeconds', label: 'Min interval (s)', type: 'number', min: 0, section: 'OPTIONS', advancedOnly: true },
  ],
  llmDescription: `Notify the OWNER (John) under a notification category — the way to reach his iPhone, and the preferred way to reach his WhatsApp. The category's route decides the channels: build/deploy/uptime/intel/system go to WhatsApp and the iPhone, health/news/chat to the iPhone only, by default. Use this instead of a \`whatsapp\` node whenever the recipient is the owner. **When the user names a channel, set \`channel\`** — "to my WhatsApp" → \`channel: 'whatsapp'\`, "to my phone"/"iPhone" → \`'iphone'\`, both → \`'both'\` — it overrides the category's route; leave it \`'route'\` only when no channel was named. Output: { raised, channels ("WhatsApp + iPhone" | "iPhone" | "suppressed (…)"), whatsapp: sent|failed|off, iphone: queued|off, id }.`,
  llmExamples: [
    { category: 'build', title: 'Nightly build failed', body: '{{input.error}}', url: '/jkai/builds', severity: 'warn' },
    { category: 'news', title: '{{input.count}} new stories', body: '{{input.titles}}', dedupeKey: 'news:{{input.count}}' },
  ],
};
