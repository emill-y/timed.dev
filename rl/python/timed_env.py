"""timed.dev coding environment: a tiny, dependency-free Gym-style client.

    env = TimedEnv("https://your-deploy.vercel.app", api_key="...")
    obs, info = env.reset(seed=42, mode="solve")        # or mode="repair"
    obs, reward, terminated, truncated, info = env.step(code)

Observations are dicts (prompt, starter_code, visible_tests, feedback...).
Actions are strings: a complete JavaScript function declaration.
Rewards come from executing hidden tests in a sandbox, so they are
verifiable and can't be gamed by text alone.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Optional


class TimedEnvError(RuntimeError):
    pass


class TimedEnv:
    def __init__(self, base_url: str = "http://localhost:3000", api_key: Optional[str] = None, timeout: float = 30.0):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        self.episode_id: Optional[str] = None

    def _call(self, method: str, path: str, body: Optional[dict] = None) -> dict:
        req = urllib.request.Request(self.base_url + path, method=method)
        req.add_header("Content-Type", "application/json")
        if self.api_key:
            req.add_header("Authorization", f"Bearer {self.api_key}")
        data = json.dumps(body).encode() if body is not None else None
        try:
            with urllib.request.urlopen(req, data=data, timeout=self.timeout) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            try:
                msg = json.loads(e.read()).get("error", str(e))
            except Exception:
                msg = str(e)
            raise TimedEnvError(f"{e.code}: {msg}") from None

    def spec(self) -> dict:
        return self._call("GET", "/api/env/spec")

    def reset(self, seed: Optional[int] = None, mode: str = "solve", family: Optional[str] = None,
              difficulty: Optional[int] = None, max_steps: int = 5) -> tuple[dict, dict]:
        body: dict[str, Any] = {"mode": mode, "maxSteps": max_steps}
        if seed is not None:
            body["seed"] = seed
        if family:
            body["family"] = family
        if difficulty:
            body["difficulty"] = difficulty
        out = self._call("POST", "/api/env/reset", body)
        self.episode_id = out["observation"]["episode_id"]
        return out["observation"], out.get("info", {})

    def step(self, code: str) -> tuple[dict, float, bool, bool, dict]:
        if not self.episode_id:
            raise TimedEnvError("call reset() first")
        out = self._call("POST", "/api/env/step", {"episode_id": self.episode_id, "code": code})
        return out["observation"], float(out["reward"]), bool(out["terminated"]), bool(out["truncated"]), out["info"]


def render_prompt(obs: dict) -> str:
    """Turn an observation into a plain-text prompt for a policy model."""
    lines = [
        f"# {obs['title']}  ({obs['mode']}, difficulty {obs['difficulty']})",
        obs["prompt"],
        "",
        obs["instructions"],
        f"Function name: {obs['function_name']}",
        "Examples:",
    ]
    for t in obs["visible_tests"]:
        args = ", ".join(json.dumps(a) for a in t["args"])
        lines.append(f"  {obs['function_name']}({args}) -> {json.dumps(t['expect'])}")
    lines.append(f"Plus {obs['hidden_test_count']} hidden tests.")
    lines += ["", "Starter code:", obs["starter_code"]]
    fb = obs.get("feedback")
    if fb:
        lines += ["", "Feedback from your last attempt:"]
        if fb.get("fatal"):
            lines.append(f"  crashed: {fb['fatal']}")
        for r in fb.get("results", []):
            if r.get("hidden"):
                lines.append(f"  hidden #{r['i'] + 1}: {'pass' if r['pass'] else 'FAIL'}")
            elif not r["pass"]:
                lines.append(f"  args={json.dumps(r.get('args'))} got={json.dumps(r.get('got'))} want={json.dumps(r.get('expect'))}{' error=' + r['error'] if r.get('error') else ''}")
    return "\n".join(lines)
