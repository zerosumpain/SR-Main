interface MusicKitInstance {
  authorize(): Promise<string>;
}

interface MusicKitGlobal {
  configure(config: {
    developerToken: string;
    app: { name: string; build: string };
  }): Promise<void> | void;
  getInstance(): MusicKitInstance;
}

declare global {
  interface Window {
    MusicKit?: MusicKitGlobal;
  }
}

let loading: Promise<MusicKitGlobal> | null = null;

function loadMusicKit(): Promise<MusicKitGlobal> {
  if (window.MusicKit) return Promise.resolve(window.MusicKit);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const onReady = () => {
      if (window.MusicKit) resolve(window.MusicKit);
      else reject(new Error('MusicKit loaded without exposing its API'));
    };
    document.addEventListener('musickitloaded', onReady, { once: true });
    const existing = document.querySelector<HTMLScriptElement>('script[data-jkai-musickit]');
    if (existing) return;
    const script = document.createElement('script');
    script.src = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js';
    script.async = true;
    script.dataset.jkaiMusickit = 'true';
    script.onerror = () => reject(new Error('MusicKit could not be loaded'));
    document.head.appendChild(script);
  });
  return loading;
}

export async function authorizeAppleMusicConnection(connectionId: string): Promise<{ jobId: string }> {
  const tokenResponse = await fetch('/api/activity/v1/providers/apple-music/developer-token');
  const tokenBody = await tokenResponse.json();
  if (!tokenResponse.ok) throw new Error(tokenBody.detail ?? 'Apple Music is not configured');

  const musicKit = await loadMusicKit();
  await musicKit.configure({
    developerToken: tokenBody.token,
    app: { name: 'JKAI', build: '1' },
  });
  const musicUserToken = await musicKit.getInstance().authorize();
  if (!musicUserToken) throw new Error('Apple Music did not return a user token');

  const response = await fetch(`/api/activity/v1/connections/${connectionId}/apple-music-token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ musicUserToken }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.detail ?? 'Apple Music authorization could not be stored');
  return { jobId: body.jobId };
}
