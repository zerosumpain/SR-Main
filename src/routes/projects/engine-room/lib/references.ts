// references.ts — the technologies and specifications this study refers to, shown in the
// layout footer. The other field studies cite external evidence; this one is about a system
// I built, so the honest equivalent is the standards and tools it stands on.

export interface Reference { name: string; url: string; what: string }

export const REFERENCES: Reference[] = [
  { name: 'SvelteKit', url: 'https://svelte.dev/docs/kit', what: 'the application framework — routing, server load functions, streaming responses' },
  { name: 'Svelte 5 runes', url: 'https://svelte.dev/docs/svelte/what-are-runes', what: 'the reactivity model every interactive on this page is built with' },
  { name: 'PostgreSQL', url: 'https://www.postgresql.org/docs/16/index.html', what: 'the single database behind every subsystem described here' },
  { name: 'Drizzle ORM', url: 'https://orm.drizzle.team/docs/overview', what: 'typed schema and query builder over Postgres' },
  { name: 'pgvector', url: 'https://github.com/pgvector/pgvector', what: 'vector similarity search inside Postgres — the retrieval index' },
  { name: 'OpenRouter', url: 'https://openrouter.ai/docs', what: 'the single gateway every language-model call passes through' },
  { name: 'Prompt caching', url: 'https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching', what: 'cache breakpoints on a long prefix — the single largest cost lever in the system' },
  { name: 'Model Context Protocol', url: 'https://modelcontextprotocol.io/', what: 'the open protocol that lets external assistants call this site’s tools' },
  { name: 'JSON-RPC 2.0', url: 'https://www.jsonrpc.org/specification', what: 'the wire format MCP speaks' },
  { name: 'Server-Sent Events', url: 'https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events', what: 'how tokens, tool steps and status frames stream to the browser' },
  { name: 'Okapi BM25', url: 'https://en.wikipedia.org/wiki/Okapi_BM25', what: 'the lexical ranking function behind this page’s own Ask dock' },
  { name: 'Auth.js', url: 'https://authjs.dev/', what: 'OAuth sign-in and session handling' },
  { name: 'GitHub Actions', url: 'https://docs.github.com/en/actions', what: 'the gate-then-deploy pipeline that is the only route to production' },
  { name: 'Docker', url: 'https://docs.docker.com/', what: 'the sandbox that AI-authored build code executes inside' },
  { name: 'Playwright', url: 'https://playwright.dev/', what: 'browser automation behind the scraping nodes and the visual checks' },
  { name: 'Cloudflare Tunnel', url: 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/', what: 'how the origin is reachable without an exposed inbound port' },
  { name: 'WebDAV (RFC 4918)', url: 'https://datatracker.ietf.org/doc/html/rfc4918', what: 'the protocol that mounts the document store as a network drive' },
  { name: 'restic', url: 'https://restic.readthedocs.io/', what: 'encrypted, deduplicated off-site backup' },
  { name: 'd3-force', url: 'https://d3js.org/d3-force', what: 'the force simulation that lays out the knowledge graph in 2-D and 3-D' },
  { name: 'OWASP SSRF guidance', url: 'https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html', what: 'the class of attack the outbound-fetch guard defends against' },
];
