// Regenerates src/lib/games/words/boggle.ts — Boggle's 8–16 letter words.
//
//   curl -sSfLo /tmp/en_50k.txt https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt
//   node scripts/games/build-boggle-words.mjs /tmp/en_50k.txt
//
// Needs /usr/share/hunspell/en_US.{dic,aff} (the `hunspell-en-us` package).
// The pruned stems are read off Anagram Blitz's lists: a 3–7 letter Hunspell
// word missing from them was taken out by hand, so its longer forms go too.
import fs from "node:fs";

const freqPath = process.argv[2] ?? "/tmp/en_50k.txt";
const aff = fs
  .readFileSync("/usr/share/hunspell/en_US.aff", "utf8")
  .split("\n");
const rules = {};
for (let i = 0; i < aff.length; i++) {
  const p = aff[i].trim().split(/\s+/);
  if (
    (p[0] === "PFX" || p[0] === "SFX") &&
    p.length === 4 &&
    /^\d+$/.test(p[3])
  ) {
    const r = { type: p[0], cross: p[2] === "Y", entries: [] };
    for (let k = 1; k <= +p[3]; k++) {
      const q = aff[i + k].trim().split(/\s+/);
      const cond =
        q[4] === "."
          ? null
          : new RegExp(p[0] === "SFX" ? q[4] + "$" : "^" + q[4]);
      r.entries.push({
        strip: q[2] === "0" ? "" : q[2],
        add: q[3] === "0" ? "" : q[3].split("/")[0],
        cond,
      });
    }
    rules[p[1]] = r;
    i += +p[3];
  }
}
function apply(word, r) {
  const res = [];
  for (const e of r.entries) {
    if (e.cond && !e.cond.test(word)) continue;
    if (r.type === "SFX") {
      if (e.strip && !word.endsWith(e.strip)) continue;
      res.push(word.slice(0, word.length - e.strip.length) + e.add);
    } else {
      if (e.strip && !word.startsWith(e.strip)) continue;
      res.push(e.add + word.slice(e.strip.length));
    }
  }
  return res;
}
const expanded = new Map(); // word -> stem
for (const line of fs
  .readFileSync("/usr/share/hunspell/en_US.dic", "utf8")
  .split("\n")
  .slice(1)) {
  if (!line) continue;
  const [stem, flags = ""] = line.split("/");
  const words = [stem];
  const fl = [...flags];
  const sfxWords = [];
  for (const f of fl.filter((f) => rules[f]?.type === "SFX"))
    for (const w of apply(stem, rules[f])) {
      sfxWords.push([w, rules[f].cross]);
      words.push(w);
    }
  for (const f of fl.filter((f) => rules[f]?.type === "PFX")) {
    for (const w of apply(stem, rules[f])) words.push(w);
    if (rules[f].cross)
      for (const [sw, c] of sfxWords)
        if (c) for (const w of apply(sw, rules[f])) words.push(w);
  }
  for (const w of words)
    if (
      /^[a-z]+$/.test(w) &&
      w.length >= 3 &&
      w.length <= 16 &&
      !expanded.has(w)
    )
      expanded.set(w, stem.toLowerCase());
}

const anagram = fs.readFileSync(
  new URL("../../src/lib/games/words/anagram.ts", import.meta.url),
  "utf8",
);
const grab = (n) => {
  const i = anagram.indexOf("export const " + n);
  const a = anagram.indexOf("`", i);
  return anagram
    .slice(a + 1, anagram.indexOf("`", a + 1))
    .split(/\s+/)
    .filter(Boolean);
};
const kept = new Set([...grab("COMMON_WORDS"), ...grab("RARE_WORDS")]);
const pruned = new Set(
  [...expanded.keys()].filter((w) => w.length <= 7 && !kept.has(w)),
);

// Compounds of the same themes. Each is checked for innocent words it would
// catch ("semen" takes basement, "vagin" ravaging) — keep it that way.
const BAD = [
  "fuck",
  "shit",
  "cunt",
  "nigg",
  "whore",
  "slut",
  "porn",
  "dildo",
  "penis",
  "vagina",
  "masturb",
  "orgasm",
  "erotic",
  "sodom",
  "bitch",
  "bastard",
  "asshole",
  "faggot",
  "pervert",
  "fetish",
  "scrotum",
  "scrotal",
  "blowjob",
  "sexual",
  "sexy",
  "sexis",
  "sexless",
  "homosex",
  "bisex",
  "transsex",
  "heterosex",
  "lesbian",
  "drunk",
  "booze",
  "boozi",
  "suicid",
  "cocain",
  "prostitut",
  "hooker",
  "horny",
  "nipple",
  "pubic",
  "sperm",
  "condom",
  "tampon",
  "retard",
  "idiot",
  "piss",
  "slave",
  "whiskey",
  "whisky",
  "intercourse",
  "genocid",
];
const longs = [...expanded]
  .filter(
    ([w, s]) =>
      w.length >= 8 && !pruned.has(s) && !BAD.some((b) => w.includes(b)),
  )
  .map(([w]) => w)
  .sort();

const freq = new Set(
  fs
    .readFileSync(freqPath, "utf8")
    .split("\n")
    .map((l) => l.split(" ")[0]),
);
const common = longs.filter((w) => freq.has(w));
const rare = longs.filter((w) => !freq.has(w));
const wrap = (ws) => {
  const lines = [];
  let cur = "  ";
  for (const w of ws) {
    if (cur.length + w.length + 1 > 100) {
      lines.push(cur.trimEnd());
      cur = "  ";
    }
    cur += w + " ";
  }
  lines.push(cur.trimEnd());
  return lines.join("\n");
};
const out = `// Boggle's long words: every eight-to-sixteen-letter word, for the boards that can hold one.
//
// Three-to-seven-letter words are Anagram Blitz's lists (\`./anagram\`), used as
// they are. These extend them the same way: the system Hunspell dictionary
// (/usr/share/hunspell/en_US.dic, SCOWL-derived) expanded through en_US.aff,
// lowercase a–z only, with any word built on a stem Anagram Blitz pruned (slurs,
// sexual and crude words, drink and drug words) taken out, plus a substring
// screen for the same themes in compounds. LONG_COMMON (${common.length}) are the ones
// spoken in film and TV subtitles (hermitdave/FrequencyWords, 2018 en_50k) and
// may be shown as a word nobody found; LONG_RARE (${rare.length}) are accepted but never
// shown. Regenerate with scripts/games/build-boggle-words.mjs.

const split = (s: string): readonly string[] => s.trim().split(/\\s+/);

export const LONG_COMMON: readonly string[] = split(\`
${wrap(common)}
\`);

export const LONG_RARE: readonly string[] = split(\`
${wrap(rare)}
\`);
`;
fs.writeFileSync(
  new URL("../../src/lib/games/words/boggle.ts", import.meta.url),
  out,
);
console.log(`LONG_COMMON ${common.length}, LONG_RARE ${rare.length}`);
