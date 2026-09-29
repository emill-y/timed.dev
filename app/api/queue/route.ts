import { NextResponse } from "next/server";
import { get, set, withLock, hasRedis } from "@/lib/store";
import { claim, cleanHandle } from "@/lib/accounts";
import {
  BOT_FILL_MS, CLOCKS, MODES, STALE_MS, createMatch, makeBot, uid,
  type ClockId, type Format, type Mode, type Player,
} from "@/lib/game";

export const dynamic = "force-dynamic";

type Ticket = { id: string; name: string; handle?: string; party?: string; joinedAt: number; lastSeen: number };
type Assign = { matchId: string; playerId: string };

const clean = (s: unknown, n: number) => String(s ?? "").replace(/[^\w.\-]/g, "").slice(0, n);

// Pack queue groups (a party = players sharing a code) onto two teams.
function formTeams(groups: Ticket[][], per: number): Ticket[][][] | null {
  const teams: Ticket[][][] = [[], []];
  const count = (t: Ticket[][]) => t.reduce((n, g) => n + g.length, 0);
  for (const g of groups) {
    const slot = teams.find((t) => count(t) + g.length <= per);
    if (slot) slot.push(g);
    if (count(teams[0]) === per && count(teams[1]) === per) return teams;
  }
  return null;
}

function toPlayers(teams: Ticket[][][], per: number): Player[] {
  const players: Player[] = [];
  const taken = new Set<string>();
  teams.forEach((groups, ti) => {
    const team = ti as 0 | 1;
    for (const t of groups.flat()) {
      players.push({ id: t.id, name: t.name, handle: t.handle, team, passed: 0, attempts: 0, lastSeen: Date.now() });
      taken.add(t.name);
    }
    while (players.filter((p) => p.team === team).length < per) {
      const b = makeBot(team, taken);
      taken.add(b.name);
      players.push(b);
    }
  });
  return players;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const format: Format = body.format === "ai" ? "ai" : "classic";
  const mode: Mode = body.mode === "2v2" ? "2v2" : "1v1";
  const clock: ClockId = CLOCKS.some((c) => c.id === body.clock) ? body.clock : "blitz";
  let name = cleanHandle(body.name);
  let handle: string | undefined;
  // A handle plus the browser's secret = ranked. Anything else plays unranked.
  if (name && typeof body.token === "string") {
    const c = await claim(name, body.token);
    if (c === "taken") return NextResponse.json({ status: "error", error: `handle "${name}" is already claimed on another device` }, { status: 409 });
    if (c === "ok") handle = name;
  }
  name ||= "anon_" + uid().slice(0, 4);
  const party = mode === "2v2" ? clean(body.party, 12).toLowerCase() || undefined : undefined;
  const id: string = clean(body.ticket, 16) || uid() + uid();
  const size = MODES[mode].size;
  const per = size / 2;
  const qkey = `queue:${format}:${mode}:${clock}`;
  const now = Date.now();

  // Practice: straight into a match against bots.
  if (body.practice) {
    const teams = [[[{ id, name, handle, joinedAt: now, lastSeen: now }]], []];
    const match = createMatch(format, mode, clock, toPlayers(teams, per));
    await set(`match:${match.id}`, match, 3600);
    return NextResponse.json({ status: "matched", matchId: match.id, playerId: id });
  }

  try {
    return await withLock(qkey, async () => {
      const assigned = await get<Assign>(`ticket:${id}`);
      if (assigned) return NextResponse.json({ status: "matched", ...assigned });

      let queue = ((await get<Ticket[]>(qkey)) ?? []).filter((t) => now - t.lastSeen < STALE_MS);
      let me = queue.find((t) => t.id === id);
      if (!me) {
        me = { id, name, handle, party, joinedAt: now, lastSeen: now };
        queue.push(me);
      }
      me.lastSeen = now;

      // Group by party, in join order.
      const groups: Ticket[][] = [];
      for (const t of queue) {
        const g = t.party ? groups.find((x) => x[0].party === t.party) : undefined;
        if (g && g.length < per) g.push(t);
        else groups.push([t]);
      }

      let teams = formTeams(groups, per);
      // Nobody around? Fill empty seats with ghosts once the oldest ticket
      // has waited long enough.
      if (!teams && queue.length && now - queue[0].joinedAt > BOT_FILL_MS) {
        const partial: Ticket[][][] = [[], []];
        const count = (t: Ticket[][]) => t.reduce((n, g) => n + g.length, 0);
        for (const g of groups) {
          const slot = partial.find((t) => count(t) + g.length <= per);
          if (slot) slot.push(g);
        }
        teams = partial;
      }

      if (teams) {
        const players = toPlayers(teams, per);
        const match = createMatch(format, mode, clock, players);
        await set(`match:${match.id}`, match, 3600);
        const ids = new Set(players.map((p) => p.id));
        for (const p of players) if (!p.bot) await set(`ticket:${p.id}`, { matchId: match.id, playerId: p.id }, 600);
        queue = queue.filter((t) => !ids.has(t.id));
        await set(qkey, queue, 120);
        if (ids.has(id)) return NextResponse.json({ status: "matched", matchId: match.id, playerId: id });
      } else {
        await set(qkey, queue, 120);
      }

      return NextResponse.json({
        status: "waiting",
        ticket: id,
        inQueue: queue.length,
        size,
        waited: now - me.joinedAt,
        botFillMs: BOT_FILL_MS,
        shared: hasRedis,
      });
    });
  } catch {
    return NextResponse.json({ status: "waiting", ticket: id, inQueue: 0, size, waited: 0, botFillMs: BOT_FILL_MS, shared: hasRedis });
  }
}
