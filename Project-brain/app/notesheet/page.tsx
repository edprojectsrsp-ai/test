"use client";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FileText, Send, Lock, CheckCircle2, XCircle, ArrowLeftRight, Paperclip,
  Clock, AlertTriangle, User, Building2, ChevronRight, Plus, Search,
  Inbox, Archive, FileCheck2
} from "lucide-react";

const API = "http://localhost:8000";
const USER_ID = 1; // TODO: from auth

type Notesheet = {
  notesheet_id: number; notesheet_no: string; subject: string;
  category: string; priority: string; status: string;
  scheme_name: string; package_name: string;
  cost_implication_cr: number; time_implication_days: number;
  current_owner_id: number; current_owner_name: string;
  initiated_by_name: string; initiated_at: string; last_action_at: string;
  days_pending: number;
};

type Note = {
  note_id: number; note_no: number; note_text: string;
  author_id: number; author_name: string; author_designation: string;
  written_at: string; is_locked: boolean;
};

type TrackEvent = {
  track_id: number; seq_no: number; action: string;
  actor_name: string; from_user_name: string; to_user_name: string;
  remarks: string; occurred_at: string;
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-zinc-500/20 text-zinc-300 border-zinc-500/30",
  in_circulation: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  pending_approval: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  approved: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  rejected: "bg-red-500/20 text-red-300 border-red-500/30",
  returned: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  closed: "bg-zinc-600/20 text-zinc-400 border-zinc-600/30",
};

const PRIORITY_COLORS: Record<string, string> = {
  routine: "text-zinc-400",
  urgent: "text-amber-400",
  most_urgent: "text-orange-400",
  immediate: "text-red-400",
};

export default function NotesheetPage() {
  const [view, setView] = useState<"list" | "detail" | "create">("list");
  const [activeTab, setActiveTab] = useState<"inbox" | "outbox" | "trash" | "all">("inbox");
  const [notesheets, setNotesheets] = useState<Notesheet[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => { load(); }, [activeTab]);

  const load = async () => {
    if (activeTab === "inbox" || activeTab === "outbox" || activeTab === "trash") {
      const r = await fetch(`${API}/api/v1/notesheet/mailbox/${activeTab}?user_id=${USER_ID}`).then(r => r.json());
      setNotesheets(r.notesheets || []);
    } else {
      const r = await fetch(`${API}/api/v1/notesheet`).then(r => r.json());
      setNotesheets(r.notesheets || []);
    }
  };

  const trashItem = async (id: number) => {
    await fetch(`${API}/api/v1/notesheet/${id}/trash?user_id=${USER_ID}`, { method: "POST" });
    load();
  };
  const restoreItem = async (id: number) => {
    await fetch(`${API}/api/v1/notesheet/${id}/restore?user_id=${USER_ID}`, { method: "POST" });
    load();
  };

  const open = async (id: number) => {
    const r = await fetch(`${API}/api/v1/notesheet/${id}`).then(r => r.json());
    setSelected(r);
    setView("detail");
  };

  const search = async () => {
    if (!searchQuery.trim()) { load(); return; }
    const r = await fetch(`${API}/api/v1/notesheet/search/text?q=${encodeURIComponent(searchQuery)}`).then(r => r.json());
    setNotesheets(r.matches || []);
  };

  if (view === "create") return <CreateView onDone={() => { setView("list"); load(); }} onCancel={() => setView("list")} />;
  if (view === "detail" && selected) return <DetailView data={selected} onBack={() => { setView("list"); load(); }} />;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-7xl mx-auto">
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <FileText className="w-8 h-8 text-indigo-400" />
            <h1 className="text-3xl font-bold">e-NoteSheet</h1>
            <span className="px-2 py-0.5 text-xs font-mono rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              SPRINT 9A · DIGITAL FILE NOTING
            </span>
          </div>
          <p className="text-zinc-400">
            Paper file replacement. Every note, signature, decision tracked digitally. Notes are immutable.
          </p>
        </motion.div>

        <div className="flex items-center justify-between mb-4 gap-3">
          <div className="flex flex-wrap gap-2">
            <TabBtn active={activeTab === "inbox"} onClick={() => setActiveTab("inbox")} icon={<Inbox className="w-4 h-4" />}>
              Inbox
            </TabBtn>
            <TabBtn active={activeTab === "outbox"} onClick={() => setActiveTab("outbox")} icon={<FileCheck2 className="w-4 h-4" />}>
              Outbox
            </TabBtn>
            <TabBtn active={activeTab === "trash"} onClick={() => setActiveTab("trash")} icon={<Archive className="w-4 h-4" />}>
              Trash
            </TabBtn>
            <TabBtn active={activeTab === "all"} onClick={() => setActiveTab("all")} icon={<FileText className="w-4 h-4" />}>
              All Files
            </TabBtn>
          </div>
          <div className="flex gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-zinc-500" />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && search()}
                placeholder="Search subject/proposal..."
                className="pl-9 pr-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm w-64"
              />
            </div>
            <button onClick={() => setView("create")} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium">
              <Plus className="w-4 h-4" />New File
            </button>
          </div>
        </div>

        <div className="space-y-2">
          {notesheets.length === 0 && (
            <div className="text-center py-16 text-zinc-500">
              <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
              No notesheets in this view.
            </div>
          )}
          {notesheets.map(ns => (
            <motion.div key={ns.notesheet_id} layout
              initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
              onClick={() => open(ns.notesheet_id)}
              className="bg-zinc-900/50 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-xl p-4 cursor-pointer transition">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="font-mono text-xs text-zinc-500">{ns.notesheet_no}</span>
                    <span className={`px-2 py-0.5 text-xs rounded border ${STATUS_COLORS[ns.status]}`}>{ns.status.replace('_', ' ')}</span>
                    {ns.priority !== "routine" && (
                      <span className={`text-xs font-semibold uppercase ${PRIORITY_COLORS[ns.priority]}`}>
                        {ns.priority.replace('_', ' ')}
                      </span>
                    )}
                  </div>
                  <h3 className="font-semibold text-zinc-100 mb-1 truncate">{ns.subject}</h3>
                  <div className="flex flex-wrap gap-3 text-xs text-zinc-400">
                    {ns.scheme_name && (
                      <span className="flex items-center gap-1">
                        <Building2 className="w-3 h-3" />{ns.scheme_name}{ns.package_name ? ` / ${ns.package_name}` : ""}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <User className="w-3 h-3" />from {ns.initiated_by_name}
                    </span>
                    {ns.current_owner_name && (
                      <span className="flex items-center gap-1">
                        <ArrowLeftRight className="w-3 h-3" />with {ns.current_owner_name}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />{ns.days_pending}d pending
                    </span>
                    {ns.cost_implication_cr != null && (
                      <span className="text-amber-400">₹{Number(ns.cost_implication_cr).toFixed(2)} Cr</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
                  {activeTab === "trash" ? (
                    <button
                      type="button"
                      onClick={() => restoreItem(ns.notesheet_id)}
                      className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/20"
                    >
                      Restore
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => trashItem(ns.notesheet_id)}
                      className="rounded-lg border border-zinc-700 px-2.5 py-1 text-[11px] font-semibold text-zinc-400 hover:border-red-500/40 hover:text-red-300"
                    >
                      Trash
                    </button>
                  )}
                  <ChevronRight className="w-5 h-5 text-zinc-600" />
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children, icon }: any) {
  return (
    <button onClick={onClick} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition
      ${active ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40"
               : "bg-zinc-900 text-zinc-400 border border-zinc-800 hover:border-zinc-700"}`}>
      {icon}{children}
    </button>
  );
}

// ============================================================================
// DETAIL VIEW — full file with notes timeline + action panel
// ============================================================================
function DetailView({ data, onBack }: any) {
  const ns = data.notesheet;
  const [newNote, setNewNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submitNote = async () => {
    if (!newNote.trim()) return;
    setSubmitting(true);
    await fetch(`${API}/api/v1/notesheet/${ns.notesheet_id}/note`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note_text: newNote, author_id: USER_ID }),
    });
    setNewNote("");
    setSubmitting(false);
    onBack();
  };

  const action = async (path: string, body: any = {}) => {
    await fetch(`${API}/api/v1/notesheet/${ns.notesheet_id}/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, actor_id: USER_ID }),
    });
    onBack();
  };

  const canAct = ns.current_owner_id === USER_ID && ["in_circulation", "pending_approval", "draft"].includes(ns.status);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-5xl mx-auto">
        <button onClick={onBack} className="text-zinc-400 hover:text-zinc-200 mb-4 flex items-center gap-1 text-sm">
          ← Back to list
        </button>

        {/* Header */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-4">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="font-mono text-sm text-zinc-500">{ns.notesheet_no}</span>
                <span className={`px-2 py-0.5 text-xs rounded border ${STATUS_COLORS[ns.status]}`}>{ns.status.replace('_', ' ')}</span>
                {ns.priority !== "routine" && (
                  <span className={`text-xs font-semibold uppercase ${PRIORITY_COLORS[ns.priority]}`}>
                    {ns.priority.replace('_', ' ')}
                  </span>
                )}
              </div>
              <h2 className="text-2xl font-bold mb-2">{ns.subject}</h2>
              <div className="flex flex-wrap gap-4 text-sm text-zinc-400">
                <span>Category: <strong className="text-zinc-200">{ns.category}</strong></span>
                {ns.scheme_name && <span>Scheme: <strong className="text-zinc-200">{ns.scheme_name}</strong></span>}
                {ns.workflow_name && <span>Workflow: <strong className="text-zinc-200">{ns.workflow_name}</strong></span>}
                {ns.cost_implication_cr != null && <span>Cost: <strong className="text-amber-400">₹{Number(ns.cost_implication_cr).toFixed(2)} Cr</strong></span>}
              </div>
            </div>
          </div>

          {ns.background && <Section title="Background">{ns.background}</Section>}
          <Section title="Proposal">{ns.proposal}</Section>
          {ns.justification && <Section title="Justification">{ns.justification}</Section>}
        </div>

        {/* Notes timeline */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-4">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-400" />
            Notes ({data.notes.length})
          </h3>
          <div className="space-y-3">
            {data.notes.map((n: Note) => (
              <div key={n.note_id} className="bg-zinc-950/50 border border-zinc-800 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2 text-xs">
                  <span className="font-mono text-zinc-500">Note #{n.note_no}</span>
                  <span className="text-zinc-300 font-medium">{n.author_name}</span>
                  {n.author_designation && <span className="text-zinc-500">{n.author_designation}</span>}
                  <span className="text-zinc-600 ml-auto">{new Date(n.written_at).toLocaleString()}</span>
                  {n.is_locked && <Lock className="w-3 h-3 text-emerald-400" />}
                </div>
                <p className="text-sm text-zinc-200 whitespace-pre-wrap">{n.note_text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Track / movement */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 mb-4">
          <h3 className="text-lg font-semibold mb-4">Movement Track</h3>
          <div className="space-y-2">
            {data.track.map((t: TrackEvent) => (
              <div key={t.track_id} className="flex items-start gap-3 text-sm">
                <span className="font-mono text-xs text-zinc-500 mt-0.5 w-8">#{t.seq_no}</span>
                <div className="flex-1">
                  <span className="text-zinc-300">{t.actor_name}</span>
                  <span className="text-zinc-500"> · {t.action}</span>
                  {t.to_user_name && <span className="text-zinc-500"> → {t.to_user_name}</span>}
                  {t.remarks && <p className="text-xs text-zinc-400 mt-0.5">{t.remarks}</p>}
                </div>
                <span className="text-xs text-zinc-600">{new Date(t.occurred_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Action panel */}
        {canAct && (
          <div className="bg-zinc-900/50 border border-indigo-500/30 rounded-xl p-6">
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Send className="w-5 h-5 text-indigo-400" />
              Your Action
            </h3>
            <textarea
              value={newNote}
              onChange={e => setNewNote(e.target.value)}
              placeholder="Add your note before taking action..."
              rows={3}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm resize-none mb-3"
            />
            <div className="flex flex-wrap gap-2">
              <button onClick={submitNote} disabled={submitting || !newNote.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 rounded-lg text-sm">
                <FileText className="w-4 h-4" />Add Note Only
              </button>
              <button onClick={() => action("approve", { remarks: newNote })}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm font-medium">
                <CheckCircle2 className="w-4 h-4" />Approve
              </button>
              <button onClick={() => action("reject", { remarks: newNote })}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-medium">
                <XCircle className="w-4 h-4" />Reject
              </button>
              <button onClick={() => action("return", { remarks: newNote })}
                className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-500 rounded-lg text-sm font-medium">
                <ArrowLeftRight className="w-4 h-4" />Return for Clarification
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: any) {
  return (
    <div className="mb-3">
      <h4 className="text-xs uppercase tracking-wider text-zinc-500 mb-1">{title}</h4>
      <p className="text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed">{children}</p>
    </div>
  );
}

// ============================================================================
// CREATE VIEW
// ============================================================================
function CreateView({ onDone, onCancel }: any) {
  const [form, setForm] = useState<any>({
    subject: "", category: "general", priority: "routine",
    proposal: "", background: "", justification: "",
    cost_implication_cr: "", scheme_id: "",
    workflow_template_id: "",
  });
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/v1/notesheet/workflows/templates`).then(r => r.json())
      .then(d => setWorkflows(d.templates || []));
  }, []);

  const submit = async () => {
    if (!form.subject || !form.proposal) { alert("Subject and Proposal required"); return; }
    setSubmitting(true);
    const body = {
      ...form,
      initiated_by: USER_ID,
      cost_implication_cr: form.cost_implication_cr ? parseFloat(form.cost_implication_cr) : null,
      scheme_id: form.scheme_id ? parseInt(form.scheme_id) : null,
      workflow_template_id: form.workflow_template_id ? parseInt(form.workflow_template_id) : null,
    };
    await fetch(`${API}/api/v1/notesheet`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSubmitting(false);
    onDone();
  };

  const field = (k: string, v: string) => setForm((f: any) => ({ ...f, [k]: v }));

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-3xl mx-auto">
        <button onClick={onCancel} className="text-zinc-400 hover:text-zinc-200 mb-4 text-sm">← Cancel</button>
        <h2 className="text-2xl font-bold mb-6">Initiate New File</h2>

        <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-6 space-y-4">
          <FormField label="Subject *">
            <input value={form.subject} onChange={e => field("subject", e.target.value)}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg" />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Category">
              <select value={form.category} onChange={e => field("category", e.target.value)}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg">
                <option value="general">General</option>
                <option value="sanction_request">Sanction Request</option>
                <option value="deviation_approval">Deviation Approval</option>
                <option value="eot_extension">EOT Extension</option>
                <option value="change_of_scope">Change of Scope</option>
                <option value="capex_request">CAPEX Request</option>
                <option value="tender_recommendation">Tender Recommendation</option>
                <option value="award_recommendation">Award Recommendation</option>
              </select>
            </FormField>
            <FormField label="Priority">
              <select value={form.priority} onChange={e => field("priority", e.target.value)}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg">
                <option value="routine">Routine</option>
                <option value="urgent">Urgent</option>
                <option value="most_urgent">Most Urgent</option>
                <option value="immediate">Immediate</option>
              </select>
            </FormField>
          </div>

          <FormField label="Workflow (optional)">
            <select value={form.workflow_template_id} onChange={e => field("workflow_template_id", e.target.value)}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg">
              <option value="">— No workflow (manual forward) —</option>
              {workflows.map(w => <option key={w.template_id} value={w.template_id}>{w.template_name}</option>)}
            </select>
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Scheme ID (optional)">
              <input value={form.scheme_id} onChange={e => field("scheme_id", e.target.value)}
                type="number" className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg" />
            </FormField>
            <FormField label="Cost Impact (₹ Cr)">
              <input value={form.cost_implication_cr} onChange={e => field("cost_implication_cr", e.target.value)}
                type="number" step="0.01" className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg" />
            </FormField>
          </div>

          <FormField label="Background">
            <textarea value={form.background} onChange={e => field("background", e.target.value)} rows={3}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg resize-none" />
          </FormField>

          <FormField label="Proposal *">
            <textarea value={form.proposal} onChange={e => field("proposal", e.target.value)} rows={4}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg resize-none" />
          </FormField>

          <FormField label="Justification">
            <textarea value={form.justification} onChange={e => field("justification", e.target.value)} rows={3}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg resize-none" />
          </FormField>

          <button onClick={submit} disabled={submitting}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg font-semibold">
            {submitting ? "Creating..." : "Initiate File"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FormField({ label, children }: any) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
