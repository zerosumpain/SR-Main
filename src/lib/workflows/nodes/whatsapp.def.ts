import type { NodeDefinition } from '../types';

export const whatsappDef: NodeDefinition = {
  type: 'whatsapp',
  label: 'WhatsApp',
  category: 'integration',
  description: 'Send a WhatsApp message (Markdown-aware, auto-chunked, optional media). To/message fields support {{input.field}} templates.',
  configSchema: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient phone number (E.164 format). Supports {{input.field}} templates.' },
      message: { type: 'string', description: 'Message text. Supports {{input.field}} templates.' },
      formatMarkdown: { type: 'boolean', description: 'Translate Markdown (**bold**, ## headings, [links](url), - bullets) into WhatsApp formatting before sending. Default true.' },
      maxChunks: { type: 'number', description: 'Messages over 4096 chars are split on paragraph boundaries into sequential sends; beyond this many chunks the rest is dropped with a "… (truncated)" tail. Default 3. 0 = no cap.' },
      mediaPath: { type: 'string', description: 'Absolute path to a local file to send as an attachment (image/audio/video/document). Requires the WhatsApp worker. Supports {{input.field}}.' },
      mediaUrl: { type: 'string', description: 'URL of a file to download and send as an attachment. Supports {{input.field}}.' },
      caption: { type: 'string', description: 'Caption for the media attachment. Falls back to the message text. Supports {{input.field}}.' },
      suppressDuplicateWindowMins: { type: 'number', description: 'Last-line-of-defence idempotency: skip the send if an identical message was already sent to this recipient within this many minutes (hash-based). Default 0 = off. The dedupe node upstream remains the primary pattern.' },
    },
    required: ['to'],
  },
  defaultConfig: { to: '', message: '', formatMarkdown: true, maxChunks: 3, suppressDuplicateWindowMins: 0 },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Result' }],
  summarize: (config) => {
    const to = String(config.to ?? '').trim();
    const message = String(config.message ?? '').trim();
    const media = String(config.mediaPath ?? config.mediaUrl ?? '').trim();
    const short = message.length > 60 ? `${message.slice(0, 57)}…` : message;
    return {
      line: to
        ? `Send a WhatsApp message to ${to}${media ? ' with media' : ''}`
        : 'Send a WhatsApp message (set a recipient first)',
      preview: { kind: 'message', details: { To: to || '—', Message: short || (media ? '(media)' : '—') } },
    };
  },
  basicConfig: [
    {
      key: 'to',
      label: 'Recipient Phone Number',
      type: 'template-textarea',
      placeholder: '+447700900123 or {{input.phone}}',
      description: 'Phone number in E.164 format (include country code). Supports {{input.field}} templates.',
    },
    {
      key: 'message',
      label: 'Message',
      type: 'template-textarea',
      placeholder: 'Hi {{input.name}}, your report is ready.',
      description: 'Text to send. Supports {{input.field}} templates. Markdown is converted to WhatsApp formatting when enabled.',
    },
    {
      key: 'formatMarkdown',
      label: 'Convert Markdown',
      type: 'toggle',
      description: '**bold** → *bold*, ## headings → bold lines, [links](url) → text (url), - bullets → •.',
      section: 'OPTIONS',
    },
    {
      key: 'maxChunks',
      label: 'Max chunks',
      type: 'number',
      min: 0,
      description: 'Split long messages (>4096 chars) into at most this many sends. 0 = no cap.',
      section: 'OPTIONS',
    },
    {
      key: 'suppressDuplicateWindowMins',
      label: 'Suppress duplicates (mins)',
      type: 'number',
      min: 0,
      description: 'Skip an identical message to the same recipient within this many minutes. 0 = off.',
      section: 'OPTIONS',
    },
    {
      key: 'mediaPath',
      label: 'Media file path',
      type: 'template-textarea',
      placeholder: '/path/to/file.png or {{input.filePath}}',
      description: 'Local file to send as an attachment. Requires the WhatsApp worker.',
      section: 'MEDIA',
      advancedOnly: true,
    },
    {
      key: 'mediaUrl',
      label: 'Media URL',
      type: 'template-textarea',
      placeholder: 'https://…/image.png',
      description: 'URL to download and send as an attachment.',
      section: 'MEDIA',
      advancedOnly: true,
    },
    {
      key: 'caption',
      label: 'Media caption',
      type: 'template-textarea',
      placeholder: 'Optional caption',
      description: 'Caption for the attachment. Falls back to the message text.',
      section: 'MEDIA',
      advancedOnly: true,
    },
  ],
  llmDescription: `Send a WhatsApp message to a phone number. Use when a workflow needs to notify someone via WhatsApp.

The \`to\` field must be an E.164 phone number (e.g. "+447700900123"). \`to\`, \`message\`, \`caption\`, \`mediaPath\` and \`mediaUrl\` all support \`{{input.field}}\` templates.

Behaviour:
- \`formatMarkdown\` (default true) converts Markdown to WhatsApp formatting (**bold** → *bold*, ## headings → bold lines, [text](url) → "text (url)", "- " bullets → "•").
- Messages longer than 4096 chars are split on paragraph boundaries into up to \`maxChunks\` (default 3) sequential sends; the overflow is truncated.
- Set \`mediaPath\` (local file) or \`mediaUrl\` (downloaded) to send an attachment with an optional \`caption\`.
- \`suppressDuplicateWindowMins\` is a LAST-LINE-OF-DEFENCE idempotency guard: it hashes the resolved message and skips re-sending an identical message to the same recipient within the window (output \`{ sent:false, suppressed:true }\`). For recurring "digest / news" workflows the primary pattern is still a \`dedupe\` node upstream that filters already-seen items — use both.

Downstream nodes read \`input.sent\`, \`input.messageId\`, \`input.messageIds\` (one per chunk), \`input.chunks\`, or \`input.error\`.

Requires an active WhatsApp connection (the WhatsApp worker).`,
  llmExamples: [
    { to: '+447700900123', message: 'Daily report: {{input.summary}}' },
    { to: '{{input.phone}}', message: '## Headlines\n{{input.digest}}', formatMarkdown: true },
    { to: '+447700900123', message: 'Daily news for {{today}}', suppressDuplicateWindowMins: 1440 },
    { to: '+447700900123', mediaUrl: '{{input.chartUrl}}', caption: 'This week: {{input.title}}' },
  ],
};
