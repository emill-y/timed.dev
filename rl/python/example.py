"""Smoke test: run a trivial 'policy' against the environment.

    python rl/python/example.py http://localhost:3000 [API_KEY]

A real setup swaps `policy` for a model call (e.g. Claude via the Anthropic
SDK) that reads render_prompt(obs) and returns a function.
"""
import sys

from timed_env import TimedEnv, render_prompt


def policy(obs: dict) -> str:
    # In repair mode, submitting the broken code unchanged is a baseline
    # that scores whatever the damage didn't break.
    return obs["starter_code"]


if __name__ == "__main__":
    env = TimedEnv(sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000", api_key=sys.argv[2] if len(sys.argv) > 2 else None)
    print("families:", [f["id"] for f in env.spec()["families"]])
    for mode in ("solve", "repair"):
        obs, info = env.reset(seed=7, mode=mode, max_steps=2)
        print(f"\n=== {mode}: {obs['title']} ({info})")
        print(render_prompt(obs)[:600])
        done, total = False, 0.0
        while not done:
            obs, reward, terminated, truncated, info = env.step(policy(obs))
            total += reward
            done = terminated or truncated
            print(f"step {obs['step']}: reward={reward} pass_rate={info['pass_rate']:.2f} solved={info['solved']}")
        print("return:", round(total, 4))
