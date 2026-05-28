"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LineChart, Table, FileText, Bot } from "lucide-react";

const API_URL = "http://localhost:8002/api/v1/view";

type SchemeRow = {
  scheme_id: string | number;
  scheme_name: string;
  scheme_type?: string;
};

export default function ReportsHub() {
  const [selectedProject, setSelectedProject] = useState("");
  const [schemes, setSchemes] = useState<SchemeRow[]>([]);
  const router = useRouter();

  useEffect(() => {
    fetch(`${API_URL}/all`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load schemes");
        return res.json();
      })
      .then((data: SchemeRow[]) => setSchemes(Array.isArray(data) ? data : []))
      .catch(() => setSchemes([]));
  }, []);

  const actions = [
    { name: "S-Curve", icon: LineChart, color: "bg-cyan-500", path: "/s-curve" },
    { name: "Data Table", icon: Table, color: "bg-emerald-500", path: "/table" },
    { name: "DPR Analysis", icon: FileText, color: "bg-amber-500", path: "/dpr" },
    { name: "AI Analytics", icon: Bot, color: "bg-purple-500", path: "/ai" },
  ];

  return (
    <div className="p-8 neural-bg min-h-screen text-white">
      <h1 className="text-3xl font-bold mb-8 text-cyan-400">Reports Command Center</h1>

      <div className="glass-input p-6 rounded-2xl mb-8 w-full max-w-md">
        <label className="block text-sm text-zinc-400 mb-2">Select Project/Scheme</label>
        <select
          className="w-full bg-zinc-900 border border-zinc-700 p-3 rounded-xl outline-none"
          value={selectedProject}
          onChange={(e) => setSelectedProject(e.target.value)}
        >
          <option value="">-- Select Scheme --</option>
          {schemes.map((s) => (
            <option key={String(s.scheme_id)} value={String(s.scheme_id)}>
              {s.scheme_name}
              {s.scheme_type ? ` (${s.scheme_type})` : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.name}
              type="button"
              disabled={!selectedProject}
              onClick={() =>
                router.push(`/reports${action.path}?id=${encodeURIComponent(selectedProject)}`)
              }
              className={`p-6 rounded-2xl ${action.color} opacity-90 hover:opacity-100 transition-all text-center flex flex-col items-center gap-4 ${
                !selectedProject ? "opacity-30 cursor-not-allowed" : ""
              }`}
            >
              <Icon size={48} />
              <span className="font-bold text-lg">{action.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

