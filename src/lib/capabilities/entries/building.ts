import type { CapabilityEntry } from '../types';

// Building things: app builds, commissioned site builds and the blog.
// One row per registered toolset; `manifest.test.ts` keeps rows and registry in step.

export const BUILDING_ENTRIES: CapabilityEntry[] = [
  {
    id: 'builds',
    title: 'App builds',
    blurb: 'App builds — the sandbox builder for self-contained apps (create, monitor, control, inspect, publish to /projects)',
    app: 'main',
    repo: 'SR-Main',
    status: 'live',
    toolsets: ['builds'],
    tools: ['build_create', 'build_list', 'build_control', 'build_inspect', 'build_get_iteration', 'build_get_plan', 'build_get_logs', 'build_list_files', 'build_read_file', 'build_tweak', 'build_write_file', 'register_chat_build', 'build_delete', 'studio_build', 'publish_page', 'request_change'],
    keywords: [String.raw`build|app|deploy|publish\s*app|scaffold|create\s*app|publish\s+(?:this|the|a|my|it)?\s*(?:page|report|analysis|dashboard)`],
    pages: ['/jkai/builds'],
    memberSafe: false,
  },
  {
    id: 'develop',
    title: 'Commissioning a site build',
    blurb: 'Commission a build of the site itself (SR-Main) from web chat — quote the card (develop_quote), commission it (develop_commission, confirmed, browser only) and follow it (develop_status). Stops at a preview or a draft pull request',
    app: 'main',
    repo: 'SR-Main',
    status: 'live',
    toolsets: ['develop'],
    tools: ['develop_quote', 'develop_commission', 'develop_status'],
    keywords: [String.raw`\bcommission(?:ed|ing)?\s+(?:a\s+|the\s+|this\s+)?(?:build|feature|change)|\b(?:jkai\/)?develop(?:ment)?\s+(?:delivery|deliveries|feature|status)|\/jkai\/develop|\bdeliver(?:y|ies)\b.*\b(?:stage|status|pr|pull\s+request)|\b(?:change|feature|fix)\s+(?:to|on|for)\s+(?:the\s+)?(?:site|strangeramblings)|\brequest_change\b`],
    pages: ['/jkai/develop'],
    memberSafe: false,
  },
  {
    id: 'blog',
    title: 'The blog',
    blurb: 'Blog post management — list, create, update, publish/unpublish',
    app: 'main',
    repo: 'SR-Main',
    status: 'live',
    toolsets: ['blog'],
    tools: ['blog_list', 'blog_get', 'blog_create', 'blog_update', 'blog_unpublish'],
    keywords: [String.raw`blog|post|draft|publish|article|write\s+about`],
    pages: ['/blog'],
    memberSafe: false,
  },
];
