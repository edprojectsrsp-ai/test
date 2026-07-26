"use client";
/**
 * DelayCausesTab — what the recorded causes add up to.
 *
 * This is the reason the root-cause field is a closed list rather than free
 * text: one tap per shortfall becomes "47 days lost to design holds this
 * quarter, of which 41 are owner-attributable". That sentence is what a review
 * actually asks for, and it cannot be reconstructed from remarks.
 *
 * Two things it refuses to do:
 *
 *   It never presents responsibility as settled. The taxonomy carries a
 *   default per cause to speed up analysis, and the payload carries a
 *   disclaimer saying so — shown here rather than dropped, because a figure
 *   quoted without it becomes a contractual claim nobody intended to make.
 *
 *   It never hides unclassified entries. Rows recorded before the field
 *   existed have no cause, and folding them away would make the total look
 *   complete when it is not.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Download, RefreshCw } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

const RESP_STYLE = {
  owner: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  contractor: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  external: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  shared: "bg-violet-500/15 text-violet-300 border-violet-500/30",
};

const GROUP_BAR = {
  Design: "bg-sky-500", Supply: "bg-amber-500", Resources: "bg-orange-500",
  Access: "bg-violet-500", External: "bg-zinc-500", Quality: "bg-rose-500",
  Commercial: "bg-emerald-500", Other: "bg-zinc-600",
};

function Card({ label, value, sub, tone = "text-white" }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${tone}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-zinc-500">{sub}</div>}
    </div>
  );
}

export default function DelayCausesTab({ schemeId }) {
  const today = new Date().toISOString().slice(0, 10);
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);

  const [from, setFrom] = useState(ninetyDaysAgo);
  const [to, setTo] = useState(today);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!schemeId) return;
    setLoading(true); setError(null);
    try {
      const qs = new URLSearchParams({ date_from: from, date_to: to });
      const r = await fetch(`${API}/dpr/root-causes/summary/${schemeId}?${qs}`,
        { cache: "no-store" });
      if (!r.ok) throw new Error((await r.text()).slice(0, 180) || `HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [schemeId, from, to]);

  useEffect(() => { load(); }, [load]);

  const maxDays = useMemo(
    () => Math.max(1, ...(data?.causes || []).map((c) => c.days_lost)),
    [data]);

  const exportCsv = () => {
    if (!data) return;
    const rows = [
      ["Cause", "Group", "Responsibility", "Excusable", "Occurrences", "Days lost"],
      ...data.causes.map((c) => [c.label, c.group, c.responsibility,
        c.excusable ? "Yes" : "No", c.occurrences, c.days_lost]),
      [], ["Total days lost", data.total_days_lost],
      ["Excusable", data.excusable_days], ["Non-excusable", data.non_excusable_days],
      ["Unclassified entries", data.unclassified_count],
      ["Unclassified days", data.unclassified_days],
      [], ["Note", data.disclaimer],
    ];
    const csv = rows.map((r) => r.map((v) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `delay-causes-${schemeId}-${from}-to-${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (!schemeId) {
    return <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-8 text-center text-zinc-500">
      Select a scheme to see what has been holding it up.
    </div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
        <div>
          <label className="mb-2 block text-xs text-zinc-400">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2.5 text-sm outline-none focus:border-amber-400" />
        </div>
        <div>
          <label className="mb-2 block text-xs text-zinc-400">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2.5 text-sm outline-none focus:border-amber-400" />
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 rounded-xl border border-zinc-700 px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-60">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Loading…" : "Refresh"}
        </button>
        <div className="flex-1" />
        <button onClick={exportCsv} disabled={!data}
          className="flex items-center gap-2 rounded-xl border border-zinc-700 px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-40">
          <Download className="h-4 w-4" />Export
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-300">
          {error}
        </div>
      )}

      {data && data.total_days_lost === 0 && data.unclassified_count === 0 && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-8 text-center text-zinc-500">
          No delay causes recorded in this period. Causes are captured on the
          Data Entry tab whenever a day falls short of plan.
        </div>
      )}

      {data && (data.total_days_lost > 0 || data.unclassified_count > 0) && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card label="Days lost" value={data.total_days_lost}
              sub={`across ${data.entries_examined} entries`} />
            <Card label="Excusable" value={data.excusable_days} tone="text-emerald-300"
              sub="typically supports an EOT claim" />
            <Card label="Not excusable" value={data.non_excusable_days} tone="text-amber-300"
              sub="contractor-side by default" />
            <Card label="Unclassified" value={data.unclassified_count}
              tone={data.unclassified_count ? "text-rose-300" : "text-zinc-500"}
              sub={data.unclassified_days ? `${data.unclassified_days} days with no cause` : "every entry classified"} />
          </div>

          {data.unclassified_count > 0 && (
            <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <strong>{data.unclassified_count} entries carry no cause</strong>, covering{" "}
                {data.unclassified_days} days. These are shown separately rather than
                folded into the total, because the figures above would otherwise look
                more complete than they are. Entries recorded before the cause field
                existed will never have one.
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900">
            <div className="border-b border-zinc-800 px-6 py-4 text-sm font-semibold text-white">
              Where the time went
            </div>
            <div className="divide-y divide-zinc-800/60">
              {data.causes.map((c) => (
                <div key={c.code} className="flex flex-wrap items-center gap-3 px-6 py-3">
                  <div className="min-w-[180px] flex-1">
                    <div className="text-sm text-zinc-100">{c.label}</div>
                    <div className="text-[11px] text-zinc-500">
                      {c.group} · {c.occurrences} occurrence{c.occurrences === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div className="h-2 min-w-[120px] flex-[2] overflow-hidden rounded-full bg-zinc-800">
                    <div className={`h-full rounded-full ${GROUP_BAR[c.group] || "bg-zinc-600"}`}
                      style={{ width: `${(c.days_lost / maxDays) * 100}%` }} />
                  </div>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${RESP_STYLE[c.responsibility]}`}>
                    {c.responsibility}
                  </span>
                  <span className="w-16 shrink-0 text-right text-sm font-bold tabular-nums text-white">
                    {c.days_lost}d
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {[["By category", data.by_group], ["By responsibility", data.by_responsibility]]
              .map(([title, obj]) => (
                <div key={title} className="rounded-2xl border border-zinc-800 bg-zinc-900">
                  <div className="border-b border-zinc-800 px-6 py-3 text-sm font-semibold text-white">
                    {title}
                  </div>
                  <div className="space-y-2 p-5">
                    {Object.entries(obj || {}).map(([k, v]) => (
                      <div key={k} className="flex items-center gap-3">
                        <span className="w-28 shrink-0 text-xs capitalize text-zinc-400">{k}</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
                          <div className={`h-full rounded-full ${GROUP_BAR[k] || "bg-sky-500"}`}
                            style={{ width: `${(v / (data.total_days_lost || 1)) * 100}%` }} />
                        </div>
                        <span className="w-14 shrink-0 text-right text-xs tabular-nums text-zinc-300">
                          {v}d
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>

          {data.disclaimer && (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 text-xs leading-relaxed text-zinc-500">
              {data.disclaimer}
            </div>
          )}
        </>
      )}
    </div>
  );
}
