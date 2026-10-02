// references.ts — the technologies and specifications this study refers to, shown in the
// layout footer. The other field studies cite external evidence; this one is about a system
// I built, so the honest equivalent is the standards and tools it stands on.

export interface Reference { name: string; url: string; what: string }

export const REFERENCES: Reference[] = [
  { name: 'SwiftUI', url: 'https://developer.apple.com/documentation/swiftui', what: 'the iPhone and watch apps’ interface' },
  { name: 'ActivityKit', url: 'https://developer.apple.com/documentation/activitykit', what: 'Live Activities on the Lock Screen and Dynamic Island, updated by push' },
  { name: 'WidgetKit', url: 'https://developer.apple.com/documentation/widgetkit', what: 'Home Screen widgets and watch complications' },
  { name: 'App Intents', url: 'https://developer.apple.com/documentation/appintents', what: 'Siri, Shortcuts and the Action button' },
  { name: 'Apple Push Notification service', url: 'https://developer.apple.com/documentation/usernotifications', what: 'how the site reaches the phone' },
  { name: 'XcodeGen', url: 'https://github.com/yonaskolb/XcodeGen', what: 'the project spec the app manifest on these pages is read from' },
  { name: 'bubblewrap', url: 'https://github.com/containers/bubblewrap', what: 'the empty namespace AI-written tool code runs in' },
  { name: 'SvelteKit', url: 'https://svelte.dev/docs/kit', what: 'the application framework — routing, server load functions, streaming responses' },
  { name: 'PostgreSQL', url: 'https://www.postgresql.org/docs/16/index.html', what: 'the single database behind every subsystem described here' },
  { name: 'OpenRouter', url: 'https://openrouter.ai/docs', what: 'the single gateway every language-model call passes through' },
  { name: 'Server-Sent Events', url: 'https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events', what: 'how tokens, tool steps and status frames stream to the browser' },
  { name: 'Okapi BM25', url: 'https://en.wikipedia.org/wiki/Okapi_BM25', what: 'the lexical ranking function behind this page’s own Ask dock' },
  { name: 'GitHub Actions', url: 'https://docs.github.com/en/actions', what: 'the gate-then-deploy pipeline that is the only route to production' },
  { name: 'OpenStreetMap', url: 'https://www.openstreetmap.org/about', what: 'the open map data behind the app’s offline route maps' },
];
