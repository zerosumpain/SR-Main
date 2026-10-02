#!/usr/bin/env node
// sync-app-manifest.mjs — what the iPhone app is made of, read from its own source.
//
// The Engine Room's app pages describe the companion app's tabs, extensions, Siri
// shortcuts, watch faces, background modes, permissions and entitlements. The app lives
// in its own repository, so the site cannot read it at runtime, and copying the list by
// hand is exactly how the old study went stale. This script parses the Swift project and
// writes a small committed JSON file the pages render from.
//
//   node scripts/sync-app-manifest.mjs [path/to/SR-AppleApp/ios] [--check]
//
// `--check` exits 1 when the committed file differs from what the source says, so CI on
// either side can catch drift. Only structural names are read: enum cases, widget
// display names, intent titles, plist and entitlement KEYS. No values that could carry
// personal data (usage-description wording, bundle identifiers, team ids) are copied.
//
// Follow-up: the app's own CI should run this against its checkout and publish the JSON,
// so a merged app change refreshes the study without anyone remembering to run it here.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../src/routes/projects/engine-room/lib/app-manifest.json');
const args = process.argv.slice(2);
const check = args.includes('--check');
const ROOT = resolve(args.find((a) => !a.startsWith('--')) ?? process.env.SR_APPLE_IOS ?? '/home/john/sr-apple-ux-20261002/ios');

if (!existsSync(join(ROOT, 'project.yml'))) {
  console.error(`sync-app-manifest: no project.yml under ${ROOT}`);
  process.exit(2);
}

const read = (p) => readFileSync(join(ROOT, p), 'utf8');

function enumCases(src, name) {
  // A one-line enum (`enum Tab: String { case a, b }`) first, then a block enum.
  const m = new RegExp(`enum ${name}\\b[^{\\n]*\\{([^\\n}]*)\\}`).exec(src)
    ?? new RegExp(`enum ${name}\\b[^{]*\\{([\\s\\S]*?)\\n\\s*\\}`).exec(src);
  if (!m) throw new Error(`enum ${name} not found`);
  const body = m[1].replace(/;/g, '\n');
  const out = [];
  for (const line of body.split('\n')) {
    const c = /^\s*case\s+(.+?)\s*(?:\/\/.*)?$/.exec(line);
    if (!c) continue;
    for (const part of c[1].split(',')) {
      const [name, raw] = part.split('=').map((s) => s.trim());
      if (!name || name.includes('(') || name.startsWith('.')) continue;
      out.push(raw ? raw.replace(/^"|"$/g, '') : name);
    }
  }
  return out;
}

// Tabs and More pages: `enum Tab: String, Hashable { case today, chat, … }`.
const content = read('SRAppleApp/ContentView.swift');
const tabs = enumCases(content, 'Tab');
const morePages = enumCases(content, 'MorePage');

// Games: the GameKind raw values plus their `title` switch.
const games = (() => {
  const src = read('SRAppleApp/Games/GameModels.swift');
  const ids = enumCases(src, 'GameKind');
  const titles = new Map();
  for (const m of src.matchAll(/case \.(\w+): return "([^"]+)"/g)) if (!titles.has(m[1])) titles.set(m[1], m[2]);
  const cases = [...src.matchAll(/case (\w+)(?: = "([^"]+)")?/g)].map((m) => [m[1], m[2] ?? m[1]]);
  return ids.map((id) => {
    const swift = cases.find(([, raw]) => raw === id)?.[0] ?? id;
    return { id, title: titles.get(swift) ?? id };
  });
})();

// Widgets and complications: StaticConfiguration display names; the Live Activity by struct.
function widgets(file, surface) {
  const src = read(file);
  const out = [];
  for (const m of src.matchAll(/struct (\w+): Widget \{([\s\S]*?)\n\}/g)) {
    const name = /configurationDisplayName\("([^"]+)"\)/.exec(m[2])?.[1];
    const description = /\.description\("([^"]+)"\)/.exec(m[2])?.[1];
    const live = /ActivityConfiguration\(/.test(m[2]);
    out.push({ id: m[1], name: name ?? m[1].replace(/([a-z])([A-Z])/g, '$1 $2'), description: description ?? null, surface: live ? 'live-activity' : surface });
  }
  return out;
}
const phoneWidgets = [...widgets('SRAppleLive/SRAppleLive.swift', 'home-screen'), ...widgets('SRAppleLive/FamilyWidgets.swift', 'home-screen')];
const complications = widgets('SRAppleWatchWidgets/SRWatchWidgets.swift', 'watch-face');

// Siri and Shortcuts: each AppIntent's title, and how many shortcuts are offered.
const intentsSrc = read('SRAppleApp/Intents/SRAppIntents.swift');
const intents = [...intentsSrc.matchAll(/struct (\w+): AppIntent \{[\s\S]*?static var title: LocalizedStringResource = "([^"]+)"/g)]
  .map((m) => ({ id: m[1], title: m[2] }));
const shortcuts = (intentsSrc.match(/AppShortcut\(/g) ?? []).length;

// Watch pages: the vertical TabView in the watch app's root.
const watchPages = [...read('SRAppleWatch/SRAppleWatchApp.swift').matchAll(/Watch(\w+)Page\(\)/g)].map((m) => m[1].toLowerCase());

// Info.plist: background modes and which permissions the app asks for (keys only).
const plist = read('SRAppleApp/Info.plist');
const backgroundModes = [...(/<key>UIBackgroundModes<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(plist)?.[1] ?? '').matchAll(/<string>([^<]+)<\/string>/g)].map((m) => m[1]);
const permissions = [...plist.matchAll(/<key>NS(\w+)UsageDescription<\/key>/g)].map((m) => m[1]);
const liveActivities = /<key>NSSupportsLiveActivities<\/key>\s*<true\/>/.test(plist);

// Entitlements: capability keys only, never their values.
const ENTITLEMENT_NAMES = {
  'aps-environment': 'push',
  'com.apple.developer.usernotifications.time-sensitive': 'time-sensitive',
  'com.apple.developer.applesignin': 'sign-in-with-apple',
  'com.apple.developer.healthkit': 'healthkit',
  'com.apple.developer.healthkit.background-delivery': 'healthkit-background',
  'keychain-access-groups': 'keychain-sharing',
  'com.apple.developer.usernotifications.critical-alerts': 'critical-alerts',
};
const entitlementKeys = [...read('SRAppleApp/SRAppleApp.entitlements').matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]);
const entitlements = entitlementKeys.map((k) => ENTITLEMENT_NAMES[k] ?? k);

// Targets from the XcodeGen specs: `  Name:\n    type: …\n    platform: …`.
const targets = [];
for (const f of ['app.yml', 'watch.yml']) {
  for (const m of read(f).matchAll(/^ {2}(\w+):\n {4}type: ([\w.-]+)\n {4}platform: (\w+)/gm)) {
    if (!/test/i.test(m[2])) targets.push({ id: m[1], type: m[2], platform: m[3] });
  }
}

let commit = null;
try {
  commit = execFileSync('git', ['-C', ROOT, 'rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).trim();
} catch { /* not a git checkout */ }

const manifest = {
  // Where these names were read from. A short commit, never a path or branch name.
  source: { commit },
  targets,
  tabs,
  morePages,
  watchPages,
  widgets: phoneWidgets,
  complications,
  intents,
  shortcuts,
  games,
  backgroundModes,
  liveActivities,
  permissions,
  entitlements,
};

const json = `${JSON.stringify(manifest, null, 2)}\n`;
if (check) {
  const committed = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  const strip = (s) => s.replace(/"commit": "[^"]*"/, '"commit": ""');
  if (strip(committed) !== strip(json)) {
    console.error('sync-app-manifest: app-manifest.json is out of date — run node scripts/sync-app-manifest.mjs');
    process.exit(1);
  }
  console.log('sync-app-manifest: up to date');
} else {
  writeFileSync(OUT, json);
  console.log(`sync-app-manifest: ${tabs.length} tabs, ${phoneWidgets.length} phone widgets, ${complications.length} complications, ${intents.length} intents, ${games.length} games → ${OUT}`);
}
