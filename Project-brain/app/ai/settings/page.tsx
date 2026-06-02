"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, RotateCcw, Save } from "lucide-react";
import Link from "next/link";

const API = process.env.NEXT_PUBLIC_AI_API_URL || "http://localhost:8001";

type PromptResponse = {
  prompt: string;
  source?: string;
  updated_at?: string | null;
};

export default function AISettingsPage() {
  const [prompt, setPrompt] = useState("");
  const [defaultPrompt, setDefaultPrompt] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [source, setSource] = useState<string>("default");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [savedRes, defaultRes] = await Promise.all([
          fetch(`${API}/api/v1/ai-settings/system-prompt`),
          fetch(`${API}/api/v1/ai-settings/default-prompt`),
        ]);
        const saved: PromptResponse = await savedRes.json();
        const def: PromptResponse = await defaultRes.json();
        if (!alive) return;
        setPrompt(saved.prompt || "");
        setDefaultPrompt(def.prompt || "");
        setSource(saved.source || "default");
        setUpdatedAt(saved.updated_at || null);
      } catch {
        if (alive) {
          setPrompt("");
          setDefaultPrompt("");
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/v1/ai-settings/system-prompt`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
      const data = await res.json();
      setSource("custom");
      setUpdatedAt(data.updated_at || new Date().toISOString());
      alert("System prompt saved.");
    } catch (e: any) {
      alert(`Could not save prompt: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!confirm("Reset the AI system prompt to the built-in default?")) return;
    setResetting(true);
    try {
      const res = await fetch(`${API}/api/v1/ai-settings/reset-prompt`, { method: "POST" });
      if (!res.ok) throw new Error(`Reset failed (${res.status})`);
      const data = await res.json();
      setPrompt(data.prompt || defaultPrompt);
      setSource("default");
      setUpdatedAt(null);
      alert("Prompt reset to default.");
    } catch (e: any) {
      alert(`Could not reset prompt: ${e.message}`);
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.18),_transparent_30%),linear-gradient(180deg,#050816_0%,#091225_100%)] text-white">
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-8">
        <div className="mb-6 flex items-center gap-3">
          <Link href="/ai" className="rounded-xl border border-white/10 bg-white/5 p-2 hover:bg-white/10">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-cyan-300">AI Settings</h1>
            <p className="text-sm text-zinc-400">Edit the system prompt used by the AI service.</p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-6 text-zinc-300">
            <Loader2 className="animate-spin" size={18} /> Loading settings...
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
            <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 shadow-2xl shadow-cyan-950/20 backdrop-blur">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm uppercase tracking-[0.25em] text-cyan-300/70">System Prompt</div>
                  <div className="text-xs text-zinc-500">
                    Source: <span className="text-zinc-300">{source}</span>
                    {updatedAt ? ` • Updated ${new Date(updatedAt).toLocaleString()}` : ""}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleReset}
                    disabled={resetting}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm hover:bg-white/10 disabled:opacity-50"
                  >
                    {resetting ? <Loader2 className="animate-spin" size={16} /> : <RotateCcw size={16} />}
                    Reset
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                    Save
                  </button>
                </div>
              </div>

              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="min-h-[70vh] w-full rounded-2xl border border-white/10 bg-black/40 p-4 font-mono text-sm leading-6 text-zinc-100 outline-none ring-0 placeholder:text-zinc-600"
                placeholder="Write the AI system prompt here..."
              />
            </div>

            <div className="space-y-4">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                <div className="text-sm font-semibold text-cyan-300">How it works</div>
                <p className="mt-2 text-sm text-zinc-300">
                  The AI service reads this prompt from the database on every request.
                  Saving here updates what the chat orchestrator uses immediately.
                </p>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                <div className="text-sm font-semibold text-cyan-300">Default prompt</div>
                <p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-zinc-400">
                  {defaultPrompt || "No default prompt loaded."}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
