// Video source parsing — pure, shared by the registry (validation), the
// Video block component (rendering) and tests. Decks accept exactly three
// shapes: a site-relative video file, a YouTube URL (rendered through the
// privacy-enhanced youtube-nocookie embed) or a Vimeo URL (dnt=1). Arbitrary
// third-party iframes stay banned — same posture as the iframe block.

export type VideoSource =
  | { kind: 'file'; src: string }
  | { kind: 'youtube'; id: string }
  | { kind: 'vimeo'; id: string };

const FILE_RE = /^\/(?!\/|\\)\S+\.(mp4|webm)$/i;
const YT_ID = /^[A-Za-z0-9_-]{6,20}$/;

export function parseVideoSrc(raw: string): VideoSource | null {
  const src = raw.trim();
  if (!src) return null;
  if (FILE_RE.test(src)) return { kind: 'file', src };

  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.replace(/^www\./, '');

  if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'm.youtube.com') {
    const id =
      url.searchParams.get('v') ??
      url.pathname.match(/^\/(?:embed|shorts|live)\/([^/?]+)/)?.[1] ??
      '';
    return YT_ID.test(id) ? { kind: 'youtube', id } : null;
  }
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return YT_ID.test(id) ? { kind: 'youtube', id } : null;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = url.pathname.match(/(\d{6,12})/)?.[1] ?? '';
    return id ? { kind: 'vimeo', id } : null;
  }
  return null;
}
