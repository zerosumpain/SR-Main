# Hero animation

Playback controls live at `/admin/content/hero`. Settings persist in the existing
`app_settings` table under `landing.hero.background`; no migration is needed.
The default is muted, single playback behind the title, a one-second final-frame
hold, then a four-second fade to 80% transparency. Only after the fade does the
frame layer over the title. The vitals rail is outside the animation.

To change the animation without a deployment:

1. Upload an MP4 directly into `siteherobackground` in `/drive`.
2. Open `/admin/content/hero`, refresh the folder, and select the MP4.
3. Click **Prepare & apply**. Progress survives navigation; the current animation
   stays active until preparation succeeds.

Preparation runs on the server and preserves the original. It creates desktop
and phone MP4s plus a final-frame WebP, saved in
`siteherobackground/web-ready/<source>-<job ID>/` for download and reuse.
Inputs must be readable MP4s up to 50 MiB, 60 seconds, and 4096px per dimension.
Only direct children of the source folder appear in the picker. Prepared copies
are read-only so editing a Drive file cannot silently change a published hero.
Choose **Included animation** to restore the bundled asset.

The server requires `ffmpeg` and `ffprobe`; the release script installs them
when missing, and the local preview image includes them. A database lease allows
one preparation at a time. An interrupted job becomes retryable after ten
minutes. Failed conversions leave the current animation intact. The selected
asset and job state use `app_settings`; no schema migration is needed.

Only explicitly prepared copies are published by `/api/landing/hero-media`.
Their immutable URLs support byte ranges and long-lived browser caching.
Previously published copies remain available to visitors who loaded before a
switch. Original Drive IDs and private files are never resolved by this route.

For preparing a bundled asset during development, use the local script
(requires ffmpeg):

```sh
python3 scripts/prepare-hero-background.py /path/to/downloaded-animation.mp4
```

This alternative preserves the original and writes only the optimised assets to
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

`node scripts/qa/hero-source-picker-preview.mjs` checks the real local Drive
upload, folder and permission filtering, server conversion, generated Drive
copies, persistent selection, unchanged original, concurrency rejection, public
byte ranges, private-ID rejection, failed-conversion recovery and restoring the
bundled animation. It checks desktop/phone admin layouts and homepage playback,
then removes its fixtures and restores the previous selection.

The configured Drive animation is eight seconds long. Its 24,560,653-byte original
was preserved; the prepared copies are 1,069,969 bytes at 960 × 550 (desktop),
380,718 bytes at 480 × 274 (phone), and a 51,382-byte final-frame WebP. Both
videos retain 24fps and have no audio. The source share capability is deliberately
not stored in the repository.
