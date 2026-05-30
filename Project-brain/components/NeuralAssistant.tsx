"use client";

/**
 * NeuralAssistant — floating site-wide AI chat.
 *
 * Four states: closed (bubble), minimized (robot), default (floating panel),
 * maximized (almost full-screen). Streams via /ai/chat/stream with a provider
 * dropdown to override which LLM answers.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  GripHorizontal, MessageSquare, Minus, Maximize2, Minimize2, X, Send, Bot, User,
  Wrench, Loader2, RotateCcw,
} from "lucide-react";
import { useAIChat } from "@/lib/aiChat";
import ProviderPicker from "@/components/ProviderPicker";

type WindowState = "closed" | "minimized" | "default" | "maximized";

const GREETING =
  "Project Brain assistant ready. Ask about schemes, packages, delays, " +
  "or anything in the system. The dropdown lets you pick which LLM answers.";

export default function NeuralAssistant() {
  const [windowState, setWindowState] = useState<WindowState>("closed");
  const [input, setInput] = useState("");
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const panelRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Initialise position client-side (avoids SSR mismatch)
  useEffect(() => {
    setPos({
      x: window.innerWidth - 450,
      y: Math.max(20, window.innerHeight / 2 - 288),
    });
  }, []);

  // Drag handlers
  const onDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (windowState === "maximized") return;
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
    const rect = panelRef.current?.getBoundingClientRect();
    dragOffset.current = {
      x: clientX - (rect?.left ?? 0),
      y: clientY - (rect?.top ?? 0),
    };
    setDragging(true);
    e.preventDefault();
  }, [windowState]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent | TouchEvent) => {
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
      const panelW = panelRef.current?.offsetWidth ?? 448;
      const panelH = panelRef.current?.offsetHeight ?? 576;
      setPos({
        x: Math.max(0, Math.min(window.innerWidth  - panelW, clientX - dragOffset.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - panelH, clientY - dragOffset.current.y)),
      });
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };
  }, [dragging]);

  const {
    messages, send, busy, reset,
    taskType, activeTool,
    providers, provider, setProvider, strict, setStrict,
  } = useAIChat({ mode: "stream", greeting: GREETING });

  // Auto-scroll on new content
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, taskType, activeTool]);

  const handleSubmit = () => {
    if (!input.trim() || busy) return;
    const q = input;
    setInput("");
    send(q);
  };

  // ==========================================
  // STATE 1: CLOSED (chat bubble)
  // ==========================================
  if (windowState === "closed") {
    return (
      <button
        onClick={() => setWindowState("default")}
        className="fixed top-1/2 right-0 -translate-y-1/2 bg-cyan-600 hover:bg-cyan-500 text-white px-2 py-4 rounded-l-xl shadow-[0_0_20px_rgba(6,182,212,0.4)] transition-all hover:px-3 z-50 group flex flex-col items-center gap-1"
        title="Open Neural Assistant"
      >
        <MessageSquare size={18} className="group-hover:animate-pulse" />
        <span className="text-[9px] font-bold tracking-widest [writing-mode:vertical-lr] rotate-180 uppercase">AI</span>
      </button>
    );
  }

  // ==========================================
  // STATE 2: MINIMIZED (robot icon)
  // ==========================================
  if (windowState === "minimized") {
    return (
      <button
        onClick={() => setWindowState("default")}
        className="fixed top-1/2 right-0 -translate-y-1/2 bg-[#111115] hover:bg-gray-800 border-2 border-l-0 border-cyan-800/80 text-cyan-400 px-2 py-4 rounded-l-xl shadow-[0_0_20px_rgba(6,182,212,0.3)] transition-all hover:px-3 z-50 group flex flex-col items-center gap-1"
        title="Restore Neural Assistant"
      >
        <Bot size={18} className="group-hover:animate-bounce" />
        <span className="text-[9px] font-bold tracking-widest [writing-mode:vertical-lr] rotate-180 uppercase text-cyan-400">AI</span>
      </button>
    );
  }

  // ==========================================
  // STATES 3 & 4: DEFAULT & MAXIMIZED
  // ==========================================
  const isMaximized = windowState === "maximized";
  const panelStyle = isMaximized
    ? {}
    : pos
    ? { left: pos.x, top: pos.y }
    : { right: 0, top: "50%", transform: "translateY(-50%)" };

  const windowClasses = isMaximized
    ? "fixed inset-4 md:inset-10 z-50 rounded-xl"
    : "fixed z-50 w-[22rem] md:w-[28rem] h-[36rem] rounded-xl shadow-2xl";

  return (
    <div
      ref={panelRef}
      className={`${windowClasses} bg-[#111115] border border-cyan-900/50 flex flex-col overflow-hidden ${
        dragging ? "select-none" : "transition-shadow duration-200"
      } ${dragging ? "shadow-[0_0_40px_rgba(6,182,212,0.5)]" : ""}`}
      style={panelStyle}
    >
      {/* HEADER — drag handle */}
      <div
        className={`bg-gradient-to-r from-gray-900 to-cyan-950/30 p-3 flex items-center justify-between border-b border-cyan-900/50 ${
          !isMaximized ? "cursor-grab active:cursor-grabbing" : ""
        }`}
        onMouseDown={!isMaximized ? onDragStart : undefined}
        onTouchStart={!isMaximized ? onDragStart : undefined}
      >
        <div className="flex items-center gap-2">
          <Bot size={18} className="text-cyan-400" />
          <h3 className="text-sm font-bold text-gray-200">Neural Assistant</h3>
          {!isMaximized && (
            <GripHorizontal size={14} className="text-zinc-600 ml-1" title="Drag to move" />
          )}
        </div>
        <div className="flex items-center gap-2 text-gray-400">
          <button
            onClick={reset}
            className="hover:text-white hover:bg-gray-700/50 p-1.5 rounded transition-colors"
            title="New conversation"
          >
            <RotateCcw size={14} />
          </button>
          <button
            onClick={() => setWindowState("minimized")}
            className="hover:text-white hover:bg-gray-700/50 p-1.5 rounded transition-colors"
            title="Minimize"
          >
            <Minus size={16} />
          </button>
          <button
            onClick={() =>
              setWindowState(windowState === "maximized" ? "default" : "maximized")
            }
            className="hover:text-white hover:bg-gray-700/50 p-1.5 rounded transition-colors"
            title={windowState === "maximized" ? "Restore" : "Maximize"}
          >
            {windowState === "maximized" ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button
            onClick={() => setWindowState("closed")}
            className="hover:text-rose-400 hover:bg-rose-900/30 p-1.5 rounded transition-colors"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* PROVIDER ROW */}
      <div className="px-3 py-2 bg-zinc-950/50 border-b border-zinc-900 flex items-center justify-between">
        <ProviderPicker
          providers={providers}
          value={provider}
          onChange={setProvider}
          strict={strict}
          onStrictChange={setStrict}
          compact
        />
        {taskType && !busy && (
          <span className="text-[10px] text-zinc-600 truncate ml-2">
            last task: {taskType}
          </span>
        )}
      </div>

      {/* MESSAGES */}
      <div className="flex-1 bg-[#09090b]/80 p-4 overflow-y-auto space-y-3">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex gap-2 ${
              msg.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            {msg.role !== "user" && (
              <div className="shrink-0 w-7 h-7 rounded-full bg-cyan-900/40 border border-cyan-800/50 flex items-center justify-center">
                <Bot size={14} className="text-cyan-400" />
              </div>
            )}
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-cyan-700/40 border border-cyan-600/40 text-cyan-50 rounded-tr-none"
                  : "bg-zinc-900 border border-zinc-800 text-zinc-200 rounded-tl-none"
              }`}
            >
              <div className="whitespace-pre-wrap">
                {msg.content}
                {msg.pending && (
                  <span className="inline-block ml-1 w-1.5 h-3 bg-cyan-400 animate-pulse align-baseline" />
                )}
              </div>
              {msg.role === "assistant" && msg.meta && (
                <div className="mt-1.5 pt-1.5 border-t border-zinc-800 flex flex-wrap gap-1.5 text-[10px] text-zinc-500">
                  {msg.meta.provider && (
                    <span
                      className={`px-1.5 py-0.5 rounded font-mono ${
                        msg.meta.degraded
                          ? "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                          : "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                      }`}
                    >
                      {msg.meta.provider}
                      {msg.meta.model ? ` · ${msg.meta.model}` : ""}
                    </span>
                  )}
                  {msg.meta.tokens != null && (
                    <span>{msg.meta.tokens} tok</span>
                  )}
                  {msg.meta.cost != null && msg.meta.cost > 0 && (
                    <span>${msg.meta.cost.toFixed(4)}</span>
                  )}
                  {msg.meta.task_type && (
                    <span className="text-zinc-600">[{msg.meta.task_type}]</span>
                  )}
                  {msg.meta.tools?.length ? (
                    <span className="text-zinc-600">
                      tools: {msg.meta.tools.join(", ")}
                    </span>
                  ) : null}
                  {msg.meta.degraded && msg.meta.reason && (
                    <span
                      className="text-amber-400/80"
                      title={msg.meta.reason}
                    >
                      degraded
                    </span>
                  )}
                </div>
              )}
            </div>
            {msg.role === "user" && (
              <div className="shrink-0 w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center">
                <User size={14} className="text-zinc-400" />
              </div>
            )}
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-2 text-[11px] text-cyan-400/80 pl-9">
            {activeTool ? (
              <>
                <Wrench size={11} className="animate-pulse" />
                Calling tool: <span className="font-mono">{activeTool}</span>
              </>
            ) : taskType ? (
              <>
                <Loader2 size={11} className="animate-spin" />
                Thinking ({taskType})...
              </>
            ) : (
              <>
                <Loader2 size={11} className="animate-spin" />
                Thinking...
              </>
            )}
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* INPUT */}
      <div className="p-3 bg-gray-900 border-t border-gray-800">
        <div className="relative">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            disabled={busy}
            placeholder="Ask the Brain engine..."
            className="w-full bg-[#09090b] border border-gray-700 rounded-lg py-2.5 pl-3 pr-10 text-sm text-white focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all disabled:opacity-50"
          />
          <button
            onClick={handleSubmit}
            disabled={busy || !input.trim()}
            className="absolute right-2 top-2 text-gray-400 hover:text-cyan-400 transition-colors p-0.5 disabled:opacity-30 disabled:hover:text-gray-400"
          >
            {busy ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Send size={16} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
