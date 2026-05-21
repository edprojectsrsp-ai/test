"use client";

/**
 * Shared AI chat plumbing for Project Brain.
 *
 * Two consumers:
 *  - The floating <NeuralAssistant /> (site-wide, lives in the layout)
 *  - The dashboard's embedded chat panel
 *
 * Both share:
 *  - Provider dropdown (OpenAI / Gemini / Groq / Ollama + "Auto")
 *  - Message list with provider+model badges on each AI message
 *  - Streaming (preferred) with non-streaming fallback
 *
 * Endpoints:
 *  - GET  /api/v1/brain/providers       → list providers (proxy to AI service)
 *  - POST /api/v1/brain/chat            → non-streaming, simple reply
 *  - POST {AI_API}/ai/conversations/start
 *  - POST {AI_API}/ai/chat/stream       → SSE token stream + tool events
 */

import { useCallback, useEffect, useRef, useState } from "react";

// The main backend.  `/brain/chat` lives here and proxies to the AI service.
const BACKEND_URL = "http://localhost:8000/api/v1";
// The AI service.  Used directly for streaming.
const AI_URL = process.env.NEXT_PUBLIC_AI_API_URL || "http://localhost:8001";

// =============================================================================
// Types
// =============================================================================
export type ChatRole = "user" | "assistant" | "system";

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
  role: ChatRole;
  content: string;
  meta?: ChatMeta;
  pending?: boolean;
};

export type ProviderInfo = {
  available: string[];
  default: string | null;
  configured_default: string;
  all_known: string[];
  degraded?: boolean;
  reason?: string;
};

export type ProviderChoice =
  | "auto"
  | "openai"
  | "gemini"
  | "groq"
  | "ollama";

export type ChatMode = "stream" | "simple";

export type UseAIChatOptions = {
  /** Pass JSON-able context that should be sent alongside every message
   *  (used by the dashboard panel — page state).  Has no effect in stream mode
   *  beyond being prepended to the user message.
   */
  context?: any;
  /** Streaming uses /ai/chat/stream and shows tokens as they arrive.
   *  Simple uses /brain/chat (single round-trip, no streaming). Default: "stream".
   */
  mode?: ChatMode;
  /** Caller user id for conversation persistence (defaults to 1 — anonymous). */
  userId?: number;
  /** Greeting shown when the chat opens. */
  greeting?: string;
};

// =============================================================================
// Hook
// =============================================================================
export function useAIChat(opts: UseAIChatOptions = {}) {
  const { context, mode = "stream", userId = 1, greeting } = opts;

  const [providers, setProviders] = useState<ProviderInfo | null>(null);
  const [provider, setProvider] = useState<ProviderChoice>("openai");
  const [strict, setStrict] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    greeting ? [{ role: "assistant", content: greeting }] : [],
  );
  const [busy, setBusy] = useState(false);

  // Streaming state shown to the user while a response is forming
  const [taskType, setTaskType] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<string | null>(null);

  const convIdRef = useRef<number | null>(null);
  const startedConvForMode = useRef<ChatMode | null>(null);

  // -------------------------------------------------------------------------
  // Load provider list (and seed default selection)
  // -------------------------------------------------------------------------
  const loadProviders = useCallback(async () => {
    try {
      const r = await fetch(`${BACKEND_URL}/brain/providers`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: ProviderInfo = await r.json();
      setProviders(data);
      // If openai isn't available, fall back to the default the server suggests.
      if (data.default && !data.available.includes("openai")) {
        setProvider(data.default as ProviderChoice);
      }
    } catch (e: any) {
      // Non-fatal — we'll still let the user try, and degrade based on what the
      // backend says when they actually send a message.
      setProviders({
        available: [],
        default: null,
        configured_default: "openai",
        all_known: ["openai", "gemini", "groq", "ollama"],
        degraded: true,
        reason: e?.message || "Could not reach /brain/providers",
      });
    }
  }, []);

  // -------------------------------------------------------------------------
  // Conversation init (only for stream mode — /brain/chat is stateless)
  // -------------------------------------------------------------------------
  const ensureConversation = useCallback(async (): Promise<number | null> => {
    if (mode !== "stream") return null;
    if (convIdRef.current && startedConvForMode.current === mode) {
      return convIdRef.current;
    }
    try {
      const r = await fetch(`${AI_URL}/ai/conversations/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, source: "web" }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      convIdRef.current = d.conversation_id;
      startedConvForMode.current = mode;
      return d.conversation_id;
    } catch {
      // Stream mode requires the AI service; if it's down we'll fall back to
      // simple mode for this request.
      return null;
    }
  }, [mode, userId]);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  // -------------------------------------------------------------------------
  // Send
  // -------------------------------------------------------------------------
  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;

      // Push user message + a pending assistant placeholder
      setMessages((m) => [
        ...m,
        { role: "user", content: trimmed },
        { role: "assistant", content: "", pending: true },
      ]);
      setBusy(true);
      setTaskType(null);
      setActiveTool(null);

      const providerField = provider === "auto" ? null : provider;
      let usedSimpleFallback = false;

      try {
        if (mode === "stream") {
          const convId = await ensureConversation();
          if (convId == null) {
            usedSimpleFallback = true;
          } else {
            await streamChat(convId, trimmed, userId, providerField, strict, {
              onTaskType: setTaskType,
              onToolCallStart: setActiveTool,
              onToolCallEnd: () => setActiveTool(null),
              onToken: (tk) => {
                setMessages((m) => {
                  const copy = [...m];
                  const last = copy[copy.length - 1];
                  if (last && last.role === "assistant") {
                    last.content += tk;
                    last.pending = true;
                  }
                  return copy;
                });
              },
              onDone: (meta) => {
                setMessages((m) => {
                  const copy = [...m];
                  const last = copy[copy.length - 1];
                  if (last && last.role === "assistant") {
                    last.meta = meta;
                    last.pending = false;
                  }
                  return copy;
                });
              },
              onError: (msg) => {
                setMessages((m) => {
                  const copy = [...m];
                  const last = copy[copy.length - 1];
                  if (last && last.role === "assistant") {
                    last.content = last.content || `⚠️ ${msg}`;
                    last.pending = false;
                    last.meta = { ...(last.meta || {}), degraded: true, reason: msg };
                  }
                  return copy;
                });
              },
            });
          }
        }

        if (mode === "simple" || usedSimpleFallback) {
          const data = await simpleChat(trimmed, context, providerField, strict);
          setMessages((m) => {
            const copy = [...m];
            const last = copy[copy.length - 1];
            if (last && last.role === "assistant") {
              last.content = data.reply || "(empty reply)";
              last.pending = false;
              last.meta = {
                provider: data.provider,
                model: data.model,
                task_type: data.task_type,
                tokens: data.tokens_used,
                cost: data.cost_usd,
                degraded: data.degraded,
                reason: data.reason,
              };
            }
            return copy;
          });
        }
      } catch (e: any) {
        setMessages((m) => {
          const copy = [...m];
          const last = copy[copy.length - 1];
          if (last && last.role === "assistant") {
            last.content = `⚠️ ${e?.message || "Request failed"}`;
            last.pending = false;
            last.meta = { degraded: true, reason: e?.message };
          }
          return copy;
        });
      } finally {
        setBusy(false);
        setTaskType(null);
        setActiveTool(null);
      }
    },
    [busy, mode, provider, strict, ensureConversation, context, userId],
  );

  // -------------------------------------------------------------------------
  // Reset
  // -------------------------------------------------------------------------
  const reset = useCallback(() => {
    setMessages(greeting ? [{ role: "assistant", content: greeting }] : []);
    convIdRef.current = null;
    startedConvForMode.current = null;
    setTaskType(null);
    setActiveTool(null);
  }, [greeting]);

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
    reloadProviders: loadProviders,
  };
}

// =============================================================================
// Streaming helper (split out so the hook stays readable)
// =============================================================================
type StreamCallbacks = {
  onTaskType: (t: string) => void;
  onToolCallStart: (name: string) => void;
  onToolCallEnd: () => void;
  onToken: (text: string) => void;
  onDone: (meta: ChatMeta) => void;
  onError: (msg: string) => void;
};

async function streamChat(
  convId: number,
  message: string,
  userId: number,
  forcedProvider: string | null,
  strict: boolean,
  cb: StreamCallbacks,
) {
  const resp = await fetch(`${AI_URL}/ai/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      conversation_id: convId,
      user_id: userId,
      message,
      provider: forcedProvider,
      strict_provider: strict,
    }),
  });
  if (!resp.ok || !resp.body) {
    cb.onError(`HTTP ${resp.status}`);
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentTaskType: string | null = null;
  const tools: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const ev: any = JSON.parse(line.slice(6));
        switch (ev.type) {
          case "task_type":
            currentTaskType = ev.value;
            cb.onTaskType(ev.value);
            break;
          case "tool_call":
            cb.onToolCallStart(ev.name);
            tools.push(ev.name);
            break;
          case "tool_result":
            cb.onToolCallEnd();
            break;
          case "token":
            cb.onToken(ev.text);
            break;
          case "done":
            cb.onDone({
              provider: ev.provider,
              model: ev.model,
              task_type: currentTaskType || undefined,
              tokens: ev.tokens,
              cost: ev.cost_usd,
              tools,
            });
            return;
          case "error":
            cb.onError(ev.message || "Unknown stream error");
            return;
        }
      } catch {
        // Skip malformed lines silently — SSE keep-alives, etc.
      }
    }
  }
}

// =============================================================================
// Non-streaming helper (used in 'simple' mode and as fallback)
// =============================================================================
async function simpleChat(
  message: string,
  context: any,
  forcedProvider: string | null,
  strict: boolean,
): Promise<any> {
  const r = await fetch(`${BACKEND_URL}/brain/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      context,
      provider: forcedProvider,
      strict_provider: strict,
    }),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`HTTP ${r.status}: ${txt}`);
  }
  return r.json();
}
