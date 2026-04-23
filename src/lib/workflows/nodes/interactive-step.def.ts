import type { NodeDefinition } from '../types';

export const interactiveStepDef: NodeDefinition = {
  type: 'interactive-step',
  category: 'control',
  label: 'Interactive Step',
  description: 'Pauses the workflow for a human to solve a CAPTCHA, log in, or confirm data. Resumes after the human completes it from the canvas.',
  defaultConfig: {
    mode: 'vnc',
    profile: '',
    url: '',
    prompt: 'Please complete the required action',
    fields: [],
    timeoutMinutes: 60,
  },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'object', label: 'Completion' }],
  configSchema: {
    type: 'object',
    required: ['mode', 'prompt'],
    properties: {
      mode: { type: 'string', enum: ['vnc', 'confirm', 'both'], description: 'What kind of human interaction' },
      profile: { type: 'string', description: 'Scraper profile name (for vnc / both)' },
      url: { type: 'string', description: 'URL to open in the browser (for vnc / both; supports {{input.x}} templates)' },
      prompt: { type: 'string', description: 'Instruction shown to the human' },
      fields: {
        type: 'array',
        description: 'Form fields shown alongside the VNC (for confirm / both)',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: { type: 'string', enum: ['text', 'textarea', 'number', 'boolean'] },
            label: { type: 'string' },
            defaultValueTemplate: { type: 'string' },
          },
          required: ['name', 'type', 'label'],
        },
      },
      timeoutMinutes: { type: 'number', description: 'Auto-cancel after N minutes (default 60)' },
    },
  },
  llmDescription: 'Pauses the workflow for a human to solve a CAPTCHA, log in, or confirm data. Mode="vnc" opens a live headed Chromium in a browser modal pointing at url. Mode="confirm" shows a form with fields. Mode="both" shows both. For CAPTCHA/login setup: use mode="vnc", match the `profile` to the downstream `stealth-scrape` node\'s profile, and set the url to the target site\'s search/landing URL. For data confirmation checkpoints: use mode="confirm" with the appropriate fields. The node outputs {completed, completedAt, formValues, durationMs} — access formValues from downstream nodes via templates like {{nodes.step1.output.formValues.myField}}. Place this node UPSTREAM of stealth-scrape when the target domain has bot-detection or login requirements — the human seeds the profile once and headless runs reuse the cookies.',
  llmExamples: [
    {
      mode: 'vnc',
      profile: 'civilservicejobs-gov-uk',
      url: 'https://www.civilservicejobs.service.gov.uk/csr/jobs.cgi',
      prompt: 'Please complete any CAPTCHA or cookie consent, then click Search so the session is seeded.',
    },
    {
      mode: 'confirm',
      prompt: 'Review the extracted job listings before they are emailed.',
      fields: [
        { name: 'approved', type: 'boolean', label: 'Approve and send?' },
        { name: 'notes', type: 'textarea', label: 'Optional notes to include' },
      ],
    },
    {
      mode: 'both',
      profile: 'linkedin',
      url: 'https://www.linkedin.com/login',
      prompt: 'Log in to LinkedIn, then fill in the search keyword below.',
      fields: [
        { name: 'searchKeyword', type: 'text', label: 'Job search keyword' },
      ],
    },
  ],
  basicConfig: [
    {
      key: 'mode',
      label: 'Mode',
      type: 'dropdown',
      description: 'What kind of human interaction to show.',
      options: [
        { value: 'vnc', label: 'VNC — live headed browser' },
        { value: 'confirm', label: 'Confirm — form fields only' },
        { value: 'both', label: 'Both — browser + form fields' },
      ],
    },
    {
      key: 'prompt',
      label: 'Prompt',
      type: 'template-textarea',
      placeholder: 'Please complete any CAPTCHA or log in, then click Continue.',
      description: 'Instruction shown to the human in the modal.',
    },
    {
      key: 'profile',
      label: 'Profile Name',
      type: 'text',
      placeholder: 'example-com',
      description: 'Must match the downstream stealth-scrape profile so the seeded cookies are shared.',
      visibleWhen: { key: 'mode', in: ['vnc', 'both'] },
    },
    {
      key: 'url',
      label: 'URL to Open',
      type: 'template-textarea',
      placeholder: 'https://example.com',
      description: 'URL to load in the headed browser. Use the target site\'s landing/search page.',
      visibleWhen: { key: 'mode', in: ['vnc', 'both'] },
    },
    {
      key: 'fields',
      label: 'Form Fields',
      type: 'code',
      description: 'Array of {name, type, label, defaultValueTemplate?} for the confirm form.',
      visibleWhen: { key: 'mode', in: ['confirm', 'both'] },
    },
  ],
};
