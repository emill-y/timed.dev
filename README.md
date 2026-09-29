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

Keyboard first: `enter` to queue, `ctrl+enter` to run, `ctrl+shift+enter` to submit, `esc` to back out.

## Stack

- Next.js 15 (App Router) + React 19 + TypeScript. No UI kit, just hand-written CSS.
- Player code runs in a sandboxed **Web Worker in the player's own browser**, with a 3s kill switch for infinite loops. The server never executes user code.
- Matchmaking and match state go through two small API routes (`/api/queue` and `/api/match/[id]`), polled once a second.
- Storage: **Upstash Redis** over REST when configured. Without it, state lives in process memory, which is fine for `npm run dev`. On serverless, though, separate instances don't share memory, so live human-vs-human matches need Redis.

## Run locally

```bash
npm install
npm run dev              # http://localhost:3000
npm run test:problems    # checks every ticket's tests against a reference solution
```

## Deploy to Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import this GitHub repo. No settings to change: the framework is detected as Next.js.
2. To get real human matchmaking, add Redis: in the Vercel project, open **Storage → Marketplace → Upstash (Redis)** and connect it. That sets `KV_REST_API_URL` / `KV_REST_API_TOKEN`; `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` also work. Then redeploy.

Or from a terminal: `npx vercel --prod`.

## Adding tickets

Tickets live in `lib/problems.ts`. Each one has a prompt, a stub, and tests (mark edge cases `hidden: true`). Add a reference solution to `scripts/verify-problems.ts` and run `npm run test:problems`.

## Known limits (MVP)

- Players report their own test results, so a determined cheater can lie. The fix is server-side verification in an isolated runner.
- Only JavaScript for now. Python via Pyodide is the obvious next step.
