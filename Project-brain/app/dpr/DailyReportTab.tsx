"use client";

/**
 * DPR "Daily Report" tab (friend-parity): every historical entry date as a row,
 * one column per activity, plus the manpower log per date.
 */

import { useEffect, useState } from "react";
import { FileText, Users } from "lucide-react";

const API = "http://localhost:8000/api/v1";

type Column = { id: number; label: string; category: string; uom: string; scope: number; package?: string };
type MatrixRow = { date: string; values: Record<string, number> };
type ManpowerRecord = {
  report_date: string;
  rsp_executive: number; rsp_non_executive: number;
  contractor_supervisor: number; contractor_labour: number;
  executing_agency: number;
};

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });

export default function DailyReportTab({ schemeId }: { schemeId: number }) {
  const [columns, setColumns] = useState<Column[]>([]);
  const [rows, setRows] = useState<MatrixRow[]>([]);
  const [manpower, setManpower] = useState<ManpowerRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!schemeId) return;
    let alive = true;
    setLoading(true);
    fetch(`${API}/board/daily-report/${schemeId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setColumns(d.activityReportColumns || []);
        setRows(d.activityReportRows || []);
        setManpower(d.manpowerRecords || []);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [schemeId]);

  if (loading) return <p className="text-sm text-zinc-500">Loading daily report…</p>;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
          <FileText className="h-4 w-4 text-cyan-400" /> Activity-wise Daily Entries
          <span className="text-xs font-normal text-zinc-500">({rows.length} dates)</span>
        </h3>
        <div className="max-h-[520px] overflow-auto rounded-xl border border-zinc-800">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-zinc-950 text-[10px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                {columns.map((c) => (
                  <th key={c.id} className="min-w-[90px] px-2 py-2 text-right" title={`${c.category} · Scope ${c.scope} ${c.uom}`}>
                    {c.label}
                    <span className="block font-normal normal-case text-zinc-600">{c.uom}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {rows.map((r) => (
                <tr key={r.date} className="hover:bg-zinc-800/40">
                  <td className="whitespace-nowrap px-3 py-1.5 font-medium text-zinc-300">{fmtDate(r.date)}</td>
                  {columns.map((c) => {
                    const v = r.values[String(c.id)];
                    return (
                      <td key={c.id} className={`px-2 py-1.5 text-right ${v ? "text-emerald-300" : "text-zinc-700"}`}>
                        {v ? v.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={columns.length + 1} className="px-3 py-6 text-center text-zinc-600">No daily entries yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
          <Users className="h-4 w-4 text-teal-400" /> Manpower Log
        </h3>
        <div className="max-h-72 overflow-auto rounded-xl border border-zinc-800">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-zinc-950 text-[10px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-2 py-2 text-right">RSP Exec</th>
                <th className="px-2 py-2 text-right">RSP Non-Exec</th>
                <th className="px-2 py-2 text-right">Agency</th>
                <th className="px-2 py-2 text-right">Contr. Supervisor</th>
                <th className="px-2 py-2 text-right">Contr. Labour</th>
                <th className="px-2 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {manpower.map((m) => {
                const total = m.rsp_executive + m.rsp_non_executive + m.executing_agency
                  + m.contractor_supervisor + m.contractor_labour;
                return (
                  <tr key={m.report_date}>
                    <td className="px-3 py-1.5 text-zinc-300">{fmtDate(m.report_date)}</td>
                    <td className="px-2 py-1.5 text-right text-zinc-400">{m.rsp_executive}</td>
                    <td className="px-2 py-1.5 text-right text-zinc-400">{m.rsp_non_executive}</td>
                    <td className="px-2 py-1.5 text-right text-zinc-400">{m.executing_agency}</td>
                    <td className="px-2 py-1.5 text-right text-zinc-400">{m.contractor_supervisor}</td>
                    <td className="px-2 py-1.5 text-right text-zinc-400">{m.contractor_labour}</td>
                    <td className="px-2 py-1.5 text-right font-bold text-teal-300">{total}</td>
                  </tr>
                );
              })}
              {manpower.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-zinc-600">No manpower entries yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
