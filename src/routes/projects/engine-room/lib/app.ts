// app.ts — the words for the App pages. What the app is made of comes from
// `app-manifest.json` (written by scripts/sync-app-manifest.mjs from the app's own Swift),
// and the server side from the route manifest through `facts.server.ts`.
//
// The manifest's names are plain strings, so the type checker can't hold these maps to it.
// `drift.test.ts` does instead: every tab, surface, permission, entitlement and native area
// in the manifests must have a line here, and every line here must still exist there.

import manifest from '$lib/native/app-manifest.json';
import type { Twin } from './daydream';

export const APP = manifest;
export type AppManifest = typeof manifest;

export const TAB_COPY: Record<string, string> = {
  today: 'the day at a glance, and what needs me',
  chat: 'the assistant, with voice and attachments',
  health: 'readiness, activities, and routes I can follow offline',
  family: 'the household map, step board, tasks and journeys',
  games: 'quick games against the family',
  news: 'the news desk, briefed',
  flows: 'automations I can run from my pocket',
  more: 'settings, connections, and the daydream notes',
};

export const MORE_COPY: Record<string, string> = {
  daydream: 'the daydream Inbox, with verdict buttons',
};

export const WATCH_COPY: Record<string, string> = {
  today: 'readiness and the next thing',
  alerts: 'unread alerts, only when there are some',
  flows: 'pinned automations, only when I’ve pinned one',
  status: 'whether the phone and site are talking',
};

export const BACKGROUND_COPY: Record<string, Twin> = {
  location: { plain: 'notices a walk starting without me opening anything', eng: 'significant-change and region monitoring wake the app to start a journey' },
  fetch: { plain: 'tops up in the background now and then', eng: 'a background app refresh task syncs health and household state' },
  processing: { plain: 'may take longer background turns when iOS offers them', eng: 'declared so the system may grant longer background execution' },
};

export const PERMISSION_COPY: Record<string, string> = {
  HealthShare: 'read workouts, sleep and heart data',
  HealthUpdate: 'save workouts it records',
  LocationWhenInUse: 'show where I am on a route',
  LocationAlwaysAndWhenInUse: 'record a walk and share a journey while the phone is in my pocket',
  Motion: 'tell walking from driving',
  Camera: 'scan the pairing code',
  LocalNetwork: 'reach the site at home during development',
  SpeechRecognition: 'turn speech into a chat message',
  Microphone: 'hear a voice message',
};

export const ENTITLEMENT_COPY: Record<string, string> = {
  push: 'notifications from the site',
  'time-sensitive': 'notifications allowed through Focus when they matter',
  'sign-in-with-apple': 'family members join with their Apple account',
  healthkit: 'Apple Health access',
  'healthkit-background': 'new health data wakes the app',
  'keychain-sharing': 'widgets read the same sign-in as the app',
};

export const SURFACE_COPY: Record<string, { label: string; plain: string }> = {
  'live-activity': { label: 'Lock Screen and Dynamic Island', plain: 'A journey in progress, updated by push from the site. The phone draws it, the site decides every word.' },
  'home-screen': { label: 'Home Screen widgets', plain: 'Glanceable family boards that read a shared sign-in, never their own.' },
  'watch-face': { label: 'Watch complications', plain: 'One number each, on the watch face.' },
};

/** The native API, by first path segment. Every area the route manifest reports needs a line. */
export const AREA_COPY: Record<string, string> = {
  account: 'the signed-in person and their access',
  chat: 'the assistant, streamed',
  'companion-pair': 'pairing the background companion',
  'companion-policy': 'what the companion may collect',
  connections: 'which accounts are connected',
  daydream: 'daydream notes and verdicts',
  family: 'steps, tasks, forecasts and alarms',
  games: 'game rooms and the leaderboard',
  health: 'the health hub, activities, routes and recordings',
  me: 'who this phone belongs to',
  news: 'the news desk',
  notifications: 'what it may notify about',
  pair: 'pairing a phone with a one-time code',
  push: 'registering for push',
  register: 'joining with Sign in with Apple',
  'review-demo': 'the App Review demo account',
  'route-gifts': 'sending a route to someone',
  'route-session': 'sharing a live walk',
  session: 'checking a device is still trusted',
  today: 'the Today screen',
};

export const APP_COPY = {
  hub: {
    strap: 'And it all lives in my pocket',
    headline: ['It lives', 'in my', 'pocket'],
    lede: 'An iPhone app, a watch app and their widgets all reach the same site through one narrow, guarded doorway. That’s how the site does the things a web page can’t, like noticing a walk start without being opened, or putting a journey on the Lock Screen.',
  },
  surfaces: {
    line: { plain: 'The app is more than its screens. It also lives on the Lock Screen, the Home Screen, the watch and in Siri.', eng: 'Every target and surface on this page is generated from the app’s Swift source and project files.' },
  },
  api: {
    line: { plain: 'The app only reaches the site through one doorway, and every phone has to be paired before it gets through.', eng: 'One native route tree with its own gate, device tokens stored only as hashes, and per-area access for family members.' },
    pairing: { plain: 'Pairing uses a short-lived code. The phone then keeps a key that runs out after a few months, and I can switch it off from the site at any time.', eng: 'A one-time pairing code becomes a device token. Only its SHA-256 is stored, so a database leak can’t replay it.' },
    push: { plain: 'The site sends notifications and Live Activity updates itself. The phone just draws them.', eng: 'APNs from the site, with a redacted variant when a device has asked for private notifications.' },
  },
  privacy: {
    line: { plain: 'Every permission the app asks for, and what it uses it for. Nothing here shows a single person’s data.', eng: 'Usage-description keys and entitlements read from the project, never their values.' },
  },
} as const;

/** The pairing walk-through on the Native API page, step by step. Words only. */
export const PAIRING_COPY = {
  code: {
    label: 'A code on the site',
    plain: 'I ask the site for a pairing code. It shows a short code that stops working after a few minutes, so a photo of it is useless by tea time.',
    eng: 'An owner-authenticated request mints a one-time pairing code with a short expiry. It is single use and dies on first redemption or at expiry, whichever comes first.',
  },
  scan: {
    label: 'The phone reads it',
    plain: 'The phone scans the code with its camera and sends it back. That proves the phone was in front of a screen I was signed in to.',
    eng: 'The app redeems the code over the native API. Possession of a live code is the proof of presence; nothing else about the phone is trusted yet.',
  },
  key: {
    label: 'A key of its own',
    plain: 'In return the phone gets its own key, which lasts a few months. I can switch any phone off from the site whenever I like.',
    eng: 'Redemption issues a long-lived device token with a fixed lifetime, revocable per device from the site.',
  },
  hash: {
    label: 'Only a fingerprint kept',
    plain: 'The site keeps only a fingerprint of that key, never the key itself. If someone stole the database, they still couldn’t pretend to be my phone.',
    eng: 'Only the SHA-256 of the token is stored and compared, so a database leak can’t be replayed as a credential.',
  },
} as const;

/** The doorway explainer: what happens to a request with and without a key. */
export const DOORWAY_COPY = {
  paired: {
    plain: 'A paired phone shows its key at the door, the site checks the fingerprint, and the request goes through to the one area that phone is allowed into.',
    eng: 'Every native route checks the bearer token’s hash against live, unrevoked devices, then the per-area member grant, before any handler runs.',
  },
  stranger: {
    plain: 'Anything without a valid key is turned away at the door. It never gets near the rest of the site.',
    eng: 'No token, an expired token or a revoked device is refused at the native gate with an unauthorised response; the handler never runs.',
  },
  redacted: {
    plain: 'If a phone has asked for private notifications, the site sends a plain one that only says there is something to see.',
    eng: 'Devices that opt into private notifications receive a redacted APNs payload; the detail is fetched over the API after unlock.',
  },
} as const;
