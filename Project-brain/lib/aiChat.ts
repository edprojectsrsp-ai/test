"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export type ProviderChoice = "auto" | "openai" | "gemini" | "groq" | "ollama";

export type ProviderInfo = {
  available: ProviderChoice[];
  degraded?: boolean;
  reason?: string;
};

export type ChatMeta = {
  provider?: string;
  model?: string;
  tokens?: number;
  cost?: number;
  task_type?: string;
  tools?: string[];
  degraded?: boolean;
  reason?: string;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
  meta?: ChatMeta;
};

type UseAIChatOptions = {
  mode?: "simple" | "stream";
  greeting?: string;
  context?: unknown;
};

const API_BASE = "http://localhost:8002/api/v1";

export function useAIChat(options: UseAIChatOptions = {}) {
  const { mode = "simple", greeting, context } = options;

  const [messages, setMessages] = useState<ChatMessage[]>(
    greeting ? [{ role: "assistant", content: greeting }] : []
  );
  const [busy, setBusy] = useState(false);
  const [taskType, setTaskType] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [provider, setProvider] = useState<ProviderChoice>("auto");
  const [strict, setStrict] = useState(false);
  const [providers, setProviders] = useState<ProviderInfo | null>(null);

  useEffect(() => {
    let mounted = true;
    fetch(`${API_BASE}/brain/providers`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!mounted || !data) return;
        setProviders({
          available: Array.isArray(data.available) ? data.available : [],
          degraded: !!data.degraded,
          reason: data.reason,
        });
      })
      .catch(() => {
        if (!mounted) return;
        setProviders({ available: ["auto"], degraded: true, reason: "Provider service unavailable" });
      });
    return () => {
      mounted = false;
    };
  }, []);

  const reset = useCallback(() => {
    setMessages(greeting ? [{ role: "assistant", content: greeting }] : []);
    setBusy(false);
    setTaskType(null);
    setActiveTool(null);
  }, [greeting]);

  const send = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q) return;

      setBusy(true);
      setTaskType(null);
      setActiveTool(null);
      setMessages((prev) => [...prev, { role: "user", content: q }, { role: "assistant", content: "", pending: true }]);

      const endpoint = mode === "stream" ? `${API_BASE}/ai/chat/stream` : `${API_BASE}/brain/chat`;
      try {
        const body = {
          message: q,
          query: q,
          prompt: q,
          provider,
          strict,
          context,
        };
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json().catch(() => ({}));
        const content = data.reply ?? data.answer ?? data.response ?? data.text ?? data.message ?? "No response";
        const meta: ChatMeta = data.meta ?? {
          provider: data.provider,
          model: data.model,
          tokens: data.tokens,
          cost: data.cost,
          task_type: data.task_type,
          tools: data.tools,
          degraded: data.degraded,
          reason: data.reason,
        };

        setTaskType(meta.task_type ?? null);
        setActiveTool(Array.isArray(meta.tools) && meta.tools.length ? meta.tools[0] : null);

        setMessages((prev) => {
          const next = [...prev];
          const idx = next.findIndex((m) => m.pending);
          if (idx >= 0) next[idx] = { role: "assistant", content, meta };
          return next;
        });
      } catch {
        setMessages((prev) => {
          const next = [...prev];
          const idx = next.findIndex((m) => m.pending);
          if (idx >= 0) {
            next[idx] = {
              role: "assistant",
              content: "AI service is unavailable. Start backend on :8002 and try again.",
              meta: { degraded: true, reason: "request_failed" },
            };
          }
          return next;
        });
      } finally {
        setBusy(false);
      }
    },
    [context, mode, provider, strict]
  );

  return useMemo(
    () => ({
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
    }),
    [messages, send, busy, reset, taskType, activeTool, providers, provider, strict]
  );
}
