// Problem bank. Every problem is a single JS function the player must export.
// Prompts are written like real tickets: the skill being tested is scoping
// the ask fast (with or without AI), not remembering syntax.

export type Test = { args: unknown[]; expect: unknown; hidden?: boolean };

export type Problem = {
  id: string;
  title: string;
  tier: "sprint" | "heat" | "final";
  fn: string;
  prompt: string;
  starter: string;
  tests: Test[];
};

export const PROBLEMS: Problem[] = [
  {
    id: "duration",
    title: "Parse Duration",
    tier: "sprint",
    fn: "parseDuration",
    prompt:
      "Ops wants human durations in config. Turn strings like \"1h30m\", \"45s\", \"2d4h\" into total seconds. Units: d, h, m, s. Units appear at most once, in any order. Return null for anything invalid (empty string, unknown unit, number with no unit).",
    starter: "function parseDuration(str) {\n  \n}\n",
    tests: [
      { args: ["1h30m"], expect: 5400 },
      { args: ["45s"], expect: 45 },
      { args: ["2d4h"], expect: 187200 },
      { args: ["10m5s"], expect: 605 },
      { args: [""], expect: null, hidden: true },
      { args: ["5x"], expect: null, hidden: true },
      { args: ["12"], expect: null, hidden: true },
      { args: ["30s1m"], expect: 90, hidden: true },
    ],
  },
  {
    id: "flatten",
    title: "Flatten Config",
    tier: "sprint",
    fn: "flatten",
    prompt:
      "Env export needs flat keys. Flatten a nested plain object into dot-separated keys. Arrays are leaf values (keep them as-is). Empty nested objects disappear.",
    starter: "function flatten(obj) {\n  \n}\n",
    tests: [
      { args: [{ a: 1, b: { c: 2 } }], expect: { a: 1, "b.c": 2 } },
      { args: [{ db: { host: "x", port: 5432 } }], expect: { "db.host": "x", "db.port": 5432 } },
      { args: [{ a: { b: { c: { d: true } } } }], expect: { "a.b.c.d": true } },
      { args: [{ list: [1, 2], e: {} }], expect: { list: [1, 2] }, hidden: true },
      { args: [{}], expect: {}, hidden: true },
      { args: [{ n: null, z: { y: 0 } }], expect: { n: null, "z.y": 0 }, hidden: true },
    ],
  },
  {
    id: "semver",
    title: "Semver Compare",
    tier: "sprint",
    fn: "compareVersions",
    prompt:
      "The updater needs to know if a release is newer. Compare two versions like \"1.2.10\" and \"1.2.9\". Return 1 if a > b, -1 if a < b, 0 if equal. Missing parts count as 0 (\"1.2\" equals \"1.2.0\"). Ignore a leading \"v\".",
    starter: "function compareVersions(a, b) {\n  \n}\n",
    tests: [
      { args: ["1.2.10", "1.2.9"], expect: 1 },
      { args: ["1.0.0", "1.0.0"], expect: 0 },
      { args: ["0.9", "1.0"], expect: -1 },
      { args: ["1.2", "1.2.0"], expect: 0, hidden: true },
      { args: ["v2.0.0", "1.99.99"], expect: 1, hidden: true },
      { args: ["1.10", "1.9.9"], expect: 1, hidden: true },
      { args: ["3", "v3.0.1"], expect: -1, hidden: true },
    ],
  },
  {
    id: "rle",
    title: "Run-Length Pack",
    tier: "sprint",
    fn: "pack",
    prompt:
      "Compress telemetry strings. Replace runs of the same character with count+char, but only when the run is 3 or longer. Shorter runs stay as-is. \"aaabcc\" -> \"3abcc\".",
    starter: "function pack(str) {\n  \n}\n",
    tests: [
      { args: ["aaabcc"], expect: "3abcc" },
      { args: ["abc"], expect: "abc" },
      { args: ["zzzzzzzzzzzz"], expect: "12z" },
      { args: [""], expect: "", hidden: true },
      { args: ["aabbbaa"], expect: "aa3baa", hidden: true },
      { args: ["xxxyyyx"], expect: "3x3yx", hidden: true },
    ],
  },
  {
    id: "merge-slots",
    title: "Merge Busy Slots",
    tier: "heat",
    fn: "mergeSlots",
    prompt:
      "Calendar sync returns busy slots as [start, end] minute pairs, unsorted and overlapping. Merge them into the minimal sorted list. Touching slots ([1,3] and [3,5]) merge.",
    starter: "function mergeSlots(slots) {\n  \n}\n",
    tests: [
      { args: [[[1, 3], [2, 6], [8, 10]]], expect: [[1, 6], [8, 10]] },
      { args: [[[5, 7], [1, 2]]], expect: [[1, 2], [5, 7]] },
      { args: [[[1, 3], [3, 5]]], expect: [[1, 5]] },
      { args: [[]], expect: [], hidden: true },
      { args: [[[1, 10], [2, 3], [4, 5]]], expect: [[1, 10]], hidden: true },
      { args: [[[9, 12], [0, 1], [1, 2], [11, 15]]], expect: [[0, 2], [9, 15]], hidden: true },
    ],
  },
  {
    id: "log-line",
    title: "Parse Access Log",
    tier: "heat",
    fn: "parseLog",
    prompt:
      "Given an access log line like 'GET /api/users?id=4 200 13ms', return { method, path, query, status, ms }. query is an object of params (empty object if none). status and ms are numbers. Return null if the line doesn't match that shape.",
    starter: "function parseLog(line) {\n  \n}\n",
    tests: [
      {
        args: ["GET /api/users?id=4 200 13ms"],
        expect: { method: "GET", path: "/api/users", query: { id: "4" }, status: 200, ms: 13 },
      },
      {
        args: ["POST /login 401 7ms"],
        expect: { method: "POST", path: "/login", query: {}, status: 401, ms: 7 },
      },
      {
        args: ["DELETE /x?a=1&b=two 204 120ms"],
        expect: { method: "DELETE", path: "/x", query: { a: "1", b: "two" }, status: 204, ms: 120 },
        hidden: true,
      },
      { args: ["garbage"], expect: null, hidden: true },
      { args: ["GET /x 200"], expect: null, hidden: true },
    ],
  },
  {
    id: "ipv4",
    title: "Validate IPv4",
    tier: "heat",
    fn: "isIPv4",
    prompt:
      "Firewall form validation. Return true only for a dotted-quad IPv4 address: four decimal parts 0-255, no leading zeros (\"01\" is invalid, \"0\" is fine), no spaces, nothing extra.",
    starter: "function isIPv4(str) {\n  \n}\n",
    tests: [
      { args: ["192.168.0.1"], expect: true },
      { args: ["256.1.1.1"], expect: false },
      { args: ["10.0.0"], expect: false },
      { args: ["0.0.0.0"], expect: true, hidden: true },
      { args: ["01.2.3.4"], expect: false, hidden: true },
      { args: ["1.2.3.4 "], expect: false, hidden: true },
      { args: ["1.2.3.-4"], expect: false, hidden: true },
      { args: ["1..3.4"], expect: false, hidden: true },
    ],
  },
  {
    id: "rate-limit",
    title: "Rate Limiter",
    tier: "final",
    fn: "rateLimit",
    prompt:
      "API gateway. Given a limit, a window in ms, and an array of request timestamps (ms, ascending), return an array of booleans: whether each request is allowed. Sliding window: a request is allowed if fewer than `limit` ALLOWED requests happened in (t - window, t]. Rejected requests don't count.",
    starter: "function rateLimit(limit, windowMs, times) {\n  \n}\n",
    tests: [
      { args: [2, 1000, [0, 100, 200, 1100]], expect: [true, true, false, true] },
      { args: [1, 10, [0, 5, 10, 15, 20]], expect: [true, false, true, false, true] },
      { args: [3, 100, []], expect: [] },
      { args: [2, 1000, [0, 0, 0, 999, 1000]], expect: [true, true, false, false, true], hidden: true },
      { args: [1, 1, [1, 2, 3]], expect: [true, true, true], hidden: true },
    ],
  },
  {
    id: "diff",
    title: "Object Diff",
    tier: "final",
    fn: "diff",
    prompt:
      "Audit log needs to show what changed. Shallow-compare two plain objects and return { added, removed, changed } — each an array of key names sorted alphabetically. Values compare with === except arrays/objects, which compare by JSON.stringify.",
    starter: "function diff(before, after) {\n  \n}\n",
    tests: [
      { args: [{ a: 1, b: 2 }, { a: 1, b: 3, c: 4 }], expect: { added: ["c"], removed: [], changed: ["b"] } },
      { args: [{ x: 1 }, {}], expect: { added: [], removed: ["x"], changed: [] } },
      { args: [{ t: [1, 2] }, { t: [1, 2] }], expect: { added: [], removed: [], changed: [] } },
      {
        args: [{ z: 1, y: { k: 1 }, m: "a" }, { y: { k: 2 }, m: "a", b: 0, a: null }],
        expect: { added: ["a", "b"], removed: ["z"], changed: ["y"] },
        hidden: true,
      },
      { args: [{}, {}], expect: { added: [], removed: [], changed: [] }, hidden: true },
    ],
  },
  {
    id: "wrap",
    title: "Word Wrap",
    tier: "final",
    fn: "wrap",
    prompt:
      "Terminal UI. Wrap text to a max line width, breaking only at spaces, and return an array of lines. Collapse runs of whitespace. A single word longer than the width goes on its own line unbroken.",
    starter: "function wrap(text, width) {\n  \n}\n",
    tests: [
      { args: ["the quick brown fox", 10], expect: ["the quick", "brown fox"] },
      { args: ["a b c", 1], expect: ["a", "b", "c"] },
      { args: ["hello", 20], expect: ["hello"] },
      { args: ["supercalifragilistic is long", 8], expect: ["supercalifragilistic", "is long"], hidden: true },
      { args: ["  spaced    out  ", 6], expect: ["spaced", "out"], hidden: true },
      { args: ["", 5], expect: [], hidden: true },
    ],
  },
];

export function getProblem(id: string): Problem {
  return PROBLEMS.find((p) => p.id === id) ?? PROBLEMS[0];
}

export function randomProblemId(seed?: number): string {
  const i = Math.floor((seed ?? Math.random()) * PROBLEMS.length) % PROBLEMS.length;
  return PROBLEMS[i].id;
}
