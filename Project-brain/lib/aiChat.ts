"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { authFetch } from "@/lib/auth";

export type ProviderChoice =
  | "auto"
  | "openai"
  | "gemini"
  | "groq"
  | "cerebras"
  | "openrouter"
  | "ollama";

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

const AI_BASE = (process.env.NEXT_PUBLIC_AI_API_URL || "http://127.0.0.1:8002").replace(/\/$/, "");
const USER_ID = 1;

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
  const [conversationId, setConversationId] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    authFetch(`${AI_BASE}/ai/providers`)
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

  useEffect(() => {
    let mounted = true;
    authFetch(`${AI_BASE}/ai/conversations/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: USER_ID, source: "web" }),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (mounted) setConversationId(data?.conversation_id ?? null);
      })
      .catch(() => {
        if (mounted) setConversationId(null);
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

      if (!conversationId) {
        setMessages((prev) => [
          ...prev,
          { role: "user", content: q },
          {
            role: "assistant",
            content: "AI service is not ready. Start it on port 8002 and try again.",
            meta: { degraded: true, reason: "conversation_unavailable" },
          },
        ]);
        return;
      }

      setBusy(true);
      setTaskType(null);
      setActiveTool(null);
      setMessages((prev) => [...prev, { role: "user", content: q }, { role: "assistant", content: "", pending: true }]);

      const endpoint = `${AI_BASE}/ai/chat`;
      try {
        const body = {
          conversation_id: conversationId,
          user_id: USER_ID,
          message: q,
          provider,
          strict_provider: strict,
          context,
        };
        const res = await authFetch(endpoint, {
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
              content: "AI service is unavailable. Start the AI service on port 8002 and try again.",
              meta: { degraded: true, reason: "request_failed" },
            };
          }
          return next;
        });
      } finally {
        setBusy(false);
      }
    },
    [context, conversationId, mode, provider, strict]
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
