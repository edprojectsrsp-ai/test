"use client";

/**
 * DPR Manpower matrix (friend-parity): RSP Executives / Non-Executives,
 * Executing Agency roles, Contractor roster (Supervisor + Labour per
 * contractor) with last-month average, today's count and remarks.
 */

import { useCallback, useEffect, useState } from "react";
import { Plus, Save, Trash2, Users } from "lucide-react";

const API = "http://localhost:8000/api/v1";

type Row = {
  id: number;
  category: string;
  contractorGroupId?: string;
  contractorName: string;
  trade: string;
  lastMonth: number | string;
  today: number | string;
  remarks: string;
};

export default function ManpowerMatrix({ schemeId }: { schemeId: number }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<Row[]>([]);
  const [agency, setAgency] = useState("");
  const [newContractor, setNewContractor] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  const load = useCallback(() => {
    if (!schemeId) return;
    fetch(`${API}/board/manpower/${schemeId}?date=${date}`)
      .then((r) => r.json())
      .then((d) => { setRows(d.rows || []); setAgency(d.agencyName || ""); })
      .catch(() => {});
  }, [schemeId, date]);

  useEffect(load, [load]);

  const update = (id: number, patch: Partial<Row>) =>
    setRows((cur) => cur.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const save = async () => {
    setSaving(true);
    setStatus("");
    try {
      const r = await fetch(`${API}/board/manpower/${schemeId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          report_date: date,
          rows: rows.map((row) => ({
            category: row.category,
            contractorName: row.contractorName,
            trade: row.trade,
            lastMonth: Number(row.lastMonth) || 0,
            today: Number(row.today) || 0,
            remarks: row.remarks,
          })),
        }),
      });
      setStatus(r.ok ? "Saved ✓" : "Save failed");
    } catch {
      setStatus("Save failed");
    } finally {
      setSaving(false);
    }
  };

  const addContractor = async () => {
    const name = newContractor.trim();
    if (!name) return;
    await fetch(`${API}/board/manpower/${schemeId}/contractors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contractorName: name }),
    }).catch(() => {});
    setNewContractor("");
    load();
  };

  const removeContractor = async (name: string) => {
    await fetch(
      `${API}/board/manpower/${schemeId}/contractors?contractorName=${encodeURIComponent(name)}`,
      { method: "DELETE" },
    ).catch(() => {});
    load();
  };

  const contractorNames = Array.from(new Set(
    rows.filter((r) => r.category === "Contractor" && r.contractorName).map((r) => r.contractorName),
  ));

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-white">
          <Users className="h-4 w-4 text-teal-400" /> Manpower Deployment
          {agency && <span className="text-xs font-normal text-zinc-500">· Agency: {agency}</span>}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-white outline-none" />
          <input
            value={newContractor}
            onChange={(e) => setNewContractor(e.target.value)}
            placeholder="New contractor name…"
            className="w-44 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-white outline-none"
          />
          <button onClick={addContractor}
            className="flex items-center gap-1 rounded-lg border border-teal-500/40 bg-teal-500/10 px-3 py-1.5 text-xs font-bold text-teal-300 hover:bg-teal-500/20">
            <Plus className="h-3.5 w-3.5" /> Add Contractor
          </button>
          <button onClick={save} disabled={saving}
            className="flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50">
            <Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save Manpower"}
          </button>
          {status && <span className="text-xs text-emerald-400">{status}</span>}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-800">
        <table className="w-full text-xs">
          <thead className="bg-zinc-950 text-[10px] uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2 text-left">Category</th>
              <th className="px-3 py-2 text-left">Contractor / Agency</th>
              <th className="px-3 py-2 text-left">Trade / Role</th>
              <th className="px-2 py-2 text-right">Last Month Avg</th>
              <th className="px-2 py-2 text-right">Today</th>
              <th className="px-3 py-2 text-left">Remarks</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/70">
            {rows.map((r) => (
              <tr key={r.id} className={r.category === "Contractor" ? "bg-cyan-500/5" : ""}>
                <td className="px-3 py-1.5 font-medium text-zinc-300">{r.category}</td>
                <td className="px-3 py-1.5 text-zinc-400">{r.contractorName || "—"}</td>
                <td className="px-3 py-1.5 text-zinc-400">{r.trade || "—"}</td>
                <td className="px-2 py-1">
                  <input type="number" value={r.lastMonth}
                    onChange={(e) => update(r.id, { lastMonth: e.target.value })}
                    className="w-20 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-right text-zinc-300 outline-none focus:border-teal-400" />
                </td>
                <td className="px-2 py-1">
                  <input type="number" value={r.today}
                    onChange={(e) => update(r.id, { today: e.target.value })}
                    className="w-20 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-right text-teal-300 outline-none focus:border-teal-400" />
                </td>
                <td className="px-3 py-1">
                  <input value={r.remarks}
                    onChange={(e) => update(r.id, { remarks: e.target.value })}
                    className="w-full min-w-[140px] rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-300 outline-none focus:border-teal-400" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {contractorNames.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          Contractors:
          {contractorNames.map((name) => (
            <span key={name} className="flex items-center gap-1 rounded-full border border-zinc-700 px-2 py-0.5 text-zinc-300">
              {name}
              <button onClick={() => removeContractor(name)} title="Remove contractor" className="text-zinc-500 hover:text-red-400">
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
