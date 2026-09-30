// A new generated ticket goes live every 30 minutes. Everyone gets one
// attempt per drop; times go on a per-drop board. Drops are derived from the
// clock, so no scheduler is needed: the first request in a new window
// "opens" it (and posts it to the feed).
import { generateFromSeed, type Generated } from "./generators.ts";

export const DROP_MS = 30 * 60 * 1000;
export const DROP_CLOCK_MS = 10 * 60 * 1000; // per-attempt clock
const SALT = 0x7d11; // changes the whole schedule if the ticket pool ever leaks
const EPOCH = Date.UTC(2026, 8, 1); // drop #0: 2026-09-01 00:00 UTC

export type Drop = { n: number; startsAt: number; endsAt: number; problem: Generated };

export function dropAt(now = Date.now()): Drop {
  const n = Math.floor((now - EPOCH) / DROP_MS);
  return dropN(n);
}

export function dropN(n: number): Drop {
  return { n, startsAt: EPOCH + n * DROP_MS, endsAt: EPOCH + (n + 1) * DROP_MS, problem: generateFromSeed(Math.imul(n, 2654435761) ^ SALT) };
}
