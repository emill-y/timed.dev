# timed.dev as an RL environment for coding

The game already has the three things a coding RL environment needs, so this folder exposes them directly:

1. **An endless supply of fresh tasks.** `lib/generators.ts` turns any 32-bit seed into a ticket: a spec written like a work ticket, a function signature, visible examples and hidden edge-case tests. Nine families (run-length packing, rule-based counters, ciphers, rolling means, histograms, case conversion, custom-radix encoding, word frequency, chunking) each randomize their *rules*, not just their inputs. Expected outputs come from executing a reference solution, so every task is solvable by construction. `npm run test:generators` checks that.
2. **Verifiable rewards.** Code runs in the same QuickJS/WASM sandbox the game uses for scoring (24 MB, 1s per test, 4s per step, no Node, network or filesystem). Reward comes from hidden tests passing, not from anything a model can claim in text.
3. **A built-in repair task.** The game's "glitch paste" corrupter deletes logic lines, misspells identifiers or flips operators in a working solution. In `repair` mode the policy has to fix it. Tasks are filtered so the damage actually fails tests but keeps most of the original code, so they're fixes rather than rewrites.

## HTTP API

Auth uses `Authorization: Bearer <key>`, with keys taken from the `RL_API_KEYS` env var (comma-separated). With no keys set, the API only answers outside production. The rate limit is 600 calls per minute per key.

| | |
|---|---|
| `GET /api/env/spec` | families, difficulty levels, reward definition, limits |
| `POST /api/env/reset` | body `{ seed?, mode?: "solve" \| "repair", family?, difficulty?: 1-3, maxSteps?: 1-20 }` → `{ observation, info }` |
| `POST /api/env/step` | body `{ episode_id, code }` → `{ observation, reward, terminated, truncated, info }` |

The observation contains `prompt`, `function_name`, `starter_code` (the broken code in repair mode), `visible_tests`, `hidden_test_count`, `step`, `max_steps` and, after a step, `feedback`: per-test results (hidden tests reveal pass/fail only), a crash message and `console.log` output.

**Reward.** Each step earns the improvement in pass rate over the best so far. A full solve adds `1 - (step-1)/max_steps/2`, so solving earlier pays more. The undiscounted return is in [0, 2]. `terminated` means solved; `truncated` means out of steps.

Seeds are deterministic: the same `seed`, `mode` and `family` give the same task. That makes held-out eval splits easy (e.g. seeds ≥ 2³⁰).

## Python client

Dependency-free, in the familiar Gym `reset`/`step` shape:

```python
from timed_env import TimedEnv, render_prompt

env = TimedEnv("https://your-deploy.vercel.app", api_key="...")
obs, info = env.reset(seed=42, mode="repair")
prompt = render_prompt(obs)                  # text for your policy model
obs, reward, terminated, truncated, info = env.step(code_from_model)
```

`rl/python/example.py` runs a baseline policy end to end.

## Offline dataset

For SFT, evals or rejection sampling without calling the API:

```bash
npm run export:dataset -- 5000 > solve.jsonl
npm run export:dataset -- 5000 repair > repair.jsonl
SEED=123 npm run export:dataset -- 1000 > eval.jsonl   # different, reproducible split
```

Each line holds the task, all tests (flagged `hidden`) and `reference_solution`.

## What this is and isn't (for labs)

- **Is:** cheap, verifiable, contamination-resistant tasks, since you can mint new seeds forever, plus a repair variant that targets reading and debugging code rather than writing it. The human game on top produces real human timing data on the same task distribution: how fast strong people solve and repair each family, with and without AI. That's a natural difficulty calibration.
- **Isn't (yet):** a hard benchmark. These are function-level tasks in JavaScript, and today's frontier models will saturate `solve` on most families quickly. Directions to raise the ceiling: multi-function and multi-file tasks, stateful APIs, stricter spec ambiguity with clarification turns, time/token budgets as part of the reward, Python via Pyodide, and harsher repair corruption.
- Sandbox caveat: QuickJS is a separate engine inside WASM, but it is not an audited security boundary for adversarial workloads at scale. For large runs, execute the judge in isolated workers or containers.
