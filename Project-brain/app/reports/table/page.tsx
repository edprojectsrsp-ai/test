"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

export default function ReportsDataTablePage() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? "";

  return (
    <div className="p-8 neural-bg min-h-screen text-white">
      <h1 className="text-2xl font-bold text-emerald-400 mb-2">Data Table</h1>
      <p className="text-zinc-400 mb-6">
        {id ? `Scheme ID: ${id}` : "No scheme selected."} — grid export wiring can go here.
      </p>
      <Link href="/reports" className="text-cyan-400 underline">
        Back to Reports hub
      </Link>
    </div>
  );
}
