"use client";

/**
 * DPR â€” Daily Progress Reports
 *
 * Two modes, toggle at the top:
 *   1. Legacy  â€” one report per (scheme, date). Unchanged from before.
 *   2. Multi-Entry (Sprint 14a) â€” many entries per day, each with GPS, area,
 *      photos. Used for capturing separate site visits during the day.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle, Calendar as CalendarIcon, CloudRain, HardHat, Send,
  Activity, ChevronDown, ChevronUp, MapPin, Camera, Image as ImageIcon,
  Trash2, Loader2, Layers, PlusCircle, X,
} from "lucide-react";
import { jwtDecode } from "jwt-decode";

const API_URL = "http://localhost:8002/api/v1";
const BACKEND_ORIGIN = "http://localhost:8002"; // for /uploads/...

// =============================================================================
// Shared types
// =============================================================================
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

type V2Photo = {
  id: number;
  url: string;
  captured_at: string | null;
};

type V2Entry = {
  id: number;
  scheme_id: number;
  report_date: string;
  area_name: string | null;
  gps_lat: number;
  gps_lng: number;
  gps_accuracy_m: number | null;
  work_done: string | null;
  issues: string | null;
  weather: string;
  manpower: number;
  created_by: string | null;
  created_at: string | null;
  photos: V2Photo[];
};

// =============================================================================
// Page shell â€” scheme picker, mode toggle, then either pane
// =============================================================================
export default function DPREntry() {
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [selectedScheme, setSelectedScheme] = useState("");
  const [mode, setMode] = useState<"legacy" | "multi">("multi");
  const [canWrite, setCanWrite] = useState(false);
  const [username, setUsername] = useState("user");
  const [hasActivePlan, setHasActivePlan] = useState<boolean | null>(null);

  useEffect(() => {
    // Prefer /schemes/all (present in the main backend). Fall back to /view/all for older builds.
    const load = async () => {
      const tryUrls = [`${API_URL}/schemes/all`, `${API_URL}/view/all`];
      for (const url of tryUrls) {
        try {
          const r = await fetch(url);
          const data = await r.json();
          if (!Array.isArray(data)) continue;
          const active = data.filter((s: Scheme) => (s as any).current_status !== "closed");
          setSchemes(active);
          if (active.length > 0) setSelectedScheme(active[0].id.toString());
          return;
        } catch {
          // try next url
        }
      }
    };

    load();
  }, []);

  // Check if the selected scheme has any locked plan
  useEffect(() => {
    if (!selectedScheme) { setHasActivePlan(null); return; }
    setHasActivePlan(null);
    fetch(`${API_URL}/plan-engine/schemes/${selectedScheme}/progress`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d) { setHasActivePlan(false); return; }
        const hasPlan = Array.isArray(d.packages) && d.packages.some((p: any) => p.has_plan);
        setHasActivePlan(hasPlan);
      })
      .catch(() => setHasActivePlan(false));
  }, [selectedScheme]);

  useEffect(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("brain_token") : null;
    if (token) {
      try {
        const decoded = jwtDecode<any>(token);
        setCanWrite(
          decoded.permissions?.SUPER_ADMIN === true ||
            decoded.permissions?.DPR?.write === true,
        );
        setUsername(decoded.sub || "user");
      } catch {
        /* bad token, ignore */
      }
    }
  }, []);

  return (
    <div className="relative min-h-screen bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.05)_0%,transparent_60%)] p-10 pt-20 text-white">
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-zinc-800 pb-6">
        <div>
          <h1 className="mb-2 flex items-center gap-3 text-4xl font-bold tracking-tight">
            <CalendarIcon className="h-8 w-8 text-amber-400" />
            Daily Progress Reports
          </h1>
          <p className="text-lg text-zinc-400">On-site execution logs and roadblock tracking</p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {/* Mode toggle */}
          <div className="inline-flex rounded-xl border border-zinc-800 bg-zinc-900 p-1 text-xs">
            <button
              onClick={() => setMode("multi")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 font-medium transition-colors ${
                mode === "multi" ? "bg-amber-500/20 text-amber-300" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Layers className="h-3.5 w-3.5" /> Multi-Entry
            </button>
            <button
              onClick={() => setMode("legacy")}
              className={`rounded-lg px-3 py-2 font-medium transition-colors ${
                mode === "legacy" ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Legacy
            </button>
          </div>

          <select
            value={selectedScheme}
            onChange={(e) => setSelectedScheme(e.target.value)}
            className="min-w-[260px] rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-lg font-bold outline-none focus:border-amber-400"
          >
            {schemes.map((s) => (
              <option key={s.id} value={s.id}>
                [{s.id}] {s.scheme_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* DPR gate: warn if no locked plan */}
      {selectedScheme && hasActivePlan === false && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-sm text-amber-300">
          <span className="text-lg shrink-0">⚠️</span>
          <div>
            <span className="font-bold">No active baseline plan found for this scheme.</span>
            <span className="ml-2 text-amber-400/80">
              DPR entries cannot be linked to progress without a locked plan.
              Please go to{" "}
              <a href="/progress/plan-engine" className="underline font-bold hover:text-amber-200">
                Plan Engine
              </a>{" "}
              to create and lock a plan first.
            </span>
          </div>
        </div>
      )}

      {!selectedScheme ? (
        <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/40 p-12 text-center text-zinc-500">
          No active schemes available.
        </div>
      ) : mode === "legacy" ? (
        <LegacyPane
          schemeId={selectedScheme}
          canWrite={canWrite}
          username={username}
        />
      ) : (
        <MultiEntryPane
          schemeId={selectedScheme}
          canWrite={canWrite}
          username={username}
        />
      )}
    </div>
  );
}

// =============================================================================
// LEGACY PANE â€” preserves original behavior verbatim, only refactored into
// a child component so the toggle can swap it out.
// =============================================================================
function LegacyPane({
  schemeId,
  canWrite,
  username,
}: {
  schemeId: string;
  canWrite: boolean;
  username: string;
}) {
  const [dprHistory, setDprHistory] = useState<DPR[]>([]);
  const [isLoading, setIsLoading] = useState(false);
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

  useEffect(() => {
    if (schemeId) {
      fetchDPRs();
      fetchActivities();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemeId]);

  const fetchDPRs = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_URL}/dpr/${schemeId}`);
      if (res.ok) setDprHistory(await res.json());
    } catch {
      /* swallow */
    } finally {
      setIsLoading(false);
    }
  };

  const fetchActivities = async () => {
    setActLoading(true);
    try {
      const res = await fetch(`${API_URL}/activities/${schemeId}`);
      if (res.ok) {
        setActivities(await res.json());
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
    if (!formData.work_done) {
      alert("Please enter the work executed today.");
      return;
    }
    if (!canWrite) {
      alert("You do not have write access to DPR.");
      return;
    }
    try {
      const payload = { ...formData, manpower: parseInt(formData.manpower, 10) || 0 };
      const res = await fetch(`${API_URL}/dpr/${schemeId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        alert("Daily Report Logged!");
        setFormData({ ...formData, work_done: "", issues: "" });
        fetchDPRs();
      }
    } catch {
      alert("Failed to submit DPR.");
    }
  };

  const handleActivityDprSubmit = async () => {
    if (!canWrite) {
      alert("You do not have write access.");
      return;
    }
    const entries = activities
      .filter((a) => actQty[a.id] && parseFloat(actQty[a.id]) > 0)
      .map((a) => ({
        activity_id: a.id,
        actual_date: formData.report_date,
        actual_qty: parseFloat(actQty[a.id]),
        remarks: actRemarks[a.id] || null,
      }));
    if (!entries.length) {
      alert("Enter at least one activity quantity.");
      return;
    }
    const res = await fetch(`${API_URL}/daily-actuals/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scheme_id: parseInt(schemeId),
        submitted_by: username,
        entries,
      }),
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
    <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
      {/* DPR Form */}
      <div className="flex flex-col gap-6 rounded-3xl border border-zinc-800 bg-zinc-900 p-8 shadow-2xl">
        <h3 className="border-b border-zinc-800 pb-4 text-2xl font-bold">Log Today's Progress</h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-2 block text-sm text-zinc-400">Date</label>
            <input
              type="date"
              value={formData.report_date}
              disabled={!canWrite}
              onChange={(e) => setFormData({ ...formData, report_date: e.target.value })}
              className={`w-full rounded-xl border bg-zinc-950 p-3 outline-none ${
                canWrite ? "border-zinc-700 focus:border-amber-400" : "cursor-not-allowed border-zinc-800 opacity-50"
              }`}
            />
          </div>
          <div>
            <label className="mb-2 flex items-center gap-2 text-sm text-zinc-400">
              <CloudRain className="h-4 w-4" /> Weather
            </label>
            <select
              value={formData.weather}
              disabled={!canWrite}
              onChange={(e) => setFormData({ ...formData, weather: e.target.value })}
              className={`w-full rounded-xl border bg-zinc-950 p-3 outline-none ${
                canWrite ? "border-zinc-700 focus:border-amber-400" : "cursor-not-allowed border-zinc-800 opacity-50"
              }`}
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
              onChange={(e) => setFormData({ ...formData, manpower: e.target.value })}
              className={`w-full rounded-xl border bg-zinc-950 p-3 outline-none ${
                canWrite ? "border-zinc-700 focus:border-amber-400" : "cursor-not-allowed border-zinc-800 opacity-50"
              }`}
            />
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm text-zinc-400">
            Work Executed Today <span className="text-amber-400">*</span>
          </label>
          <textarea
            rows={4}
            placeholder="Describe the physical progress achieved on site today..."
            value={formData.work_done}
            disabled={!canWrite}
            onChange={(e) => setFormData({ ...formData, work_done: e.target.value })}
            className={`w-full resize-none rounded-xl border bg-zinc-950 p-4 outline-none ${
              canWrite ? "border-zinc-700 focus:border-amber-400" : "cursor-not-allowed border-zinc-800 opacity-50"
            }`}
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
            onChange={(e) => setFormData({ ...formData, issues: e.target.value })}
            className={`w-full resize-none rounded-xl border bg-zinc-950 p-4 outline-none ${
              canWrite ? "border-zinc-700 focus:border-red-400" : "cursor-not-allowed border-zinc-800 opacity-50"
            }`}
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
            onClick={() => setShowActivityDpr((v) => !v)}
            className="flex w-full items-center justify-between text-left text-base font-semibold text-zinc-300 transition-colors hover:text-white"
          >
            <span className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-cyan-400" />
              Activity-wise Progress Entry
              {activities.length > 0 && (
                <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-400">
                  {activities.length} activities
                </span>
              )}
            </span>
            {showActivityDpr ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          {showActivityDpr && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              className="mt-4 space-y-3"
            >
              {actLoading ? (
                <p className="animate-pulse text-sm text-cyan-400">Loading activities...</p>
              ) : activities.length === 0 ? (
                <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-center">
                  <p className="text-sm text-zinc-500">No activities configured for this scheme.</p>
                  <p className="mt-1 text-xs text-zinc-600">Set up a plan and activities via the Plan Engine.</p>
                </div>
              ) : (
                <>
                  <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                    {activities.map((act) => (
                      <div key={act.id} className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-sm font-medium text-white">{act.activity_name}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-zinc-500">{act.progress_pct}% done</span>
                            <span className="rounded bg-zinc-900 px-2 py-0.5 text-xs text-zinc-600">
                              {act.uom || "â€”"}
                            </span>
                          </div>
                        </div>
                        <div className="mb-2 h-1 rounded-full bg-zinc-800">
                          <div
                            className="h-full rounded-full bg-cyan-500/60"
                            style={{ width: `${Math.min(act.progress_pct, 100)}%` }}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="number"
                            placeholder={`Today's qty (${act.uom || "units"})`}
                            value={actQty[act.id] ?? ""}
                            disabled={!canWrite}
                            onChange={(e) => setActQty((q) => ({ ...q, [act.id]: e.target.value }))}
                            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-cyan-400 disabled:opacity-50"
                          />
                          <input
                            type="text"
                            placeholder="Remarks (optional)"
                            value={actRemarks[act.id] ?? ""}
                            disabled={!canWrite}
                            onChange={(e) => setActRemarks((r) => ({ ...r, [act.id]: e.target.value }))}
                            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-cyan-400 disabled:opacity-50"
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  {canWrite && (
                    <button
                      onClick={handleActivityDprSubmit}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 py-3 text-sm font-bold text-cyan-400 transition-colors hover:bg-cyan-500/20"
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
            <div className="flex animate-pulse justify-center text-amber-400">Loading Site History...</div>
          ) : dprHistory.length === 0 ? (
            <div className="mt-10 text-center text-zinc-500">No reports logged yet.</div>
          ) : (
            dprHistory.map((dpr) => (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                key={dpr.id}
                className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 p-5"
              >
                <div
                  className={`absolute bottom-0 left-0 top-0 w-1 ${
                    dpr.weather === "Rain"
                      ? "bg-blue-500"
                      : dpr.weather === "Extreme"
                      ? "bg-red-500"
                      : "bg-amber-500"
                  }`}
                />
                <div className="mb-3 flex items-start justify-between pl-3">
                  <div className="text-lg font-bold text-white">
                    {new Date(dpr.report_date).toLocaleDateString("en-GB", {
                      weekday: "short",
                      day: "2-digit",
                      month: "short",
                    })}
                  </div>
                  <div className="flex gap-3 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 font-mono text-xs text-zinc-400">
                    <span className="flex items-center gap-1">
                      <HardHat className="h-3 w-3 text-amber-400" /> {dpr.manpower}
                    </span>
                    <span className="flex items-center gap-1">
                      <CloudRain className="h-3 w-3 text-blue-400" /> {dpr.weather}
                    </span>
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
  );
}

// =============================================================================
// MULTI-ENTRY PANE (Sprint 14a)
// =============================================================================
function MultiEntryPane({
  schemeId,
  canWrite,
  username,
}: {
  schemeId: string;
  canWrite: boolean;
  username: string;
}) {
  const [entries, setEntries] = useState<V2Entry[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!schemeId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetch(`${API_URL}/dpr/v2/${schemeId}`).then((r) => (r.ok ? r.json() : [])),
      fetch(`${API_URL}/dpr/v2/${schemeId}/areas`).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([ent, ar]) => {
        if (cancelled) return;
        setEntries(Array.isArray(ent) ? ent : []);
        setAreas(Array.isArray(ar) ? ar : []);
      })
      .catch(() => {
        if (!cancelled) {
          setEntries([]);
          setAreas([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [schemeId, refreshKey]);

  const reload = () => setRefreshKey((k) => k + 1);

  // Group entries by date for the feed
  const grouped = useMemo(() => {
    const map = new Map<string, V2Entry[]>();
    for (const e of entries) {
      const key = e.report_date;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [entries]);

  return (
    <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
      <NewEntryForm
        schemeId={schemeId}
        canWrite={canWrite}
        username={username}
        areas={areas}
        onSaved={reload}
      />

      <div className="flex h-[760px] flex-col rounded-3xl border border-zinc-800 bg-zinc-900 p-8 shadow-2xl">
        <h3 className="mb-6 flex items-center justify-between border-b border-zinc-800 pb-4 text-2xl font-bold">
          <span>Site Feed</span>
          {entries.length > 0 && (
            <span className="text-sm font-normal text-zinc-500">
              {entries.length} entries Â· {grouped.length} days
            </span>
          )}
        </h3>

        <div className="flex-1 space-y-6 overflow-y-auto pr-2">
          {loading ? (
            <div className="flex animate-pulse justify-center text-amber-400">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading feed...
            </div>
          ) : grouped.length === 0 ? (
            <div className="mt-10 text-center text-zinc-500">
              No entries logged yet.
              <div className="mt-2 text-xs">Submit your first multi-entry report on the left.</div>
            </div>
          ) : (
            grouped.map(([date, dayEntries]) => (
              <div key={date}>
                <div className="sticky top-0 z-10 -mx-1 mb-3 bg-zinc-900/95 px-1 py-1 backdrop-blur">
                  <div className="text-xs font-bold uppercase tracking-wider text-amber-400">
                    {new Date(date).toLocaleDateString("en-GB", {
                      weekday: "short",
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                    <span className="ml-2 font-normal text-zinc-500">{dayEntries.length} entries</span>
                  </div>
                </div>
                <div className="space-y-3">
                  {dayEntries.map((e) => (
                    <EntryCard key={e.id} entry={e} canWrite={canWrite} onDeleted={reload} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// New-entry form
// =============================================================================
function NewEntryForm({
  schemeId,
  canWrite,
  username,
  areas,
  onSaved,
}: {
  schemeId: string;
  canWrite: boolean;
  username: string;
  areas: string[];
  onSaved: () => void;
}) {
  const [reportDate, setReportDate] = useState(new Date().toISOString().split("T")[0]);
  const [areaName, setAreaName] = useState("");
  const [weather, setWeather] = useState("Clear");
  const [manpower, setManpower] = useState("");
  const [workDone, setWorkDone] = useState("");
  const [issues, setIssues] = useState("");

  const [gps, setGps] = useState<{ lat: number; lng: number; acc?: number } | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const [photos, setPhotos] = useState<File[]>([]);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const [submitting, setSubmitting] = useState(false);

  // Reset photos & area whenever scheme changes
  useEffect(() => {
    setPhotos([]);
    setAreaName("");
    setWorkDone("");
    setIssues("");
    setManpower("");
    setGps(null);
    setGpsError(null);
  }, [schemeId]);

  const getGps = () => {
    if (!("geolocation" in navigator)) {
      setGpsError("This browser doesn't support geolocation.");
      return;
    }
    setGpsLoading(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGps({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          acc: pos.coords.accuracy,
        });
        setGpsLoading(false);
      },
      (err) => {
        setGpsError(err.message || "Couldn't get GPS fix.");
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  const addPhotos = (files: FileList | null) => {
    if (!files) return;
    const fresh = Array.from(files).filter((f) => f.type.startsWith("image/"));
    setPhotos((prev) => [...prev, ...fresh]);
  };

  const removePhoto = (idx: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  };

  const canSubmit = canWrite && !!gps && !submitting;

  const submit = async () => {
    if (!canWrite) {
      alert("You don't have write access to DPR.");
      return;
    }
    if (!gps) {
      alert("GPS location is required. Tap 'Capture GPS' first.");
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("report_date", reportDate);
      fd.append("gps_lat", String(gps.lat));
      fd.append("gps_lng", String(gps.lng));
      if (gps.acc != null) fd.append("gps_accuracy_m", String(gps.acc));
      if (areaName.trim()) fd.append("area_name", areaName.trim());
      if (workDone.trim()) fd.append("work_done", workDone.trim());
      if (issues.trim()) fd.append("issues", issues.trim());
      fd.append("weather", weather);
      fd.append("manpower", String(parseInt(manpower, 10) || 0));
      fd.append("created_by", username);
      for (const p of photos) fd.append("photos", p);

      const res = await fetch(`${API_URL}/dpr/v2/${schemeId}`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        alert(`Submit failed: ${res.status} ${text || ""}`);
        return;
      }
      // Reset form for the next entry, but keep date & weather
      setAreaName("");
      setWorkDone("");
      setIssues("");
      setManpower("");
      setPhotos([]);
      setGps(null); // require re-capture for next entry (different visit, different fix)
      onSaved();
    } catch (e: any) {
      alert(`Submit failed: ${e?.message || e}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 rounded-3xl border border-zinc-800 bg-zinc-900 p-8 shadow-2xl">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
        <h3 className="text-2xl font-bold">New Entry</h3>
        <span className="text-xs uppercase tracking-wider text-amber-400">Multi-Entry Mode</span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-2 block text-sm text-zinc-400">Date</label>
          <input
            type="date"
            value={reportDate}
            disabled={!canWrite}
            onChange={(e) => setReportDate(e.target.value)}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 outline-none focus:border-amber-400 disabled:opacity-50"
          />
        </div>
        <div>
          <label className="mb-2 flex items-center gap-2 text-sm text-zinc-400">
            <CloudRain className="h-4 w-4" /> Weather
          </label>
          <select
            value={weather}
            disabled={!canWrite}
            onChange={(e) => setWeather(e.target.value)}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 outline-none focus:border-amber-400 disabled:opacity-50"
          >
            <option value="Clear">Clear</option>
            <option value="Cloudy">Cloudy</option>
            <option value="Rain">Rain</option>
            <option value="Extreme">Extreme Weather</option>
          </select>
        </div>
      </div>

      {/* Area combobox â€” datalist gives free-typing + suggestions out of the box */}
      <div>
        <label className="mb-2 flex items-center gap-2 text-sm text-zinc-400">
          <Layers className="h-4 w-4 text-amber-400" /> Area Name
          {areas.length > 0 && (
            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-400">
              {areas.length} SAVED
            </span>
          )}
        </label>
        <input
          list={`areas-${schemeId}`}
          value={areaName}
          disabled={!canWrite}
          onChange={(e) => setAreaName(e.target.value)}
          placeholder="e.g. Substation Bay 3 (start typing or pick)"
          className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 outline-none focus:border-amber-400 disabled:opacity-50"
        />
        <datalist id={`areas-${schemeId}`}>
          {areas.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
      </div>

      {/* GPS */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-zinc-300">
            <MapPin className="h-4 w-4 text-cyan-400" />
            <span className="font-medium">GPS Location</span>
            <span className="text-xs text-amber-400">*required</span>
          </div>
          <button
            onClick={getGps}
            disabled={!canWrite || gpsLoading}
            className="flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-300 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
          >
            {gpsLoading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Acquiringâ€¦
              </>
            ) : gps ? (
              <>
                <MapPin className="h-3.5 w-3.5" /> Re-capture
              </>
            ) : (
              <>
                <MapPin className="h-3.5 w-3.5" /> Capture GPS
              </>
            )}
          </button>
        </div>
        {gps ? (
          <div className="font-mono text-xs text-zinc-400">
            <div>
              lat: <span className="text-cyan-300">{gps.lat.toFixed(6)}</span> &nbsp;
              lng: <span className="text-cyan-300">{gps.lng.toFixed(6)}</span>
            </div>
            {gps.acc != null && (
              <div className="mt-0.5 text-zinc-500">Â±{Math.round(gps.acc)} m</div>
            )}
          </div>
        ) : (
          <div className="text-xs text-zinc-500">
            No fix yet. Stand outside if accuracy is poor.
          </div>
        )}
        {gpsError && (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{gpsError}</span>
          </div>
        )}
      </div>

      {/* Photos */}
      <div>
        <label className="mb-2 flex items-center gap-2 text-sm text-zinc-400">
          <Camera className="h-4 w-4" /> Photos
          {photos.length > 0 && (
            <span className="rounded bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-bold text-cyan-400">
              {photos.length} ATTACHED
            </span>
          )}
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => cameraInputRef.current?.click()}
            disabled={!canWrite}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-amber-400 hover:text-amber-300 disabled:opacity-50"
          >
            <Camera className="h-3.5 w-3.5" /> Camera
          </button>
          <button
            onClick={() => galleryInputRef.current?.click()}
            disabled={!canWrite}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-amber-400 hover:text-amber-300 disabled:opacity-50"
          >
            <ImageIcon className="h-3.5 w-3.5" /> Gallery
          </button>
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              addPhotos(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              addPhotos(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {photos.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {photos.map((p, i) => (
              <PhotoChip key={`${p.name}-${i}`} file={p} onRemove={() => removePhoto(i)} />
            ))}
          </div>
        )}
      </div>

      {/* Manpower + Work Done + Issues */}
      <div>
        <label className="mb-2 flex items-center gap-2 text-sm text-zinc-400">
          <HardHat className="h-4 w-4" /> Manpower (this visit)
        </label>
        <input
          type="number"
          placeholder="e.g. 12"
          value={manpower}
          disabled={!canWrite}
          onChange={(e) => setManpower(e.target.value)}
          className="w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3 outline-none focus:border-amber-400 disabled:opacity-50"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm text-zinc-400">Diary / Work Done</label>
        <textarea
          rows={3}
          placeholder="What you observed or executed at this area..."
          value={workDone}
          disabled={!canWrite}
          onChange={(e) => setWorkDone(e.target.value)}
          className="w-full resize-none rounded-xl border border-zinc-700 bg-zinc-950 p-4 outline-none focus:border-amber-400 disabled:opacity-50"
        />
      </div>

      <div>
        <label className="mb-2 flex items-center gap-2 text-sm text-zinc-400">
          <AlertTriangle className="h-4 w-4 text-red-400" /> Remarks / Issues
        </label>
        <textarea
          rows={2}
          placeholder="Optional. Roadblocks, observations, or notes..."
          value={issues}
          disabled={!canWrite}
          onChange={(e) => setIssues(e.target.value)}
          className="w-full resize-none rounded-xl border border-zinc-700 bg-zinc-950 p-4 outline-none focus:border-red-400 disabled:opacity-50"
        />
      </div>

      <button
        onClick={submit}
        disabled={!canSubmit}
        className={`flex w-full items-center justify-center gap-2 rounded-xl py-4 font-bold text-white transition-transform ${
          canSubmit
            ? "bg-gradient-to-r from-amber-500 to-orange-500 hover:scale-[1.01]"
            : "cursor-not-allowed bg-zinc-800 text-zinc-500"
        }`}
      >
        {submitting ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" /> Savingâ€¦
          </>
        ) : (
          <>
            <PlusCircle className="h-5 w-5" /> Submit Entry
          </>
        )}
      </button>
      {!gps && canWrite && !submitting && (
        <p className="-mt-3 text-center text-xs text-zinc-500">
          Capture GPS to enable submit.
        </p>
      )}
    </div>
  );
}

function PhotoChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <div className="group relative h-16 w-16 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950">
      {url && <img src={url} alt={file.name} className="h-full w-full object-cover" />}
      <button
        onClick={onRemove}
        className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
        title="Remove"
      >
        <X className="h-3 w-3 text-white" />
      </button>
    </div>
  );
}

// =============================================================================
// Feed card for one entry
// =============================================================================
function EntryCard({
  entry,
  canWrite,
  onDeleted,
}: {
  entry: V2Entry;
  canWrite: boolean;
  onDeleted: () => void;
}) {
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const mapsHref = `https://www.google.com/maps?q=${entry.gps_lat},${entry.gps_lng}`;
  const created = entry.created_at
    ? new Date(entry.created_at).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  const remove = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`${API_URL}/dpr/v2/entry/${entry.id}`, { method: "DELETE" });
      if (!res.ok) {
        alert("Delete failed.");
        return;
      }
      onDeleted();
    } finally {
      setDeleting(false);
    }
  };

  const weatherBar =
    entry.weather === "Rain"
      ? "bg-blue-500"
      : entry.weather === "Extreme"
      ? "bg-red-500"
      : "bg-amber-500";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 p-5"
    >
      <div className={`absolute bottom-0 left-0 top-0 w-1 ${weatherBar}`} />

      {/* Header */}
      <div className="mb-3 flex items-start justify-between pl-3">
        <div>
          <div className="flex items-center gap-2 text-base font-bold text-white">
            {entry.area_name || <span className="italic text-zinc-500">(no area)</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            {created && <span>{created}</span>}
            {entry.created_by && <span>Â· by {entry.created_by}</span>}
            <a
              href={mapsHref}
              target="_blank"
              rel="noreferrer"
              className="ml-1 inline-flex items-center gap-1 rounded-full bg-cyan-500/10 px-2 py-0.5 text-cyan-300 hover:bg-cyan-500/20"
            >
              <MapPin className="h-3 w-3" />
              {entry.gps_lat.toFixed(5)}, {entry.gps_lng.toFixed(5)}
              {entry.gps_accuracy_m != null && (
                <span className="text-zinc-500">Â±{Math.round(entry.gps_accuracy_m)}m</span>
              )}
            </a>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex gap-3 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 font-mono text-xs text-zinc-400">
            <span className="flex items-center gap-1">
              <HardHat className="h-3 w-3 text-amber-400" /> {entry.manpower}
            </span>
            <span className="flex items-center gap-1">
              <CloudRain className="h-3 w-3 text-blue-400" /> {entry.weather}
            </span>
          </div>
          {canWrite && (
            <button
              onClick={() => setConfirmDel(true)}
              className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
              title="Delete entry"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {entry.work_done && (
        <div className="mb-3 whitespace-pre-wrap pl-3 text-sm leading-relaxed text-zinc-300">
          {entry.work_done}
        </div>
      )}
      {entry.issues && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border-t border-zinc-800 bg-red-500/5 p-3 text-sm text-red-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{entry.issues}</span>
        </div>
      )}

      {entry.photos.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 pl-3">
          {entry.photos.map((p) => (
            <a
              key={p.id}
              href={`${BACKEND_ORIGIN}${p.url}`}
              target="_blank"
              rel="noreferrer"
              className="block h-20 w-20 overflow-hidden rounded-lg border border-zinc-800 transition-transform hover:scale-105"
            >
              <img
                src={`${BACKEND_ORIGIN}${p.url}`}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </a>
          ))}
        </div>
      )}

      {/* Inline delete confirm */}
      <AnimatePresence>
        {confirmDel && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center rounded-2xl bg-zinc-950/95 backdrop-blur-sm"
          >
            <div className="flex flex-col items-center gap-3 p-4 text-center">
              <Trash2 className="h-6 w-6 text-red-400" />
              <p className="text-sm text-zinc-300">
                Delete this entry?
                {entry.photos.length > 0 && (
                  <span className="block text-xs text-zinc-500">
                    {entry.photos.length} photo(s) will also be removed.
                  </span>
                )}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmDel(false)}
                  disabled={deleting}
                  className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  onClick={remove}
                  disabled={deleting}
                  className="flex items-center gap-1.5 rounded-lg bg-red-500/20 px-3 py-1.5 text-xs font-bold text-red-300 hover:bg-red-500/30"
                >
                  {deleting && <Loader2 className="h-3 w-3 animate-spin" />} Delete
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

