"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ProviderChoice = "auto" | "openai" | "gemini" | "groq" | "ollama";

export type ProviderInfo = {
  available: string[];
  default: string | null;
  configured_default: string;
  all_known: string[];
  degraded?: boolean;
  reason?: string;
};

export type ChatMeta = {
  provider?: string;
  model?: string;
  task_type?: string;
  tokens?: number;
  cost?: number;
  tools?: string[];
  degraded?: boolean;
  reason?: string;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  meta?: ChatMeta;
  pending?: boolean;
};

type UseAIChatOptions = {
  mode?: "stream" | "simple";
  greeting?: string;
  context?: any;
  userId?: number;
};

const BACKEND_URL = "http://localhost:8000/api/v1";

export function useAIChat(opts: UseAIChatOptions = {}) {
  const mode = opts.mode ?? "simple";
  const userId = opts.userId ?? 1;

  const [messages, setMessages] = useState<ChatMessage[]>(
    opts.greeting ? [{ role: "assistant", content: opts.greeting }] : [],
  );
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<ProviderInfo | null>(null);
  const [provider, setProvider] = useState<ProviderChoice>("auto");
  const [strict, setStrict] = useState(false);
  const [taskType, setTaskType] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<string | null>(null);

  const convIdRef = useRef<number | null>(null);

  const loadProviders = useCallback(async () => {
    try {
      const r = await fetch(`${BACKEND_URL}/brain/providers`);
      const d = await r.json();
      if (d && typeof d === "object") setProviders(d);
    } catch {
      // leave null
    }
  }, []);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  const reset = useCallback(() => {
    convIdRef.current = null;
    setMessages(opts.greeting ? [{ role: "assistant", content: opts.greeting }] : []);
    setTaskType(null);
    setActiveTool(null);
  }, [opts.greeting]);

  const ensureConversation = useCallback(async () => {
    if (mode !== "stream") return null;
    if (convIdRef.current) return convIdRef.current;
    try {
      const r = await fetch("http://localhost:8001/ai/conversations/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, source: "web" }),
      });
      const d = await r.json();
      convIdRef.current = d?.conversation_id ?? null;
      return convIdRef.current;
    } catch {
      return null;
    }
  }, [mode, userId]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;

      setMessages((m) => [...m, { role: "user", content: trimmed }, { role: "assistant", content: "", pending: true }]);
      setBusy(true);
      setTaskType(null);
      setActiveTool(null);

      const forcedProvider = provider === "auto" ? null : provider;

      try {
        if (mode === "stream") {
          const convId = await ensureConversation();
          if (convId) {
            // Very small streaming implementation: treat body as newline-delimited JSON (same as sprint files).
            const resp = await fetch("http://localhost:8001/ai/chat/stream", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                conversation_id: convId,
                user_id: userId,
                message: trimmed,
                provider: forcedProvider,
                strict_provider: strict,
              }),
            });
            if (resp.ok && resp.body) {
              const reader = resp.body.getReader();
              const decoder = new TextDecoder();
              let buf = "";
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += decoder.decode(value, { stream: true });
                const lines = buf.split("\n");
                buf = lines.pop() || "";
                for (const line of lines) {
                  if (!line.trim()) continue;
                  try {
                    const ev = JSON.parse(line);
                    if (ev.type === "token") {
                      setMessages((m) => {
                        const copy = [...m];
                        const last = copy[copy.length - 1];
                        if (last?.role === "assistant") last.content += ev.text || "";
                        return copy;
                      });
                    } else if (ev.type === "task_type") {
                      setTaskType(ev.value || null);
                    } else if (ev.type === "tool_call") {
                      setActiveTool(ev.name || null);
                    } else if (ev.type === "tool_result") {
                      setActiveTool(null);
                    } else if (ev.type === "done") {
                      setMessages((m) => {
                        const copy = [...m];
                        const last = copy[copy.length - 1];
                        if (last?.role === "assistant") {
                          last.pending = false;
                          last.meta = {
                            provider: ev.provider,
                            model: ev.model,
                            task_type: ev.task_type,
                            tokens: ev.tokens,
                            cost: ev.cost_usd,
                          };
                        }
                        return copy;
                      });
                    }
                  } catch {
                    // ignore
                  }
                }
              }
              setMessages((m) => {
                const copy = [...m];
                const last = copy[copy.length - 1];
                if (last?.role === "assistant") last.pending = false;
                return copy;
              });
              return;
            }
          }
          // fall back to simple if stream isn't available
        }

        const r = await fetch(`${BACKEND_URL}/brain/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            context: opts.context,
            provider: forcedProvider,
            strict_provider: strict,
          }),
        });
        const d = await r.json().catch(() => ({}));
        setMessages((m) => {
          const copy = [...m];
          const last = copy[copy.length - 1];
          if (last?.role === "assistant") {
            last.content = d.reply || "(empty reply)";
            last.pending = false;
            last.meta = {
              provider: d.provider,
              model: d.model,
              task_type: d.task_type,
              tokens: d.tokens_used,
              cost: d.cost_usd,
              degraded: d.degraded,
              reason: d.reason,
            };
          }
          return copy;
        });
      } catch (e: any) {
        setMessages((m) => {
          const copy = [...m];
          const last = copy[copy.length - 1];
          if (last?.role === "assistant") {
            last.content = `⚠️ ${e?.message || "Request failed"}`;
            last.pending = false;
            last.meta = { degraded: true, reason: e?.message };
          }
          return copy;
        });
      } finally {
        setBusy(false);
      }
    },
    [busy, ensureConversation, mode, opts.context, provider, strict, userId],
  );

  return {
    messages,
    send,
    busy,
    reset,
    taskType,
    activeTool,
    providers,
    provider,
    setProvider,
    strict,
    setStrict,
  };
}

