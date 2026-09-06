# Hero animation

Playback controls live at `/admin/content/hero`. Settings persist in the existing
`app_settings` table under `landing.hero.background`; no migration is needed.
The default is muted, single playback behind the title, a one-second final-frame
hold, then a four-second fade to 80% transparency. Only after the fade does the
frame layer over the title. The vitals rail is outside the animation.

Download the intended animation from the site's `/drive/siteherobackground`
folder, then prepare public presentation assets locally (requires ffmpeg):

```sh
python3 scripts/prepare-hero-background.py /path/to/downloaded-animation.mp4
```

This preserves the original and writes only the optimised assets to
`static/hero-background` and their manifest to
`src/lib/constants/hero-background-asset.json`. Include those outputs with the change.
The original Drive file and other private files are never served by a public API.
Do not add the original, credentials, or a Drive database export to the checkout.
With a null manifest the hero remains unchanged and admin reports the missing asset.

Output: H.264 MP4, max 960px desktop / 480px phone, 24fps, CRF 30, no audio or
metadata, fast-start headers. The byte ceilings are 2 MB / 1 MB, with a bitrate
cap adjusted for duration. Content-hashed URLs allow cache reuse. A WebP still
contains the final decoded frame. The browser selects one video size after
mount; neither video is preloaded into the initial HTML. Reduced-motion and
data-saving users get only the still, and playback pauses outside the viewport
or in a hidden tab. An autoplay failure falls back to the still.

The admin preview uses unsaved controls; Save applies them to future homepage
loads. Reset controls changes the form only until saved. Disabling playback
removes the animation and all its media requests. Timing settings are in
milliseconds, and 80% final transparency means 20% opacity.

## Local verification

`node scripts/qa/hero-background-preview.mjs` uses an ephemeral synthetic clip
through the LAN preview. It checks encoding ceilings, saved/reloaded controls,
desktop and phone playback, pause/resume, hold/fade/layer ordering, final-frame
20% opacity, reduced motion, autoplay denial, disabled media and invalid inputs.
It restores both the manifest and local database settings even on failure.

The actual Drive artwork remains unverified until its source is available.
