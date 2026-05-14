"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle, Calendar as CalendarIcon, CloudRain, HardHat, Send,
  Activity, ChevronDown, ChevronUp,
} from "lucide-react";
import { jwtDecode } from "jwt-decode";

const API_URL = "http://localhost:8000/api/v1";

type Scheme = { id: number; scheme_name: string; current_status: string };

type DPR = {
  id: number;
  report_date: string;
  weather: string;
  manpower: number;
  work_done: string;
  issues: string;
};

type ActivityRow = {
  id: number;
  activity_name: string;
  uom: string;
  scope_qty: number;
  cumulative: number;
  progress_pct: number;
};

export default function DPREntry() {
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [selectedScheme, setSelectedScheme] = useState("");
  const [dprHistory, setDprHistory] = useState<DPR[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [canWrite, setCanWrite] = useState(false);

  const [formData, setFormData] = useState({
    report_date: new Date().toISOString().split("T")[0],
    weather: "Clear",
    manpower: "",
    work_done: "",
    issues: "",
  });

  // Activity DPR
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [actQty, setActQty] = useState<Record<number, string>>({});
  const [actRemarks, setActRemarks] = useState<Record<number, string>>({});
  const [showActivityDpr, setShowActivityDpr] = useState(false);
  const [actLoading, setActLoading] = useState(false);
  const [username, setUsername] = useState("user");

  useEffect(() => {
    fetch(`${API_URL}/schemes`)
      .then(r => r.json())
      .then(data => {
        const active = data.filter((s: Scheme) => s.current_status !== "closed");
        setSchemes(active);
        if (active.length > 0) setSelectedScheme(active[0].id.toString());
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("brain_token");
    if (token) {
      const decoded = jwtDecode<any>(token);
      setCanWrite(decoded.permissions?.SUPER_ADMIN === true || decoded.permissions?.DPR?.write === true);
      setUsername(decoded.sub || "user");
    }
  }, []);

  useEffect(() => {
    if (selectedScheme) {
      fetchDPRs();
      fetchActivities();
    }
  }, [selectedScheme]);

  const fetchDPRs = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_URL}/dpr/${selectedScheme}`);
      if (res.ok) setDprHistory(await res.json());
    } catch {}
    finally { setIsLoading(false); }
  };

  const fetchActivities = async () => {
    setActLoading(true);
    try {
      const res = await fetch(`${API_URL}/activities/${selectedScheme}`);
      if (res.ok) {
        const data = await res.json();
        setActivities(data);
        setActQty({});
        setActRemarks({});
      } else {
        setActivities([]);
      }
    } catch {
      setActivities([]);
    } finally {
      setActLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!formData.work_done) { alert("Please enter the work executed today."); return; }
    if (!canWrite) { alert("You do not have write access to DPR."); return; }

    try {
      const payload = { ...formData, manpower: parseInt(formData.manpower, 10) || 0 };
      const res = await fetch(`${API_URL}/dpr/${selectedScheme}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        alert("Daily Report Logged!");
        setFormData({ ...formData, work_done: "", issues: "" });
        fetchDPRs();
      }
    } catch { alert("Failed to submit DPR."); }
  };

  const handleActivityDprSubmit = async () => {
    if (!canWrite) { alert("You do not have write access."); return; }

    const entries = activities
      .filter(a => actQty[a.id] && parseFloat(actQty[a.id]) > 0)
      .map(a => ({
        activity_id: a.id,
        actual_date: formData.report_date,
        actual_qty: parseFloat(actQty[a.id]),
        remarks: actRemarks[a.id] || null,
      }));

    if (!entries.length) { alert("Enter at least one activity quantity."); return; }

    const res = await fetch(`${API_URL}/daily-actuals/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheme_id: parseInt(selectedScheme), submitted_by: username, entries }),
    });

    if (res.ok) {
      alert(`Activity DPR submitted: ${entries.length} entries`);
      setActQty({});
      setActRemarks({});
      fetchActivities();
    } else {
      alert("Failed to submit activity DPR. Ensure the database migration has been run.");
    }
  };

  return (
    <div className="relative min-h-screen bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.05)_0%,transparent_60%)] p-10 pt-20 text-white">

      {/* Header */}
      <div className="mb-10 flex items-end justify-between border-b border-zinc-800 pb-6">
        <div>
          <h1 className="mb-2 flex items-center gap-3 text-4xl font-bold tracking-tight">
            <CalendarIcon className="h-8 w-8 text-amber-400" />
            Daily Progress Reports
          </h1>
          <p className="text-lg text-zinc-400">On-site execution logs and roadblock tracking</p>
        </div>
        <select
          value={selectedScheme}
          onChange={e => setSelectedScheme(e.target.value)}
          className="min-w-[300px] rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-lg font-bold outline-none focus:border-amber-400"
        >
          {schemes.map(s => (
            <option key={s.id} value={s.id}>[{s.id}] {s.scheme_name}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">

        {/* DPR Form */}
        <div className="flex flex-col gap-6 rounded-3xl border border-zinc-800 bg-zinc-900 p-8 shadow-2xl">
          <h3 className="border-b border-zinc-800 pb-4 text-2xl font-bold">Log Today's Progress</h3>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="mb-2 block text-sm text-zinc-400">Report Date</label>
              <input
                type="date"
                value={formData.report_date}
                disabled={!canWrite}
                onChange={e => setFormData({ ...formData, report_date: e.target.value })}
                className={`w-full rounded-xl border bg-zinc-950 p-3 outline-none ${canWrite ? "border-zinc-700 focus:border-amber-400" : "cursor-not-allowed border-zinc-800 opacity-50"}`}
              />
            </div>
            <div>
              <label className="mb-2 flex items-center gap-2 text-sm text-zinc-400">
                <CloudRain className="h-4 w-4" /> Weather
              </label>
              <select
                value={formData.weather}
                disabled={!canWrite}
                onChange={e => setFormData({ ...formData, weather: e.target.value })}
                className={`w-full rounded-xl border bg-zinc-950 p-3 outline-none ${canWrite ? "border-zinc-700 focus:border-amber-400" : "cursor-not-allowed border-zinc-800 opacity-50"}`}
              >
                <option value="Clear">Clear</option>
                <option value="Cloudy">Cloudy</option>
                <option value="Rain">Rain</option>
                <option value="Extreme">Extreme Weather</option>
              </select>
            </div>
            <div>
              <label className="mb-2 flex items-center gap-2 text-sm text-zinc-400">
                <HardHat className="h-4 w-4" /> Manpower
              </label>
              <input
                type="number"
                placeholder="e.g. 45"
                value={formData.manpower}
                disabled={!canWrite}
                onChange={e => setFormData({ ...formData, manpower: e.target.value })}
                className={`w-full rounded-xl border bg-zinc-950 p-3 outline-none ${canWrite ? "border-zinc-700 focus:border-amber-400" : "cursor-not-allowed border-zinc-800 opacity-50"}`}
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm text-zinc-400">Work Executed Today <span className="text-amber-400">*</span></label>
            <textarea
              rows={4}
              placeholder="Describe the physical progress achieved on site today..."
              value={formData.work_done}
              disabled={!canWrite}
              onChange={e => setFormData({ ...formData, work_done: e.target.value })}
              className={`w-full resize-none rounded-xl border bg-zinc-950 p-4 outline-none ${canWrite ? "border-zinc-700 focus:border-amber-400" : "cursor-not-allowed border-zinc-800 opacity-50"}`}
            />
          </div>

          <div>
            <label className="mb-2 flex items-center gap-2 text-sm text-zinc-400">
              <AlertTriangle className="h-4 w-4 text-red-400" /> Issues & Roadblocks
            </label>
            <textarea
              rows={3}
              placeholder="Any delays, material shortages, or safety incidents?"
              value={formData.issues}
              disabled={!canWrite}
              onChange={e => setFormData({ ...formData, issues: e.target.value })}
              className={`w-full resize-none rounded-xl border bg-zinc-950 p-4 outline-none ${canWrite ? "border-zinc-700 focus:border-red-400" : "cursor-not-allowed border-zinc-800 opacity-50"}`}
            />
          </div>

          {canWrite && (
            <button
              onClick={handleSubmit}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 py-4 font-bold text-white transition-transform hover:scale-[1.02]"
            >
              <Send className="h-5 w-5" /> Submit Daily Report
            </button>
          )}

          {/* Activity DPR Section */}
          <div className="border-t border-zinc-800 pt-4">
            <button
              onClick={() => setShowActivityDpr(v => !v)}
              className="flex w-full items-center justify-between text-left text-base font-semibold text-zinc-300 hover:text-white transition-colors"
            >
              <span className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-cyan-400" />
                Activity-wise Progress Entry
                {activities.length > 0 && (
                  <span className="text-xs bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-2 py-0.5 rounded-full">
                    {activities.length} activities
                  </span>
                )}
              </span>
              {showActivityDpr ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showActivityDpr && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="mt-4 space-y-3"
              >
                {actLoading ? (
                  <p className="text-sm text-cyan-400 animate-pulse">Loading activities...</p>
                ) : activities.length === 0 ? (
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-center">
                    <p className="text-zinc-500 text-sm">No activities configured for this scheme.</p>
                    <p className="text-zinc-600 text-xs mt-1">Set up a plan and activities via the Plan Engine.</p>
                  </div>
                ) : (
                  <>
                    <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                      {activities.map(act => (
                        <div key={act.id} className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-white">{act.activity_name}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-zinc-500">{act.progress_pct}% done</span>
                              <span className="text-xs text-zinc-600 bg-zinc-900 px-2 py-0.5 rounded">{act.uom || "—"}</span>
                            </div>
                          </div>
                          <div className="h-1 rounded-full bg-zinc-800 mb-2">
                            <div className="h-full rounded-full bg-cyan-500/60" style={{ width: `${Math.min(act.progress_pct, 100)}%` }} />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              type="number"
                              placeholder={`Today's qty (${act.uom || "units"})`}
                              value={actQty[act.id] ?? ""}
                              disabled={!canWrite}
                              onChange={e => setActQty(q => ({ ...q, [act.id]: e.target.value }))}
                              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-cyan-400 disabled:opacity-50"
                            />
                            <input
                              type="text"
                              placeholder="Remarks (optional)"
                              value={actRemarks[act.id] ?? ""}
                              disabled={!canWrite}
                              onChange={e => setActRemarks(r => ({ ...r, [act.id]: e.target.value }))}
                              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-cyan-400 disabled:opacity-50"
                            />
                          </div>
                        </div>
                      ))}
                    </div>

                    {canWrite && (
                      <button
                        onClick={handleActivityDprSubmit}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 py-3 text-sm font-bold text-cyan-400 hover:bg-cyan-500/20 transition-colors"
                      >
                        <Activity className="h-4 w-4" /> Submit Activity Progress
                      </button>
                    )}
                  </>
                )}
              </motion.div>
            )}
          </div>
        </div>

        {/* DPR History Feed */}
        <div className="flex h-[700px] flex-col rounded-3xl border border-zinc-800 bg-zinc-900 p-8 shadow-2xl">
          <h3 className="mb-6 border-b border-zinc-800 pb-4 text-2xl font-bold">Site Feed (Last 30 Days)</h3>

          <div className="flex-1 space-y-4 overflow-y-auto pr-2">
            {isLoading ? (
              <div className="flex justify-center text-amber-400 animate-pulse">Loading Site History...</div>
            ) : dprHistory.length === 0 ? (
              <div className="mt-10 text-center text-zinc-500">No reports logged yet.</div>
            ) : (
              dprHistory.map(dpr => (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  key={dpr.id}
                  className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 p-5"
                >
                  <div className={`absolute bottom-0 left-0 top-0 w-1 ${dpr.weather === "Rain" ? "bg-blue-500" : dpr.weather === "Extreme" ? "bg-red-500" : "bg-amber-500"}`} />

                  <div className="mb-3 flex items-start justify-between pl-3">
                    <div className="text-lg font-bold text-white">
                      {new Date(dpr.report_date).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })}
                    </div>
                    <div className="flex gap-3 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 font-mono text-xs text-zinc-400">
                      <span className="flex items-center gap-1"><HardHat className="h-3 w-3 text-amber-400" /> {dpr.manpower}</span>
                      <span className="flex items-center gap-1"><CloudRain className="h-3 w-3 text-blue-400" /> {dpr.weather}</span>
                    </div>
                  </div>

                  <div className="mb-3 whitespace-pre-wrap pl-3 text-sm leading-relaxed text-zinc-300">{dpr.work_done}</div>

                  {dpr.issues && (
                    <div className="mt-3 flex items-start gap-2 rounded-xl border-t border-zinc-800 bg-red-500/5 p-3 pl-3 text-sm text-red-400">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{dpr.issues}</span>
                    </div>
                  )}
                </motion.div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
