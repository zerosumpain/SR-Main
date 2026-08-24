// src/lib/workflows/site-tools/keyword-classifier.ts

/** Slide-deck work spans two toolsets — `decks` holds the build/read/update
 *  tools and `presentations` the vocabulary helper that describes the spec they
 *  take — so one trigger has to load both or the model gets the builders with
 *  no way to look up what it may put in the spec. */
const DECK_PATTERN = /\bdecks?\b|\bslides?\b|\bpresentations?\b|\bpitch\b|\bkeynote\b|\bpowerpoint\b|\bppt\b/i;

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
  // Money words load `apis` because the answer to "what was that payment"
  // lives on the payment RAIL — `api_integration_call('paypal-transactions')`,
  // or TrueLayer for bank and card — not in a mailbox. Nothing here matched
  // before, so on 2026-08-16 "what did I pay for through paypal" pre-loaded
  // gmail (which matches `\bemails?\b`), spent fourteen searches over three
  // turns, answered from a 2018 receipt, and was wrong. The recorded
  // integration answered it in one call once asked directly.
  //
  // `\bpay\b` is deliberately absent — "pay attention", "pay off", "it pays
  // to" are ordinary English and would load the toolset on prose. The nouns
  // and `paid` carry the intent without that.
  { toolset: 'apis', pattern: /\bapis?\b|data\s+sources?|live\s+data|current\s+(?:figures?|stats?|numbers?|data|values?)|latest\s+(?:figures?|stats?|numbers?|data)|external\s+data|fetch\s+(?:live|current)\s+data|\bpaypal\b|\btruelayer\b|\bopen\s+banking\b|\btransactions?\b|\breceipts?\b|\binvoices?\b|\brefunds?\b|\bsubscriptions?\b|\bdirect\s+debits?\b|\bstatements?\b|\bbilling\b|\bpayments?\b|\bpaid\s+(?:for|to|by|via|through)\b|\bcharged?\s+(?:me|to|for)\b/i },
  { toolset: 'knowledge', pattern: /@?knowledge|search\s+(?:everything|all\s+(?:my|the)\s+(?:stores?|sources?|knowledge))|across\s+(?:my\s+)?(?:files,?\s*research|everything)|unified\s+(?:search|recall)/i },
  { toolset: 'discovery', pattern: /\bwhat (?:tools?|can you)\b|\bis there a tool\b|\bskill\b|\bplaybook\b|\bhow do i\b.*\bhere\b/i },
  { toolset: 'browser', pattern: /\bbrowser\b|\bconsole (?:log|error)s?\b|\bopen the (?:page|site)\b|\brender(?:s|ed|ing)?\b.*\bpage\b|\bclick\b|\bscreenshot\b|\bjavascript error/i },
  { toolset: 'recall', pattern: /\bwhat did (?:we|you|i) (?:say|decide|discuss)\b|\blast time\b|\bearlier (?:conversation|chat)\b|\bremember that\b|\bdo you remember\b|\bpreviously\b/i },
  { toolset: 'agents', pattern: /\bdelegate\b|\bagent\s+team\b|\bspecialists?\b|ask\s+the\s+(?:researcher|analyst|writer|reviewer)|team\s+memory/i },
  { toolset: 'monitors', pattern: /\bmonitors?\b|watch\s+(?:for|this|that|the)|tell\s+me\s+when|alert\s+me\s+(?:when|if)|keep\s+an\s+eye\s+on/i },
  // The entity graph. Distinct from `knowledge` above: that one loads
  // knowledge_search (a flat ranked recall across every store), this one loads
  // the graph walkers — intel_find / intel_path / intel_neighbourhood /
  // intel_insights / intel_unlikely_relations. Asking about "the knowledge
  // graph" matches both, which is intended: you want the recall AND the walk.
  // Without an entry here the whole toolset was unreachable unless the model
  // thought to call activate_toolset('intel-graph') off its own bat.
  { toolset: 'intel-graph', pattern: /knowledge\s*graph|entity\s*graph|\bentities\b|\bdossiers?\b|connect(?:ed|ion)s?\s+(?:between|to)|\brelationships?\b|\bpath\b[^.]*\bbetween\b|\bunlikely\s+(?:relation|connection)/i },
  // The BUILD-history graph, distinct from the entity graph above: that one is
  // about the world, this one is about this codebase. Deliberately keyed on
  // repo/change language ("why does X work that way", "has this broken
  // before", a bare src/... path) rather than on the word "graph", which
  // belongs to intel. Without a row here the toolset is unreachable unless the
  // model thinks to call activate_toolset('codegraph') unprompted — the exact
  // reason intel-graph needed its own entry.
  {
    toolset: 'codegraph',
    pattern:
      /\bcodegraph\b|build\s+history|past\s+builds?|(?:why|how)\s+(?:is|does|do|did)\s+.{0,40}\b(?:work|done|built|written)\b|has\s+(?:this|that|it)\s+(?:ever\s+)?(?:broken|failed)\s+before|previous(?:ly)?\s+(?:fixed|broke|failed)|what\s+changed\s+.{0,30}\b(?:last\s+time|before)\b|\b(?:src|scripts|packages)\/[\w.\-/]+\.(?:ts|svelte|mjs|js|sql)\b|precedents?\s+for/i,
  },
  { toolset: 'decks', pattern: DECK_PATTERN },
  { toolset: 'presentations', pattern: DECK_PATTERN },
  { toolset: 'capabilities', pattern: /what\s+can\s+you\s+do|what\s+are\s+you\s+(?:able|capable)|your\s+capabilit|\bcapabilit(?:y|ies)\b/i },
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
