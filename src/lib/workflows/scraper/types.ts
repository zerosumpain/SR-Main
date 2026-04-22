export interface ExtractRule {
  /** Output field name */
  field: string;
  /** CSS selector */
  selector: string;
  /** What to pull from the matched node. Default 'text'. */
  attr?: 'text' | 'html' | 'href' | 'src' | string;
  /** If true, return all matches as an array. If false, return first match as a scalar. */
  multi?: boolean;
  /** Optional post-processing: trim (default true), regex match group 1 */
  trim?: boolean;
  regex?: string;
}

export interface ScrapeJob {
  /** Starting URL */
  url: string;
  /** Profile name — maps to ~/.openclaw/scraper-profiles/<profile>/ inside the sandbox */
  profile: string;
  /** Wait condition before extracting */
  waitFor: { type: 'networkidle' } | { type: 'selector'; selector: string; timeoutMs?: number } | { type: 'timeout'; ms: number };
  /** Extraction rules — runs once per page */
  extract: ExtractRule[];
  /** Optional pagination */
  pagination?: {
    type: 'next-link';
    nextSelector: string;
    maxPages: number;
  } | {
    type: 'url-template';
    /** e.g. "https://...&page={n}" */
    template: string;
    start: number;
    maxPages: number;
  };
  /** Credentials — looked up via scraper_credentials by id (resolved in Node, passed as a minimal cookie jar or script snippet) */
  credentialId?: number;
  /** Human-like pacing: min/max delay between actions (ms). Default 800–2500. */
  pacing?: { minMs: number; maxMs: number };
  /** Whether to run robots.txt check before scraping. Default true. */
  respectRobots?: boolean;
  /** Optional screenshot on failure. Default true. */
  screenshotOnFailure?: boolean;
  /** Optional viewport override. Default randomised. */
  viewport?: { width: number; height: number };
  /** Optional user-agent override. Default: a real recent Chrome UA. */
  userAgent?: string;
}

export interface ExtractedPage {
  url: string;
  fields: Record<string, string | string[]>;
  /** Full page HTML, only when the job sets includeHtml */
  html?: string;
  /** Text content */
  text?: string;
}

export interface ScrapeResult {
  success: boolean;
  pages: ExtractedPage[];
  error?: string;
  screenshotPathInSandbox?: string;
  robotsBlocked?: boolean;
  runLogId?: number;
}
