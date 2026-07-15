"use client";
// ReportDocument — renders a resolved report (any of the 5 families) as the
// ACTUAL document, on screen, in format. Figure cells and narrative bullets are
// inline-editable. Export walks the same resolved blocks -> the docx equals what
// you see. Preserves each family's structure & register.
import React, { useCallback, useEffect, useState } from "react";

const API = (process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000/api/v1").replace(/\/$/, "");
const rb = (p) => `${API}/report-brain${p}`;

const P = {
  paper: "#fbfbf7", ink: "#14263c", dim: "#5a6b80", line: "#c9d3e0",
  steel: "#1a4e8a", ok: "#147d5b", warn: "#b7791f", hot: "#c0392b",
  soft: "#eef3f9",
};
const FAMILIES = [
  { id: "do", label: "DO Letter" },
  { id: "pmc", label: "PMC Report" },
  { id: "agenda", label: "Board Agenda" },
  { id: "capex", label: "CAPEX / MoS" },
  { id: "wpr", label: "WPR" },
];

async function jpost(path, body) {
  const r = await fetch(rb(path), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

function EditableCell({ value, onSave, bold }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  if (edit) {
    return (
      <input value={v} autoFocus onChange={(e) => setV(e.target.value)}
        onBlur={() => { setEdit(false); onSave(v); }}
        onKeyDown={(e) => { if (e.key === "Enter") { setEdit(false); onSave(v); } }}
        style={{ width: "100%", border: `1px solid ${P.steel}`, borderRadius: 3, padding: "2px 4px", fontSize: 12.5, fontFamily: "inherit", boxSizing: "border-box" }} />
    );
  }
  return (
    <span onClick={() => setEdit(true)} title="click to edit"
      style={{ cursor: "text", fontWeight: bold ? 700 : 400, display: "inline-block", minWidth: 30, minHeight: 16 }}>
      {String(value ?? "")}
    </span>
  );
}

function NarrativeBlock({ block, onEditBullet }) {
  let curDisc = null;
  const sorted = [...block.bullets].sort((a, b) => (a.discipline || "").localeCompare(b.discipline || ""));
  return (
    <div style={{ margin: "6px 0 14px" }}>
      {block.title ? <div style={{ fontWeight: 700, fontSize: 13, margin: "8px 0 4px" }}>{block.title}</div> : null}
      {sorted.length === 0 ? <div style={{ fontStyle: "italic", color: P.dim, fontSize: 12.5 }}>Nil for the month.</div> : null}
      {sorted.map((b, i) => {
        const showDisc = b.discipline && b.discipline !== curDisc; curDisc = b.discipline;
        return (
          <div key={i}>
            {showDisc ? <div style={{ fontWeight: 700, fontSize: 12.5, color: P.steel, marginTop: 7 }}>{b.discipline}</div> : null}
            <div style={{ display: "flex", gap: 6, alignItems: "flex-start", paddingLeft: 14, lineHeight: 1.55,
              background: b.draft ? "#fdf6e3" : !b.grounded ? "#fbeeee" : "transparent", borderRadius: 3 }}>
              <span style={{ color: b.grounded ? P.ok : P.hot, fontSize: 10, marginTop: 4 }}>{b.grounded ? "●" : "▲"}</span>
              <EditableBullet text={b.text} draft={b.draft} onSave={(nv) => onEditBullet(block.section, block.project, b.text, nv)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EditableBullet({ text, draft, onSave }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(text);
  useEffect(() => setV(text), [text]);
  if (edit) {
    return (
      <textarea value={v} autoFocus rows={2} onChange={(e) => setV(e.target.value)}
        onBlur={() => { setEdit(false); if (v !== text) onSave(v); }}
        style={{ flex: 1, border: `1px solid ${P.steel}`, borderRadius: 4, padding: "3px 6px", fontSize: 12.5, fontFamily: "inherit", resize: "vertical" }} />
    );
  }
  return (
    <span onClick={() => setEdit(true)} style={{ flex: 1, fontSize: 12.5, cursor: "text" }}>
      {text.replace(/\.$/, "")}.
      {draft ? <span style={{ color: P.warn, fontSize: 10, marginLeft: 6 }}>[auto-draft — review]</span> : null}
    </span>
  );
}

export default function ReportDocument({ project = "COB7-PKG2", month = "2026-06",
  allProjects = [], projectNames = {}, figuresCtx = {} }) {
  const [family, setFamily] = useState("pmc");
  const [doc, setDoc] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const say = (m) => { setToast(m); setTimeout(() => setToast(""), 2500); };

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const perProject = ["do", "agenda", "capex"].includes(family);
      const d = await jpost("/document", {
        family, project, month,
        all_projects: perProject ? (allProjects.length ? allProjects : [project]) : [],
        figures_ctx: figuresCtx, project_names: projectNames,
      });
      setDoc(d);
    } catch { say("load failed — is the backend running?"); }
    setBusy(false);
  }, [family, project, month, allProjects, projectNames, figuresCtx]);
  useEffect(() => { load(); }, [load]);

  const editBullet = async (section, proj, before, after) => {
    await jpost("/edit", { project: proj || project, month, section_type: section, before_text: before, after_text: after, kind: "phrasing" }).catch(() => {});
    setDoc((d) => !d ? d : {
      ...d, blocks: d.blocks.map((b) => b.kind === "narrative" && b.section === section && (b.project === proj)
        ? { ...b, bullets: b.bullets.map((x) => x.text === before ? { ...x, text: after, grounded: true } : x) } : b),
    });
    say("Edited & learned");
  };

  const editCell = (blockIdx, rowIdx, colIdx, value) => {
    setDoc((d) => { const bl = structuredClone(d.blocks); bl[blockIdx].rows[rowIdx][colIdx] = value; return { ...d, blocks: bl }; });
  };

  const exportDocx = async () => {
    if (!doc) return;
    setBusy(true);
    try {
      const r = await jpost("/document/export", { resolved: doc, filename: `${family.toUpperCase()}_${project}_${month}.docx` });
      window.open(`${API}${r.download}`, "_blank");
      say(`${r.file} downloaded`);
    } catch { say("export failed"); }
    setBusy(false);
  };

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", padding: "16px 0 60px" }}>
      {/* toolbar */}
      <div style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--panel)", borderBottom: "1px solid var(--line)",
        display: "flex", gap: 8, alignItems: "center", padding: "10px 24px" }}>
        {FAMILIES.map((f) => (
          <button key={f.id} onClick={() => setFamily(f.id)}
            style={{ border: `1px solid ${P.line}`, cursor: "pointer", padding: "6px 14px", borderRadius: 8, fontSize: 12.5, fontWeight: 700,
              background: family === f.id ? "var(--steel)" : "var(--panel)", color: family === f.id ? "#fff" : "var(--ink-3)" }}>{f.label}</button>
        ))}
        <span style={{ flex: 1 }} />
        {busy ? <span style={{ color: P.steel, fontSize: 12 }}>working…</span> : null}
        {toast ? <span style={{ background: P.soft, borderRadius: 8, padding: "5px 12px", fontSize: 12, color: P.steel }}>{toast}</span> : null}
        <button onClick={exportDocx} style={{ border: "none", background: P.steel, color: "#fff", borderRadius: 8, padding: "7px 18px", fontWeight: 800, cursor: "pointer" }}>Export .docx</button>
      </div>

      {/* the paper */}
      <div style={{ maxWidth: 860, margin: "18px auto", background: P.paper, boxShadow: "0 4px 24px rgba(20,38,60,.14)",
        padding: "46px 56px", color: P.ink, fontFamily: "'Times New Roman', Georgia, serif" }}>
        {!doc ? <div style={{ color: P.dim }}>Loading document…</div> : (
          <>
            <div style={{ textAlign: "center", fontWeight: 700, textDecoration: "underline", fontSize: 15, marginBottom: 18 }}>
              {doc.title} — {doc.project} — {doc.month}
            </div>
            {doc.blocks.map((b, bi) => {
              if (b.kind === "heading") return (
                <div key={bi} style={{ fontWeight: 700, textDecoration: "underline", fontSize: 13.5, margin: "16px 0 6px" }}>
                  {b.roman ? `${b.roman}. ` : ""}{b.text}
                </div>
              );
              if (b.kind === "para") return <p key={bi} style={{ fontSize: 12.5, lineHeight: 1.6, margin: "6px 0" }}>{b.text}</p>;
              if (b.kind === "table") return (
                <div key={bi} style={{ margin: "8px 0 14px" }}>
                  {b.title ? <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 4 }}>{b.title}</div> : null}
                  <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 11.5 }}>
                    <thead><tr>{b.columns.map((c, i) => (
                      <th key={i} style={{ border: `1px solid ${P.line}`, background: P.soft, padding: "5px 7px", textAlign: i === 0 ? "left" : "right", fontWeight: 700 }}>{c}</th>
                    ))}</tr></thead>
                    <tbody>{b.rows.map((row, ri) => (
                      <tr key={ri}>{b.columns.map((_, ci) => (
                        <td key={ci} style={{ border: `1px solid ${P.line}`, padding: "4px 7px", textAlign: ci === 0 ? "left" : "right" }}>
                          {b.editable_cells ? <EditableCell value={row[ci]} bold={String(row[0]).toLowerCase() === "total"} onSave={(v) => editCell(bi, ri, ci, v)} /> : String(row[ci] ?? "")}
                        </td>
                      ))}</tr>
                    ))}</tbody>
                  </table>
                  {b.note ? <div style={{ fontSize: 10.5, fontStyle: "italic", color: P.dim, marginTop: 3 }}>Note: {b.note}</div> : null}
                </div>
              );
              if (b.kind === "narrative") return <NarrativeBlock key={bi} block={b} onEditBullet={editBullet} />;
              return null;
            })}
          </>
        )}
      </div>
      <div style={{ textAlign: "center", fontSize: 11, color: P.dim }}>
        ● grounded to source · ▲ unverified · <span style={{ color: P.warn }}>amber</span> = auto-draft · figures from database · click any cell or bullet to edit
      </div>
    </div>
  );
}
