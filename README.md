# timed.dev

**Prompt. Ship. Beat the clock.**

Real-time coding duels for the AI era. You and your opponent get the same ticket and the same clock, and you can use any tools you like (AI, docs, your own hands). First to turn every test green wins.

LeetCode tested whether you could write a loop from memory. timed.dev tests **speed, judgement and how well you steer AI**: scope a loose ticket, spot the hidden edge cases, and ship something that works before the other person does.

## How a match works

- **Modes:** `1v1 duel` or `2v2 co-hack`. In co-hack your team wins the moment either of you goes all-green. You can watch your teammate's code live and pull it into your own editor. Share a **party code** to queue with a friend.
- **Clocks:** bullet 3:00 · blitz 5:00 · rapid 10:00.
- **RUN** checks the visible tests for free. **SUBMIT** also runs the hidden edge cases, and each failed submit adds a **+10s** penalty to your finish time.
- If the clock runs out, the team that passed the most tests wins.
- Nobody else in the queue? After 12s **ghosts** (bots on a realistic pace curve) take the empty seats. You can also go straight to *practice vs ghost*.
- Results show your time, submits, runs, and **paste share** (how much of your code was pasted rather than typed). It's a stat, not a penalty.

## Drops: a new challenge every 30 minutes

On the hour and half hour, a fresh **generated** ticket goes live (`lib/generators.ts`). Nine ticket families each randomize their rules, wording and test data from a seed, and expected answers come from executing a reference solution, so drops never run dry and are always solvable. Everyone gets **one attempt** per drop with 10 minutes on their own clock, and **glitch paste is always on**: one damaged paste, then the clipboard locks. The fastest clear takes the drop board, and the home screen counts down to the next one. There's no cron: the drop is derived from the clock, and the first visitor of a window posts "drop #N is live" to the feed. `npm run test:generators` runs 108 generated tickets through the server judge with their reference solutions.

## The feed

`/feed` is a public, Venmo-style timeline: "eisha beat ghost_nitro · Rate Limiter · bullet · 22.1s", with points shown where Venmo shows amounts, GitHub avatars, likes and comments. Every finished match and every drop clear by a signed-in player posts automatically.

## RL environment

The same generators, sandboxed judge and glitch corrupter are exposed as an RL environment for coding models, with `solve` and `repair` tasks, verifiable rewards, a Python client and a dataset exporter. See [`rl/README.md`](rl/README.md).

## Hard modes

Toggle under the mode bar on the home screen. Hard-mode players only get matched with each other, and wins pay extra points.

- **Glitch paste (x1.3 points).** Your first paste goes through, but it arrives damaged after a glitch animation. Roughly a quarter of its logic lines (up to 4) are deleted, leaving their indentation behind as gaps. One or two variable names get scrambled into typos at some of their uses. When nothing gets renamed, a comparison or off-by-one gets flipped instead. You have to find and fix the damage by hand. After that, paste, copy, cut and drag-and-drop are locked for the rest of the match, and pulling a teammate's code counts as your paste. In AI mode, every block of copilot code arrives damaged.

The corruption logic lives in `lib/glitch.ts`.

## AI mode: how good a Claude coder are you?

A separate format (with its own queue and leaderboard) built around **boss tickets**: an expression evaluator, an LRU cache replay, a markdown table importer, dependency install order, and a JSON-path resolver. These are specs a model half-solves on the first try, with hidden tests that catch the other half.

- **Built-in copilot panel.** Paste your own **Anthropic** key (pick Claude Opus 5.5, Sonnet 5.5 or Haiku 4.5, plus an effort level) or an **OpenAI** key (any model name).
- **Your key stays private.** It's stored only in your browser (the current tab, or localStorage if you tick "remember"), and requests go **straight from your browser to the provider**. The timed.dev server never sees the key or your prompts.
- **Context and code are automatic.** Each prompt carries your current code and your last test run. The reply's code block is auto-applied (with undo).
- **Scoring.** Results show prompts used and tokens spent. Boss wins pay x1.25.

## Accounts, points & leaderboard

**Sign in with GitHub** (the only way to create an account). The OAuth flow uses a one-time `state` cookie. The access token is used once to read your public profile, then dropped. Accounts are keyed by GitHub's numeric user id, so renaming your GitHub login keeps your history. Sessions are random tokens in an `httpOnly` cookie, and the server stores only their SHA-256 hash. Guests can still play regular matches unranked, but drops, points, likes and comments need an account.

**Points can't be faked.** Every RUN and SUBMIT is judged **on the server**. Player code runs in [QuickJS](https://github.com/justjake/quickjs-emscripten) compiled to WebAssembly: a separate JS engine with no access to Node, the network or the filesystem, capped at 24 MB of memory, 1s per test and 4s per submission. Progress bars, finish times, failed-submit penalties, wins and points all come from judged results. Browsers can't report scores, and opponents never learn your seat id.

Monkeytype-style scoring:

| | points |
|---|---|
| win / draw / loss | 100 / 40 / 10 |
| each test passed | +5 |
| speed bonus (wins) | up to +100, scaled by clock time left |
| clock multiplier | bullet x1.5 · blitz x1.2 · rapid x1 |
| AI mode | x1.25 |
| no human opponents (ghosts only) | x0.3, and only the first time you clear that ticket |

Boards: all-time, today, classic, AI mode, at `/leaderboard`. Points are awarded server-side when a match resolves, once per match.

Keyboard first: `enter` to queue, `ctrl+enter` to run, `ctrl+shift+enter` to submit, `ctrl+k` to prompt the copilot, `esc` to back out.

## Stack

- Next.js 15 (App Router) + React 19 + TypeScript. No UI kit, just hand-written CSS.
- Player code is judged server-side in a QuickJS/WASM sandbox (`lib/judge.ts`, route `/api/match/[id]/judge`). It ships browser-ish shims (`URLSearchParams`, `structuredClone`) since tickets commonly reach for them.
- Matchmaking and match state go through two small API routes (`/api/queue` and `/api/match/[id]`), polled once a second.
- The AI copilot uses the official Anthropic and OpenAI JS SDKs in the browser, with `dangerouslyAllowBrowser`. That's safe here because the only key involved is the player's own, kept on the player's machine.
- Storage: **Upstash Redis** over REST when configured (queue, matches, accounts, sessions, leaderboards). **Required in production:** without it, accounts and points live in one server instance's memory and vanish on redeploy. Locally (`npm run dev`) it falls back to process memory.

## Configuration

| env var | what for |
|---|---|
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_*`) | Redis. **Required in production.** |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub sign-in. Create an OAuth App at github.com/settings/developers with callback URL `https://<your-domain>/api/auth/github/callback`. |
| `APP_URL` | optional: your public origin, if the request host isn't it |
| `RL_API_KEYS` | comma-separated keys for the RL API (`/api/env/*`). Unset means the API is off in production. |

Without GitHub credentials, `npm run dev` offers a throwaway "dev sign-in" instead. It never exists in production.

## Run locally

```bash
npm install
npm run dev              # http://localhost:3000
npm run test:problems    # checks every ticket's tests against a reference solution
npm run test:generators  # judges 108 generated tickets with their reference solutions
```

## Deploy to Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import this GitHub repo. No settings to change: the framework is detected as Next.js.
2. To get real human matchmaking, add Redis: in the Vercel project, open **Storage → Marketplace → Upstash (Redis)** and connect it. That sets `KV_REST_API_URL` / `KV_REST_API_TOKEN`; `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` also work. Then redeploy.
3. Create a GitHub OAuth App (see Configuration above) and add `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in Vercel → Settings → Environment Variables. Redeploy.

Or from a terminal: `npx vercel --prod`.

## Adding tickets

Tickets live in `lib/problems.ts`. Each one has a prompt, a stub, and tests (mark edge cases `hidden: true`). Add a reference solution to `scripts/verify-problems.ts` and run `npm run test:problems`.

## Known limits (MVP)

- Drop boards rank by time only. There are no prizes or end-of-drop payouts yet (points are awarded on clear).
- Nothing stops one person from running two accounts and throwing matches between them. Ghost-match farming is capped (see the table above), but human-vs-human collusion isn't detected.
- A few pathological built-ins (e.g. filling a multi-million-element array) can keep the judge busy for several seconds before it hits the memory cap. Per-seat rate limits and one-judge-at-a-time bound the cost.
- Hard-mode clipboard locks are enforced in the browser, so a determined player could get around them with devtools. (Scores themselves are still judged server-side.)
- Only JavaScript for now. Python via Pyodide is the obvious next step.
