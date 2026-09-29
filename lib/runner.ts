// Runs player code against tests inside a throwaway Web Worker, in the
// player's own browser. A hung loop gets the worker terminated.
import type { Problem } from "./problems";

export type TestResult = {
  i: number;
  pass: boolean;
  hidden: boolean;
  args?: unknown[];
  expect?: unknown;
  got?: unknown;
  error?: string;
  ms: number;
};
export type RunOutput = { results: TestResult[]; logs: string[]; fatal?: string };

const WORKER_SRC = `
const eq = (a, b) => {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && eq(a[k], b[k]));
};
const fmt = (v) => { try { return typeof v === "string" ? v : JSON.stringify(v); } catch { return String(v); } };
onmessage = (e) => {
  const { code, fn, tests } = e.data;
  const logs = [];
  const log = (...a) => { if (logs.length < 200) logs.push(a.map(fmt).join(" ")); };
  const con = { log, info: log, warn: log, error: log, debug: log };
  let f;
  try {
    f = new Function("console", code + "\\n;return typeof " + fn + " === 'function' ? " + fn + " : undefined;")(con);
  } catch (err) {
    postMessage({ results: [], logs, fatal: String(err && err.message || err) });
    return;
  }
  if (typeof f !== "function") {
    postMessage({ results: [], logs, fatal: "function " + fn + "() not found" });
    return;
  }
  const results = tests.map((t, i) => {
    const t0 = performance.now();
    try {
      const got = f(...structuredClone(t.args));
      let safe;
      try { safe = got === undefined ? "undefined" : structuredClone(got); } catch { safe = String(got); }
      return { i, pass: eq(got, t.expect), got: safe, ms: performance.now() - t0 };
    } catch (err) {
      return { i, pass: false, error: String(err && err.message || err), ms: performance.now() - t0 };
    }
  });
  postMessage({ results, logs });
};
`;

let workerUrl: string | null = null;

export function runTests(code: string, problem: Problem, includeHidden: boolean, timeoutMs = 3000): Promise<RunOutput> {
  workerUrl ??= URL.createObjectURL(new Blob([WORKER_SRC], { type: "text/javascript" }));
  const tests = problem.tests
    .map((t, i) => ({ ...t, i }))
    .filter((t) => includeHidden || !t.hidden);

  return new Promise((resolve) => {
    const w = new Worker(workerUrl!);
    const timer = setTimeout(() => {
      w.terminate();
      resolve({ results: [], logs: [], fatal: `timed out after ${timeoutMs / 1000}s (infinite loop?)` });
    }, timeoutMs);
    w.onmessage = (e) => {
      clearTimeout(timer);
      w.terminate();
      const out = e.data as { results: { i: number; pass: boolean; got?: unknown; error?: string; ms: number }[]; logs: string[]; fatal?: string };
      resolve({
        logs: out.logs,
        fatal: out.fatal,
        results: out.results.map((r) => {
          const t = tests[r.i];
          const hidden = Boolean(t.hidden);
          // Hidden tests only reveal pass/fail, never their inputs.
          return hidden
            ? { i: t.i, pass: r.pass, hidden, ms: r.ms, error: r.error ? "threw" : undefined }
            : { i: t.i, pass: r.pass, hidden, ms: r.ms, args: t.args, expect: t.expect, got: r.got, error: r.error };
        }),
      });
    };
    w.onerror = (e) => {
      clearTimeout(timer);
      w.terminate();
      resolve({ results: [], logs: [], fatal: e.message || "worker error" });
    };
    // Models love `export`; it's meaningless here, so drop it.
    const src = code.replace(/^(\s*)export\s+(default\s+)?/gm, "$1");
    w.postMessage({ code: src, fn: problem.fn, tests: tests.map(({ args, expect }) => ({ args, expect })) });
  });
}
