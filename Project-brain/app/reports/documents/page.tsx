"use client";

/**
 * Report Documents — upload, list, and manage .docx report files.
 * Each document can be opened for view/edit/export.
 *
 * Place at: app/reports/documents/page.tsx
 * Backend:  /api/v1/report-docs/  (report_docs.py router)
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Upload, FileText, Trash2, Loader2, Plus, Clock, Download,
} from "lucide-react";

const API = "http://localhost:8000/api/v1/report-docs";

type ReportDoc = {
  note_id: number;
  title: string;
  slug: string;
  filename: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export default function ReportDocumentsPage() {
  const [docs, setDocs] = useState<ReportDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const router = useRouter();

  const fetchDocs = async () => {
    try {
      const r = await fetch(`${API}/list`);
      if (r.ok) setDocs(await r.json());
    } catch { /* empty */ }
    setLoading(false);
  };

  useEffect(() => { fetchDocs(); }, []);

  const handleUpload = async () => {
    if (!uploadFile) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", uploadFile);
      const title = uploadTitle.trim() || uploadFile.name.replace(/\.docx?$/i, "");
      const r = await fetch(`${API}/upload?title=${encodeURIComponent(title)}`, {
        method: "POST",
        body: form,
      });
      if (!r.ok) {
        const err = await r.json();
        alert(`Upload failed: ${err.detail || r.status}`);
      } else {
        setShowUpload(false);
        setUploadTitle("");
        setUploadFile(null);
        await fetchDocs();
      }
    } catch (e: any) {
      alert(`Upload error: ${e.message}`);
    }
    setUploading(false);
  };

  const handleDelete = async (slug: string, title: string) => {
    if (!confirm(`Delete "${title}"? This can be undone by an admin.`)) return;
    await fetch(`${API}/${slug}`, { method: "DELETE" });
    await fetchDocs();
  };

  const fmtDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

  return (
    <div className="p-8 neural-bg min-h-screen text-white">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-cyan-400">Report Documents</h1>
        <button
          onClick={() => setShowUpload(!showUpload)}
          className="flex items-center gap-2 px-5 py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 transition font-medium"
        >
          <Plus size={18} /> Upload .docx
        </button>
      </div>

      {/* Upload panel */}
      {showUpload && (
        <div className="glass-input p-6 rounded-2xl mb-8 max-w-lg">
          <h2 className="text-lg font-semibold mb-4 text-zinc-200">Upload Word Document</h2>
          <input
            type="text"
            placeholder="Report title (optional — defaults to filename)"
            value={uploadTitle}
            onChange={(e) => setUploadTitle(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 p-3 rounded-xl mb-3 outline-none text-white"
          />
          <label className="flex items-center gap-3 bg-zinc-900 border border-dashed border-zinc-600 p-6 rounded-xl cursor-pointer hover:border-cyan-500 transition">
            <Upload size={24} className="text-zinc-400" />
            <span className="text-zinc-400">
              {uploadFile ? uploadFile.name : "Choose a .docx file"}
            </span>
            <input
              type="file"
              accept=".docx,.doc"
              className="hidden"
              onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
            />
          </label>
          <button
            onClick={handleUpload}
            disabled={!uploadFile || uploading}
            className="mt-4 px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 transition font-medium disabled:opacity-40 flex items-center gap-2"
          >
            {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {uploading ? "Converting & saving…" : "Upload & Convert"}
          </button>
        </div>
      )}

      {/* Document list */}
      {loading ? (
        <div className="flex items-center gap-3 text-gray-400 mt-12">
          <Loader2 className="animate-spin" /> Loading documents…
        </div>
      ) : docs.length === 0 ? (
        <div className="text-center text-zinc-500 mt-16">
          <FileText size={48} className="mx-auto mb-4 opacity-40" />
          <p>No report documents yet. Upload a .docx file to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4 max-w-3xl">
          {docs.map((d) => (
            <div
              key={d.note_id}
              className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5 flex items-center gap-4 hover:border-cyan-700 transition group"
            >
              <FileText size={36} className="text-cyan-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-lg truncate">{d.title}</h3>
                <div className="flex items-center gap-4 text-xs text-zinc-400 mt-1">
                  {d.filename && <span>{d.filename}</span>}
                  <span className="flex items-center gap-1">
                    <Clock size={12} /> {fmtDate(d.updated_at)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 opacity-60 group-hover:opacity-100 transition">
                <button
                  onClick={() => router.push(`/reports/documents/editor?slug=${d.slug}`)}
                  className="px-4 py-2 rounded-lg bg-cyan-700 hover:bg-cyan-600 text-sm font-medium transition"
                >
                  Open
                </button>
                <a
                  href={`${API}/${d.slug}/export?format=docx`}
                  className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition"
                  title="Download as Word"
                >
                  <Download size={16} />
                </a>
                <button
                  onClick={() => handleDelete(d.slug, d.title)}
                  className="p-2 rounded-lg bg-zinc-800 hover:bg-red-900 transition text-red-400"
                  title="Delete"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
