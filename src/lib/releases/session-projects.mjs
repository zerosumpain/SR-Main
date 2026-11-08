// Which project a Claude Code session belongs to, when its folder can no
// longer say so itself.
//
// The transcript parser credits a session to the repository its dominant
// folder checks out. A worktree is deleted after merge, and a folder like
// `casebook-lanes/` or `docker/` is not a checkout at all, so the parser falls
// back to these name rules. The /releases cost band applies the SAME rules when
// it reads stored rows, because rows ingested before a rule existed keep the
// raw folder name and their transcripts are often gone from disk.
//
// Shared by scripts/claude-changelog/parse-transcript.mjs (plain node) and
// $lib/releases/spend*.ts, so it stays dependency-free JavaScript.

export const SITE_PROJECT = 'strange-rambling-svelte';
export const INFRA_PROJECT = 'infrastructure';

/**
 * First matching prefix wins. Slugs are each repo's lowercased name.
 * @type {Array<[RegExp, string]>}
 */
export const FOLDER_PROJECT = [
  [/^(sr-main|wt-|sr-shipped|sr-news|sr-deploy|sr-build|sr-jkai-grounding|jkai-overhaul|sr-daydream|sr-briefing|sr-chat|sr-security|sr-project-audit|sr-workflow-ownership|site-modularity|site-tech-debt|strange_rambling_svelte)/i, SITE_PROJECT],
  [/^sr-health/i, 'sr-health'],
  [/^sr-jkai/i, 'sr-jkai-core'],
  [/^sr-workflows?/i, 'sr-workflows'],
  [/^sr-drive/i, 'sr-drive'],
  [/^sr-infra/i, 'sr-infra'],
  [/^sr-hex/i, 'sr-hex'],
  [/^sr-policy-engine/i, 'sr-policy-engine'],
  [/^sr-policy/i, 'sr-policy-analysis'],
  [/^sr-apple/i, 'SR-AppleApp'],
  [/^sr-dataspine/i, 'sr-dataspine'],
  [/^sr-spine/i, 'sr-spine'],
  [/^sr-docs/i, 'sr-docs'],
  [/^sr-tv/i, 'sr-tv'],
  [/^(wildmind|wm-)/i, 'wildmind'],
  [/^casebook/i, 'casebook'],
  [/^policy-lab/i, 'policy-lab'],
  [/^(policy-red-team|prt-)/i, 'policy-red-team'],
  [/^(local-plan-navigator|lpn-)/i, 'local-plan-navigator'],
  [/^supply-chain/i, 'supply-chain-monitor'],
  [/^marbler/i, 'marbler'],
  [/^beds/i, 'beds_analysis'],
  // Not repositories: the servers, their compose stacks, runners and scripts.
  [/^(docker|bin|porkserv|homeserv|actions-runner|backups|gate|stage)(-|$)/i, INFRA_PROJECT],
];

/**
 * A stored or folder-derived project name, mapped through the rules.
 * @param {unknown} name
 * @returns {string}
 */
export function canonicalProject(name) {
  const value = String(name ?? '').trim();
  if (!value) return 'unknown';
  for (const [re, slug] of FOLDER_PROJECT) if (re.test(value)) return slug;
  return value;
}

/**
 * Display names for the cost band. Anything missing shows its slug.
 * @type {Record<string, string>}
 */
export const PROJECT_LABEL = {
  'sr-health': 'SR-Health',
  'sr-jkai-core': 'SR-Jkai-Core',
  'sr-workflows': 'SR-Workflows',
  'sr-drive': 'SR-Drive',
  'sr-infra': 'SR-Infra',
  'sr-hex': 'SR-Hex',
  'sr-policy-engine': 'Policy Engine',
  'sr-policy-analysis': 'Policy Analysis',
  'sr-dfe-data-strategy': 'DfE Data Strategy',
  'sr-data-standard-designer': 'Data Standard Designer',
  'sr-dataspine': 'Data Spine',
  'sr-spine': 'The Spine',
  'sr-docs': 'SR docs library',
  'sr-tv': 'SR-TV',
  'SR-AppleApp': 'iPhone app',
  wildmind: 'Wildmind',
  casebook: 'Casebook',
  marbler: 'Marbler',
  'policy-lab': 'Policy Lab',
  'policy-red-team': 'Policy Red Team',
  'local-plan-navigator': 'Local Plan Navigator',
  'supply-chain-monitor': 'Supply Chain Monitor',
  'scs-earnings': 'SCS earnings',
  beds_analysis: 'Bedfordshire analysis',
  archetype: 'Archetype',
  'brass-and-rails': 'Brass & Rails',
  whitehall: 'Whitehall',
  'terminal-descent': 'Terminal Descent',
  'marble-run': 'Marble run',
  'broads-pilot': 'Broads pilot',
  'offline-maps': 'Offline maps',
  'homeserv-infra': 'homeserv infrastructure',
  'strange-rambling-legacy': 'Original site',
  [INFRA_PROJECT]: 'Servers & ops',
};
