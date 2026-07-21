"use client";

/**
 * DPR "Import File" tab — upload a contractor's daily-report Excel (any of the
 * three site format families, auto-detected), review the parsed rows with
 * auto-matched plan activities + confidence, adjust quantities/matches, commit.
 * Suggested quantity = the file's for-the-day actual, or the delta between the
 * file's cumulative and the database cumulative when only cumulative exists.
 */

import { useMemo, useRef, useState } from "react";
import { CheckCircle2, FileSpreadsheet, Loader2, Upload, Users } from "lucide-react";

const API = "http://localhost:8000/api/v1";

type Candidate = { activity_id: number; activity_name: string; category: string; package: string; confidence: number };
type ParsedRow = {
  workType: string; activity: string; area: string; scope: number | null; uom: string;
  dayActual: number | null; cumActualToDate: number | null; ftmPlan: number | null;
  remarks: string; matchedActivityId: number | null; confidence: number;
  candidates: Candidate[]; suggestedQty: number; qtyBasis: string; detailCount?: number;
  srcRow?: number; qtyCell?: string | null; learned?: boolean;
  provenance?: Record<string, string | null>;
};
type ParseResult = {
  fileName: string; format: string; projectName: string; reportDate: string; schemeId?: number;
  rows: ParsedRow[];
  manpower: { category: string; trade: string; ftd: number }[];
  equipment: { name: string; count: number }[];
};

const num = (v: any, d = 2) =>
  v == null || isNaN(Number(v)) ? "—" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: d });

function ConfBadge({ v }: { v: number }) {
  const cls = v >= 75 ? "bg-emerald-500/15 text-emerald-300" : v >= 45 ? "bg-amber-500/15 text-amber-300" : "bg-red-500/15 text-red-300";
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${cls}`}>{v >= 45 ? `${v.toFixed(0)}%` : "no match"}</span>;
}

export default function ImportTab({ schemeId }: { schemeId: number }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [reportDate, setReportDate] = useState("");
  const [qty, setQty] = useState<Record<number, string>>({});
  const [match, setMatch] = useState<Record<number, string>>({});
  const [include, setInclude] = useState<Record<number, boolean>>({});
  const [err, setErr] = useState("");
  const [done, setDone] = useState<any>(null);
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [teaching, setTeaching] = useState<number | null>(null);

  const RSP_FIELDS: { field: string; label: string }[] = [
    { field: "dayActual", label: "Day actual" },
    { field: "cumActualToDate", label: "Cumulative actual" },
    { field: "scope", label: "Scope" },
    { field: "ftmPlan", label: "FTM plan" },
    { field: "cumActualLastMonth", label: "Cum actual last month" },
  ];
  const colIndex = (letter: string) => {
    let n = 0; for (const ch of letter.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  };
  const teachColumn = async (field: string, cellLetter: string, perScheme: boolean) => {
    const ci = colIndex(cellLetter.replace(/[0-9]/g, ""));
    if (ci < 0) return;
    await fetch(`${API}/dpr-ingest/teach/column`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dpr_format: result?.format, field, col_index: ci,
                             scheme_id: perScheme ? schemeId : null }),
    });
    setTeaching(null);
    if (lastFile) upload(lastFile);   // re-parse so provenance + values reflect the correction
  };
  const teachActivity = async (rowLabel: string, activityId: number) => {
    await fetch(`${API}/dpr-ingest/teach/activity`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheme_id: schemeId, row_label: rowLabel, activity_id: activityId }),
    });
  };

  const upload = async (file: File) => {
    setParsing(true); setErr(""); setDone(null); setResult(null); setLastFile(file);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("scheme_id", String(schemeId));
      const r = await fetch(`${API}/dpr-ingest/parse`, { method: "POST", body: fd });
      if (!r.ok) throw new Error((await r.json()).detail || r.statusText);
      const d: ParseResult = await r.json();
      setResult(d);
      setReportDate(d.reportDate);
      const q: Record<number, string> = {}, m: Record<number, string> = {}, inc: Record<number, boolean> = {};
      d.rows.forEach((row, i) => {
        q[i] = String(row.suggestedQty ?? 0);
        m[i] = row.matchedActivityId ? String(row.matchedActivityId) : "";
        inc[i] = Boolean(row.matchedActivityId && row.suggestedQty > 0);
      });
      setQty(q); setMatch(m); setInclude(inc);
    } catch (e: any) {
      setErr(String(e.message || e));
    } finally {
      setParsing(false);
    }
  };

  const commit = async () => {
    if (!result) return;
    setCommitting(true); setErr("");
    try {
      const entries = result.rows
        .map((row, i) => ({ row, i }))
        .filter(({ i }) => include[i] && match[i] && Number(qty[i]) > 0)
        .map(({ row, i }) => ({
          activity_id: Number(match[i]),
          qty: Number(qty[i]),
          area_of_work: row.workType || row.area,
          remarks: row.remarks || "",
        }));
      const r = await fetch(`${API}/dpr-ingest/commit`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheme_id: schemeId, report_date: reportDate,
          source_file: result.fileName, entries, manpower: result.manpower,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).detail || r.statusText);
      setDone(await r.json());
    } catch (e: any) {
      setErr(String(e.message || e));
    } finally {
      setCommitting(false);
    }
  };

  const committable = useMemo(
    () => result ? result.rows.filter((_, i) => include[i] && match[i] && Number(qty[i]) > 0).length : 0,
    [result, include, match, qty],
  );

  return (
    <div className="space-y-5">
      {/* upload */}
      <div className="rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/40 p-6 text-center">
        <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.xls" className="hidden"
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <FileSpreadsheet className="mx-auto mb-2 h-8 w-8 text-cyan-400" />
        <p className="mb-1 text-sm font-bold text-zinc-200">Import a contractor DPR file</p>
        <p className="mb-3 text-xs text-zinc-500">
          RSP DPR · Weekly Report · Site Progress formats auto-detected — rows auto-matched to this scheme's plan activities
        </p>
        <button onClick={() => fileRef.current?.click()} disabled={parsing}
          className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-sm font-bold text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50">
          {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {parsing ? "Parsing…" : "Choose Excel file"}
        </button>
      </div>

      {err && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{err}</div>}
      {done && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          <CheckCircle2 className="h-4 w-4" />
          Committed {done.actualsSaved} activity actual(s) and {done.manpowerSaved} manpower row(s) for {done.reportDate}.
        </div>
      )}

      {result && (
        <>
          {/* file meta */}
          <div className="flex flex-wrap items-center gap-4 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-xs">
            <span className="font-bold text-zinc-200">{result.fileName}</span>
            <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 font-mono text-[10px] uppercase text-cyan-300">{result.format}</span>
            {result.projectName && <span className="text-zinc-400">{result.projectName}</span>}
            <label className="ml-auto flex items-center gap-2 text-zinc-400">
              Report date
              <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)}
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-white outline-none" />
            </label>
          </div>

          {/* rows */}
          <div className="overflow-x-auto rounded-xl border border-zinc-800">
            <table className="w-full text-xs">
              <thead className="bg-zinc-950 text-[10px] uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-2 py-2" />
                  <th className="px-2 py-2 text-left">File row</th>
                  <th className="px-2 py-2 text-right">Scope</th>
                  <th className="px-2 py-2 text-right">Day actual</th>
                  <th className="px-2 py-2 text-right">Cum. in file</th>
                  <th className="px-2 py-2 text-left">Matched plan activity</th>
                  <th className="px-2 py-2 text-center">Confidence</th>
                  <th className="px-2 py-2 text-right">Qty to record</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {result.rows.map((row, i) => (
                  <tr key={i} className={include[i] ? "" : "opacity-45"}>
                    <td className="px-2 py-1.5 text-center">
                      <input type="checkbox" checked={include[i] || false}
                        onChange={(e) => setInclude((c) => ({ ...c, [i]: e.target.checked }))} />
                    </td>
                    <td className="px-2 py-1.5 text-zinc-200">
                      <span className="text-zinc-500">{row.workType}</span> {row.activity}
                      {row.detailCount ? <span className="ml-1 text-[10px] text-zinc-600">({row.detailCount} areas)</span> : null}
                    </td>
                    <td className="px-2 py-1.5 text-right text-zinc-400">{num(row.scope)} {row.uom}</td>
                    <td className="px-2 py-1.5 text-right text-emerald-300">{num(row.dayActual)}</td>
                    <td className="px-2 py-1.5 text-right text-zinc-400">{num(row.cumActualToDate)}</td>
                    <td className="px-2 py-1.5">
                      <select value={match[i] || ""} onChange={(e) => {
                          setMatch((c) => ({ ...c, [i]: e.target.value }));
                          if (e.target.value) teachActivity(`${row.workType || ""} ${row.activity || ""}`.trim() || row.activity, Number(e.target.value));
                        }}
                        className="w-full min-w-[210px] rounded border border-zinc-700 bg-zinc-950 px-1.5 py-1 text-zinc-200 outline-none">
                        <option value="">— unmatched —</option>
                        {row.candidates.map((c) => (
                          <option key={c.activity_id} value={String(c.activity_id)}>
                            {c.activity_name} ({c.confidence.toFixed(0)}%)
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5 text-center"><ConfBadge v={row.confidence} /></td>
                    <td className="relative px-2 py-1.5 text-right">
                      <input type="number" value={qty[i] ?? ""} onChange={(e) => setQty((c) => ({ ...c, [i]: e.target.value }))}
                        className="w-24 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-1 text-right text-cyan-300 outline-none" />
                      {row.qtyBasis === "cumulative_delta" && (
                        <span className="block text-[9px] text-amber-400/80" title="Derived: file cumulative − database cumulative">Δ cum</span>
                      )}
                      {row.qtyCell && (
                        <span className="block cursor-pointer text-[9px] text-cyan-500/80 hover:text-cyan-300"
                              title="Cell this value was read from — click to correct the source column"
                              onClick={() => setTeaching(teaching === i ? null : i)}>
                          from {row.qtyCell}{row.learned ? " · learned" : ""} ▾
                        </span>
                      )}
                      {teaching === i && (
                        <div className="absolute z-20 mt-1 w-56 rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-left shadow-xl">
                          <p className="mb-1 text-[10px] font-bold text-zinc-400">Value taken from wrong cell? Point each field to the correct column:</p>
                          {RSP_FIELDS.map((f) => (
                            <div key={f.field} className="mb-1 flex items-center gap-1">
                              <span className="w-28 text-[10px] text-zinc-400">{f.label}</span>
                              <span className="text-[10px] text-zinc-500">{row.provenance?.[f.field] || "—"}</span>
                              <input placeholder="→ col e.g. L" defaultValue=""
                                     className="w-14 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-200 outline-none"
                                     onKeyDown={(e) => { if (e.key === "Enter") { const v = (e.target as HTMLInputElement).value.trim(); if (v) teachColumn(f.field, v, true); } }} />
                            </div>
                          ))}
                          <p className="mt-1 text-[9px] text-zinc-600">Enter a column letter and press Enter. Saved for this scheme; re-parses immediately.</p>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* manpower preview */}
          {result.manpower.length > 0 && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <p className="mb-2 flex items-center gap-2 text-xs font-bold text-zinc-300">
                <Users className="h-4 w-4 text-teal-400" /> Manpower in file ({result.manpower.length}) — will be saved to the day's manpower matrix
              </p>
              <div className="flex flex-wrap gap-2 text-[11px]">
                {result.manpower.map((m, i) => (
                  <span key={i} className="rounded-full border border-zinc-700 px-2 py-0.5 text-zinc-300">
                    {m.category}{m.trade ? ` · ${m.trade}` : ""}: <b className="text-teal-300">{num(m.ftd, 0)}</b>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            <span className="text-xs text-zinc-500">{committable} row(s) ready to commit</span>
            <button onClick={commit} disabled={committing || committable === 0}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-5 py-2.5 text-sm font-bold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50">
              {committing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Commit to DPR
            </button>
          </div>
        </>
      )}
    </div>
  );
}
