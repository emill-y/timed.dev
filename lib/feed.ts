// Venmo-style public feed: match results, drop clears and drop openings,
// with likes and short comments. Newest first, capped.
import { lpushCapped, lrange, sadd, smembers, srem } from "./store.ts";
import { uid } from "./game.ts";

export type Span = { t: string; b?: boolean };
export type Actor = { login: string; avatar?: string };
export type Post = {
  id: string;
  at: number;
  kind: "match" | "drop" | "drop_open";
  actor?: Actor;
  line: Span[]; // "eisha beat ghost_nitro"
  detail: string; // "Rate Limiter · bullet · 22.1s"
  pts?: number;
  won?: boolean;
  drop?: number;
};
export type Comment = { id: string; at: number; by: Actor; text: string };

const FEED = "feed:global";
const MAX = 300;

export async function post(p: Omit<Post, "id" | "at">): Promise<void> {
  await lpushCapped(FEED, { ...p, id: uid() + uid(), at: Date.now() }, MAX);
}

export async function page(offset: number, limit: number, viewer?: string) {
  const posts = await lrange<Post>(FEED, offset, offset + limit - 1);
  return Promise.all(
    posts.map(async (p) => {
      const likes = await smembers(`feed:likes:${p.id}`);
      const comments = await lrange<Comment>(`feed:c:${p.id}`, 0, 49);
      return { ...p, likes: likes.length, liked: viewer ? likes.includes(viewer.toLowerCase()) : false, comments: comments.reverse() };
    }),
  );
}

export async function toggleLike(postId: string, login: string): Promise<boolean> {
  const k = `feed:likes:${postId}`;
  const who = login.toLowerCase();
  const on = (await smembers(k)).includes(who);
  if (on) await srem(k, who);
  else await sadd(k, who);
  return !on;
}

export async function addComment(postId: string, by: Actor, text: string): Promise<Comment> {
  const c: Comment = { id: uid(), at: Date.now(), by, text };
  await lpushCapped(`feed:c:${postId}`, c, 50);
  return c;
}

export async function postExists(postId: string): Promise<boolean> {
  const posts = await lrange<Post>(FEED, 0, MAX - 1);
  return posts.some((p) => p.id === postId);
}

