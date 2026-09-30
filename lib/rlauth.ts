// Bearer-key auth for the RL API. Keys come from RL_API_KEYS (comma
// separated). With no keys configured the API only answers outside
// production, so a fresh deploy never exposes free compute.
import { limited } from "./auth";

export async function rlGate(req: Request): Promise<{ ok: true; key: string } | { ok: false; status: number; error: string }> {
  const keys = (process.env.RL_API_KEYS || "").split(",").map((k) => k.trim()).filter(Boolean);
  const got = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (keys.length) {
    if (!keys.includes(got)) return { ok: false, status: 401, error: "missing or invalid API key" };
  } else if (process.env.NODE_ENV === "production") {
    return { ok: false, status: 503, error: "RL API disabled: set RL_API_KEYS on the deployment" };
  }
  const key = got || "dev";
  if (await limited(`rl:${key}`, 600, 60)) return { ok: false, status: 429, error: "rate limited (600 steps/min per key)" };
  return { ok: true, key };
}
