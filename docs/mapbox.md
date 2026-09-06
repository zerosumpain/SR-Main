# Mapbox maps

All interactive maps now use the pinned `mapbox-gl` package, loaded on demand.
The shared renderer is in `src/lib/maps/`; existing saved coordinates remain
`[latitude, longitude]` and are converted at the Mapbox boundary. There is no
Leaflet runtime or CDN dependency.

## Configure

In **Admin → Connections → Credentials → mapbox → + Connect**, save a **public
Mapbox access token (`pk.`)**. Use a dedicated token with `styles:read` and
`fonts:read` and URL restrictions covering the site's origin. Add the local
preview origin separately when testing. The encrypted integration credential
store uses the existing `INTEGRATION_CREDENTIALS_KEY` on the server.

Maps intentionally receive this public token through `GET /api/maps/config`.
That endpoint is public so shared chats and public projects can draw maps. It
returns only the validated public token and fixed style, with `no-store` cache
headers. Secret (`sk.`) tokens are rejected both at creation and at the browser
boundary. No credential metadata is exposed. Creating a new Mapbox credential
rotates the active token; the newest credential is selected on the next map
mount. Reload open maps after rotation.

Online maps use Mapbox Outdoors v12. Broads Pilot switches between Outdoors,
Streets v12 with its OpenSeaMap seamark overlay, and Light v11 for the schematic
view. Existing routing and geocoding providers remain in use. Attribution and
the Mapbox logo are retained.

## Offline field maps

Field maps retain the public browser configuration locally after their first
online use. When connectivity drops, downloaded OSM raster tiles from the
existing IndexedDB store render as Mapbox image sources underneath the track.
The map labels these as downloaded OpenStreetMap imagery. Online rendering
returns to Mapbox. No Mapbox imagery is bulk-downloaded. The browser must have
loaded the application and map code online before using it offline.

Mapbox fetches these browser-owned blob URLs, so `connect-src` includes `blob:`;
its worker uses the existing `worker-src blob:` policy. Existing downloaded
regions and tile keys are preserved.

## Local verification

The cumulative checkout runs at <http://127.0.0.1:5275/jkai>.
Credential entry: <http://127.0.0.1:5275/admin/connections/credentials>.
A public map surface: <http://127.0.0.1:5275/projects/broads-pilot>.
The local Compose service has a local-only encryption key and separate database.
Never copy production credentials into the preview.

```sh
PUBLIC_VAPID_PUBLIC_KEY='' npm run gate:check
PUBLIC_VAPID_PUBLIC_KEY='' npm run gate:build
npx vitest run src/lib/maps/config.test.ts src/lib/trails/field/field.test.ts
PLAYWRIGHT_DEV_PORT=5275 npx playwright test tests/e2e/mapbox.spec.ts --workers=1
```

Browser tests use synthetic provider responses with the real Mapbox WebGL
renderer. They verify geometry, style switches, label safety, cleanup,
fullscreen sizing at desktop and phone widths, setup messages, Broads overlays,
and decoding a downloaded image with the network disabled. They do not verify
live Mapbox imagery, account scopes, URL restrictions or billing. Those require
the owner's Mapbox public token entered through the credential form.

References: [Mapbox npm setup](https://docs.mapbox.com/mapbox-gl-js/guides/get-started/use-with-npm/)
and [access tokens](https://docs.mapbox.com/help/dive-deeper/access-tokens/).
