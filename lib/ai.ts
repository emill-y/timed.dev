// AI-mode copilot. Runs entirely in the player's browser: the API key is kept
// in this browser's storage and requests go straight to the provider. The
// timed.dev server never sees the key or the conversation.
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { Problem } from "./problems";
import { load, save } from "./client";

export type Provider = "anthropic" | "openai";
export type Effort = "low" | "medium" | "high";
export type AiSettings = { provider: Provider; model: string; effort: Effort; key: string; remember: boolean };

export const ANTHROPIC_MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
];
export const DEFAULT_MODEL: Record<Provider, string> = { anthropic: "claude-opus-5-5", openai: "gpt-5" };

const DEFAULT: AiSettings = { provider: "anthropic", model: DEFAULT_MODEL.anthropic, effort: "low", key: "", remember: false };

// "Remember" keeps the key in localStorage; otherwise it lives in
// sessionStorage and is gone when the tab closes.
export function loadAi(): AiSettings {
  const prefs = load<Partial<AiSettings>>("ai:prefs", {});
  const key = load<string>("ai:key", "", "local") || load<string>("ai:key", "", "session");
  return { ...DEFAULT, ...prefs, key };
}

export function saveAi(s: AiSettings) {
  const { key, ...prefs } = s;
  save("ai:prefs", prefs);
  save("ai:key", s.remember ? key : null, "local");
  save("ai:key", s.remember ? null : key, "session");
}

export const maskKey = (k: string) => (k.length > 12 ? `${k.slice(0, 7)}…${k.slice(-4)}` : k ? "set" : "");

export type Turn = { role: "user" | "assistant"; text: string };
export type Usage = { input: number; output: number };

function systemPrompt(p: Problem) {
  const visible = p.tests.filter((t) => !t.hidden);
  return [
    "You are the copilot of a player in a timed, head-to-head coding duel. Speed matters, and so does correctness on hidden edge cases.",
    `Implement a plain JavaScript function named \`${p.fn}\`. No imports, no exports, no TypeScript, no external libraries.`,
    "Reply with the complete function in exactly one ```js code block. Any helpers go inside the same block. After the block, add at most one short line if something is worth flagging.",
    p.noEval ? "eval() and Function() are disabled in the test runner, so don't use them." : "",
    "",
    `Ticket: ${p.title}`,
    p.prompt,
    "",
    "Visible examples:",
    ...visible.map((t) => `${p.fn}(${t.args.map((a) => JSON.stringify(a)).join(", ")}) -> ${JSON.stringify(t.expect)}`),
    `There are ${p.tests.length - visible.length} hidden tests covering edge cases.`,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

export function extractCode(text: string): string | null {
  const blocks = [...text.matchAll(/```(?:js|javascript|ts|typescript)?\s*\n([\s\S]*?)```/g)];
  return blocks.length ? blocks[blocks.length - 1][1].trim() + "\n" : null;
}

export class AiError extends Error {}

export async function askCopilot(opts: {
  settings: AiSettings;
  problem: Problem;
  history: Turn[];
  signal: AbortSignal;
  onText: (delta: string) => void;
}): Promise<{ text: string; usage: Usage }> {
  const { settings: s, problem, history, signal, onText } = opts;
  if (!s.key) throw new AiError("add an API key first");
  const system = systemPrompt(problem);

  if (s.provider === "anthropic") {
    const client = new Anthropic({ apiKey: s.key, dangerouslyAllowBrowser: true, maxRetries: 1 });
    const isHaiku = s.model.startsWith("claude-haiku");
    try {
      const stream = client.beta.messages.stream(
        {
          model: s.model,
          max_tokens: 16000,
          system,
          messages: history.map((t) => ({ role: t.role, content: t.text })),
          // Haiku 4.5 doesn't take effort; the 5.5 models do, and fall back
          // server-side if a safety classifier declines.
          ...(isHaiku ? {} : { output_config: { effort: s.effort }, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
        },
        { signal },
      );
      stream.on("text", onText);
      const msg = await stream.finalMessage();
      if (msg.stop_reason === "refusal") throw new AiError("the model declined this request");
      const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      return { text, usage: { input: msg.usage.input_tokens, output: msg.usage.output_tokens } };
    } catch (e) {
      if (e instanceof AiError) throw e;
      if (e instanceof Anthropic.AuthenticationError) throw new AiError("Anthropic rejected that API key");
      if (e instanceof Anthropic.PermissionDeniedError) throw new AiError("this key can't use that model");
      if (e instanceof Anthropic.RateLimitError) throw new AiError("rate limited by Anthropic, try again in a moment");
      if (e instanceof Anthropic.APIUserAbortError) throw new AiError("stopped");
      if (e instanceof Anthropic.APIError) throw new AiError(`Anthropic error ${e.status ?? ""}: ${e.message}`);
      throw new AiError(String((e as Error)?.message ?? e));
    }
  }

  const client = new OpenAI({ apiKey: s.key, dangerouslyAllowBrowser: true, maxRetries: 1 });
  try {
    const stream = await client.chat.completions.create(
      {
        model: s.model || DEFAULT_MODEL.openai,
        stream: true,
        stream_options: { include_usage: true },
        messages: [{ role: "system", content: system }, ...history.map((t) => ({ role: t.role, content: t.text }))],
      },
      { signal },
    );
    let text = "";
    const usage: Usage = { input: 0, output: 0 };
    for await (const chunk of stream) {
      const d = chunk.choices[0]?.delta?.content ?? "";
      if (d) {
        text += d;
        onText(d);
      }
      if (chunk.usage) {
        usage.input = chunk.usage.prompt_tokens;
        usage.output = chunk.usage.completion_tokens;
      }
    }
    return { text, usage };
  } catch (e) {
    if (e instanceof OpenAI.AuthenticationError) throw new AiError("OpenAI rejected that API key");
    if (e instanceof OpenAI.RateLimitError) throw new AiError("rate limited by OpenAI, try again in a moment");
    if (e instanceof OpenAI.APIUserAbortError) throw new AiError("stopped");
    if (e instanceof OpenAI.APIError) throw new AiError(`OpenAI error ${e.status ?? ""}: ${e.message}`);
    throw new AiError(String((e as Error)?.message ?? e));
  }
}
