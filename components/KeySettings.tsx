"use client";
import { useState } from "react";
import { ANTHROPIC_MODELS, DEFAULT_MODEL, maskKey, saveAi, type AiSettings, type Provider } from "@/lib/ai";

type Props = { value: AiSettings; onChange: (s: AiSettings) => void; onClose?: () => void; compact?: boolean };

export default function KeySettings({ value, onChange, onClose, compact }: Props) {
  const [draft, setDraft] = useState<AiSettings>(value);
  const [editingKey, setEditingKey] = useState(!value.key);
  const set = (patch: Partial<AiSettings>) => setDraft((d) => ({ ...d, ...patch }));

  const commit = () => {
    saveAi(draft);
    onChange(draft);
    onClose?.();
  };
  const forget = () => {
    const next = { ...draft, key: "" };
    saveAi(next);
    setDraft(next);
    onChange(next);
    setEditingKey(true);
  };

  return (
    <div className={`keys ${compact ? "compact" : ""}`}>
      <div className="keys-row">
        <span className="k">provider</span>
        {(["anthropic", "openai"] as Provider[]).map((p) => (
          <button key={p} className={`opt ${draft.provider === p ? "on" : ""}`} onClick={() => set({ provider: p, model: DEFAULT_MODEL[p] })}>
            {p}
          </button>
        ))}
      </div>
      <div className="keys-row">
        <span className="k">model</span>
        {draft.provider === "anthropic" ? (
          ANTHROPIC_MODELS.map((m) => (
            <button key={m.id} className={`opt ${draft.model === m.id ? "on" : ""}`} onClick={() => set({ model: m.id })}>
              {m.label.replace("Claude ", "").toLowerCase()}
            </button>
          ))
        ) : (
          <input className="line" value={draft.model} onChange={(e) => set({ model: e.target.value.trim() })} placeholder="gpt-5" spellCheck={false} />
        )}
      </div>
      {draft.provider === "anthropic" && !draft.model.startsWith("claude-haiku") && (
        <div className="keys-row">
          <span className="k">effort</span>
          {(["low", "medium", "high"] as const).map((e) => (
            <button key={e} className={`opt ${draft.effort === e ? "on" : ""}`} onClick={() => set({ effort: e })}>{e}</button>
          ))}
          <span className="note">low = fastest</span>
        </div>
      )}
      <div className="keys-row">
        <span className="k">api key</span>
        {editingKey ? (
          <input
            className="line wide"
            type="password"
            value={draft.key}
            onChange={(e) => set({ key: e.target.value.trim() })}
            placeholder={draft.provider === "anthropic" ? "sk-ant-…" : "sk-…"}
            autoComplete="off"
            spellCheck={false}
          />
        ) : (
          <>
            <code className="masked">{maskKey(draft.key)}</code>
            <button className="btn-ghost" onClick={() => setEditingKey(true)}>replace</button>
            <button className="btn-ghost" onClick={forget}>forget</button>
          </>
        )}
      </div>
      <div className="keys-row">
        <span className="k" />
        <label className="check">
          <input type="checkbox" checked={draft.remember} onChange={(e) => set({ remember: e.target.checked })} />
          remember on this device
        </label>
      </div>
      <p className="privacy">
        Your key stays in this browser ({draft.remember ? "localStorage" : "this tab only"}). The copilot calls {draft.provider === "anthropic" ? "api.anthropic.com" : "api.openai.com"} directly from your browser, so timed.dev&apos;s servers never see your key or your prompts. Your provider bills you for usage. A spend-capped key is a good idea.
      </p>
      <div className="keys-row">
        <button className="act submit" onClick={commit} disabled={!draft.key || !draft.model}><span>save</span></button>
        {onClose && <button className="btn-ghost" onClick={onClose}>cancel</button>}
      </div>
    </div>
  );
}
