"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function ReportsAiContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? "";

  return (
    <div className="p-8 neural-bg min-h-screen text-white">
      <h1 className="text-2xl font-bold text-purple-400 mb-2">AI Analytics</h1>
      <p className="text-zinc-400 mb-6">
        {id ? `Scheme ID: ${id}` : "No scheme selected."} — MOS / LLM insights can mount here.
      </p>
      <Link href="/reports" className="text-cyan-400 underline">
        Back to Reports hub
      </Link>
    </div>
  );
}

export default function ReportsAiPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-950 p-8 text-zinc-400">Loading AI analytics…</div>}>
      <ReportsAiContent />
    </Suspense>
  );
}
