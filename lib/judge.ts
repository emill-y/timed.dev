// Server-side judge. Player code runs inside QuickJS compiled to WebAssembly:
// a separate JS engine with its own heap, no access to Node, the network or
// the filesystem, plus hard limits on memory, stack and time. Results from
// here are the only ones that count toward progress, wins and points.
import { getQuickJS, shouldInterruptAfterDeadline, type QuickJSContext } from "quickjs-emscripten";
import type { Problem } from "./problems";
import { deepEqual } from "./equal.ts";

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

const PER_TEST_MS = 1000;
const TOTAL_MS = 4000;
const UNDEF = "__timed_undefined__";

const HARNESS = `
var __logs = [];
var __fmt = function (v) { try { return typeof v === "string" ? v : JSON.stringify(v); } catch (e) { return String(v); } };
var __log = function () { if (__logs.length < 200) __logs.push(Array.prototype.map.call(arguments, __fmt).join(" ").slice(0, 500)); };
var console = { log: __log, info: __log, warn: __log, error: __log, debug: __log };
// Browser APIs QuickJS doesn't ship that ticket solutions commonly reach for.
var structuredClone = function (v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); };
function URLSearchParams(init) {
  this._p = [];
  var s = typeof init === "string" ? init.replace(/^\\?/, "") : "";
  var dec = function (x) { return decodeURIComponent(x.replace(/\\+/g, " ")); };
  if (s) s.split("&").forEach(function (kv) {
    if (!kv) return;
    var i = kv.indexOf("=");
    this._p.push(i < 0 ? [dec(kv), ""] : [dec(kv.slice(0, i)), dec(kv.slice(i + 1))]);
  }, this);
  if (init && typeof init === "object") Object.keys(init).forEach(function (k) { this._p.push([k, String(init[k])]); }, this);
}
URLSearchParams.prototype.get = function (k) { for (var i = 0; i < this._p.length; i++) if (this._p[i][0] === k) return this._p[i][1]; return null; };
URLSearchParams.prototype.getAll = function (k) { return this._p.filter(function (e) { return e[0] === k; }).map(function (e) { return e[1]; }); };
URLSearchParams.prototype.has = function (k) { return this.get(k) !== null; };
URLSearchParams.prototype.append = function (k, v) { this._p.push([k, String(v)]); };
URLSearchParams.prototype.entries = function () { return this._p.map(function (e) { return [e[0], e[1]]; })[Symbol.iterator](); };
URLSearchParams.prototype.keys = function () { return this._p.map(function (e) { return e[0]; })[Symbol.iterator](); };
URLSearchParams.prototype.values = function () { return this._p.map(function (e) { return e[1]; })[Symbol.iterator](); };
URLSearchParams.prototype.forEach = function (f) { this._p.forEach(function (e) { f(e[1], e[0], this); }, this); };
URLSearchParams.prototype[Symbol.iterator] = URLSearchParams.prototype.entries;
`;

function evalJson(vm: QuickJSContext, src: string): { value?: unknown; error?: string } {
  const r = vm.evalCode(src);
  if (r.error) {
    const e = vm.dump(r.error);
    r.error.dispose();
    const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e);
    const name = e && typeof e === "object" && "name" in e ? String((e as { name: unknown }).name) : "";
    if (/interrupted/i.test(msg)) return { error: "timed out (infinite loop?)" };
    if (/out of memory/i.test(msg)) return { error: "out of memory" };
    return { error: name && name !== "Error" ? `${name}: ${msg}` : msg };
  }
  const v = vm.dump(r.value);
  r.value.dispose();
  return { value: v };
}

export async function judge(code: string, problem: Problem, includeHidden: boolean): Promise<RunOutput> {
  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(24 * 1024 * 1024);
  runtime.setMaxStackSize(1024 * 1024);
  const vm = runtime.newContext();
  const started = Date.now();
  const deadline = (ms: number) => runtime.setInterruptHandler(shouldInterruptAfterDeadline(Math.min(Date.now() + ms, started + TOTAL_MS)));

  const tests = problem.tests.map((t, i) => ({ ...t, i })).filter((t) => includeHidden || !t.hidden);
  const out: RunOutput = { results: [], logs: [] };

  try {
    deadline(PER_TEST_MS);
    const h = evalJson(vm, HARNESS);
    if (h.error) throw new Error(`judge harness: ${h.error}`);
    if (problem.noEval) evalJson(vm, "globalThis.eval = undefined; globalThis.Function = undefined;");

    // Models love `export`; it's meaningless here, so drop it.
    const src = code.replace(/^(\s*)export\s+(default\s+)?/gm, "$1");
    const load = evalJson(vm, src);
    if (load.error) {
      out.fatal = load.error;
      return out;
    }
    const found = evalJson(vm, `typeof ${problem.fn} === "function"`);
    if (found.value !== true) {
      out.fatal = `function ${problem.fn}() not found`;
      return out;
    }

    let dead: string | null = null; // after a timeout / OOM the VM is unusable
    for (const t of tests) {
      const t0 = Date.now();
      if (dead || t0 - started > TOTAL_MS) {
        out.results.push({ i: t.i, pass: false, hidden: Boolean(t.hidden), error: dead ? "skipped" : "out of time", ms: 0 });
        continue;
      }
      deadline(PER_TEST_MS);
      const call = `(function () {
        var got = ${problem.fn}.apply(null, JSON.parse(${JSON.stringify(JSON.stringify(t.args))}));
        return got === undefined ? ${JSON.stringify(UNDEF)} : JSON.stringify(got);
      })()`;
      const r = evalJson(vm, call);
      const ms = Date.now() - t0;
      let got: unknown;
      let error = r.error;
      if (error && /timed out|memory/i.test(error)) dead = error;
      if (!error) {
        try {
          got = r.value === UNDEF ? undefined : JSON.parse(String(r.value));
        } catch {
          error = "returned a value that can't be serialized";
        }
      }
      const pass = !error && deepEqual(got, t.expect);
      out.results.push(
        t.hidden
          ? { i: t.i, pass, hidden: true, ms, error: error ? "threw" : undefined }
          : { i: t.i, pass, hidden: false, ms, args: t.args, expect: t.expect, got: got === undefined ? "undefined" : got, error },
      );
    }
    if (!dead) {
      deadline(PER_TEST_MS);
      const logs = evalJson(vm, "JSON.stringify(__logs)");
      out.logs = typeof logs.value === "string" ? JSON.parse(logs.value) : [];
    }
    return out;
  } catch (e) {
    out.fatal = /memory/i.test(String(e)) ? "out of memory" : String((e as Error)?.message ?? e);
    return out;
  } finally {
    try {
      vm.dispose();
      runtime.dispose();
    } catch {
      // A runtime that blew its memory limit can refuse to dispose cleanly.
    }
  }
}
