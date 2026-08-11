// src/lib/workflows/site-tools/keyword-classifier.ts

const TOOLSET_PATTERNS: Array<{ toolset: string; pattern: RegExp }> = [
  { toolset: 'health', pattern: /sleep|heart|readiness|train(?:ing)?|health|hrv|recovery|workout|exercise|strain|\brun\b|\bruns\b|cycling|fitness|activity|strava/i },
  { toolset: 'blog', pattern: /blog|post|draft|publish|article|write\s+about/i },
  { toolset: 'builds', pattern: /build|app|deploy|publish\s*app|scaffold|create\s*app|publish\s+(?:this|the|a|my|it)?\s*(?:page|report|analysis|dashboard)/i },
  { toolset: 'research', pattern: /research|investigate|deep\s*dive|look\s+into|find\s+out/i },
  { toolset: 'workflows', pattern: /workflow|automat|schedule|trigger|cron/i },
  { toolset: 'home', pattern: /light|temperature|thermostat|speaker|room|house|home|blind|curtain|switch(?:es)?|heat(?:ing)?|sensor|door|camera|ring|alexa|tado|hue|media\s*player|tv\b|bravia/i },
  { toolset: 'gmail', pattern: /gmail|\bemails?\b|\be-?mails?\b|inbox|reply\s+to\s+(?:the\s+)?(?:email|message|thread)/i },
  { toolset: 'apple-calendar', pattern: /\b(?:apple|icloud|i\s*cloud)\s+calendar\b|\bcalendar\s+(?:event|appointment|meeting)\b|\b(?:add|create|put|schedule)\b.*\b(?:calendar|appointment|meeting|event)\b|\b(?:what(?:'s| is)|show|list|check)\b.*\b(?:my\s+)?calendar\b/i },
  { toolset: 'node-builder', pattern: /node\s*builder|new\s+node\s+type|build\s+(?:a\s+)?(?:new\s+)?(?:canvas\s+)?node|create\s+(?:a\s+)?node\s+type/i },
  { toolset: 'whatsapp', pattern: /whatsapp|message|text\s+me|send\s*(me\s+)?a?\s*msg|notify\s+me/i },
  { toolset: 'diagnostics', pattern: /\blog\b|logs|scheduler|system\s+(status|health|check)|debug|diagnos|service|journal/i },
  { toolset: 'memory', pattern: /remember|forget|do you know|what do you know|recall|you told me|i told you|last time/i },
  { toolset: 'media', pattern: /image|photo|picture|draw|render|illustrate|sketch|audio|voice|speak|say\s+out\s+loud|read\s+(?:this|aloud)|document|report|csv|save\s+as|export|write\s+(?:a\s+)?file|write\s+to\s+file|generate\s+(?:an\s+)?image|make\s+(?:an\s+)?image|generate\s+audio|make\s+(?:a\s+)?voice/i },
  { toolset: 'files', pattern: /\bfiles?\b|file\s*store|uploaded|attachment|\bpdf\b|\bdocx?\b|\bxlsx?\b|spreadsheet|transcribe|extract\s+(?:text|content)|read\s+(?:the\s+)?(?:file|pdf|doc|attachment|upload)/i },
  { toolset: 'web', pattern: /\bhttps?:\/\/\S+|\b(?:fetch|read|open|browse|visit|scrape|grab)\s+(?:this|that|the)?\s*(?:url|link|page|website|site)\b/i },
  { toolset: 'scraper', pattern: /\bscrap(?:e|er|ing)\b|\bstealth\b|\bplaywright\b|\bjob\s*board|\blistings?\b|\bprices?\s+from\b|\bschedules?\s+from\b|\bcookie\s*wall|civilservicejobs/i },
  { toolset: 'site-signals', pattern: /who(?:'?s| is)\s+home|family\s+presence|are\s+we\s+home|is\s+(?:anyone|any\s?one|katie|fintan|jemima|rory)\s+home|live\s+walk|on\s+a\s+(?:walk|ride)|policy[-\s]?engine|tracking\s+indicators?|dfe\s+(?:indicators?|tracking)|on[-\s]?track|off[-\s]?track/i },
  { toolset: 'datastore', pattern: /\bdatabase\b|\bdataset\b|\brecords?\b|\btables?\b|\bcollections?\b|store\s+this\s+data|save\s+this\s+(?:record|data|dataset|table)|remember\s+this\s+(?:data|dataset|table|record)|query\s+(?:the\s+)?(?:datastore|records?|dataset|collection)/i },
  { toolset: 'apis', pattern: /\bapis?\b|data\s+sources?|live\s+data|current\s+(?:figures?|stats?|numbers?|data|values?)|latest\s+(?:figures?|stats?|numbers?|data)|external\s+data|fetch\s+(?:live|current)\s+data/i },
  { toolset: 'knowledge', pattern: /@?knowledge|search\s+(?:everything|all\s+(?:my|the)\s+(?:stores?|sources?|knowledge))|across\s+(?:my\s+)?(?:files,?\s*research|everything)|unified\s+(?:search|recall)/i },
  { toolset: 'agents', pattern: /\bdelegate\b|\bagent\s+team\b|\bspecialists?\b|ask\s+the\s+(?:researcher|analyst|writer|reviewer)|team\s+memory/i },
  { toolset: 'monitors', pattern: /\bmonitors?\b|watch\s+(?:for|this|that|the)|tell\s+me\s+when|alert\s+me\s+(?:when|if)|keep\s+an\s+eye\s+on/i },
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
