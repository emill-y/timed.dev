// Hard mode "glitch paste": the first paste of a match lands corrupted. A few
// lines vanish and some variable usages get scrambled, so you have to read
// and repair what you pasted. After that the clipboard is locked.

export type HardMode = "glitch";
export const HARD_MODES: Record<HardMode, { label: string; blurb: string; mult: number }> = {
  glitch: {
    label: "glitch paste",
    blurb: "your first paste arrives damaged: lines deleted, variables scrambled. Fix it by hand. After that, copy & paste are locked.",
    mult: 1.3,
  },
};

export type GlitchReport = { removed: number; renamed: number; flipped: number };

// Small seeded PRNG so a corruption is reproducible for a given seed.
function rng(seed: number) {
  let s = (Math.imul(seed | 0, 2654435761) ^ 0x9e3779b9) >>> 0 || 1;
  const next = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  for (let i = 0; i < 8; i++) next(); // warm up so nearby seeds diverge
  return next;
}

const KEYWORDS = new Set(
  "break case catch class const continue default delete do else export extends false finally for function if import in instanceof let new null of return super switch this throw true try typeof undefined var void while yield async await".split(" "),
);

// A plausible typo: swap two neighbouring letters, or drop / double one.
function typo(name: string, r: () => number): string {
  if (name.length < 2) return name + name;
  const i = Math.floor(r() * (name.length - 1));
  const kind = r();
  let out: string;
  if (kind < 0.5) out = name.slice(0, i) + name[i + 1] + name[i] + name.slice(i + 2);
  else if (kind < 0.8 && name.length > 3) out = name.slice(0, i) + name.slice(i + 1);
  else out = name.slice(0, i) + name[i] + name.slice(i);
  return out === name ? name + "_" : out;
}

const FLIPS: [RegExp, string][] = [
  [/ <= /, " < "],
  [/ >= /, " > "],
  [/ < /, " <= "],
  [/ > /, " >= "],
  [/ \+ 1\b/, " - 1"],
  [/ - 1\b/, " + 1"],
  [/ === /, " !== "],
  [/ && /, " || "],
];

export function corrupt(text: string, seed = Date.now(), opts: { noDelete?: boolean } = {}): { text: string; report: GlitchReport } {
  const r = rng(seed);
  const lines = text.split("\n");
  const report: GlitchReport = { removed: 0, renamed: 0, flipped: 0 };

  // 1. Delete lines with real logic in them (not signatures, lone braces or
  //    comments). Their indentation stays, so you can see where the gaps are.
  const candidates = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => {
      const t = l.trim();
      return t.length > 3 && !/^[{}()[\];,]+$/.test(t) && !/^(export\s+)?(async\s+)?function\b/.test(t) && !t.startsWith("//");
    })
    .map(({ i }) => i);
  const want = opts.noDelete ? 0 : Math.max(1, Math.min(4, Math.round(candidates.length * 0.25), candidates.length - 1));
  const doomed = new Set<number>();
  while (doomed.size < want && doomed.size < candidates.length) {
    doomed.add(candidates[Math.floor(r() * candidates.length)]);
  }
  for (const i of doomed) lines[i] = lines[i].match(/^\s*/)![0];
  report.removed = doomed.size;

  // 2. Scramble some usages of declared names (params and const/let/var),
  //    but never the declaration itself, so the fix is findable.
  let body = lines.join("\n");
  const declared = new Set<string>();
  for (const m of body.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
  for (const m of body.matchAll(/\bfunction\s*[\w$]*\s*\(([^)]*)\)/g)) {
    for (const p of m[1].split(",")) {
      const n = p.trim().replace(/=.*$/, "").trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n)) declared.add(n);
    }
  }
  const names = [...declared].filter((n) => !KEYWORDS.has(n));
  const pickCount = Math.min(names.length, 1 + Math.floor(r() * 2));
  for (let k = 0; k < pickCount; k++) {
    const name = names.splice(Math.floor(r() * names.length), 1)[0];
    const bad = typo(name, r);
    const re = new RegExp(`(?<![\\w$.])${name.replace(/\$/g, "\\$")}(?![\\w$])`, "g");
    let seen = 0;
    body = body.replace(re, (match, offset: number) => {
      seen++;
      const before = body.slice(Math.max(0, offset - 12), offset);
      const isDecl = /(const|let|var)\s+$/.test(before) || seen === 1;
      if (isDecl || r() > 0.5) return match;
      report.renamed++;
      return bad;
    });
  }

  // 3. If that barely touched anything, flip one comparison or off-by-one.
  if (report.renamed === 0) {
    const order = [...FLIPS].sort(() => r() - 0.5);
    for (const [re, to] of order) {
      if (re.test(body)) {
        body = body.replace(re, to);
        report.flipped = 1;
        break;
      }
    }
  }

  // 4. Minified one-liners dodge all of the above: bite a chunk out instead.
  if (!report.removed && !report.renamed && !report.flipped) {
    const open = body.indexOf("{") + 1;
    const close = body.lastIndexOf("}");
    if (close - open > 16) {
      const len = 8 + Math.floor(r() * 10);
      const at = open + Math.floor(r() * (close - open - len));
      body = body.slice(0, at) + body.slice(at + len);
      report.removed = 1;
    }
  }

  return { text: body, report };
}

export function describe(rep: GlitchReport): string {
  const parts = [];
  if (rep.removed) parts.push(`${rep.removed} line${rep.removed === 1 ? "" : "s"} deleted`);
  if (rep.renamed) parts.push(`${rep.renamed} name${rep.renamed === 1 ? "" : "s"} scrambled`);
  if (rep.flipped) parts.push("1 operator flipped");
  return parts.join(" · ") || "shaken, not stirred";
}

// Characters for the scramble animation.
const NOISE = "!<>-_\\/[]{}=+*^?#$%&@01░▒▓█";
export function scramble(text: string, amount: number, r = Math.random): string {
  return text.replace(/[^\s]/g, (c) => (r() < amount ? NOISE[Math.floor(r() * NOISE.length)] : c));
}
