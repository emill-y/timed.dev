// Procedural tickets. Each family turns a seed into a fresh variant: its own
// rules, wording and test inputs. Expected outputs are computed by running
// the family's reference solution on those inputs, so every generated
// ticket is solvable by construction.
//
// These power the 30-minute drops and the RL environment (rl/).
import type { Problem, Test } from "./problems.ts";

export type Rand = { next: () => number; int: (lo: number, hi: number) => number; pick: <T>(xs: readonly T[]) => T; shuffle: <T>(xs: T[]) => T[] };

export function rand(seed: number): Rand {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)];
  const shuffle = <T,>(xs: T[]) => {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [xs[i], xs[j]] = [xs[j], xs[i]];
    }
    return xs;
  };
  return { next, int, pick, shuffle };
}

type Spec = {
  title: string;
  fn: string;
  prompt: string;
  params: string; // signature shown in the starter
  solution: string; // reference JS, a function declaration named fn
  visible: unknown[][];
  hidden: unknown[][];
  difficulty: 1 | 2 | 3;
};

type Family = { id: string; make: (r: Rand) => Spec };

const WORDS = ["lorem", "ship", "fast", "turbo", "api", "cache", "queue", "retry", "lap", "pit", "grid", "fuel", "drift", "apex"];
const word = (r: Rand) => r.pick(WORDS);
const str = (r: Rand, alphabet: string, lo: number, hi: number) =>
  Array.from({ length: r.int(lo, hi) }, () => alphabet[r.int(0, alphabet.length - 1)]).join("");

export const FAMILIES: Family[] = [
  {
    id: "rle",
    make: (r) => {
      const k = r.int(2, 4);
      const countFirst = r.next() < 0.5;
      const eg = countFirst ? `"aaaab" -> "4ab"` : `"aaaab" -> "a4b"`;
      return {
        title: `Pack Runs (≥${k})`,
        fn: "pack",
        params: "str",
        difficulty: 1,
        prompt: `Telemetry compression. Replace every run of ${k} or more identical characters with ${countFirst ? "the run length followed by the character" : "the character followed by the run length"}. Shorter runs stay as they are. Example: ${eg}${k > 4 ? "" : ` (with a threshold of ${k})`}.`,
        solution: `function pack(str) {
  return str.replace(/(.)\\1*/g, (m, c) => (m.length >= ${k} ? ${countFirst ? "m.length + c" : "c + m.length"} : m));
}`,
        visible: [["aaaabbc"], ["abc"], [str(r, "xy", 6, 10)]],
        hidden: [[""], ["z".repeat(r.int(9, 14))], [str(r, "aab", 8, 16)], [str(r, "qqqqr", 10, 20)], ["a".repeat(k - 1) + "b".repeat(k)]],
      };
    },
  },
  {
    id: "fizz",
    make: (r) => {
      const divs = r.shuffle([2, 3, 4, 5, 6, 7]).slice(0, r.int(2, 3)).sort((a, b) => a - b);
      const words = r.shuffle(["Zip", "Zap", "Vroom", "Boost", "Pit", "Lap", "Nitro"]).slice(0, divs.length);
      const rules = divs.map((d, i) => `${d} → "${words[i]}"`).join(", ");
      return {
        title: `${words.join("")} Counter`,
        fn: "count",
        params: "n",
        difficulty: 1,
        prompt: `Return an array of strings for 1..n. For each number, concatenate the words of every rule it's divisible by, in this order: ${rules}. If no rule matches, use the number itself as a string. n can be 0.`,
        solution: `function count(n) {
  const rules = ${JSON.stringify(divs.map((d, i) => [d, words[i]]))};
  const out = [];
  for (let i = 1; i <= n; i++) {
    const s = rules.filter(([d]) => i % d === 0).map(([, w]) => w).join("");
    out.push(s || String(i));
  }
  return out;
}`,
        visible: [[5], [divs[0] * divs[1]], [1]],
        hidden: [[0], [r.int(15, 30)], [divs.reduce((a, b) => a * b, 1)], [r.int(31, 45)]],
      };
    },
  },
  {
    id: "rotate",
    make: (r) => {
      const shift = r.pick([1, 3, 5, 7, 11, 13, 19, 25]);
      const digits = r.next() < 0.5;
      return {
        title: `Rot-${shift}${digits ? " + digits" : ""}`,
        fn: "rotate",
        params: "text",
        difficulty: 1,
        prompt: `Obfuscate log lines. Shift every letter forward by ${shift} places, wrapping z→a and keeping case${digits ? `. Also shift every digit forward by ${shift % 10}, wrapping 9→0` : ""}. Everything else stays untouched.`,
        solution: `function rotate(text) {
  return text.replace(/[a-z]/gi, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + ${shift}) % 26) + base);
  })${digits ? `.replace(/[0-9]/g, (d) => String((+d + ${shift % 10}) % 10))` : ""};
}`,
        visible: [["Hello, World!"], ["abc xyz"], ["Route 66"]],
        hidden: [[""], ["ZzZz"], [str(r, "abcXYZ 09!-", 10, 24)], ["The Quick Brown Fox 2026"]],
      };
    },
  },
  {
    id: "moving-avg",
    make: (r) => {
      const w = r.int(2, 5);
      const dp = r.int(0, 2);
      const nums = (lo: number, hi: number) => Array.from({ length: r.int(lo, hi) }, () => r.int(-20, 60));
      return {
        title: `Rolling Mean (${w})`,
        fn: "rolling",
        params: "nums",
        difficulty: 2,
        prompt: `Dashboard smoothing. Return the average of every full window of ${w} consecutive numbers, left to right, rounded to ${dp} decimal place${dp === 1 ? "" : "s"} (use Math.round on the scaled value, then divide back). Fewer than ${w} numbers returns [].`,
        solution: `function rolling(nums) {
  const out = [];
  for (let i = 0; i + ${w} <= nums.length; i++) {
    let s = 0;
    for (let j = i; j < i + ${w}; j++) s += nums[j];
    out.push(Math.round((s / ${w}) * ${10 ** dp}) / ${10 ** dp});
  }
  return out;
}`,
        visible: [[[1, 2, 3, 4, 5, 6]], [nums(w + 1, w + 3)], [[10, 20]]],
        hidden: [[[]], [nums(w - 1, w - 1)], [nums(8, 14)], [[-5, 5, -5, 5, -5, 5, 1]]],
      };
    },
  },
  {
    id: "buckets",
    make: (r) => {
      const width = r.pick([5, 10, 25, 100]);
      const xs = (n: number) => Array.from({ length: n }, () => r.int(-width, width * 4));
      return {
        title: `Histogram /${width}`,
        fn: "histogram",
        params: "values",
        difficulty: 2,
        prompt: `Latency histogram. Group integers into buckets of width ${width}: a value v goes in the bucket starting at floor(v / ${width}) * ${width}. Return an object whose keys are "start-end" (end = start + ${width - 1}) and whose values are counts. Insert keys in ascending bucket order and include only non-empty buckets. Negative values follow the same floor rule.`,
        solution: `function histogram(values) {
  const counts = new Map();
  for (const v of values) {
    const s = Math.floor(v / ${width}) * ${width};
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  const out = {};
  for (const s of [...counts.keys()].sort((a, b) => a - b)) out[s + "-" + (s + ${width - 1})] = counts.get(s);
  return out;
}`,
        visible: [[[0, 1, width, width + 1, width * 3]], [xs(6)], [[]]],
        hidden: [[[-1, -width, -width - 1]], [xs(20)], [[width - 1, width]], [xs(9)]],
      };
    },
  },
  {
    id: "case",
    make: (r) => {
      const sep = r.pick(["_", "-", "."]);
      const upper = r.next() < 0.3;
      const name = { "_": upper ? "SCREAMING_SNAKE" : "snake_case", "-": "kebab-case", ".": "dot.case" }[sep]!;
      return {
        title: `camelCase → ${name}`,
        fn: "convert",
        params: "ident",
        difficulty: 2,
        prompt: `Codemod helper. Convert a camelCase or PascalCase identifier to ${name}, separating words with "${sep}"${upper ? " and uppercasing everything" : " in lowercase"}. A run of capitals is an acronym and stays together as one word: "parseHTTPResponse" → ${JSON.stringify(upper ? "PARSE_HTTP_RESPONSE" : ["parse", "http", "response"].join(sep))}. Digits stick to the word before them.`,
        solution: `function convert(ident) {
  const words = ident.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|[0-9]+/g) || [];
  const merged = [];
  for (const w of words) {
    if (/^[0-9]+$/.test(w) && merged.length) merged[merged.length - 1] += w;
    else merged.push(w);
  }
  return merged.map((w) => w.${upper ? "toUpperCase" : "toLowerCase"}()).join(${JSON.stringify(sep)});
}`,
        visible: [["parseHTTPResponse"], ["userId"], ["XMLHttpRequest"]],
        hidden: [["a"], ["getV2Api"], ["IOError"], [r.pick(["myURLParser", "toJSON", "base64Encode", "HTMLElement"])], ["already"]],
      };
    },
  },
  {
    id: "radix",
    make: (r) => {
      const base = r.int(3, 9);
      const alphabet = r.shuffle("abcdefghjkmnpqrstuvwxyz".split("")).slice(0, base).join("");
      return {
        title: `Base-${base} Short Links`,
        fn: "encode",
        params: "n",
        difficulty: 2,
        prompt: `URL shortener. Encode a non-negative integer in base ${base} using the digit alphabet "${alphabet}" (so "${alphabet[0]}" is zero and "${alphabet[1]}" is one). No leading zeros; 0 encodes to "${alphabet[0]}".`,
        solution: `function encode(n) {
  const a = ${JSON.stringify(alphabet)};
  if (n === 0) return a[0];
  let s = "";
  while (n > 0) {
    s = a[n % ${base}] + s;
    n = Math.floor(n / ${base});
  }
  return s;
}`,
        visible: [[1], [base], [r.int(20, 99)]],
        hidden: [[0], [base * base - 1], [r.int(1000, 99999)], [2 ** 31 - 1]],
      };
    },
  },
  {
    id: "top-words",
    make: (r) => {
      const k = r.int(2, 4);
      const text = (n: number) => Array.from({ length: n }, () => (r.next() < 0.2 ? word(r).toUpperCase() : word(r)) + (r.next() < 0.2 ? r.pick([",", ".", "!"]) : "")).join(" ");
      return {
        title: `Top ${k} Words`,
        fn: "topWords",
        params: "text",
        difficulty: 3,
        prompt: `Search analytics. Return the ${k} most frequent words as [word, count] pairs. Words are runs of letters a-z (case-insensitive, returned lowercase); anything else separates words. Sort by count descending, then alphabetically. Return fewer than ${k} if there aren't enough distinct words.`,
        solution: `function topWords(text) {
  const c = new Map();
  for (const w of text.toLowerCase().match(/[a-z]+/g) || []) c.set(w, (c.get(w) || 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, ${k});
}`,
        visible: [["the cat and the hat and the bat"], [text(12)], ["one"]],
        hidden: [[""], ["b a b a c"], [text(30)], ["Don't stop, don't STOP! 42 times"]],
      };
    },
  },
  {
    id: "chunk",
    make: (r) => {
      const size = r.int(2, 4);
      const pad = r.next() < 0.5;
      const fill = r.pick([0, null, "-"]);
      const arr = (n: number) => Array.from({ length: n }, () => r.int(0, 9));
      return {
        title: `Chunk ×${size}${pad ? " (padded)" : ""}`,
        fn: "chunk",
        params: "items",
        difficulty: 1,
        prompt: `Batch uploader. Split an array into consecutive chunks of ${size}.${pad ? ` If the last chunk is short, pad it to ${size} with ${JSON.stringify(fill)}.` : " The last chunk may be shorter."} An empty array gives [].`,
        solution: `function chunk(items) {
  const out = [];
  for (let i = 0; i < items.length; i += ${size}) out.push(items.slice(i, i + ${size}));
  ${pad ? `const last = out[out.length - 1];
  if (last) while (last.length < ${size}) last.push(${JSON.stringify(fill)});` : ""}
  return out;
}`,
        visible: [[arr(size * 2 + 1)], [arr(size)], [[]]],
        hidden: [[arr(1)], [arr(size * 3)], [arr(size * 4 - 1)], [arr(r.int(10, 20))]],
      };
    },
  },
];

const FAMILY = new Map(FAMILIES.map((f) => [f.id, f]));

// Evaluates our own reference solutions (trusted code, never player code).
function runReference(solution: string, fn: string, args: unknown[]): unknown {
  const f = new Function(`${solution}\nreturn ${fn};`)() as (...a: unknown[]) => unknown;
  return f(...structuredClone(args));
}

export type Generated = Problem & { family: string; seed: number; solution: string; difficulty: 1 | 2 | 3 };

export const genId = (family: string, seed: number) => `gen-${family}-${seed >>> 0}`;

export function parseGenId(id: string): { family: string; seed: number } | null {
  const m = /^gen-([a-z-]+?)-(\d+)$/.exec(id);
  return m && FAMILY.has(m[1]) ? { family: m[1], seed: Number(m[2]) } : null;
}

const cache = new Map<string, Generated>();

export function generate(family: string, seed: number): Generated {
  const id = genId(family, seed);
  const hit = cache.get(id);
  if (hit) return hit;
  const f = FAMILY.get(family);
  if (!f) throw new Error(`unknown family ${family}`);
  const s = f.make(rand(seed ^ hash(family)));
  const tests: Test[] = [
    ...s.visible.map((args) => ({ args, expect: runReference(s.solution, s.fn, args) })),
    ...s.hidden.map((args) => ({ args, expect: runReference(s.solution, s.fn, args), hidden: true })),
  ];
  const p: Generated = {
    id,
    title: s.title,
    tier: s.difficulty === 3 ? "final" : s.difficulty === 2 ? "heat" : "sprint",
    fn: s.fn,
    prompt: s.prompt,
    starter: `function ${s.fn}(${s.params}) {\n  \n}\n`,
    tests,
    family,
    seed,
    solution: s.solution,
    difficulty: s.difficulty,
  };
  if (cache.size > 500) cache.clear();
  cache.set(id, p);
  return p;
}

export function generateFromSeed(seed: number): Generated {
  const r = rand(seed);
  return generate(r.pick(FAMILIES).id, r.int(0, 2 ** 31 - 1));
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
