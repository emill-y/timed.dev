"use client";
import { useEffect, useRef, useState } from "react";
import type { Problem } from "@/lib/problems";
import type { RunOutput } from "@/lib/judge";
import { AiError, askCopilot, extractCode, loadAi, type AiSettings, type Turn, type Usage } from "@/lib/ai";
import KeySettings from "./KeySettings";

type Props = {
  problem: Problem;
  locked: boolean;
  getCode: () => string;
  applyCode: (code: string) => void;
  lastRun: RunOutput | null;
  onUsage: (u: Usage & { aiChars: number }) => void;
};

type Shown = { role: "user" | "assistant"; text: string; applied?: number; error?: boolean };

function describeRun(out: RunOutput | null, fn: string): string {
  if (!out) return "";
  if (out.fatal) return `Last run crashed: ${out.fatal}`;
  const lines = out.results.map((r) =>
    r.hidden
      ? `hidden test #${r.i + 1}: ${r.pass ? "pass" : "FAIL"}${r.error ? " (threw)" : ""}`
      : `${fn}(${r.args?.map((a) => JSON.stringify(a)).join(", ")}): ${r.pass ? "pass" : `FAIL, got ${JSON.stringify(r.got)}${r.error ? ` (threw: ${r.error})` : ""}, want ${JSON.stringify(r.expect)}`}`,
  );
  return `Last test run (${out.results.filter((r) => r.pass).length}/${out.results.length} passing):\n${lines.join("\n")}`;
}

export default function Copilot({ problem, locked, getCode, applyCode, lastRun, onUsage }: Props) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [showKeys, setShowKeys] = useState(false);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<Turn[]>([]);
  const [shown, setShown] = useState<Shown[]>([]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [autoApply, setAutoApply] = useState(true);
  const [attachRun, setAttachRun] = useState(true);
  const [undo, setUndo] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const s = loadAi();
    setSettings(s);
    if (!s.key) setShowKeys(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [shown, streaming]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = async () => {
    const ask = input.trim() || (history.length ? "Fix the failing tests." : "Solve it.");
    if (!settings?.key || streaming != null || locked) return;
    const code = getCode();
    const run = attachRun ? describeRun(lastRun, problem.fn) : "";
    const content = `${ask}\n\nMy current code:\n\`\`\`js\n${code.trimEnd()}\n\`\`\`${run ? `\n\n${run}` : ""}`;
    const nextHistory: Turn[] = [...history, { role: "user", text: content }];
    setInput("");
    setShown((s) => [...s, { role: "user", text: ask }]);
    setStreaming("");
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const { text, usage } = await askCopilot({
        settings,
        problem,
        history: nextHistory,
        signal: ac.signal,
        onText: (d) => setStreaming((s) => (s ?? "") + d),
      });
      const extracted = extractCode(text);
      let applied: number | undefined;
      if (extracted && autoApply && !locked) {
        setUndo(getCode());
        applyCode(extracted);
        applied = extracted.split("\n").length - 1;
      }
      setHistory([...nextHistory, { role: "assistant", text }]);
      setShown((s) => [...s, { role: "assistant", text, applied }]);
      onUsage({ ...usage, aiChars: extracted?.length ?? 0 });
    } catch (e) {
      const msg = e instanceof AiError ? e.message : String(e);
      setShown((s) => [...s, { role: "assistant", text: msg, error: true }]);
      if (/key/i.test(msg)) setShowKeys(true);
    } finally {
      setStreaming(null);
      abortRef.current = null;
    }
  };

  const applyFrom = (text: string) => {
    const c = extractCode(text);
    if (c) {
      setUndo(getCode());
      applyCode(c);
    }
  };

  if (!settings) return <aside className="copilot" />;

  const prose = (t: string) => t.replace(/```[\s\S]*?(```|$)/g, "").trim();

  return (
    <aside className="copilot">
      <header>
        <span className="title">copilot</span>
        <span className="model">{settings.key ? settings.model : "no key"}</span>
        <button className="btn-ghost" onClick={() => setShowKeys((v) => !v)}>{showKeys ? "close" : "key"}</button>
      </header>

      {showKeys ? (
        <KeySettings compact value={settings} onChange={(s) => { setSettings(s); if (s.key) setShowKeys(false); }} onClose={settings.key ? () => setShowKeys(false) : undefined} />
      ) : (
        <>
          <div className="log" ref={logRef}>
            {shown.length === 0 && streaming == null && (
              <div className="muted">
                Scope it, prompt it, ship it. Your code and the last test run are sent along with each prompt.
                Empty prompt + <kbd>enter</kbd> = &quot;solve it&quot;.
              </div>
            )}
            {shown.map((m, i) => (
              <div key={i} className={`msg ${m.role} ${m.error ? "err" : ""}`}>
                {m.role === "user" ? <span className="you">›</span> : null}
                <span className="body">{m.role === "assistant" ? prose(m.text) || (m.applied != null ? "" : "(code only)") : m.text}</span>
                {m.role === "assistant" && !m.error && extractCode(m.text) && (
                  <span className="chip">
                    {m.applied != null ? `applied ${m.applied} lines` : <button className="btn-ghost" onClick={() => applyFrom(m.text)}>apply code</button>}
                  </span>
                )}
              </div>
            ))}
            {streaming != null && (
              <div className="msg assistant streaming">
                <span className="body">{prose(streaming) || "writing code"}<i className="caret" /></span>
                <span className="chip">{streaming.length} chars</span>
              </div>
            )}
          </div>

          <div className="ask">
            <textarea
              ref={inputRef}
              value={input}
              rows={3}
              disabled={locked}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={locked ? "locked" : history.length ? "fix it / handle the hidden cases / refactor…" : "how should it solve this?"}
              spellCheck={false}
            />
            <div className="ask-row">
              {streaming != null ? (
                <button className="act" onClick={() => abortRef.current?.abort()}><span>stop</span></button>
              ) : (
                <button className="act submit" onClick={send} disabled={!settings.key || locked}><span>ask</span></button>
              )}
              <label className="check"><input type="checkbox" checked={autoApply} onChange={(e) => setAutoApply(e.target.checked)} />auto-apply</label>
              <label className="check"><input type="checkbox" checked={attachRun} onChange={(e) => setAttachRun(e.target.checked)} />send test results</label>
              {undo != null && !locked && (
                <button className="btn-ghost" onClick={() => { applyCode(undo); setUndo(null); }}>undo apply</button>
              )}
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
