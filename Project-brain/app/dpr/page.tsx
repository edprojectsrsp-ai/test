"use client";

/**
 * DPR — Daily Progress Reports (t5 schema)
 *
 * Tab 1 "Activity DPR": Enter actual_qty per activity for a date.
 *        Writes to daily_actuals via POST /api/v1/dpr/actuals.
 * Tab 2 "Monthly Summary": Per-activity month plan vs actual progress table.
 * Tab 3 "Field Observations": GPS-tagged site notes / issues.
 */

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  Activity,
  BarChart2,
  CalendarIcon,
  Camera,
  ChevronDown,
  CloudRain,
  HardHat,
  Image as ImageIcon,
  Loader2,
  MapPin,
  PlusCircle,
  Save,
  X,
} from "lucide-react";

const API = "http://localhost:8002/api/v1";

// ─────────────────────── types ────────────────────────────────────────────────

type Scheme   = { id: number; scheme_name: string; current_status: string };
type Package  = { package_id: number; package_name: string; has_active_plan: boolean };
type Activity = {
  activity_id: number;
  activity_name: string;
  uom: string;
  scope_qty: number;
  sort_order: number;
  actual_qty: number;
  manpower_count: number;
  weather_conditions: string;
  area_of_work: string;
  remarks: string;
  cumulative_before: number;
  month_plan_qty: number;
};
type SummaryRow = {
  activity_id: number;
  activity_name: string;
  uom: string;
  scope_qty: number;
  month_plan: number;
  month_actual: number;
  cum_actual: number;
  progress_pct: number;
};

// ─────────────────────── page shell ──────────────────────────────────────────

export default function DPRPage() {
  const [schemes, setSchemes]         = useState<Scheme[]>([]);
  const [selectedScheme, setSelectedScheme] = useState("");
  const [packages, setPackages]       = useState<Package[]>([]);
  const [selectedPkg, setSelectedPkg] = useState("");
  const [tab, setTab]                 = useState<"entry" | "summary" | "obs">("entry");

  // load schemes
  useEffect(() => {
    fetch(`${API}/schemes/all`)
      .then(r => r.json())
      .then((d: any[]) => {
        const active = d.filter(s => s.current_status !== "closed");
        setSchemes(active);
        if (active.length) setSelectedScheme(String(active[0].id));
      })
      .catch(() => {});
  }, []);

  // load packages when scheme changes
  useEffect(() => {
    if (!selectedScheme) return;
    setPackages([]);
    setSelectedPkg("");
    fetch(`${API}/dpr/scheme/${selectedScheme}/packages`)
      .then(r => r.json())
      .then((d: Package[]) => {
        setPackages(d);
        if (d.length) setSelectedPkg(String(d[0].package_id));
      })
      .catch(() => {});
  }, [selectedScheme]);

  const currentPkg = packages.find(p => String(p.package_id) === selectedPkg);

  return (
    <div className="relative min-h-screen bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.05)_0%,transparent_60%)] p-10 pt-20 text-white">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-zinc-800 pb-6">
        <div>
          <h1 className="mb-1 flex items-center gap-3 text-4xl font-bold">
            <CalendarIcon className="h-8 w-8 text-amber-400" />
            Daily Progress Reports
          </h1>
          <p className="text-zinc-400">Activity-wise execution logging · field observations</p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <select
            value={selectedScheme}
            onChange={e => setSelectedScheme(e.target.value)}
            className="min-w-[260px] rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-bold outline-none focus:border-amber-400"
          >
            {schemes.map(s => (
              <option key={s.id} value={s.id}>[{s.id}] {s.scheme_name}</option>
            ))}
          </select>
          {packages.length > 0 && (
            <select
              value={selectedPkg}
              onChange={e => setSelectedPkg(e.target.value)}
              className="min-w-[180px] rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-bold outline-none focus:border-amber-400"
            >
              {packages.map(p => (
                <option key={p.package_id} value={p.package_id}>{p.package_name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* No-plan banner */}
      {currentPkg && !currentPkg.has_active_plan && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-sm text-amber-300">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <span className="font-bold">No locked baseline plan for {currentPkg.package_name}.</span>
            {" "}DPR entries need a locked plan to link progress.{" "}
            <a href="/progress/plan-engine" className="font-bold underline hover:text-amber-200">
              Go to Plan Engine →
            </a>
          </div>
        </div>
      )}

      {/* Tab bar */}
      {selectedPkg && (
        <div className="mb-6 inline-flex rounded-xl border border-zinc-800 bg-zinc-900 p-1 text-sm">
          {(["entry", "summary", "obs"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 font-medium transition-colors ${
                tab === t ? "bg-amber-500/20 text-amber-300" : "text-zinc-400 hover:text-white"
              }`}
            >
              {t === "entry"   && <><Activity   className="h-4 w-4" />Entry</>}
              {t === "summary" && <><BarChart2   className="h-4 w-4" />Monthly Summary</>}
              {t === "obs"     && <><MapPin      className="h-4 w-4" />Observations</>}
            </button>
          ))}
        </div>
      )}

      {!selectedPkg ? (
        <EmptyState message="Select a scheme and package to start." />
      ) : tab === "entry" ? (
        <ActivityEntryPane packageId={selectedPkg} />
      ) : tab === "summary" ? (
        <MonthlySummaryPane packageId={selectedPkg} />
      ) : (
        <ObservationsPane packageId={selectedPkg} />
      )}
    </div>
  );
}

// ─────────────────────── Activity Entry pane ─────────────────────────────────

function ActivityEntryPane({ packageId }: { packageId: string }) {
  const today = new Date().toISOString().split("T")[0];
  const [date, setDate]           = useState(today);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);

  // shared header fields (broadcast to all entries on save)
  const [weather, setWeather]     = useState("Clear");
  const [manpower, setManpower]   = useState("");
  const [area, setArea]           = useState("");

  // per-activity qty + remarks
  const [qtys, setQtys]     = useState<Record<number, string>>({});
  const [remarks, setRemarks] = useState<Record<number, string>>({});

  const loadActivities = async () => {
    setLoading(true);
    setSaved(false);
    try {
      const r = await fetch(`${API}/dpr/actuals/${packageId}/date/${date}`);
      if (!r.ok) { setActivities([]); return; }
      const data: Activity[] = await r.json();
      setActivities(data);
      // pre-fill from existing actuals
      const q: Record<number, string> = {};
      const rm: Record<number, string> = {};
      for (const a of data) {
        if (a.actual_qty > 0) q[a.activity_id]  = String(a.actual_qty);
        if (a.remarks)        rm[a.activity_id] = a.remarks;
      }
      setQtys(q);
      setRemarks(rm);
      if (data[0]?.weather_conditions) setWeather(data[0].weather_conditions);
      if (data[0]?.manpower_count)     setManpower(String(data[0].manpower_count));
      if (data[0]?.area_of_work)       setArea(data[0].area_of_work);
    } catch {
      setActivities([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadActivities(); }, [packageId, date]);

  const handleSave = async () => {
    const entries = activities
      .filter(a => qtys[a.activity_id] !== undefined && qtys[a.activity_id] !== "")
      .map(a => ({
        activity_id:        a.activity_id,
        actual_date:        date,
        actual_qty:         parseFloat(qtys[a.activity_id] || "0"),
        area_of_work:       area || null,
        manpower_count:     parseInt(manpower || "0", 10) || null,
        weather_conditions: weather || null,
        remarks:            remarks[a.activity_id] || null,
        entered_via:        "web",
      }));

    if (!entries.length) { alert("Enter at least one activity quantity."); return; }
    setSaving(true);
    try {
      const r = await fetch(`${API}/dpr/actuals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package_id: parseInt(packageId), entries }),
      });
      if (r.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
        loadActivities();
      } else {
        alert("Save failed: " + (await r.text()));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Date + header controls */}
      <div className="flex flex-wrap items-end gap-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <div>
          <label className="mb-2 block text-xs text-zinc-400">Date</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2.5 text-sm outline-none focus:border-amber-400"
          />
        </div>
        <div>
          <label className="mb-2 flex items-center gap-1 text-xs text-zinc-400"><CloudRain className="h-3.5 w-3.5" />Weather</label>
          <select
            value={weather}
            onChange={e => setWeather(e.target.value)}
            className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2.5 text-sm outline-none focus:border-amber-400"
          >
            {["Clear","Partly Cloudy","Cloudy","Rain","Heavy Rain","Extreme"].map(w => (
              <option key={w}>{w}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-2 flex items-center gap-1 text-xs text-zinc-400"><HardHat className="h-3.5 w-3.5" />Manpower</label>
          <input
            type="number"
            placeholder="0"
            value={manpower}
            onChange={e => setManpower(e.target.value)}
            className="w-24 rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2.5 text-sm outline-none focus:border-amber-400"
          />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="mb-2 block text-xs text-zinc-400">Area of Work</label>
          <input
            type="text"
            placeholder="e.g. Foundation Bay A, Switchgear room…"
            value={area}
            onChange={e => setArea(e.target.value)}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2.5 text-sm outline-none focus:border-amber-400"
          />
        </div>
      </div>

      {/* Activities table */}
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden">
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <h3 className="flex items-center gap-2 font-semibold">
            <Activity className="h-5 w-5 text-cyan-400" />
            Activity-wise Quantities
            {activities.length > 0 && (
              <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-400">
                {activities.length} activities
              </span>
            )}
          </h3>
          <AnimatePresence>
            {saved && (
              <motion.span
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className="text-sm font-medium text-green-400"
              >
                ✓ Saved
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-amber-400">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading activities…
          </div>
        ) : activities.length === 0 ? (
          <EmptyState message="No activities found. Set up a locked plan in Plan Engine first." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-xs text-zinc-500">
                  <th className="px-4 py-3 text-left">Activity</th>
                  <th className="px-4 py-3 text-center">UoM</th>
                  <th className="px-4 py-3 text-center">Scope</th>
                  <th className="px-4 py-3 text-center text-blue-400">Month Plan</th>
                  <th className="px-4 py-3 text-center text-green-400">Cum.Before</th>
                  <th className="px-3 py-3 text-center font-bold text-amber-300">Today's Qty</th>
                  <th className="px-4 py-3 text-center">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {activities.map(a => {
                  const qty = parseFloat(qtys[a.activity_id] || "0");
                  const cum = a.cumulative_before + qty;
                  const pct = a.scope_qty > 0 ? Math.min((cum / a.scope_qty) * 100, 100) : 0;
                  return (
                    <tr key={a.activity_id} className="border-b border-zinc-800/50 hover:bg-zinc-800/20">
                      <td className="px-4 py-3 font-medium text-white">{a.activity_name}</td>
                      <td className="px-4 py-3 text-center text-zinc-400">{a.uom || "—"}</td>
                      <td className="px-4 py-3 text-center text-zinc-300">{Number(a.scope_qty).toFixed(1)}</td>
                      <td className="px-4 py-3 text-center text-blue-300">{Number(a.month_plan_qty).toFixed(1)}</td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-green-300">{Number(a.cumulative_before).toFixed(1)}</span>
                          <div className="h-1 w-16 overflow-hidden rounded-full bg-zinc-800">
                            <div className="h-full rounded-full bg-green-500/60" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0"
                          value={qtys[a.activity_id] ?? ""}
                          onChange={e => setQtys(q => ({ ...q, [a.activity_id]: e.target.value }))}
                          className="w-28 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-center text-sm font-bold text-amber-300 outline-none focus:border-amber-400"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          placeholder="Optional"
                          value={remarks[a.activity_id] ?? ""}
                          onChange={e => setRemarks(r => ({ ...r, [a.activity_id]: e.target.value }))}
                          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs outline-none focus:border-zinc-500"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {activities.length > 0 && (
          <div className="flex justify-end gap-3 border-t border-zinc-800 px-6 py-4">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-3 font-bold text-white transition-transform hover:scale-[1.02] disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "Saving…" : "Save Actuals"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────── Monthly Summary pane ────────────────────────────────

function MonthlySummaryPane({ packageId }: { packageId: string }) {
  const now   = new Date();
  const curM  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [month, setMonth]     = useState(curM);
  const [rows, setRows]       = useState<SummaryRow[]>([]);
  const [loading, setLoading] = useState(false);

  const monthOptions = Array.from({ length: 24 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  useEffect(() => {
    setLoading(true);
    fetch(`${API}/dpr/summary/${packageId}?month=${month}`)
      .then(r => r.json())
      .then(d => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [packageId, month]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select
          value={month}
          onChange={e => setMonth(e.target.value)}
          className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm outline-none focus:border-amber-400"
        >
          {monthOptions.map(m => (
            <option key={m} value={m}>
              {new Date(m + "-01").toLocaleDateString("en-IN", { month: "short", year: "numeric" })}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-900">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-amber-400">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <EmptyState message="No data for this month. Lock a plan and enter actuals first." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-xs text-zinc-500">
                <th className="px-4 py-3 text-left">Activity</th>
                <th className="px-4 py-3 text-center">UoM</th>
                <th className="px-4 py-3 text-center">Scope</th>
                <th className="px-4 py-3 text-center text-blue-400">Month Plan</th>
                <th className="px-4 py-3 text-center text-amber-400">Month Actual</th>
                <th className="px-4 py-3 text-center text-green-400">Cumulative</th>
                <th className="px-4 py-3 text-center">Progress</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const dev = r.month_plan > 0 ? ((r.month_actual - r.month_plan) / r.month_plan) * 100 : null;
                const devColor = dev === null ? "" : dev >= 0 ? "text-green-400" : dev >= -15 ? "text-amber-400" : "text-red-400";
                return (
                  <tr key={r.activity_id} className="border-b border-zinc-800/50">
                    <td className="px-4 py-3 font-medium text-white">{r.activity_name}</td>
                    <td className="px-4 py-3 text-center text-zinc-400">{r.uom || "—"}</td>
                    <td className="px-4 py-3 text-center text-zinc-300">{Number(r.scope_qty).toFixed(1)}</td>
                    <td className="px-4 py-3 text-center text-blue-300">{Number(r.month_plan).toFixed(1)}</td>
                    <td className={`px-4 py-3 text-center font-bold ${devColor || "text-amber-300"}`}>
                      {Number(r.month_actual).toFixed(1)}
                      {dev !== null && (
                        <span className={`ml-1 text-xs ${devColor}`}>
                          ({dev >= 0 ? "+" : ""}{dev.toFixed(0)}%)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-green-300">{Number(r.cum_actual).toFixed(1)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500"
                            style={{ width: `${Math.min(r.progress_pct, 100)}%` }}
                          />
                        </div>
                        <span className="w-10 text-right text-xs text-zinc-300">{r.progress_pct.toFixed(1)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
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
  const [gpsError, setGpsError]     = useState("");

  const loadObs = () => {
    setLoading(true);
    fetch(`${API}/dpr/observations/${packageId}`)
      .then(r => r.json())
      .then(d => setObs(Array.isArray(d) ? d : []))
      .catch(() => setObs([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadObs(); }, [packageId]);

  const captureGps = () => {
    if (!("geolocation" in navigator)) { setGpsError("Geolocation not supported."); return; }
    setGpsLoading(true);
    setGpsError("");
    navigator.geolocation.getCurrentPosition(
      pos => {
        setForm(f => ({
          ...f,
          location_lat: pos.coords.latitude.toFixed(6),
          location_lng: pos.coords.longitude.toFixed(6),
        }));
        setGpsLoading(false);
      },
      err => { setGpsError(err.message); setGpsLoading(false); },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const submit = async () => {
    if (!form.description.trim()) { alert("Description is required."); return; }
    setSaving(true);
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
      setSaving(false);
    }
  };

  const severityColor = (s: string) =>
    s === "red" ? "bg-red-500/20 text-red-400 border-red-500/30" :
    s === "amber" ? "bg-amber-500/20 text-amber-400 border-amber-500/30" :
    "bg-green-500/20 text-green-400 border-green-500/30";

  const typeColor = (t: string) =>
    t === "safety_incident" ? "text-red-400" :
    t === "quality_issue" ? "text-orange-400" :
    t === "issue" ? "text-amber-400" : "text-cyan-400";

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2.5 text-sm font-bold text-cyan-300 hover:bg-cyan-500/20"
        >
          <PlusCircle className="h-4 w-4" />
          {showForm ? "Cancel" : "New Observation"}
        </button>
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
    </div>
  );
}

// ─────────────────────── helpers ─────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/40 py-16 text-center text-zinc-500">
      {message}
    </div>
  );
}
