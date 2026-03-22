/**
 * Detect which sandbox components a code block uses based on imports, commands, and patterns.
 */

interface DetectedComponent {
  component: string;
  category: 'runtime' | 'python-pkg' | 'npm-global' | 'system-tool';
}

const PYTHON_IMPORT_PATTERNS: Array<{ pattern: RegExp; component: string }> = [
  { pattern: /\bimport\s+pandas\b|\bfrom\s+pandas\b/, component: 'pandas' },
  { pattern: /\bimport\s+numpy\b|\bfrom\s+numpy\b/, component: 'numpy' },
  { pattern: /\bimport\s+matplotlib\b|\bfrom\s+matplotlib\b/, component: 'matplotlib' },
  { pattern: /\bimport\s+requests\b|\bfrom\s+requests\b/, component: 'requests' },
  { pattern: /\bimport\s+httpx\b|\bfrom\s+httpx\b/, component: 'httpx' },
  { pattern: /\bimport\s+bs4\b|\bfrom\s+bs4\b|\bBeautifulSoup\b/, component: 'beautifulsoup4' },
  { pattern: /\bimport\s+lxml\b|\bfrom\s+lxml\b/, component: 'lxml' },
  { pattern: /\bimport\s+yaml\b|\bfrom\s+yaml\b/, component: 'PyYAML' },
  { pattern: /\bimport\s+playwright\b|\bfrom\s+playwright\b/, component: 'playwright' },
  { pattern: /\bimport\s+json\b/, component: 'json (stdlib)' },
  { pattern: /\bimport\s+csv\b/, component: 'csv (stdlib)' },
  { pattern: /\bimport\s+re\b/, component: 're (stdlib)' },
  { pattern: /\bimport\s+os\b|\bfrom\s+os\b/, component: 'os (stdlib)' },
  { pattern: /\bimport\s+sys\b/, component: 'sys (stdlib)' },
  { pattern: /\bimport\s+pathlib\b|\bfrom\s+pathlib\b/, component: 'pathlib (stdlib)' },
  { pattern: /\bimport\s+subprocess\b/, component: 'subprocess (stdlib)' },
];

const COMMAND_PATTERNS: Array<{ pattern: RegExp; component: string; category: DetectedComponent['category'] }> = [
  { pattern: /\bcurl\s/, component: 'curl', category: 'system-tool' },
  { pattern: /\bwget\s/, component: 'wget', category: 'system-tool' },
  { pattern: /\bgit\s/, component: 'git', category: 'system-tool' },
  { pattern: /\bjq\s/, component: 'jq', category: 'system-tool' },
  { pattern: /\bpip\s+install\b/, component: 'pip', category: 'runtime' },
  { pattern: /\bnpm\s+install\b|\bnpx\s/, component: 'npm', category: 'runtime' },
  { pattern: /\btsc\b/, component: 'TypeScript', category: 'npm-global' },
  { pattern: /\btsx\b/, component: 'tsx', category: 'npm-global' },
];

export function detectComponents(lang: string, code: string): DetectedComponent[] {
  const found = new Map<string, DetectedComponent>();

  // Detect runtime from language
  if (['python', 'python3'].includes(lang)) {
    found.set('Python', { component: 'Python', category: 'runtime' });
  } else if (['javascript', 'typescript', 'node'].includes(lang)) {
    found.set('Node.js', { component: 'Node.js', category: 'runtime' });
  } else if (['bash', 'sh'].includes(lang)) {
    found.set('bash', { component: 'bash', category: 'runtime' });
  }

  // Python imports
  if (['python', 'python3'].includes(lang)) {
    for (const { pattern, component } of PYTHON_IMPORT_PATTERNS) {
      if (pattern.test(code)) {
        found.set(component, { component, category: 'python-pkg' });
      }
    }
  }

  // Command patterns (any language, since bash blocks can call anything)
  for (const { pattern, component, category } of COMMAND_PATTERNS) {
    if (pattern.test(code)) {
      found.set(component, { component, category });
    }
  }

  return Array.from(found.values());
}
