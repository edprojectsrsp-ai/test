"use client";

/**
 * Report Studio — Custom Reports (multi-section KPI reports).
 *
 * A custom report = ordered sections, each a full semantic-layer query spec
 * (dimensions / measures / formulas / filters / pivot / totals) run live by
 * the backend (/api/v1/report-studio/reports). This file provides:
 *   - CustomReportsTab : full manager (list, view, reorder/delete sections,
 *     seed the standard CAPEX pack, download XLSX/DOCX)
 *   - CapexPackPanel   : embeddable panel with the 3 standard CAPEX
 *     physical-financial reports (auto-seeds on first load) — used by the
 *     Reports → MoS CAPEX page.
 */

import { useCallback, useEffect, useState } from "react";
import {
  ArrowDown, ArrowUp, ChevronDown, ChevronRight, Download, Eye, FileSpreadsheet,
  FileText, Loader2, RefreshCw, Sparkles, Trash2,
} from "lucide-react";
import { authFetch } from "@/lib/auth";
import { exportRsReport } from "@/lib/export";

const API = (process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000/api/v1").replace(/\/$/, "");
const rs = (p: string) => `${API}/report-studio${p}`;

export type RsColumn = { key: string; label: string; type: string };
export type RsSectionResult = { title: string; note?: string | null; columns: RsColumn[]; rows: any[] };
export type RsRunResult = { report_id: number; name: string; description?: string | null; sections: RsSectionResult[] };
export type RsReportMeta = { report_id: number; name: string; description?: string | null; category?: string | null; section_count: number };

const NUMERIC = ["int", "number", "money"];
const fmtVal = (v: any, type: string) => {
  if (v == null || v === "") return "—";
  if (typeof v === "number") {
    if (type === "int") return v.toLocaleString("en-IN");
    return v.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: type === "money" ? 2 : 0 });
  }
  return String(v);
};

// ───────────────────────────── section table ─────────────────────────────

export function RsSectionTable({ sec }: { sec: RsSectionResult }) {
  const th: React.CSSProperties = {
    border: "1px solid var(--line)", background: "var(--panel-3)", padding: "6px 9px",
    fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.4,
    color: "var(--ink-3)", whiteSpace: "nowrap",
  };
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: "var(--ink)", marginBottom: 2 }}>{sec.title}</div>
      {sec.note && <div style={{ fontSize: 11, color: "var(--ink-4)", marginBottom: 6 }}>{sec.note}</div>}
      <div style={{ overflowX: "auto", border: "1px solid var(--line)", borderRadius: 8 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
          <thead>
            <tr>{sec.columns.map((c) => (
              <th key={c.key} style={{ ...th, textAlign: NUMERIC.includes(c.type) ? "right" : "left" }}>{c.label}</th>
            ))}</tr>
          </thead>
          <tbody>
            {sec.rows.map((r, i) => {
              const total = !!r.__total__;
              return (
                <tr key={i} style={total ? { background: "var(--steel-soft)", fontWeight: 800 } : undefined}>
                  {sec.columns.map((c) => (
                    <td key={c.key} style={{
                      border: "1px solid var(--line)", padding: "5px 9px", whiteSpace: "nowrap",
                      textAlign: NUMERIC.includes(c.type) ? "right" : "left",
                      color: "var(--ink-2)", fontWeight: total ? 800 : undefined,
                    }}>
                      {fmtVal(r[c.key], c.type)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {sec.rows.length === 0 && (
              <tr><td colSpan={sec.columns.length || 1} style={{ padding: 16, textAlign: "center", color: "var(--ink-4)", fontSize: 12 }}>No rows.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function RsReportViewer({ data }: { data: RsRunResult }) {
  return (
    <div>
      {data.description && <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 12 }}>{data.description}</div>}
      {data.sections.map((s, i) => <RsSectionTable key={i} sec={s} />)}
    </div>
  );
}

// ───────────────────────────── shared card ─────────────────────────────

const btn = (kind: "primary" | "ghost" = "ghost"): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 11px", borderRadius: 8,
  border: "1px solid var(--line)", cursor: "pointer", fontSize: 12, fontWeight: 700,
  background: kind === "primary" ? "var(--steel)" : "var(--panel)",
  color: kind === "primary" ? "#fff" : "var(--ink-2)",
});

export function RsReportCard({ meta, onDeleted, defaultOpen = false }: {
  meta: RsReportMeta; onDeleted?: () => void; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [data, setData] = useState<RsRunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState<"" | "xlsx" | "docx">("");
  const [err, setErr] = useState("");

  const run = useCallback(async () => {
    setBusy(true); setErr("");
    try {
      const r = await authFetch(rs(`/reports/${meta.report_id}/run`), { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || "Run failed");
      setData(j);
    } catch (e: any) { setErr(String(e.message || e)); }
    finally { setBusy(false); }
  }, [meta.report_id]);

  useEffect(() => { if (open && !data && !busy) run(); }, [open, data, busy, run]);

  const doExport = async (fmt: "xlsx" | "docx") => {
    setExporting(fmt); setErr("");
    try { await exportRsReport({ reportId: meta.report_id, fmt, name: meta.name }); }
    catch (e: any) { setErr(String(e.message || e)); }
    finally { setExporting(""); }
  };

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, background: "var(--panel)", marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", flexWrap: "wrap" }}>
        <button onClick={() => setOpen(!open)} style={{ ...btn("ghost"), border: "none", padding: 4 }}>
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "var(--ink)" }}>{meta.name}</div>
          <div style={{ fontSize: 11, color: "var(--ink-4)" }}>{meta.section_count} sections · live data</div>
        </div>
        <button onClick={() => { setOpen(true); setData(null); run(); }} disabled={busy} style={btn("ghost")}>
          {busy ? <Loader2 size={13} className="spin" /> : <Eye size={13} />} View
        </button>
        <button onClick={() => doExport("xlsx")} disabled={!!exporting} style={btn("ghost")}>
          {exporting === "xlsx" ? <Loader2 size={13} className="spin" /> : <FileSpreadsheet size={13} />} Excel
        </button>
        <button onClick={() => doExport("docx")} disabled={!!exporting} style={btn("ghost")}>
          {exporting === "docx" ? <Loader2 size={13} className="spin" /> : <FileText size={13} />} Word
        </button>
        {onDeleted && (
          <button
            onClick={async () => {
              if (!confirm(`Delete report "${meta.name}"?`)) return;
              await authFetch(rs(`/reports/${meta.report_id}`), { method: "DELETE" });
              onDeleted();
            }}
            style={{ ...btn("ghost"), color: "var(--slag, #e5534b)" }}>
            <Trash2 size={13} />
          </button>
        )}
      </div>
      {err && <div style={{ padding: "0 14px 10px", color: "var(--slag, #e5534b)", fontSize: 12 }}>{err}</div>}
      {open && (
        <div style={{ padding: "4px 14px 14px" }}>
          {busy && !data ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--ink-3)", fontSize: 12, padding: 18 }}>
              <Loader2 size={14} className="spin" /> Computing report from live data…
            </div>
          ) : data ? <RsReportViewer data={data} /> : null}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── CAPEX pack panel ─────────────────────────────

export function CapexPackPanel() {
  const [reports, setReports] = useState<RsReportMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async (autoSeed = true) => {
    setLoading(true); setErr("");
    try {
      let r = await authFetch(rs("/reports?category=capex-pack"));
      let j = await r.json();
      if (!r.ok) throw new Error(j.detail || "Failed to load reports");
      if ((j.reports || []).length === 0 && autoSeed) {
        await authFetch(rs("/reports/seed-capex-pack"), { method: "POST" });
        r = await authFetch(rs("/reports?category=capex-pack"));
        j = await r.json();
      }
      setReports(j.reports || []);
    } catch (e: any) { setErr(String(e.message || e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const reseed = async () => {
    setSeeding(true); setErr("");
    try {
      const r = await authFetch(rs("/reports/seed-capex-pack"), { method: "POST" });
      if (!r.ok) throw new Error((await r.json()).detail || "Seed failed");
      await load(false);
    } catch (e: any) { setErr(String(e.message || e)); }
    finally { setSeeding(false); }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
          The 3 standard CAPEX physical–financial templates — stored as query specs, regenerated
          live each time. Manage them in Report Studio → Templates.
        </div>
        <button onClick={reseed} disabled={seeding} style={{ ...btn("ghost"), marginLeft: "auto" }}>
          {seeding ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} Reset to standard formats
        </button>
      </div>
      {err && <div style={{ color: "var(--slag, #e5534b)", fontSize: 12, marginBottom: 8 }}>{err}</div>}
      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--ink-3)", fontSize: 12, padding: 22 }}>
          <Loader2 size={14} className="spin" /> Loading CAPEX report pack…
        </div>
      ) : reports.length === 0 ? (
        <div style={{ color: "var(--ink-4)", fontSize: 12, padding: 18 }}>No reports in the pack yet.</div>
      ) : (
        reports.map((m) => <RsReportCard key={m.report_id} meta={m} />)
      )}
    </div>
  );
}

// ───────────────────────────── full manager tab ─────────────────────────────

export default function CustomReportsTab() {
  const [reports, setReports] = useState<RsReportMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editDoc, setEditDoc] = useState<any | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await authFetch(rs("/reports"));
      const j = await r.json();
      setReports(j.reports || []);
    } catch { setErr("Failed to load reports"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const seed = async () => {
    setSeeding(true);
    try { await authFetch(rs("/reports/seed-capex-pack"), { method: "POST" }); await load(); }
    finally { setSeeding(false); }
  };

  const openEditor = async (id: number) => {
    const r = await authFetch(rs(`/reports/${id}`));
    const j = await r.json();
    setEditId(id); setEditDoc(j);
  };

  const saveEditor = async () => {
    if (!editId || !editDoc) return;
    const r = await authFetch(rs(`/reports/${editId}`), {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editDoc.name, description: editDoc.description,
        category: editDoc.category, sections: editDoc.sections,
      }),
    });
    if (!r.ok) { setErr((await r.json()).detail || "Save failed"); return; }
    setEditId(null); setEditDoc(null); load();
  };

  const moveSection = (i: number, dir: -1 | 1) => setEditDoc((d: any) => {
    const s = [...d.sections];
    const j = i + dir;
    if (j < 0 || j >= s.length) return d;
    [s[i], s[j]] = [s[j], s[i]];
    return { ...d, sections: s };
  });

  return (
    <div style={{ padding: "16px 24px 48px", maxWidth: 1180 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)" }}>Report templates</div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", maxWidth: 720, lineHeight: 1.5 }}>
            Saved designs (query specs + section layout) — <b>not frozen numbers</b>.
            Every View / Excel / Word re-runs against live CAPEX & progress data.
            Create in <b>Matrix Builder</b> → “Add to report”, or seed the standard CAPEX pack.
          </div>
        </div>
        <button onClick={seed} disabled={seeding} style={{ ...btn("primary"), marginLeft: "auto" }}>
          {seeding ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />} Seed CAPEX pack (3 formats)
        </button>
      </div>
      {err && <div style={{ color: "var(--slag, #e5534b)", fontSize: 12, marginBottom: 8 }}>{err}</div>}
      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--ink-3)", fontSize: 12, padding: 22 }}>
          <Loader2 size={14} className="spin" /> Loading…
        </div>
      ) : reports.length === 0 ? (
        <div style={{ border: "1px dashed var(--line)", borderRadius: 10, padding: 28, textAlign: "center", color: "var(--ink-4)", fontSize: 13 }}>
          No templates yet. Seed the CAPEX pack, or design in Matrix Builder and “Add to report”.
        </div>
      ) : (
        reports.map((m) => (
          <div key={m.report_id}>
            <RsReportCard meta={m} onDeleted={load} />
            <div style={{ margin: "-6px 0 10px 40px" }}>
              <button onClick={() => openEditor(m.report_id)} style={{ ...btn("ghost"), padding: "3px 9px", fontSize: 11 }}>
                Edit sections
              </button>
            </div>
          </div>
        ))
      )}

      {editId && editDoc && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }}>
          <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: 18, width: 560, maxHeight: "80vh", overflowY: "auto" }}>
            <div style={{ fontWeight: 800, color: "var(--ink)", marginBottom: 10 }}>Edit report</div>
            <input value={editDoc.name} onChange={(e) => setEditDoc({ ...editDoc, name: e.target.value })}
              style={{ width: "100%", background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 7, padding: "6px 9px", fontSize: 13, color: "var(--ink)", marginBottom: 8 }} />
            <textarea value={editDoc.description || ""} onChange={(e) => setEditDoc({ ...editDoc, description: e.target.value })} rows={2}
              placeholder="Description"
              style={{ width: "100%", background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 7, padding: "6px 9px", fontSize: 12, color: "var(--ink)", marginBottom: 10 }} />
            {(editDoc.sections || []).map((s: any, i: number) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <input value={s.title} onChange={(e) => setEditDoc((d: any) => {
                  const sections = [...d.sections];
                  sections[i] = { ...sections[i], title: e.target.value };
                  return { ...d, sections };
                })} style={{ flex: 1, background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 7, padding: "5px 8px", fontSize: 12, color: "var(--ink)" }} />
                <span style={{ fontSize: 10, color: "var(--ink-4)" }}>{s.spec?.dataset}</span>
                <button onClick={() => moveSection(i, -1)} style={{ ...btn("ghost"), padding: "3px 6px" }}><ArrowUp size={12} /></button>
                <button onClick={() => moveSection(i, 1)} style={{ ...btn("ghost"), padding: "3px 6px" }}><ArrowDown size={12} /></button>
                <button onClick={() => setEditDoc((d: any) => ({ ...d, sections: d.sections.filter((_: any, j: number) => j !== i) }))}
                  style={{ ...btn("ghost"), padding: "3px 6px", color: "var(--slag, #e5534b)" }}><Trash2 size={12} /></button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={saveEditor} style={btn("primary")}><Download size={13} /> Save</button>
              <button onClick={() => { setEditId(null); setEditDoc(null); }} style={btn("ghost")}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
