"use client";

/**
 * DPR — Daily Progress Reports (t5 schema)
 *
 * Tab 1 "Activity DPR": Enter actual_qty per activity for a date.
 *        Writes to daily_actuals via POST /api/v1/dpr/actuals.
 * Tab 2 "Monthly Summary": Per-activity month plan vs actual progress table.
 * Tab 3 "Field Observations": GPS-tagged site notes / issues.
 */

import React, { useEffect, useRef, useState } from "react";
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

import ManpowerMatrix from "./ManpowerMatrix";
import DailyReportTab from "./DailyReportTab";
import SchemeSummaryTab from "./SchemeSummaryTab";
import ImportTab from "./ImportTab";

const API = "http://localhost:8000/api/v1";

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
  const [tab, setTab]                 = useState<"entry" | "report" | "summary" | "board" | "obs" | "import" | "qc">("entry");

  // load schemes
  useEffect(() => {
    fetch(`${API}/schemes/all`)
      .then(r => r.json())
      .then((d: any[]) => {
        const active = d.filter(s => s.current_status !== "closed");
        setSchemes(active);
        // COB-7 (scheme 74) carries the richest DPR/progress dataset —
        // default there so the page opens with real activities, not blanks.
        const preferred = active.find(s => s.id === 74) ?? active[0];
        if (preferred) setSelectedScheme(String(preferred.id));
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
          {(["entry", "report", "summary", "board", "obs", "qc", "import"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 font-medium transition-colors ${
                tab === t ? "bg-amber-500/20 text-amber-300" : "text-zinc-400 hover:text-white"
              }`}
            >
              {t === "entry"   && <><Activity   className="h-4 w-4" />Data Entry</>}
              {t === "report"  && <><CalendarIcon className="h-4 w-4" />Daily Report</>}
              {t === "summary" && <><BarChart2   className="h-4 w-4" />Monthly Summary</>}
              {t === "board"   && <><BarChart2   className="h-4 w-4" />Summary</>}
              {t === "obs"     && <><MapPin      className="h-4 w-4" />Observations</>}
              {t === "qc"      && <><AlertTriangle className="h-4 w-4" />QC / Productivity</>}
              {t === "import"  && <><PlusCircle  className="h-4 w-4" />Import File</>}
            </button>
          ))}
        </div>
      )}

      {!selectedPkg ? (
        <EmptyState message="Select a scheme and package to start." />
      ) : tab === "entry" ? (
        <div className="space-y-6">
          <ActivityEntryPane packageId={selectedPkg} />
          <ManpowerMatrix schemeId={parseInt(selectedScheme) || 0} />
        </div>
      ) : tab === "report" ? (
        <DailyReportTab schemeId={parseInt(selectedScheme) || 0} />
      ) : tab === "summary" ? (
        <MonthlySummaryPane packageId={selectedPkg} />
      ) : tab === "board" ? (
        <SchemeSummaryTab schemeId={parseInt(selectedScheme) || 0} />
      ) : tab === "import" ? (
        <ImportTab schemeId={parseInt(selectedScheme) || 0} />
      ) : tab === "qc" ? (
        <QcProductivityPane packageId={selectedPkg} />
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

// ─────────────────────── Observations pane ───────────────────────────────────

function ObservationsPane({ packageId }: { packageId: string }) {
  const [obs, setObs]           = useState<any[]>([]);
  const [loading, setLoading]   = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving]     = useState(false);

  const [form, setForm] = useState({
    observation_type: "note",
    title: "",
    description: "",
    severity: "",
    weather: "Clear",
    location_lat: "",
    location_lng: "",
    location_label: "",
  });
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
      const r = await fetch(`${API}/dpr/observations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          package_id:       parseInt(packageId),
          observation_type: form.observation_type,
          title:            form.title || null,
          description:      form.description,
          severity:         form.severity || null,
          weather:          form.weather || null,
          location_lat:     form.location_lat ? parseFloat(form.location_lat) : null,
          location_lng:     form.location_lng ? parseFloat(form.location_lng) : null,
          location_label:   form.location_label || null,
          observed_by:      1,
        }),
      });
      if (r.ok) {
        setShowForm(false);
        setForm({ observation_type: "note", title: "", description: "", severity: "", weather: "Clear", location_lat: "", location_lng: "", location_label: "" });
        loadObs();
      } else {
        alert("Save failed.");
      }
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

      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden rounded-2xl border border-cyan-500/20 bg-zinc-900 p-6"
          >
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs text-zinc-400">Type</label>
                <select
                  value={form.observation_type}
                  onChange={e => setForm(f => ({ ...f, observation_type: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-cyan-400"
                >
                  {["note","issue","safety_incident","quality_issue","photo"].map(t => (
                    <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-400">Severity</label>
                <select
                  value={form.severity}
                  onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-cyan-400"
                >
                  <option value="">—</option>
                  <option value="green">Green (Minor)</option>
                  <option value="amber">Amber (Moderate)</option>
                  <option value="red">Red (Critical)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-zinc-400">Weather</label>
                <select
                  value={form.weather}
                  onChange={e => setForm(f => ({ ...f, weather: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-cyan-400"
                >
                  {["Clear","Cloudy","Rain","Heavy Rain","Extreme"].map(w => <option key={w}>{w}</option>)}
                </select>
              </div>
              <div className="col-span-2 md:col-span-3">
                <label className="mb-1 block text-xs text-zinc-400">Title (optional)</label>
                <input
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="Brief summary…"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-cyan-400"
                />
              </div>
              <div className="col-span-2 md:col-span-3">
                <label className="mb-1 block text-xs text-zinc-400">Description *</label>
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-cyan-400"
                />
              </div>
              {/* GPS */}
              <div className="col-span-2 md:col-span-3 flex items-end gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-zinc-400">Location label</label>
                  <input
                    value={form.location_label}
                    onChange={e => setForm(f => ({ ...f, location_label: e.target.value }))}
                    placeholder="e.g. Gate 3 / Bay-A"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-cyan-400"
                  />
                </div>
                <button
                  onClick={captureGps}
                  disabled={gpsLoading}
                  className="flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"
                >
                  {gpsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MapPin className="h-3.5 w-3.5" />}
                  {form.location_lat ? `${parseFloat(form.location_lat).toFixed(4)}, ${parseFloat(form.location_lng).toFixed(4)}` : "Capture GPS"}
                </button>
              </div>
            </div>
            {gpsError && <p className="mt-2 text-xs text-red-400">{gpsError}</p>}
            <div className="mt-4 flex justify-end">
              <button
                onClick={submit}
                disabled={saving}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-500 px-6 py-2.5 font-bold text-white disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
                Save Observation
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-amber-400">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading observations…
        </div>
      ) : obs.length === 0 ? (
        <EmptyState message="No observations yet. Use the form above to log a site note, issue, or safety incident." />
      ) : (
        <div className="space-y-3">
          {obs.map(o => (
            <div key={o.observation_id} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-xs font-bold uppercase ${typeColor(o.observation_type)}`}>
                    {o.observation_type.replace(/_/g, " ")}
                  </span>
                  {o.severity && (
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${severityColor(o.severity)}`}>
                      {o.severity}
                    </span>
                  )}
                  {o.activity_name && (
                    <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">{o.activity_name}</span>
                  )}
                </div>
                <span className="shrink-0 text-xs text-zinc-500">
                  {new Date(o.observed_at).toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" })}
                </span>
              </div>
              {o.title && <p className="mb-1 font-semibold text-white">{o.title}</p>}
              <p className="text-sm text-zinc-300">{o.description}</p>
              {(o.location_lat || o.location_label) && (
                <div className="mt-2 flex items-center gap-1 text-xs text-cyan-400">
                  <MapPin className="h-3 w-3" />
                  {o.location_label || `${o.location_lat}, ${o.location_lng}`}
                </div>
              )}
            </div>
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

// ─────────────────── Progress Summary board (physical + financial) ──────────

type PhysRow = {
  activity_id: number; activity_name: string; category: string | null;
  uom: string; scope: number; last_fy_actual: number;
  ftm_plan: number; ftm_actual: number; fy_plan: number; fy_actual: number;
  cum_plan: number; cum_actual: number;
  last_fy_pct: number; ftm_plan_pct: number; ftm_actual_pct: number;
  fy_plan_pct: number; fy_actual_pct: number; cum_plan_pct: number; cum_actual_pct: number;
};
type FinRow = {
  row_name: string; budget: number; fy_plan: number; fy_actual: number;
  cum_plan: number; cum_actual: number;
  fy_plan_pct: number; fy_actual_pct: number; cum_plan_pct: number; cum_actual_pct: number;
};
type BoardData = {
  month: string; fy_label: string; physical: PhysRow[];
  overall: Record<string, number>; financial: FinRow[];
};

function ProgressBoardPane({ packageId }: { packageId: string }) {
  const thisMonth = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [data, setData] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!packageId || !month) return;
    setLoading(true);
    fetch(`${API}/dpr/progress-summary/${packageId}?month=${month}`)
      .then(r => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [packageId, month]);

  const n = (v: number) => Number(v ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 1 });
  const p = (v: number) => `${Number(v ?? 0).toFixed(1)}%`;
  const monthLabel = data
    ? new Date(`${data.month}-01`).toLocaleDateString("en-IN", { month: "short", year: "numeric" })
    : "";

  const th = "border border-[var(--line)] px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-3)] bg-[var(--panel-3)]";
  const td = "border border-[var(--line)] px-2 py-1 text-xs text-[var(--ink-2)] text-right whitespace-nowrap";
  const tdL = "border border-[var(--line)] px-2 py-1 text-xs text-[var(--ink)] text-left";

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <label className="text-xs uppercase tracking-wider text-zinc-500">Report month</label>
        <input
          type="month" value={month} onChange={e => setMonth(e.target.value)}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm outline-none focus:border-amber-400"
        />
      </div>

      {loading ? (
        <EmptyState message="Computing progress summary…" />
      ) : !data || !data.physical.length ? (
        <EmptyState message="No locked plan / progress data for this package." />
      ) : (
        <>
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5 overflow-x-auto">
            <h3 className="mb-3 text-sm font-bold text-[var(--ink)]">
              Project Progress Summary — Quantity &amp; % <span className="ml-2 font-normal text-[var(--ink-3)]">({monthLabel})</span>
            </h3>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th rowSpan={2} className={th} style={{ textAlign: "left" }}>Activity / Work Package</th>
                  <th rowSpan={2} className={th}>Scope</th>
                  <th rowSpan={2} className={th}>UOM</th>
                  <th rowSpan={2} className={th}>Actual Till Last FY</th>
                  <th colSpan={2} className={th}>For the Month — {monthLabel}</th>
                  <th colSpan={2} className={th}>FY {data.fy_label}</th>
                  <th colSpan={2} className={th}>Cumulative Till Date</th>
                </tr>
                <tr>
                  <th className={th}>Plan</th><th className={th}>Actual</th>
                  <th className={th}>Plan</th><th className={th}>Actual</th>
                  <th className={th}>Plan</th><th className={th}>Actual</th>
                </tr>
              </thead>
              <tbody>
                {data.physical.map(r => (
                  <React.Fragment key={r.activity_id}>
                    <tr>
                      <td rowSpan={2} className={tdL}>
                        {r.category && r.category !== r.activity_name ? `${r.category} — ` : ""}{r.activity_name}
                      </td>
                      <td rowSpan={2} className={td}>{n(r.scope)}</td>
                      <td className={td}>{r.uom || "—"}</td>
                      <td className={td}>{n(r.last_fy_actual)}</td>
                      <td className={td}>{n(r.ftm_plan)}</td>
                      <td className={td}>{n(r.ftm_actual)}</td>
                      <td className={td}>{n(r.fy_plan)}</td>
                      <td className={td}>{n(r.fy_actual)}</td>
                      <td className={td}>{n(r.cum_plan)}</td>
                      <td className={td}>{n(r.cum_actual)}</td>
                    </tr>
                    <tr className="opacity-80">
                      <td className={td}>%</td>
                      <td className={td}>{p(r.last_fy_pct)}</td>
                      <td className={td}>{p(r.ftm_plan_pct)}</td>
                      <td className={td}>{p(r.ftm_actual_pct)}</td>
                      <td className={td}>{p(r.fy_plan_pct)}</td>
                      <td className={td}>{p(r.fy_actual_pct)}</td>
                      <td className={td}>{p(r.cum_plan_pct)}</td>
                      <td className={td}>{p(r.cum_actual_pct)}</td>
                    </tr>
                  </React.Fragment>
                ))}
                <tr className="font-bold">
                  <td className={tdL}>Overall Progress (weighted)</td>
                  <td className={td}>100%</td>
                  <td className={td}>%</td>
                  <td className={td}>{p(data.overall.last_fy)}</td>
                  <td className={td}>{p(data.overall.ftm_plan)}</td>
                  <td className={td}>{p(data.overall.ftm_actual)}</td>
                  <td className={td}>{p(data.overall.fy_plan)}</td>
                  <td className={td}>{p(data.overall.fy_actual)}</td>
                  <td className={td}>{p(data.overall.cum_plan)}</td>
                  <td className={td}>{p(data.overall.cum_actual)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {data.financial.length > 0 && (
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5 overflow-x-auto">
              <h3 className="mb-3 text-sm font-bold text-[var(--ink)]">
                CAPEX Summary — ₹ Cr &amp; % <span className="ml-2 font-normal text-[var(--ink-3)]">(FY {data.fy_label} till {monthLabel})</span>
              </h3>
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th rowSpan={2} className={th} style={{ textAlign: "left" }}>Package / Work</th>
                    <th rowSpan={2} className={th}>Budget (Cr)</th>
                    <th colSpan={2} className={th}>FY Till Date (Cr)</th>
                    <th colSpan={2} className={th}>Cumulative (Cr)</th>
                    <th colSpan={2} className={th}>Cumulative %</th>
                  </tr>
                  <tr>
                    <th className={th}>Plan</th><th className={th}>Actual</th>
                    <th className={th}>Plan</th><th className={th}>Actual</th>
                    <th className={th}>Plan</th><th className={th}>Actual</th>
                  </tr>
                </thead>
                <tbody>
                  {data.financial.map(f => (
                    <tr key={f.row_name}>
                      <td className={tdL}>{f.row_name}</td>
                      <td className={td}>{n(f.budget)}</td>
                      <td className={td}>{n(f.fy_plan)}</td>
                      <td className={td}>{n(f.fy_actual)}</td>
                      <td className={td}>{n(f.cum_plan)}</td>
                      <td className={td}>{n(f.cum_actual)}</td>
                      <td className={td}>{p(f.cum_plan_pct)}</td>
                      <td className={td}>{p(f.cum_actual_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// -- Sprint 7 · productivity + anomaly QC -------------------------------------

function QcProductivityPane({ packageId }: { packageId: string }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!packageId) return;
    setLoading(true);
    setErr("");
    fetch(`${API}/dpr/qc/${packageId}?days=${days}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      })
      .then(setData)
      .catch((e) => setErr(e?.message || "QC load failed"))
      .finally(() => setLoading(false));
  }, [packageId, days]);

  const s = data?.summary;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold text-amber-300 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" /> Productivity &amp; Anomaly QC
        </h2>
        <label className="ml-auto flex items-center gap-2 text-xs text-zinc-400">
          Window
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-white">
            {[14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} days</option>)}
          </select>
        </label>
      </div>

      {loading && <p className="text-sm text-zinc-400">Scanning DPR entries…</p>}
      {err && <p className="text-sm text-red-400">{err}</p>}

      {s && (
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            ["Entries", s.entries ?? data.entries],
            ["Total qty", s.total_qty],
            ["Man-days", s.total_man_days],
            ["Qty / man-day", s.overall_qty_per_man_day ?? "—"],
          ].map(([label, val]) => (
            <div key={String(label)} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
              <p className="text-xl font-bold text-white">{val}</p>
            </div>
          ))}
        </div>
      )}

      {data?.anomalies?.length > 0 && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
          <p className="mb-3 text-sm font-bold text-red-300">
            Anomalies ({data.anomalies.length})
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-zinc-500">
                  <th className="p-2">Date</th>
                  <th className="p-2">Activity</th>
                  <th className="p-2">Qty</th>
                  <th className="p-2">Manpower</th>
                  <th className="p-2">Flags</th>
                </tr>
              </thead>
              <tbody>
                {data.anomalies.map((a: any) => (
                  <tr key={a.daily_actual_id} className="border-t border-zinc-800">
                    <td className="p-2 text-zinc-300">{a.date}</td>
                    <td className="p-2 text-zinc-200">{a.activity_name}</td>
                    <td className="p-2 text-right">{a.qty}</td>
                    <td className="p-2 text-right">{a.manpower}</td>
                    <td className="p-2">
                      {(a.flags || []).map((f: string) => (
                        <span key={f} className="mr-1 inline-block rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] text-red-300">{f}</span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data && !data.anomalies?.length && !loading && (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          No anomalies in the last {days} days.
        </p>
      )}

      {data?.productivity?.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <p className="mb-3 text-sm font-bold text-zinc-300">Recent productivity (qty / man-day)</p>
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-zinc-900">
                <tr className="text-left text-zinc-500">
                  <th className="p-2">Date</th>
                  <th className="p-2">Activity</th>
                  <th className="p-2">Qty</th>
                  <th className="p-2">Man</th>
                  <th className="p-2">Qty/man-day</th>
                  <th className="p-2">Equipment</th>
                </tr>
              </thead>
              <tbody>
                {data.productivity.slice(0, 80).map((p: any) => (
                  <tr key={p.daily_actual_id} className="border-t border-zinc-800/80">
                    <td className="p-2 text-zinc-400">{p.date}</td>
                    <td className="p-2 text-zinc-200">{p.activity_name}</td>
                    <td className="p-2 text-right">{p.qty}</td>
                    <td className="p-2 text-right">{p.manpower}</td>
                    <td className="p-2 text-right font-mono text-amber-300">{p.qty_per_man_day ?? "—"}</td>
                    <td className="p-2 text-zinc-500">{p.equipment || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
