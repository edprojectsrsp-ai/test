"use client";

/**
 * <ProviderPicker /> — small dropdown used by NeuralAssistant and the
 * dashboard chat. Lets the user force a specific LLM (or 'auto' for the
 * task-aware router).
 *
 * The list of providers comes from /brain/providers via useAIChat.
 * Providers that aren't configured server-side appear greyed out so the
 * user can see them but can't pick them.
 */

import { Cpu, AlertTriangle } from "lucide-react";
import type { ProviderChoice, ProviderInfo } from "@/lib/aiChat";

type Props = {
  providers: ProviderInfo | null;
  value: ProviderChoice;
  onChange: (v: ProviderChoice) => void;
  strict: boolean;
  onStrictChange?: (v: boolean) => void;
  compact?: boolean;            // smaller variant for cramped headers
  showStrictToggle?: boolean;   // hide the "strict" checkbox in tight UIs
};

const ALL_OPTIONS: { value: ProviderChoice; label: string }[] = [
  { value: "auto", label: "Auto-route" },
  { value: "openai", label: "OpenAI" },
  { value: "gemini", label: "Gemini" },
  { value: "groq", label: "Groq" },
  { value: "ollama", label: "Ollama (local)" },
];

export default function ProviderPicker({
  providers,
  value,
  onChange,
  strict,
  onStrictChange,
  compact = false,
  showStrictToggle = true,
}: Props) {
  const available = providers?.available ?? [];
  const degraded = providers?.degraded;

  return (
    <div className={`flex items-center gap-2 ${compact ? "text-[10px]" : "text-xs"}`}>
      <Cpu size={compact ? 11 : 13} className="text-cyan-400 shrink-0" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ProviderChoice)}
        title="Pick which LLM answers this chat"
        className={`bg-zinc-900/80 border border-cyan-500/30 rounded-md outline-none focus:border-cyan-400 text-zinc-200 ${
          compact ? "px-1.5 py-0.5" : "px-2 py-1"
        }`}
      >
        {ALL_OPTIONS.map((opt) => {
          const configured =
            opt.value === "auto" || available.includes(opt.value);
          return (
            <option
              key={opt.value}
              value={opt.value}
              disabled={!configured}
              title={configured ? "" : "Not configured on the server (no API key)"}
            >
              {opt.label}
              {configured ? "" : " (not configured)"}
            </option>
          );
        })}
      </select>

      {showStrictToggle && value !== "auto" && (
        <label
          className="flex items-center gap-1 text-zinc-400 cursor-pointer select-none"
          title="If on, do not fall back to a different provider when this one fails. Useful for testing one provider in isolation."
        >
          <input
            type="checkbox"
            checked={strict}
            onChange={(e) => onStrictChange?.(e.target.checked)}
            className="accent-cyan-500"
          />
          strict
        </label>
      )}

      {degraded && (
        <span
          title={providers?.reason || "Some providers unreachable"}
          className="flex items-center gap-1 text-amber-400/80"
        >
          <AlertTriangle size={compact ? 10 : 12} />
        </span>
      )}
    </div>
  );
}
