// RL environment over the same machinery the game uses: procedural tickets
// (lib/generators), the sandboxed judge (lib/judge) and the glitch corrupter
// (lib/glitch). Two task types:
//   solve  - write the function from the spec
//   repair - fix a reference solution that the glitch mode damaged
// Rewards are verifiable: they come from executing hidden tests.
import { createHash, randomBytes } from "node:crypto";
import { FAMILIES, generate, rand } from "./generators";
import { judge, type RunOutput } from "./judge";
import { corrupt, describe } from "./glitch";
import { get, set } from "./store";

export type TaskMode = "solve" | "repair";
export type Episode = {
  id: string;
  problemId: string;
  mode: TaskMode;
  broken?: string;
  step: number;
  maxSteps: number;
  done: boolean;
  best: number;
  createdAt: number;
};

const TTL = 60 * 60 * 6;

export function observation(ep: Episode) {
  const p = generate(...(split(ep.problemId)));
  return {
    episode_id: ep.id,
    task_id: ep.problemId,
    mode: ep.mode,
    family: p.family,
    difficulty: p.difficulty,
    title: p.title,
    prompt: p.prompt,
    function_name: p.fn,
    starter_code: ep.mode === "repair" ? ep.broken! : p.starter,
    visible_tests: p.tests.filter((t) => !t.hidden).map((t) => ({ args: t.args, expect: t.expect })),
    hidden_test_count: p.tests.filter((t) => t.hidden).length,
    step: ep.step,
    max_steps: ep.maxSteps,
    language: "javascript",
    instructions:
      ep.mode === "repair"
        ? "The starter code was a working solution until it got corrupted (lines deleted, identifiers misspelled or an operator flipped). Return the repaired, complete function."
        : "Return a complete JavaScript function declaration with the given name. No imports; the runtime has no Node, DOM or network.",
  };
}

function split(problemId: string): [string, number] {
  const m = /^gen-([a-z-]+?)-(\d+)$/.exec(problemId)!;
  return [m[1], Number(m[2])];
}

export async function reset(opts: { seed?: number; family?: string; mode?: TaskMode; difficulty?: number; maxSteps?: number }) {
  const seed = Number.isFinite(opts.seed) ? Number(opts.seed) >>> 0 : randomBytes(4).readUInt32BE(0);
  const r = rand(seed);
  let pool = FAMILIES.map((f) => f.id);
  if (opts.family) {
    if (!pool.includes(opts.family)) throw new Error(`unknown family "${opts.family}"`);
    pool = [opts.family];
  }
  let problem = generate(r.pick(pool), r.int(0, 2 ** 31 - 1));
  // Difficulty filter: resample a few times, then settle.
  for (let i = 0; opts.difficulty && problem.difficulty !== opts.difficulty && i < 40; i++) problem = generate(r.pick(pool), r.int(0, 2 ** 31 - 1));
  const mode: TaskMode = opts.mode === "repair" ? "repair" : "solve";
  const ep: Episode = {
    id: createHash("sha256").update(randomBytes(16)).digest("hex").slice(0, 24),
    problemId: problem.id,
    mode,
    step: 0,
    maxSteps: Math.min(20, Math.max(1, Number(opts.maxSteps) || 5)),
    done: false,
    best: 0,
    createdAt: Date.now(),
  };
  let damage: string | undefined;
  if (mode === "repair") {
    // A good repair task breaks something the tests can see while keeping
    // most of the original, so it's a fix and not a rewrite. Tiny functions
    // get renames / operator flips instead of deleted lines.
    const size = (t: string) => t.replace(/\s+/g, "").length;
    const attempts = [...Array(8)].map((_, i) => ({ seed: seed + i, noDelete: false })).concat([...Array(8)].map((_, i) => ({ seed: seed + 100 + i, noDelete: true })));
    for (const a of attempts) {
      const { text, report } = corrupt(problem.solution, a.seed, { noDelete: a.noDelete });
      if (text === problem.solution || size(text) < size(problem.solution) * 0.7) continue;
      const out = await judge(text, problem, true);
      if (out.fatal || out.results.some((x) => !x.pass)) {
        ep.broken = text;
        damage = describe(report);
        break;
      }
    }
    if (!ep.broken) {
      // Nothing subtle broke it: fall back to a plain rewrite task.
      ep.broken = problem.starter;
      damage = "none (write it from scratch)";
    }
  }
  await set(`rl:ep:${ep.id}`, ep, TTL);
  return { observation: observation(ep), info: { seed, repair_damage: damage } };
}

export async function step(episodeId: string, code: string) {
  const ep = await get<Episode>(`rl:ep:${episodeId}`);
  if (!ep) throw new Error("unknown or expired episode");
  if (ep.done) throw new Error("episode is done; call reset");
  const problem = generate(...split(ep.problemId));
  const out: RunOutput = await judge(String(code).slice(0, 20000), problem, true);
  const passed = out.results.filter((r) => r.pass).length;
  const total = problem.tests.length;
  const frac = out.fatal ? 0 : passed / total;
  const solved = !out.fatal && passed === total;
  ep.step++;
  // Reward: improvement over the best score so far (sums to the final pass
  // rate), plus a bonus for fully solving, earlier being better.
  const reward = Math.max(0, frac - ep.best) + (solved ? 1 - (ep.step - 1) / ep.maxSteps / 2 : 0);
  ep.best = Math.max(ep.best, frac);
  const truncated = !solved && ep.step >= ep.maxSteps;
  ep.done = solved || truncated;
  await set(`rl:ep:${ep.id}`, ep, TTL);
  return {
    observation: { ...observation(ep), feedback: { fatal: out.fatal ?? null, results: out.results, logs: out.logs.slice(0, 20) } },
    reward: Math.round(reward * 1e4) / 1e4,
    terminated: solved,
    truncated,
    info: { passed, total, pass_rate: frac, solved, best_pass_rate: ep.best },
  };
}

export function spec() {
  return {
    name: "timed.dev/code-v1",
    task_modes: ["solve", "repair"],
    families: FAMILIES.map((f) => {
      const sample = generate(f.id, 1);
      return { id: f.id, difficulty: sample.difficulty, example_title: sample.title };
    }),
    reward: "per step: max(0, pass_rate - best_so_far); on full solve: + (1 - (step-1)/max_steps/2). Undiscounted sum lies in [0, 2].",
    limits: { memory_mb: 24, per_test_ms: 1000, per_step_ms: 4000, max_code_chars: 20000, max_steps: 20 },
  };
}
