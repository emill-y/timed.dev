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
