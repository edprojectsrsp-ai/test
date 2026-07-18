"use client";

/**
 * Appendix-2 Tab Component
 * Extracted from app/appendix-2/page.tsx for use inside the unified Plan Engine page.
 *
 * Props received from parent:
 *   - selectedSchemeId, selectedPackageId, packages
 *
 * Handles its own:
 *   - docs list, doc viewer, activity grid
 *   - create / approve / sync modals
 *   - revision workflow
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  Plus, Trash2, FileCheck2, Sparkles, GitBranch,
  Save, RefreshCw, BookTemplate, AlertCircle,
  ChevronDown, FileText, ArrowRight,
} from "lucide-react";

const API = "http://localhost:8002/api/v1";

// =============================================================================
//   TYPES
// =============================================================================
interface Scheme { scheme_id: number; scheme_name: string; scheme_type: string; current_status: string; }
interface PkgLite { package_id: number; package_no: number; package_name: string; is_scheme_mirror: boolean; }
interface Template {
  template_id: number;
  template_name: string;
  template_category: string;
  applicable_scheme_type: string;
  description: string;
  is_default_for_type: boolean;
  activity_count: number;
  total_weightage: number;
}
interface AppxDoc {
  appendix2_id: number;
  revision_no: number;
  revision_label: string;
  is_current: boolean;
  is_approved: boolean;
  document_no: string;
  document_date: string;
  fy_baseline: string;
  package_name?: string;
  template_name?: string;
  activity_count: number;
  total_scope_value_cr?: number;
}
interface AppxActivity {
  appendix2_activity_id: number;
  s_no: string;
  activity_name: string;
  uom: string;
  scope_qty: number;
  weightage: number;
  activity_start_date: string;
  activity_finish_date: string;
  category: string;
  is_milestone: boolean;
  notes: string;
  display_order: number;
}

// =============================================================================
//   PROPS
// =============================================================================
interface Appendix2TabProps {
  selectedSchemeId: number | null;
  selectedPackageId: number | null;
  packages: any[];
}

// =============================================================================
//   MAIN COMPONENT
// =============================================================================
export default function Appendix2Tab({ selectedSchemeId, selectedPackageId, packages }: Appendix2TabProps) {
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [docs, setDocs] = useState<AppxDoc[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null);
  const [docFull, setDocFull] = useState<any>(null);
  const [templates, setTemplates] = useState<Template[]>([]);

  const [showCreate, setShowCreate] = useState(false);
  const [showApprove, setShowApprove] = useState(false);
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err" | "info" } | null>(null);

  // ----------------------------------------------------------------
  //  Effects
  // ----------------------------------------------------------------
  // Load schemes for template lookup
  useEffect(() => {
    fetch(`${API}/schemes/all`)
      .then((r) => r.json())
      .then((d) => Array.isArray(d) && setSchemes(d));
  }, []);

  // When scheme changes → load docs
  useEffect(() => {
    if (!selectedSchemeId) {
      setDocs([]); setSelectedDocId(null); setDocFull(null);
      return;
    }
    fetch(`${API}/appendix2/scheme/${selectedSchemeId}`)
      .then((r) => r.json())
      .then((d) => {
        setDocs(d);
        const current = d.find((x: AppxDoc) => x.is_current);
        if (current) setSelectedDocId(current.appendix2_id);
        else setSelectedDocId(null);
      });
  }, [selectedSchemeId]);

  // When doc changes → load full
  useEffect(() => {
    if (!selectedDocId) { setDocFull(null); return; }
    loadDoc();
  }, [selectedDocId]);

  const loadDoc = () => {
    fetch(`${API}/appendix2/${selectedDocId}/full`)
      .then((r) => r.json())
      .then(setDocFull);
  };

  // Load templates when opening create modal
  useEffect(() => {
    if (!showCreate) return;
    const scheme = schemes.find((s) => s.scheme_id === selectedSchemeId);
    const url = scheme?.scheme_type
      ? `${API}/appendix2/templates?scheme_type=${scheme.scheme_type}`
      : `${API}/appendix2/templates`;
    fetch(url).then((r) => r.json()).then(setTemplates);
  }, [showCreate, selectedSchemeId]);

  // ----------------------------------------------------------------
  //  Helpers
  // ----------------------------------------------------------------
  const showToast = (msg: string, kind: "ok" | "err" | "info" = "ok") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3500);
  };

  const totalWeightage = useMemo(() => {
    if (!docFull?.activities) return 0;
    return docFull.activities.reduce((s: number, a: AppxActivity) => s + (Number(a.weightage) || 0), 0);
  }, [docFull]);

  const refreshDocs = async () => {
    const r = await fetch(`${API}/appendix2/scheme/${selectedSchemeId}`);
    setDocs(await r.json());
  };

  // ----------------------------------------------------------------
  //  Actions
  // ----------------------------------------------------------------
  const createDoc = async (payload: any) => {
    const r = await fetch(`${API}/appendix2/create`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (r.ok) {
      showToast(`${d.revision_label} created with ${d.activities_created} activities`);
      setShowCreate(false);
      await refreshDocs();
      setSelectedDocId(d.appendix2_id);
    } else {
      showToast(d.detail || "Create failed", "err");
    }
  };

  const addActivity = async () => {
    await fetch(`${API}/appendix2/${selectedDocId}/activities`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activity_name: "New Activity", uom: "Lot", weightage: 0 }),
    });
    loadDoc();
  };

  const updateActivity = async (aid: number, patch: any) => {
    await fetch(`${API}/appendix2/activities/${aid}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    loadDoc();
  };

  const deleteActivity = async (aid: number) => {
    if (!confirm("Delete this activity?")) return;
    await fetch(`${API}/appendix2/activities/${aid}`, { method: "DELETE" });
    loadDoc();
  };

  const approveDoc = async (payload: any) => {
    const r = await fetch(`${API}/appendix2/${selectedDocId}/approve`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (r.ok) {
      showToast("Document approved ✓");
      setShowApprove(false);
      loadDoc();
      refreshDocs();
    } else {
      showToast(d.detail || "Approval failed", "err");
    }
  };

  const syncToPlan = async () => {
    if (!confirm("Sync this approved Appendix-2 to Plan Engine? This creates a new draft plan with all activities.")) return;
    const r = await fetch(`${API}/appendix2/${selectedDocId}/sync-to-plan`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
    });
    const d = await r.json();
    if (r.ok) showToast(d.message);
    else showToast(d.detail || "Sync failed", "err");
  };

  const createRevision = async () => {
    const reason = prompt("Revision reason (required):");
    if (!reason) return;
    const start = docFull.header.scheduled_start_date;
    const finish = docFull.header.scheduled_finish_date;
    createDoc({
      scheme_id: selectedSchemeId,
      package_id: docFull.header.package_id,
      copy_from_revision_id: selectedDocId,
      revision_reason: reason,
      fy_baseline: docFull.header.fy_baseline,
      scheduled_start_date: start,
      scheduled_finish_date: finish,
    });
  };

  // ----------------------------------------------------------------
  //  Render
  // ----------------------------------------------------------------
  const isApproved = docFull?.header?.is_approved;

  return (
    <div>
      {/* TOAST */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-xl border font-medium ${
          toast.kind === "ok" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300" :
          toast.kind === "err" ? "bg-red-500/10 border-red-500/30 text-red-300" :
          "bg-cyan-500/10 border-cyan-500/30 text-cyan-300"
        }`}>{toast.msg}</div>
      )}

      {/* REVISION SELECTOR + CREATE ACTIONS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div>
          <label className="text-xs uppercase tracking-wider text-zinc-500 mb-1.5 block font-medium">
            Revision History
            {docs.length > 0 && <span className="ml-2 text-cyan-400">({docs.length} revision{docs.length !== 1 ? "s" : ""})</span>}
          </label>
          <select
            value={selectedDocId || ""}
            onChange={(e) => setSelectedDocId(parseInt(e.target.value) || null)}
            disabled={!docs.length}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm focus:border-cyan-500/50 outline-none disabled:opacity-50"
          >
            <option value="">— No documents —</option>
            {docs.map((d) => (
              <option key={d.appendix2_id} value={d.appendix2_id}>
                {d.revision_label} {d.is_approved ? "✓ Approved" : "— Draft"} {d.is_current ? "● Current" : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-end gap-2">
          <button
            onClick={() => setShowCreate(true)}
            disabled={!selectedSchemeId}
            className="flex-1 px-4 py-2.5 bg-cyan-600 hover:bg-cyan-500 rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Sparkles size={16} /> New Appendix-2
          </button>
          {docFull && (
            <button
              onClick={createRevision}
              className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-sm font-bold flex items-center gap-2"
              title="Create a new revision based on this document"
            >
              <GitBranch size={16} /> Rev
            </button>
          )}
        </div>
      </div>

      {/* Empty states */}
      {!selectedSchemeId && (
        <EmptyState icon={<FileText size={48} />} title="Select a scheme to begin" body="Choose any of your schemes from the dropdown above." />
      )}

      {selectedSchemeId && !docs.length && (
        <EmptyState
          icon={<BookTemplate size={48} />}
          title="No Appendix-2 yet for this scheme"
          body="Click 'New Appendix-2' to create one. We'll auto-fill activities from a smart template."
          action={<button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-cyan-600 rounded-lg text-sm font-bold">Create First Appendix-2</button>}
        />
      )}

      {/* DOC HEADER + ACTIONS */}
      {docFull && (
        <>
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-5 mb-4">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex gap-6 flex-wrap">
                <div>
                  <div className="text-xs uppercase text-zinc-500 font-medium">Document No</div>
                  <div className="font-bold text-white">{docFull.header.document_no || "—"}</div>
                  <div className="text-xs text-zinc-500">{docFull.header.revision_label}</div>
                </div>
                <div>
                  <div className="text-xs uppercase text-zinc-500 font-medium">Period</div>
                  <div className="font-bold text-white text-sm">
                    {docFull.header.scheduled_start_date || "—"} → {docFull.header.scheduled_finish_date || "—"}
                  </div>
                  <div className="text-xs text-zinc-500">{docFull.header.fy_baseline || "FY TBD"}</div>
                </div>
                {docFull.header.package_name && (
                  <div>
                    <div className="text-xs uppercase text-zinc-500 font-medium">Package</div>
                    <div className="font-bold text-white text-sm max-w-xs truncate">{docFull.header.package_name}</div>
                  </div>
                )}
                <div>
                  <div className="text-xs uppercase text-zinc-500 font-medium">Total Scope</div>
                  <div className="font-bold text-cyan-400">{docFull.header.total_scope_value_cr ? `₹${docFull.header.total_scope_value_cr} Cr` : "—"}</div>
                </div>
                <div>
                  <div className="text-xs uppercase text-zinc-500 font-medium">Activities</div>
                  <div className="font-bold text-white">{docFull.activities.length}</div>
                </div>
                <div>
                  <div className="text-xs uppercase text-zinc-500 font-medium">Weightage</div>
                  <div className={`font-bold ${Math.abs(totalWeightage - 100) < 0.01 ? "text-emerald-400" : "text-amber-400"}`}>
                    {totalWeightage.toFixed(2)}%
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {isApproved ? (
                  <>
                    <span className="px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-300 text-xs font-bold flex items-center gap-2">
                      <FileCheck2 size={14} /> APPROVED
                    </span>
                    {docFull.header.approved_by_name && (
                      <span className="text-xs text-zinc-500">by {docFull.header.approved_by_name}</span>
                    )}
                    <button
                      onClick={syncToPlan}
                      className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-xs flex items-center gap-2 font-bold"
                      title="Create a draft plan in Plan Engine from this Appendix-2"
                    >
                      <ArrowRight size={14} /> Sync to Plan Engine
                    </button>
                  </>
                ) : (
                  <>
                    <span className="px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-300 text-xs font-bold">
                      DRAFT
                    </span>
                    <button
                      onClick={() => setShowApprove(true)}
                      disabled={Math.abs(totalWeightage - 100) > 0.01}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-xs flex items-center gap-2 font-bold"
                      title={Math.abs(totalWeightage - 100) > 0.01 ? "Weightages must sum to 100%" : "Approve this document"}
                    >
                      <FileCheck2 size={14} /> Approve
                    </button>
                  </>
                )}
              </div>
            </div>

            {docFull.header.revision_reason && (
              <div className="mt-3 pt-3 border-t border-zinc-800 text-sm text-zinc-400">
                <span className="text-xs uppercase text-zinc-500 mr-2">Revision reason:</span>
                {docFull.header.revision_reason}
              </div>
            )}
          </div>

          {/* ACTIVITIES GRID */}
          <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead className="bg-zinc-900">
                  <tr>
                    <th className="text-left px-3 py-2.5 text-zinc-400 font-bold uppercase tracking-wider text-[10px] w-16">S.No</th>
                    <th className="text-left px-3 py-2.5 text-zinc-400 font-bold uppercase tracking-wider text-[10px]">Activity</th>
                    <th className="text-left px-3 py-2.5 text-zinc-400 font-bold uppercase tracking-wider text-[10px] w-24">Category</th>
                    <th className="text-left px-3 py-2.5 text-zinc-400 font-bold uppercase tracking-wider text-[10px] w-20">UOM</th>
                    <th className="text-right px-3 py-2.5 text-zinc-400 font-bold uppercase tracking-wider text-[10px] w-24">Scope Qty</th>
                    <th className="text-right px-3 py-2.5 text-zinc-400 font-bold uppercase tracking-wider text-[10px] w-20">Weightage %</th>
                    <th className="text-left px-3 py-2.5 text-zinc-400 font-bold uppercase tracking-wider text-[10px] w-32">Start</th>
                    <th className="text-left px-3 py-2.5 text-zinc-400 font-bold uppercase tracking-wider text-[10px] w-32">Finish</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {docFull.activities.map((a: AppxActivity) => (
                    <tr key={a.appendix2_activity_id} className="border-b border-zinc-800/50 hover:bg-zinc-900/30">
                      <td className="px-3 py-2">
                        <input
                          value={a.s_no || ""}
                          onChange={(e) => updateActivity(a.appendix2_activity_id, { s_no: e.target.value })}
                          disabled={isApproved}
                          className="bg-transparent text-zinc-300 outline-none w-full font-mono text-xs disabled:cursor-not-allowed"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={a.activity_name}
                          onChange={(e) => updateActivity(a.appendix2_activity_id, { activity_name: e.target.value })}
                          disabled={isApproved}
                          className="bg-transparent text-white outline-none w-full disabled:cursor-not-allowed"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={a.category || ""}
                          onChange={(e) => updateActivity(a.appendix2_activity_id, { category: e.target.value })}
                          disabled={isApproved}
                          className="bg-transparent text-zinc-300 outline-none w-full text-xs disabled:cursor-not-allowed"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={a.uom || ""}
                          onChange={(e) => updateActivity(a.appendix2_activity_id, { uom: e.target.value })}
                          disabled={isApproved}
                          className="bg-transparent text-zinc-300 outline-none w-full disabled:cursor-not-allowed"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          value={a.scope_qty || ""}
                          onChange={(e) => updateActivity(a.appendix2_activity_id, { scope_qty: parseFloat(e.target.value) || 0 })}
                          disabled={isApproved}
                          className="bg-transparent text-zinc-300 outline-none w-full text-right disabled:cursor-not-allowed"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          value={a.weightage}
                          step="0.01"
                          onChange={(e) => updateActivity(a.appendix2_activity_id, { weightage: parseFloat(e.target.value) || 0 })}
                          disabled={isApproved}
                          className="bg-transparent text-amber-400 outline-none w-full text-right font-bold disabled:cursor-not-allowed"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="date"
                          value={a.activity_start_date || ""}
                          onChange={(e) => updateActivity(a.appendix2_activity_id, { activity_start_date: e.target.value })}
                          disabled={isApproved}
                          className="bg-transparent text-zinc-300 outline-none w-full text-xs disabled:cursor-not-allowed"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="date"
                          value={a.activity_finish_date || ""}
                          onChange={(e) => updateActivity(a.appendix2_activity_id, { activity_finish_date: e.target.value })}
                          disabled={isApproved}
                          className="bg-transparent text-zinc-300 outline-none w-full text-xs disabled:cursor-not-allowed"
                        />
                      </td>
                      <td className="px-2 py-2">
                        {!isApproved && (
                          <button
                            onClick={() => deleteActivity(a.appendix2_activity_id)}
                            className="text-zinc-600 hover:text-red-400"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {/* Totals row */}
                  <tr className="bg-zinc-900 font-bold">
                    <td colSpan={5} className="px-3 py-2.5 text-zinc-300 text-right">TOTAL WEIGHTAGE</td>
                    <td className={`px-3 py-2.5 text-right ${Math.abs(totalWeightage - 100) < 0.01 ? "text-emerald-400" : "text-amber-400"}`}>
                      {totalWeightage.toFixed(2)}
                    </td>
                    <td colSpan={3}></td>
                  </tr>
                </tbody>
              </table>
            </div>

            {!isApproved && (
              <div className="p-3 border-t border-zinc-800">
                <button
                  onClick={addActivity}
                  className="w-full py-2 bg-zinc-800/50 hover:bg-zinc-800 border border-dashed border-zinc-700 hover:border-cyan-500/30 rounded-lg text-sm text-zinc-400 hover:text-cyan-400 flex items-center justify-center gap-2"
                >
                  <Plus size={14} /> Add Activity
                </button>
              </div>
            )}
          </div>

          {/* APPROVAL DETAILS (when approved) */}
          {isApproved && (
            <div className="mt-4 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <FileCheck2 size={18} className="text-emerald-400" />
                <span className="font-bold text-emerald-300">Approval Record</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <div className="text-xs text-zinc-500 uppercase">Approved By</div>
                  <div className="text-zinc-200">{docFull.header.approved_by_name}</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 uppercase">Approval Date</div>
                  <div className="text-zinc-200">{docFull.header.approval_date}</div>
                </div>
                <div>
                  <div className="text-xs text-zinc-500 uppercase">Board Meeting Reference</div>
                  <div className="text-zinc-200">{docFull.header.board_meeting_ref || "—"}</div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* CREATE MODAL */}
      {showCreate && (
        <CreateModal
          templates={templates}
          packages={packages}
          existingDocCount={docs.length}
          onClose={() => setShowCreate(false)}
          onCreate={(fields: any) => createDoc({ ...fields, scheme_id: selectedSchemeId })}
        />
      )}

      {/* APPROVE MODAL */}
      {showApprove && (
        <ApproveModal onClose={() => setShowApprove(false)} onApprove={approveDoc} />
      )}
    </div>
  );
}

// =============================================================================
//   SUB-COMPONENTS
// =============================================================================
function CreateModal({ templates, packages, existingDocCount, onClose, onCreate }: any) {
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(
    templates.find((t: Template) => t.is_default_for_type)?.template_id || null
  );
  const [fields, setFields] = useState({
    package_id: packages.find((p: PkgLite) => !p.is_scheme_mirror)?.package_id || packages[0]?.package_id || null,
    document_no: "",
    fy_baseline: "FY26-27",
    scheduled_start_date: "",
    scheduled_finish_date: "",
    total_scope_value_cr: "",
    prepared_by_name: "",
  });

  const handleSubmit = () => {
    onCreate({
      ...fields,
      template_id: selectedTemplateId,
      total_scope_value_cr: parseFloat(fields.total_scope_value_cr) || null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm overflow-auto py-8">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-3xl mx-4">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles size={22} className="text-cyan-400" />
          <h3 className="text-xl font-bold">
            {existingDocCount === 0 ? "Create Initial Appendix-2" : "Create New Revision"}
          </h3>
        </div>

        {/* Template Picker */}
        <div className="mb-5">
          <label className="text-xs uppercase tracking-wider text-zinc-500 mb-2 block font-medium">
            ✨ Auto-fill from Template (recommended)
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {templates.map((t: Template) => (
              <button
                key={t.template_id}
                onClick={() => setSelectedTemplateId(t.template_id)}
                className={`p-3 rounded-xl border text-left transition-all ${
                  selectedTemplateId === t.template_id
                    ? "bg-cyan-500/10 border-cyan-500/50 ring-1 ring-cyan-500/30"
                    : "bg-zinc-950 border-zinc-800 hover:border-zinc-700"
                }`}
              >
                <div className="flex justify-between items-start mb-1">
                  <div className="font-bold text-white text-sm">{t.template_name}</div>
                  {t.is_default_for_type && <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-400 text-[9px] font-bold rounded">DEFAULT</span>}
                </div>
                <div className="text-xs text-zinc-500 mb-1">{t.description}</div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-cyan-400">{t.activity_count} activities</span>
                  <span className="text-emerald-400">Wt = {t.total_weightage}</span>
                </div>
              </button>
            ))}
            <button
              onClick={() => setSelectedTemplateId(null)}
              className={`p-3 rounded-xl border text-left transition-all ${
                selectedTemplateId === null
                  ? "bg-zinc-700 border-zinc-600"
                  : "bg-zinc-950 border-zinc-800 hover:border-zinc-700"
              }`}
            >
              <div className="font-bold text-white text-sm">📝 Empty (no template)</div>
              <div className="text-xs text-zinc-500">Start with a blank document. Add activities manually.</div>
            </button>
          </div>
        </div>

        {/* Doc Fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
          {packages.length > 1 && (
            <div className="md:col-span-2">
              <label className="text-xs uppercase text-zinc-500 mb-1 block">Package</label>
              <select
                value={fields.package_id || ""}
                onChange={(e) => setFields({ ...fields, package_id: parseInt(e.target.value) || null })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm"
              >
                {packages.map((p: PkgLite) => (
                  <option key={p.package_id} value={p.package_id}>
                    #{p.package_no} {p.package_name.substring(0, 60)}{p.is_scheme_mirror ? " [mirror]" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
          <Input label="Document No" value={fields.document_no} onChange={(v: string) => setFields({ ...fields, document_no: v })} placeholder="APX2/SCH/YYYY" />
          <Input label="FY Baseline" value={fields.fy_baseline} onChange={(v: string) => setFields({ ...fields, fy_baseline: v })} placeholder="FY26-27" />
          <Input label="Scheduled Start" type="date" value={fields.scheduled_start_date} onChange={(v: string) => setFields({ ...fields, scheduled_start_date: v })} />
          <Input label="Scheduled Finish" type="date" value={fields.scheduled_finish_date} onChange={(v: string) => setFields({ ...fields, scheduled_finish_date: v })} />
          <Input label="Total Scope Value (Cr)" type="number" value={fields.total_scope_value_cr} onChange={(v: string) => setFields({ ...fields, total_scope_value_cr: v })} />
          <Input label="Prepared By" value={fields.prepared_by_name} onChange={(v: string) => setFields({ ...fields, prepared_by_name: v })} placeholder="GM (Coke)" />
        </div>

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={!fields.scheduled_start_date || !fields.scheduled_finish_date}
            className="flex-1 px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 rounded-lg text-sm font-bold flex items-center justify-center gap-2"
          >
            <Sparkles size={14} /> Create & Auto-Fill
          </button>
        </div>
      </div>
    </div>
  );
}

function ApproveModal({ onClose, onApprove }: any) {
  const [fields, setFields] = useState({
    approved_by_name: "",
    approval_date: new Date().toISOString().split("T")[0],
    board_meeting_ref: "",
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-md mx-4">
        <div className="flex items-center gap-2 mb-4">
          <FileCheck2 size={22} className="text-emerald-400" />
          <h3 className="text-xl font-bold">Approve Appendix-2</h3>
        </div>
        <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-300 flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>Once approved, activities can no longer be edited. To make changes, create a new revision.</span>
        </div>
        <div className="space-y-3">
          <Input label="Approved By" value={fields.approved_by_name} onChange={(v: string) => setFields({ ...fields, approved_by_name: v })} placeholder="CMD SAIL / Director (Operations)" />
          <Input label="Approval Date" type="date" value={fields.approval_date} onChange={(v: string) => setFields({ ...fields, approval_date: v })} />
          <Input label="Board Meeting Reference" value={fields.board_meeting_ref} onChange={(v: string) => setFields({ ...fields, board_meeting_ref: v })} placeholder="PCSB Meeting 142/2024" />
        </div>
        <div className="flex gap-2 mt-6">
          <button onClick={onClose} className="flex-1 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm">Cancel</button>
          <button
            onClick={() => onApprove(fields)}
            disabled={!fields.approved_by_name}
            className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg text-sm font-bold flex items-center justify-center gap-2"
          >
            <FileCheck2 size={14} /> Approve Document
          </button>
        </div>
      </div>
    </div>
  );
}

function Input({ label, value, onChange, type = "text", placeholder }: any) {
  return (
    <div>
      <label className="text-xs uppercase tracking-wider text-zinc-500 mb-1 block">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-cyan-500/50 outline-none"
      />
    </div>
  );
}

function EmptyState({ icon, title, body, action }: any) {
  return (
    <div className="text-center py-16 bg-zinc-900/20 border border-dashed border-zinc-800 rounded-2xl">
      <div className="text-zinc-700 mx-auto inline-block">{icon}</div>
      <h3 className="text-lg font-bold text-zinc-400 mt-4 mb-2">{title}</h3>
      <p className="text-sm text-zinc-500 mb-4 max-w-md mx-auto">{body}</p>
      {action}
    </div>
  );
}
