"use client";

import type { ComponentType } from "react";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  Plus,
  FolderGit2,
  Activity,
  ClipboardList,
  Calendar,
  DollarSign,
  Package,
  Settings,
  BarChart3,
  Network,
  CheckSquare,
  Truck,
  Receipt,
  FileText,
  Brain,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMos } from "../brain/MosContext";

type ModuleItem = {
  name: string;
  icon: ComponentType<{ className?: string }>;
  path: string;
};

const modules: ModuleItem[] = [
  { name: "Dashboard", icon: LayoutDashboard, path: "/dashboard" },
  { name: "AI Assistant", icon: Brain, path: "/ai" },
  { name: "Reports", icon: BarChart3, path: "/reports" },
  { name: "Add Scheme", icon: Plus, path: "/add" },
  { name: "View Schemes", icon: FolderGit2, path: "/view" },
  { name: "Physical Progress", icon: Activity, path: "/physical" },
  { name: "DPR Entry", icon: Calendar, path: "/dpr" },
  { name: "Execution", icon: CheckSquare, path: "/execution" },
  { name: "TOD Tracking", icon: Truck, path: "/tod" },
  { name: "Billing Schedule", icon: Receipt, path: "/billing" },
  { name: "CAPEX", icon: DollarSign, path: "/capex" },
  { name: "Material Tracking", icon: Package, path: "/material" },
  { name: "CPM Engine", icon: Network, path: "/cpm" },
  { name: "Status Change", icon: Settings, path: "/status" },
];

export default function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { mosAwake, initMOS, chatHistory } = useMos();

  return (
    <div className="w-80 bg-black/50 border-r border-cyan-900/50 flex flex-col backdrop-blur-md z-10 h-screen fixed left-0 top-0">
      
      {/* Header Area */}
      <div className="p-6 flex items-center gap-4 border-b border-zinc-800/50">
        <motion.div 
          animate={{ rotate: [-12, 12, -12] }} 
          transition={{ duration: 8, repeat: Infinity }} 
          className="text-5xl"
        >
          🧠
        </motion.div>
        <div>
          <h1 className="font-[Space Grotesk] text-2xl font-bold tracking-tighter text-white">PROJECT BRAIN</h1>
          <p className="text-cyan-400 text-xs">AI Intelligence Center</p>
        </div>
      </div>

      {/* Navigation Links */}
      <div className="flex-1 overflow-y-auto py-4 px-3 custom-scrollbar">
        {modules.map((module) => {
          const Icon = module.icon;
          const isActive =
            module.path === "/reports"
              ? pathname === "/reports" || pathname.startsWith("/reports/")
              : pathname === module.path;

          return (
            <div key={module.path}>
              {module.name === "Physical Progress" && (
                <div className="mb-2">
                  <Link
                    href="/progress/plan-engine"
                    className="flex items-center gap-3 w-full text-left px-4 py-3 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors group"
                  >
                    <ClipboardList size={18} className="text-cyan-500 group-hover:text-cyan-400" />
                    <span className="font-semibold tracking-wide">Plan Engine</span>
                  </Link>
                  <Link
                    href="/appendix-2"
                    className="flex items-center gap-3 w-full text-left px-4 py-3 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors group"
                  >
                    <FileText size={18} className="text-cyan-500 group-hover:text-cyan-400" />
                    <span className="font-semibold tracking-wide">Appendix-2</span>
                  </Link>
                </div>
              )}

              <button
                onClick={() => router.push(module.path)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl mb-1 transition-all text-left ${
                  isActive 
                    ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" 
                    : "text-zinc-400 hover:text-white hover:bg-zinc-900/50"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="font-medium text-sm">{module.name}</span>
              </button>
            </div>
          );
        })}
      </div>

      {/* Your Custom Telegram-Style Chat History */}
      <div className="h-64 flex flex-col p-4 border-t border-zinc-800/50">
        <h3 className="text-zinc-400 text-xs font-semibold uppercase tracking-wider mb-3 flex justify-between items-center">
          Chat History
          {!mosAwake && (
            <button onClick={initMOS} className="bg-cyan-500 hover:bg-cyan-400 text-[10px] text-black px-2 py-1 rounded-full font-bold transition-colors">
              Wake Up MOS
            </button>
          )}
        </h3>
        
        <div className="bg-black/60 backdrop-blur-md border border-white/10 flex-1 rounded-2xl p-3 overflow-y-auto flex flex-col custom-scrollbar">
          {!mosAwake ? (
            <div className="msg-mos text-xs shadow-lg text-white font-medium">
              <span className="text-sm mr-1">😴</span> Zzz... 
            </div>
          ) : (
            chatHistory.map((msg) => (
              <div key={msg.id} className="msg-mos text-xs shadow-lg text-white font-medium">
                <span className="text-sm mr-1">{msg.mood}</span> {msg.text}
              </div>
            ))
          )}
        </div>
      </div>

    </div>
  );
}
