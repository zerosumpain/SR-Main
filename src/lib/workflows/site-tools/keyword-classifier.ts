// src/lib/workflows/site-tools/keyword-classifier.ts

const TOOLSET_PATTERNS: Array<{ toolset: string; pattern: RegExp }> = [
  { toolset: 'health', pattern: /sleep|heart|readiness|train(?:ing)?|health|hrv|recovery|workout|exercise|strain|\brun\b|\bruns\b|cycling|fitness|activity|strava/i },
  { toolset: 'blog', pattern: /blog|post|draft|publish|article|write\s+about/i },
  { toolset: 'builds', pattern: /build|app|deploy|publish\s*app|scaffold|create\s*app/i },
  { toolset: 'research', pattern: /research|investigate|deep\s*dive|look\s+into|find\s+out/i },
  { toolset: 'workflows', pattern: /workflow|automat|schedule|trigger|cron/i },
  { toolset: 'home', pattern: /light|temperature|thermostat|speaker|room|house|home|blind|curtain|switch(?:es)?|heat(?:ing)?|sensor|door|camera|ring|alexa|tado|hue|media\s*player|tv\b|bravia/i },
  { toolset: 'whatsapp', pattern: /whatsapp|message|text\s+me|send\s*(me\s+)?a?\s*msg|notify\s+me/i },
  { toolset: 'diagnostics', pattern: /\blog\b|logs|scheduler|system\s+(status|health|check)|debug|diagnos|service|journal/i },
  { toolset: 'memory', pattern: /remember|forget|do you know|what do you know|recall|you told me|i told you|last time/i },
];

export function inferToolsets(message: string): string[] {
  const matched: string[] = [];
  for (const { toolset, pattern } of TOOLSET_PATTERNS) {
    if (pattern.test(message)) {
      matched.push(toolset);
    }
  }
  return matched;
}
