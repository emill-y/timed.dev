// Every generated ticket must pass the server judge with its own reference
// solution, and generation must be deterministic.
import { FAMILIES, generate, generateFromSeed } from "../lib/generators.ts";
import { judge } from "../lib/judge.ts";
let bad = 0, n = 0;
for (const f of FAMILIES) {
  for (let seed = 1; seed <= 12; seed++) {
    const p = generate(f.id, seed * 7919);
    const out = await judge(p.solution, p, true);
    n++;
    if (out.fatal || !out.results.every((r) => r.pass)) { bad++; console.log("FAIL", p.id, out.fatal, JSON.stringify(out.results.filter(r=>!r.pass)).slice(0,300)); }
    // determinism
    if (JSON.stringify(generate(f.id, seed * 7919).tests) !== JSON.stringify(p.tests)) { bad++; console.log("NONDETERMINISTIC", p.id); }
  }
}
console.log(`${n} generated tickets, ${bad} problems`);
if (bad) process.exit(1);
const s = generateFromSeed(123456);
console.log(s.id, "|", s.title, "|", s.prompt, "\n", s.tests.slice(0, 2));
const titles = new Set(); for (let i = 0; i < 48; i++) titles.add(generateFromSeed(1000 + i).title);
console.log("distinct titles in a day of drops:", titles.size, "/ 48");
