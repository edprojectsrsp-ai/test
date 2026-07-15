"use client";
import React, { useEffect, useMemo, useState } from "react";
import { ThemeToggle } from "@/theme/ThemeProvider";
import { Card, Select, Field, PageHeader, Button, Chip, Input, toast } from "@/ui";
import {
  getSchemes, getSchemeApprovals, addStageRevision, changeStage,
  STATUS_ORDER, STATUS_LABEL, Scheme, SchemeApprovals, StageKey, StageEntry,
} from "@/lib/furnace/api";

/* Each stage's named date/cost fields (matched to scheme.py columns). */
type FType = "date" | "cost" | "num" | "text";
interface FDef { key: string; label: string; type: FType }
const STAGE_DEFS: Record<StageKey, { status: string; label: string; fields: FDef[] }> = {
  formulation: { status: "under_formulation", label: "Formulation", fields: [
    { key: "consultant_name", label: "Consultant", type: "text" },
    { key: "consultant_acceptance_date", label: "Consultant acceptance", type: "date" },
    { key: "draft_fr_ts_date", label: "Draft FR/TS", type: "date" },
    { key: "final_fr_ts_ce_ec_date", label: "Final FR/TS (CE/EC)", type: "date" },
    { key: "pre_nit_meeting_date", label: "Pre-NIT meeting", type: "date" },
    { key: "plant_pag_meeting_date", label: "Plant PAG", type: "date" },
    { key: "dic_approval_date", label: "DIC approval", type: "date" },
    { key: "forwarded_to_corporate_date", label: "Forwarded to corporate", type: "date" },
    { key: "cost_gross_cr", label: "Gross cost (₹Cr)", type: "cost" },
  ] },
  stage1: { status: "under_stage1", label: "Stage-1", fields: [
    { key: "cod_date", label: "COD", type: "date" },
    { key: "independent_financial_appraisal_date", label: "IFA", type: "date" },
    { key: "corporate_pag_date", label: "Corporate PAG", type: "date" },
    { key: "chairman_approval_date", label: "Chairman approval", type: "date" },
    { key: "pcsb_date", label: "PCSB", type: "date" },
    { key: "sail_board_date", label: "SAIL Board", type: "date" },
    { key: "sanction_date", label: "Sanction", type: "date" },
    { key: "order_date", label: "Order", type: "date" },
    { key: "cost_gross_cr", label: "Gross cost (₹Cr)", type: "cost" },
    { key: "implementation_period_months", label: "Impl. period (mo)", type: "num" },
  ] },
  tendering: { status: "under_tendering", label: "Tendering", fields: [
    { key: "nit_number", label: "NIT number", type: "text" },
    { key: "pr_initiation_date", label: "PR initiation", type: "date" },
    { key: "pr_approval_date", label: "PR approval", type: "date" },
    { key: "nit_date", label: "NIT", type: "date" },
    { key: "pre_bid_date", label: "Pre-bid", type: "date" },
    { key: "tod_original_date", label: "TOD (original)", type: "date" },
    { key: "offers_received_count", label: "Offers received", type: "num" },
    { key: "estimated_value_cr", label: "Estimated (₹Cr)", type: "cost" },
    { key: "awarded_value_cr", label: "Awarded (₹Cr)", type: "cost" },
    { key: "cancellation_date", label: "Cancellation", type: "date" },
  ] },
  stage2: { status: "under_stage2", label: "Stage-2", fields: [
    { key: "draft_board_note_date", label: "Draft board note", type: "date" },
    { key: "proposal_to_co_date", label: "Proposal to CO", type: "date" },
    { key: "pag_date", label: "PAG", type: "date" },
    { key: "chairman_approval_date", label: "Chairman approval", type: "date" },
    { key: "pcsb_date", label: "PCSB", type: "date" },
    { key: "sail_board_date", label: "SAIL Board", type: "date" },
    { key: "empowered_committee_date", label: "Empowered committee", type: "date" },
    { key: "sanction_date", label: "Sanction", type: "date" },
    { key: "order_date", label: "Order", type: "date" },
    { key: "cod_date", label: "COD", type: "date" },
    { key: "firmed_up_cost_gross_cr", label: "Firmed-up gross (₹Cr)", type: "cost" },
    { key: "variance_vs_stage1_pct", label: "Variance vs S-1 (%)", type: "num" },
  ] },
};
const STAGE_KEYS: StageKey[] = ["formulation", "stage1", "tendering", "stage2"];
const fmtDate = (v: unknown) => v ? new Date(String(v)).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "—";

export default function ApprovalTimelinePage() {
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [schemeId, setSchemeId] = useState(0);
  const [data, setData] = useState<SchemeApprovals | null>(null);
  const [active, setActive] = useState<StageKey>("formulation");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [remarks, setRemarks] = useState("");

  useEffect(() => { getSchemes().then((s) => { setSchemes(s); if (s[0]) setSchemeId(s[0].scheme_id); }); }, []);
  const load = () => getSchemeApprovals(schemeId).then((d) => { setData(d); const cur = STAGE_KEYS.find((k) => STAGE_DEFS[k].status === d.current_status); setActive(cur ?? "formulation"); });
  useEffect(() => { if (schemeId) load(); }, [schemeId]);

  const curIdx = data ? STATUS_ORDER.indexOf(data.current_status) : 0;
  const def = STAGE_DEFS[active];
  const entries = data?.stages[active] ?? [];

  const saveEntry = async () => {
    const fields: Record<string, unknown> = {};
    def.fields.forEach((f) => { if (form[f.key]) fields[f.key] = f.type === "cost" || f.type === "num" ? parseFloat(form[f.key]) : form[f.key]; });
    const nextRev = entries.length;
    await addStageRevision(schemeId, active, { fields, remarks, revision_label: active === "tendering" ? `Cycle-${nextRev + 1}` : `R${nextRev}` });
    toast(`Added ${def.label} entry`); setAdding(false); setForm({}); setRemarks(""); load();
  };
  const advance = async (dir: 1 | -1) => {
    if (!data) return;
    const ni = Math.min(STATUS_ORDER.length - 1, Math.max(0, curIdx + dir));
    const ns = STATUS_ORDER[ni];
    if (ns === data.current_status) return;
    await changeStage(schemeId, ns, remarks || `Moved to ${STATUS_LABEL[ns]}`);
    toast(`Stage → ${STATUS_LABEL[ns]}`); load();
  };

  return (
    <div className="fz fz-app" style={{ padding: "22px 26px 70px" }}>
      <PageHeader title="Project Approval Timeline" subtitle="Formulation → Stage-1 → Tendering → Stage-2 → Execution · multi-revision, dated, with remarks"
        right={<>
          <Field label="Scheme"><Select value={schemeId} onChange={(v) => setSchemeId(+v)} options={schemes.map((s) => ({ value: s.scheme_id, label: s.scheme_name }))} style={{ minWidth: 240 }} /></Field>
          <ThemeToggle />
        </>} />

      {/* STEPPER */}
      <Card style={{ marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
          {STATUS_ORDER.map((st, i) => {
            const done = i < curIdx, cur = i === curIdx;
            const stageKey = STAGE_KEYS.find((k) => STAGE_DEFS[k].status === st);
            return (
              <React.Fragment key={st}>
                <button onClick={() => stageKey && setActive(stageKey)} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "8px 13px", borderRadius: 9, cursor: stageKey ? "pointer" : "default",
                  background: cur ? "var(--molten-soft)" : stageKey === active ? "var(--steel-soft)" : "transparent",
                  border: "1px solid " + (cur ? "var(--molten)" : stageKey === active ? "var(--steel-dim)" : "var(--line)"),
                }}>
                  <span style={{ width: 22, height: 22, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700,
                    background: done ? "var(--verdigris)" : cur ? "var(--molten)" : "var(--panel-3)", color: done || cur ? "#fff" : "var(--ink-3)" }}>
                    {done ? "✓" : i + 1}
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: cur ? "var(--molten)" : "var(--ink-2)" }}>{STATUS_LABEL[st]}</span>
                </button>
                {i < STATUS_ORDER.length - 1 && <div style={{ width: 18, height: 1, background: "var(--line-2)" }} />}
              </React.Fragment>
            );
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>Current stage:</span>
          <Chip tone="critical" dot>{data ? STATUS_LABEL[data.current_status] : "—"}</Chip>
          <div style={{ flex: 1 }} />
          <Input value={remarks} onChange={setRemarks} placeholder="Remark for stage change…" style={{ maxWidth: 260 }} />
          <Button onClick={() => advance(-1)} disabled={curIdx <= 0}>← Revert</Button>
          <Button kind="steel" onClick={() => advance(1)} disabled={curIdx >= STATUS_ORDER.length - 1}>Advance stage →</Button>
        </div>
      </Card>

      {/* STAGE DETAIL — multiple dated revisions */}
      <div className="fz-eyebrow">{def.label} entries <span className="tag">{entries.length} revision{entries.length === 1 ? "" : "s"} · each dated, with remarks</span></div>

      {entries.map((e: StageEntry) => (
        <Card key={e.id} style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <span className="fz-display" style={{ fontWeight: 700, fontSize: 15 }}>{e.revision_label}</span>
            {e.is_current && <Chip tone="ok" dot>Current</Chip>}
            {e.remarks && <span style={{ fontSize: 12, color: "var(--ink-3)", fontStyle: "italic" }}>“{e.remarks}”</span>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: "10px 18px" }}>
            {def.fields.filter((f) => e.fields[f.key] != null && e.fields[f.key] !== "").map((f) => (
              <div key={f.key}>
                <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--ink-4)" }}>{f.label}</div>
                <div className="fz-mono" style={{ fontSize: 13, color: "var(--ink)", marginTop: 2, fontWeight: 500 }}>
                  {f.type === "date" ? fmtDate(e.fields[f.key]) : f.type === "cost" ? `₹${Number(e.fields[f.key]).toLocaleString("en-IN")}` : String(e.fields[f.key])}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}

      {/* ADD ENTRY */}
      {adding ? (
        <Card>
          <div className="fz-display" style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>New {def.label} entry</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
            {def.fields.map((f) => (
              <Field key={f.key} label={f.label}>
                {f.type === "date"
                  ? <input type="date" value={form[f.key] ?? ""} onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))} style={{ background: "var(--panel)", border: "1px solid var(--line-2)", color: "var(--ink)", borderRadius: 9, padding: "8px 11px", font: "inherit", fontSize: 13, outline: "none", colorScheme: "light dark" }} />
                  : <Input value={form[f.key] ?? ""} onChange={(v) => setForm((s) => ({ ...s, [f.key]: v }))} mono={f.type === "cost" || f.type === "num"} placeholder={f.type === "cost" ? "₹Cr" : ""} />}
              </Field>
            ))}
            <Field label="Remarks" style={{ gridColumn: "1 / -1" }}><Input value={remarks} onChange={setRemarks} placeholder="e.g. Cost revised after scope addition" /></Field>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <Button kind="steel" onClick={saveEntry}>Save entry</Button>
            <Button kind="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </Card>
      ) : (
        <button onClick={() => { setAdding(true); setForm({}); setRemarks(""); }} style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "transparent", border: "1px dashed var(--line-2)", color: "var(--ink-3)", borderRadius: 9, padding: "10px 16px", font: "600 12.5px Inter", cursor: "pointer" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          Add {def.label} entry (new date / revision)
        </button>
      )}
    </div>
  );
}
