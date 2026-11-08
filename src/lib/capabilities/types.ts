/**
 * The capability manifest: one list of what jkai can do, what is in preview,
 * and what is not built yet (overhaul plan 2026-10-28, point 7, slice 7b).
 *
 * A PURE, tool-free leaf. Nothing under `$lib/capabilities` imports a tool
 * module, the registry or the database, so the catalogue route, the native
 * app and the drift test can all read it without pulling 175 tool modules in
 * behind it (`registry-closure.test.ts`). The registry is tied to it from the
 * other side: `manifest.test.ts` loads the registry and fails when the two
 * disagree.
 *
 * The words are the ones jkai says: 'live' (use it, or link to it), 'preview'
 * (use it and say so), 'planned' (not built yet: say so, link the page that
 * does it today, and never call it).
 */

export const CAPABILITY_STATUSES = ['live', 'preview', 'planned'] as const;
export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];

/** Which process runs a capability's tools. Core refuses a toolset whose host it does not know. */
export const CAPABILITY_HOSTS = ['main', 'workflows'] as const;
export type CapabilityHost = (typeof CAPABILITY_HOSTS)[number];

/**
 * The context router's domains (SR-Jkai-Core `grounding/context-route.ts`
 * CONTEXT_DOMAINS), restated so this leaf does not import Core's vocabulary.
 * A row's `domain` replaces Core's hand-kept DOMAIN_TOOLSETS.
 */
export const CAPABILITY_DOMAINS = ['travel', 'health', 'finance', 'work', 'home', 'calendar', 'people', 'projects', 'coding', 'graph'] as const;
export type CapabilityDomain = (typeof CAPABILITY_DOMAINS)[number];

/**
 * The reserved toolset prefix for custom tools loaded from `custom_tools`.
 * No built-in toolset may start with it (`manifest.test.ts`), so a custom
 * tool can never land in, or shadow, a built-in toolset.
 */
export const CUSTOM_TOOLSET_PREFIX = 'custom:';

export interface CapabilityEntry {
  /** Stable kebab id, e.g. 'trips' or 'family'. */
  id: string;
  /** What John would call it. */
  title: string;
  /** One release-stable sentence: no dates, no counts, no "currently". */
  blurb: string;
  /** The SR-Infra apps.json key of the app it belongs to. */
  app: string;
  /** The repository that owns the code. */
  repo: string;
  status: CapabilityStatus;
  /** Toolsets this row describes. A planned row has none. */
  toolsets: string[];
  /**
   * Tool names. For a live or preview row, every name must be registered and
   * every tool in its toolsets must be named here. For a planned row, the
   * names the capability WOULD have, none of which may exist yet ("flip it
   * to live in the same PR").
   */
  tools: string[];
  /** Which process runs the tools (default 'main'). */
  host?: CapabilityHost;
  /** Tool names offered on every owner turn, by name (Core's ALWAYS_ON_TOOL_NAMES). */
  alwaysOn?: string[];
  /** Case-insensitive regex sources that load the row's toolsets (Core's keyword rows). */
  keywords?: string[];
  /** The context-router domain that loads the row's toolsets (Core's DOMAIN_TOOLSETS). */
  domain?: CapabilityDomain;
  /** Pages that do this today, as site paths ('/trips'). The first is the link jkai gives. */
  pages: string[];
  /** The iPhone app screen that does it, if any. */
  native?: string;
  /** Members may reach it: only read-only rows, and only tools on the closed member list. */
  memberSafe: boolean;
  /** One plain sentence on what is missing or what to know. No dates. */
  notes?: string;
}
