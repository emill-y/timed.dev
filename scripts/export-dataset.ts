// Offline dataset for SFT / evals: generated tasks with hidden tests and a
// reference solution, one JSON object per line.
//   npm run export:dataset -- 1000 > tasks.jsonl
//   npm run export:dataset -- 500 repair > repair.jsonl
import { FAMILIES, generate, rand } from "../lib/generators.ts";
import { corrupt, describe } from "../lib/glitch.ts";

process.stdout.on("error", () => process.exit(0)); // e.g. piped into head
const n = Number(process.argv[2]) || 100;
const mode = process.argv[3] === "repair" ? "repair" : "solve";
const r = rand(Number(process.env.SEED) || 20260930);

for (let i = 0; i < n; i++) {
  const p = generate(r.pick(FAMILIES).id, r.int(0, 2 ** 31 - 1));
  const broken = mode === "repair" ? corrupt(p.solution, i + 1) : null;
  process.stdout.write(
    JSON.stringify({
      task_id: p.id,
      mode,
      family: p.family,
      difficulty: p.difficulty,
      title: p.title,
      prompt: p.prompt,
      function_name: p.fn,
      starter_code: broken ? broken.text : p.starter,
      damage: broken ? describe(broken.report) : undefined,
      tests: p.tests.map((t) => ({ args: t.args, expect: t.expect, hidden: Boolean(t.hidden) })),
      reference_solution: p.solution,
    }) + "\n",
  );
}
