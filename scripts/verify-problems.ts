// Sanity check: every problem's tests pass against a reference solution.
import { PROBLEMS } from "../lib/problems.ts";
import { deepEqual } from "../lib/equal.ts";

const ref: Record<string, (...a: any[]) => unknown> = {
  parseDuration(s: string) {
    if (!/^(\d+[dhms])+$/.test(s)) return null;
    const mult: Record<string, number> = { d: 86400, h: 3600, m: 60, s: 1 };
    const seen = new Set<string>();
    let t = 0;
    for (const [, n, u] of s.matchAll(/(\d+)([dhms])/g)) {
      if (seen.has(u)) return null;
      seen.add(u);
      t += Number(n) * mult[u];
    }
    return t;
  },
  flatten(o: any) {
    const out: any = {};
    const walk = (v: any, p: string) => {
      for (const [k, x] of Object.entries(v)) {
        const key = p ? p + "." + k : k;
        if (x && typeof x === "object" && !Array.isArray(x)) walk(x, key);
        else out[key] = x;
      }
    };
    walk(o, "");
    return out;
  },
  compareVersions(a: string, b: string) {
    const p = (s: string) => s.replace(/^v/, "").split(".").map(Number);
    const x = p(a), y = p(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (x[i] ?? 0) - (y[i] ?? 0);
      if (d) return d > 0 ? 1 : -1;
    }
    return 0;
  },
  pack(s: string) {
    return s.replace(/(.)\1*/g, (m, c) => (m.length >= 3 ? m.length + c : m));
  },
  mergeSlots(s: number[][]) {
    const out: number[][] = [];
    for (const [a, b] of [...s].sort((p, q) => p[0] - q[0])) {
      const last = out[out.length - 1];
      if (last && a <= last[1]) last[1] = Math.max(last[1], b);
      else out.push([a, b]);
    }
    return out;
  },
  parseLog(l: string) {
    const m = l.match(/^([A-Z]+) (\/[^\s?]*)(?:\?(\S*))? (\d{3}) (\d+)ms$/);
    if (!m) return null;
    return { method: m[1], path: m[2], query: Object.fromEntries(new URLSearchParams(m[3] ?? "")), status: +m[4], ms: +m[5] };
  },
  isIPv4(s: string) {
    const p = s.split(".");
    return p.length === 4 && p.every((x) => /^(0|[1-9]\d{0,2})$/.test(x) && +x <= 255);
  },
  rateLimit(limit: number, w: number, times: number[]) {
    const ok: number[] = [];
    return times.map((t) => {
      const recent = ok.filter((x) => x > t - w).length;
      if (recent < limit) { ok.push(t); return true; }
      return false;
    });
  },
  diff(a: any, b: any) {
    const eq = (x: any, y: any) => (x && typeof x === "object") || (y && typeof y === "object") ? JSON.stringify(x) === JSON.stringify(y) : x === y;
    return {
      added: Object.keys(b).filter((k) => !(k in a)).sort(),
      removed: Object.keys(a).filter((k) => !(k in b)).sort(),
      changed: Object.keys(a).filter((k) => k in b && !eq(a[k], b[k])).sort(),
    };
  },
  wrap(t: string, w: number) {
    const lines: string[] = [];
    let cur = "";
    for (const word of t.split(/\s+/).filter(Boolean)) {
      if (!cur) cur = word;
      else if (cur.length + 1 + word.length <= w) cur += " " + word;
      else { lines.push(cur); cur = word; }
    }
    if (cur) lines.push(cur);
    return lines;
  },
  calc(src: string) {
    let i = 0;
    const s = src.replace(/\s+/g, "");
    const num = (): number | null => {
      if (s[i] === "-") { i++; const v = num(); return v == null ? null : -v; }
      if (s[i] === "(") { i++; const v = expr(); if (v == null || s[i] !== ")") return null; i++; return v; }
      const m = s.slice(i).match(/^\d+(\.\d+)?/);
      if (!m) return null;
      i += m[0].length;
      return Number(m[0]);
    };
    const term = (): number | null => {
      let v = num();
      while (v != null && (s[i] === "*" || s[i] === "/")) {
        const op = s[i++]; const r = num();
        if (r == null) return null;
        if (op === "/" && r === 0) return null;
        v = op === "*" ? v * r : v / r;
      }
      return v;
    };
    const expr = (): number | null => {
      let v = term();
      while (v != null && (s[i] === "+" || s[i] === "-")) {
        const op = s[i++]; const r = term();
        if (r == null) return null;
        v = op === "+" ? v + r : v - r;
      }
      return v;
    };
    const v = expr();
    return v == null || i !== s.length ? null : v;
  },
  lru(cap: number, ops: any[]) {
    const m = new Map();
    const out: number[] = [];
    for (const [op, k, v] of ops) {
      if (op === "get") {
        if (!m.has(k)) { out.push(-1); continue; }
        const x = m.get(k); m.delete(k); m.set(k, x); out.push(x);
      } else {
        if (cap === 0) continue;
        m.delete(k); m.set(k, v);
        if (m.size > cap) m.delete(m.keys().next().value);
      }
    }
    return out;
  },
  parseTable(md: string) {
    const rows = md.split("\n").map((l) => l.trim()).filter(Boolean)
      .map((l) => l.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()));
    if (!rows.length) return [];
    const [head, ...rest] = rows;
    return rest.filter((r) => !r.every((c) => /^:?-+:?$/.test(c))).map((r) =>
      Object.fromEntries(head.map((h, j) => {
        const c = r[j] ?? "";
        return [h, c === "" ? null : /^-?\d+(\.\d+)?$/.test(c) ? Number(c) : c];
      })));
  },
  installOrder(deps: Record<string, string[]>) {
    const nodes = new Set<string>();
    for (const [k, v] of Object.entries(deps)) { nodes.add(k); v.forEach((d) => nodes.add(d)); }
    const done: string[] = [];
    const left = new Set(nodes);
    while (left.size) {
      const ready = [...left].filter((n) => (deps[n] ?? []).every((d) => !left.has(d))).sort();
      if (!ready.length) return null;
      left.delete(ready[0]); done.push(ready[0]);
    }
    return done;
  },
  query(obj: any, path: string) {
    const toks = path.match(/[^.[\]]+|\[(\d+|\*)\]/g) ?? [];
    const MISS = Symbol();
    const walk = (v: any, t: string[]): any => {
      if (!t.length) return v;
      const [h, ...r] = t;
      if (h === "[*]") {
        if (!Array.isArray(v)) return MISS;
        const out: any[] = [];
        for (const e of v) {
          const x = walk(e, r);
          if (x === MISS) continue;
          if (r.includes("[*]") && Array.isArray(x)) out.push(...x); else out.push(x);
        }
        return out;
      }
      const key = h.startsWith("[") ? Number(h.slice(1, -1)) : h;
      if (v == null || typeof v !== "object" || !(key in v)) return MISS;
      return walk(v[key], r);
    };
    const x = walk(obj, toks);
    return x === MISS ? null : x;
  },
};

let fail = 0;
for (const p of PROBLEMS) {
  const f = ref[p.fn];
  if (!f) { console.log("NO REF", p.fn); fail++; continue; }
  p.tests.forEach((t, i) => {
    const got = f(...structuredClone(t.args));
    if (!deepEqual(got, t.expect)) { fail++; console.log(`FAIL ${p.id}#${i}`, JSON.stringify(got), "!=", JSON.stringify(t.expect)); }
  });
}
console.log(fail ? `${fail} failures` : `all ${PROBLEMS.length} problems verified`);
process.exit(fail ? 1 : 0);
