"use client";
// Report Studio — the Monthly Report Brain UI.
// Flow: pick month -> drop sources (WhatsApp/DPR/record-notes) or type a Quick
// Note -> project cards light up with atom counts -> Compose -> review every
// bullet with its source citation + grounding flag -> edit inline (feeds the
// learning loop) -> Generate the report family (downloadable docx).
import React, { useCallback, useEffect, useRef, useState } from "react";

const API = (process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000/api/v1").replace(/\/$/, "");
const rb = (p: string) => `${API}/report-brain${p}`;

const C = {
  bg: "var(--bg)", panel: "var(--panel)", panel2: "var(--panel-2)", line: "var(--line)",
  ink: "var(--ink)", dim: "var(--ink-3)", steel: "var(--steel)", ok: "var(--verdigris)",
  warn: "var(--slag)", hot: "var(--molten)", soft: "var(--steel-soft)",
};
const mono: React.CSSProperties = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };

async function jpost(path: string, body: unknown) {
  const r = await fetch(rb(path), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

interface Bullet { discipline: string; text: string; grounded: boolean; draft?: boolean; state?: string; source_ref?: string; atom_ids?: string[]; }

function SectionReview({ title, bullets, onEdit }: { title: string; bullets: Bullet[]; onEdit: (before: string, after: string) => void }) {
  const [editing, setEditing] = useState<number | null>(null);
  const [val, setVal] = useState("");
  let curDisc = "";
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11, letterSpacing: 0.6, color: C.dim, textTransform: "uppercase", marginBottom: 6 }}>
        {title} <span style={{ color: C.dim }}>· {bullets.length} bullets · {bullets.filter((b) => b.grounded).length} grounded</span>
      </div>
      <div style={{ display: "grid", gap: 3 }}>
        {bullets.map((b, i) => {
          const showDisc = b.discipline !== curDisc; curDisc = b.discipline;
          return (
            <div key={i}>
              {showDisc ? <div style={{ fontSize: 12, fontWeight: 700, color: C.steel, marginTop: 8 }}>{b.discipline}</div> : null}
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "4px 8px", borderRadius: 6, background: b.draft ? "rgba(227,179,65,.09)" : !b.grounded ? "rgba(255,107,94,.08)" : "transparent" }}>
                <span style={{ color: b.grounded ? C.ok : C.hot, fontSize: 11, marginTop: 3 }}>{b.grounded ? "✓" : "⚠"}</span>
                {editing === i ? (
                  <div style={{ flex: 1, display: "flex", gap: 6 }}>
                    <input value={val} onChange={(e) => setVal(e.target.value)} autoFocus
                      style={{ flex: 1, background: C.panel2, border: `1px solid ${C.steel}`, color: C.ink, borderRadius: 6, padding: "4px 8px", fontSize: 12.5 }} />
                    <button onClick={() => { onEdit(b.text, val); setEditing(null); }} style={{ border: "none", background: C.steel, color: "#05222b", borderRadius: 6, padding: "0 12px", fontWeight: 700, cursor: "pointer" }}>Save</button>
                  </div>
                ) : (
                  <span onClick={() => { setEditing(i); setVal(b.text); }} title={b.source_ref || "click to edit"}
                    style={{ flex: 1, fontSize: 12.5, cursor: "text", lineHeight: 1.5 }}>
                    {b.text}
                    {b.draft ? <span style={{ color: C.warn, fontSize: 10, marginLeft: 6 }}>[auto-draft]</span> : null}
                    {b.source_ref ? <span style={{ ...mono, color: C.dim, fontSize: 10, marginLeft: 6 }}>· {b.source_ref.split(":").slice(0, 2).join(":")}</span> : null}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ReportStudio() {
  const [month, setMonth] = useState("2026-06");
  const [projects, setProjects] = useState<Record<string, any>>({});
  const [active, setActive] = useState<string | null>(null);
  const [composed, setComposed] = useState<any>(null);
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState("");
  const say = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); };

  const loadProjects = useCallback(() => {
    fetch(rb(`/projects?month=${month}`)).then((r) => r.json()).then((j) => setProjects(j.projects || {})).catch(() => {});
  }, [month]);
  useEffect(() => { loadProjects(); }, [loadProjects]);

  const onUpload = async (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      setBusy(`Ingesting ${f.name}…`);
      const fd = new FormData(); fd.append("file", f); fd.append("month", month);
      try {
        const r = await fetch(rb("/ingest"), { method: "POST", body: fd });
        const j = await r.json();
        const n = Object.values(j.added || {}).reduce((a: number, v: any) => a + v, 0);
        say(`${f.name}: ${n} atoms extracted${j.staging_rows?.length ? ` · ${j.staging_rows.length} S-curve rows staged` : ""}`);
      } catch { say(`${f.name}: ingest failed`); }
    }
    setBusy(""); loadProjects();
  };

  const addNote = async () => {
    if (!note.trim() || !active) { say("Pick a project and type a note"); return; }
    await jpost("/quick-note", { project: active, month, text: note, section: "status" });
    setNote(""); say("Note added"); loadProjects();
  };

  const compose = async (proj: string) => {
    setActive(proj); setBusy("Composing…");
    try { setComposed(await jpost("/compose", { project: proj, month })); }
    catch { say("compose failed"); }
    setBusy("");
  };

  const onEdit = async (section: string, before: string, after: string) => {
    if (!active) return;
    await jpost("/edit", { project: active, month, section_type: section, before_text: before, after_text: after, kind: "phrasing" });
    say("Edit saved & learned");
    compose(active);
  };

  const generate = async (family: string) => {
    if (!active) return;
    setBusy(`Generating ${family.toUpperCase()}…`);
    try {
      const j = await jpost("/generate", { project: active, project_name: active, month, month_label: month, family });
      window.open(`${API}${j.download}`, "_blank");
      say(`${j.file} ready`);
    } catch { say("generate failed"); }
    setBusy("");
  };

  const projEntries = Object.entries(projects);

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.ink, padding: "20px 24px 60px", fontFamily: "Archivo, Inter, system-ui" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>Report Studio</h1>
        <span style={{ color: C.dim, fontSize: 12.5 }}>ingest → compose → review with citations → generate</span>
        <span style={{ flex: 1 }} />
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
          style={{ background: C.panel2, border: `1px solid ${C.line}`, color: C.ink, borderRadius: 8, padding: "5px 10px", ...mono }} />
        {busy ? <span style={{ color: C.steel, fontSize: 12 }}>{busy}</span> : null}
        {toast ? <span style={{ background: C.soft, border: `1px solid ${C.line}`, borderRadius: 8, padding: "5px 12px", fontSize: 12, color: C.steel }}>{toast}</span> : null}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16, alignItems: "start" }}>
        {/* left: sources + projects */}
        <div style={{ display: "grid", gap: 14 }}>
          <div onDrop={(e) => { e.preventDefault(); onUpload(e.dataTransfer.files); }} onDragOver={(e) => e.preventDefault()}
            style={{ background: C.panel, border: `1px dashed ${C.line}`, borderRadius: 12, padding: 18, textAlign: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Drop sources here</div>
            <div style={{ fontSize: 11.5, color: C.dim, margin: "4px 0 10px" }}>WhatsApp .txt · DPR .xlsx · Record Notes .docx</div>
            <input ref={fileRef} type="file" multiple hidden suppressHydrationWarning onChange={(e) => onUpload(e.target.files)} />
            <button onClick={() => fileRef.current?.click()} style={{ border: "none", background: C.steel, color: "#05222b", borderRadius: 8, padding: "7px 16px", fontWeight: 800, cursor: "pointer" }}>Browse files</button>
          </div>

          <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 11, letterSpacing: 0.6, color: C.dim, textTransform: "uppercase", marginBottom: 8 }}>Quick note {active ? `→ ${active}` : ""}</div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Type any status/issue/action directly…" rows={2}
              style={{ width: "100%", background: C.panel2, border: `1px solid ${C.line}`, color: C.ink, borderRadius: 8, padding: 8, fontSize: 12.5, resize: "vertical", boxSizing: "border-box" }} />
            <button onClick={addNote} style={{ marginTop: 6, border: `1px solid ${C.line}`, background: "transparent", color: C.steel, borderRadius: 8, padding: "5px 12px", fontSize: 12, cursor: "pointer" }}>Add to store</button>
          </div>

          <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 11, letterSpacing: 0.6, color: C.dim, textTransform: "uppercase", marginBottom: 8 }}>Projects · {month}</div>
            {projEntries.length ? projEntries.map(([p, c]: [string, any]) => (
              <button key={p} onClick={() => compose(p)}
                style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 6, padding: "9px 11px", cursor: "pointer",
                  borderRadius: 8, border: `1px solid ${active === p ? C.steel : C.line}`, background: active === p ? C.soft : C.panel2, color: C.ink }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{p}</div>
                <div style={{ ...mono, fontSize: 10.5, color: C.dim, marginTop: 2 }}>
                  {c.status || 0} status · {c.issue || 0} issue · {c.action || 0} action · {c.manpower || 0} manpower
                </div>
              </button>
            )) : <div style={{ color: C.dim, fontSize: 12 }}>No atoms yet — ingest a source.</div>}
          </div>
        </div>

        {/* right: review + generate */}
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, minHeight: 400 }}>
          {!composed ? (
            <div style={{ color: C.dim, fontSize: 13, display: "grid", placeItems: "center", height: 360 }}>
              Ingest sources, then pick a project to compose its monthly sections.
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", borderBottom: `1px solid ${C.line}`, paddingBottom: 12 }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{composed.project}</div>
                <span style={{ ...mono, fontSize: 11.5, color: C.ok }}>
                  {composed.grounding.present_grounded}/{composed.grounding.present_total} grounded
                </span>
                {composed.commitments.missed > 0 ? <span style={{ ...mono, fontSize: 11.5, color: C.hot }}>{composed.commitments.missed} missed commitments → auto-issues</span> : null}
                {composed.commitments.met > 0 ? <span style={{ ...mono, fontSize: 11.5, color: C.ok }}>{composed.commitments.met} met</span> : null}
                {composed.commitments.open > 0 ? <span style={{ ...mono, fontSize: 11.5, color: C.warn }}>{composed.commitments.open} open</span> : null}
                <span style={{ flex: 1 }} />
                {["pmc", "do", "agenda", "capex"].map((fam) => (
                  <button key={fam} onClick={() => generate(fam)}
                    style={{ border: `1px solid ${C.line}`, background: fam === "pmc" ? C.steel : "transparent", color: fam === "pmc" ? "#05222b" : C.steel, borderRadius: 7, padding: "5px 12px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>
                    {fam.toUpperCase()}
                  </button>
                ))}
              </div>
              <SectionReview title="Present Status" bullets={composed.present_status} onEdit={(b, a) => onEdit("present_status", b, a)} />
              <SectionReview title="Issues" bullets={composed.issues} onEdit={(b, a) => onEdit("issues", b, a)} />
              <SectionReview title="Actions Taken" bullets={composed.actions} onEdit={(b, a) => onEdit("actions", b, a)} />
              {composed.manpower?.length ? (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 11, letterSpacing: 0.6, color: C.dim, textTransform: "uppercase", marginBottom: 6 }}>Manpower (avg) · {composed.manpower.length} categories</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {composed.manpower.slice(0, 12).map((m: any, i: number) => (
                      <span key={i} style={{ ...mono, fontSize: 11, background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 6, padding: "3px 8px" }}>{m.category}: {Math.round(m.average)}</span>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
