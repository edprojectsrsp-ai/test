"use client";

/**
 * Package-N Status Report — view / print / edit-in-place.
 *
 * Modes:
 *   - VIEW  : faithful A4 print-styled rendering of the document (read-only).
 *   - EDIT  : the same content becomes editable in place (contentEditable),
 *             with a floating formatting toolbar. Save persists to backend.
 *
 * No external editor library — uses the browser's native rich-text editing
 * (document.execCommand) so it works with zero npm installs. Content is loaded
 * from the backend if a saved version exists, else falls back to the default
 * generated from the original Word file.
 *
 * Backend endpoints (see reports.py additions):
 *   GET  /api/v1/reports/doc/package-n        -> { html, updated_at } | 404
 *   PUT  /api/v1/reports/doc/package-n        body { html }  -> { ok, updated_at }
 *
 * Place at: app/reports/package-n/page.tsx
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Printer, Pencil, Save, X, Bold, Italic, Underline, List, ListOrdered,
  Undo, Redo, Heading, Table as TableIcon, RotateCcw, Download, Loader2,
} from "lucide-react";
import { PACKAGE_N_DEFAULT_HTML, PACKAGE_N_REPORT_TITLE } from "@/lib/package_n_report_content";

const API = "http://localhost:8002/api/v1/reports";
const DOC_KEY = "package-n";

type Mode = "view" | "edit";

export default function PackageNReportPage() {
  const [mode, setMode] = useState<Mode>("view");
  const [html, setHtml] = useState<string>(PACKAGE_N_DEFAULT_HTML);
  const [savedHtml, setSavedHtml] = useState<string>(PACKAGE_N_DEFAULT_HTML);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);

  // Load saved version (if any) on mount
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`${API}/doc/${DOC_KEY}`);
        if (r.ok) {
          const data = await r.json();
          if (alive && data.html) {
            setHtml(data.html);
            setSavedHtml(data.html);
            setUpdatedAt(data.updated_at || null);
          }
        }
      } catch {
        /* no saved version — use default */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // When entering edit mode, push current html into the editable div
  useEffect(() => {
    if (mode === "edit" && editorRef.current) {
      editorRef.current.innerHTML = html;
    }
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const exec = useCallback((cmd: string, value?: string) => {
    document.execCommand(cmd, false, value);
    editorRef.current?.focus();
    setDirty(true);
  }, []);

  const handleSave = async () => {
    const current = editorRef.current?.innerHTML ?? html;
    setSaving(true);
    try {
      const r = await fetch(`${API}/doc/${DOC_KEY}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html: current }),
      });
      if (!r.ok) throw new Error(`Save failed (${r.status})`);
      const data = await r.json();
      setHtml(current);
      setSavedHtml(current);
      setUpdatedAt(data.updated_at || new Date().toISOString());
      setDirty(false);
      setMode("view");
    } catch (e: any) {
      alert(`Could not save: ${e.message}. Your edits are still on screen — try again.`);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (dirty && !confirm("Discard your changes?")) return;
    setHtml(savedHtml);
    setDirty(false);
    setMode("view");
  };

  const handleResetToOriginal = () => {
    if (!confirm("Reset to the original document content? This clears your edits after saving.")) return;
    if (editorRef.current) editorRef.current.innerHTML = PACKAGE_N_DEFAULT_HTML;
    setDirty(true);
  };

  const handlePrint = () => window.print();

  const handleInsertTable = () => {
    const rows = parseInt(prompt("Rows?", "3") || "0", 10);
    const cols = parseInt(prompt("Columns?", "3") || "0", 10);
    if (rows > 0 && cols > 0) {
      let t = '<table class="rep-table"><tbody>';
      for (let r = 0; r < rows; r++) {
        t += "<tr>";
        for (let c = 0; c < cols; c++) t += "<td><p>&nbsp;</p></td>";
        t += "</tr>";
      }
      t += "</tbody></table><p></p>";
      exec("insertHTML", t);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      {/* ===== Toolbar (hidden when printing) ===== */}
      <div className="no-print sticky top-0 z-30 bg-gray-900 text-white shadow-lg">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3 flex-wrap">
          <h1 className="text-lg font-semibold text-cyan-400 mr-auto">
            {PACKAGE_N_REPORT_TITLE}
          </h1>

          {updatedAt && mode === "view" && (
            <span className="text-xs text-gray-400">
              Last edited {new Date(updatedAt).toLocaleString()}
            </span>
          )}

          {mode === "view" ? (
            <>
              <button
                onClick={handlePrint}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition"
              >
                <Printer size={16} /> Print
              </button>
              <button
                onClick={() => setMode("edit")}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 transition font-medium"
              >
                <Pencil size={16} /> Edit
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleResetToOriginal}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition text-sm"
                title="Reset to original Word content"
              >
                <RotateCcw size={15} /> Reset
              </button>
              <button
                onClick={handleCancel}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition"
              >
                <X size={16} /> Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 transition font-medium disabled:opacity-60"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {saving ? "Saving…" : "Save"}
              </button>
            </>
          )}
        </div>

        {/* ===== Formatting bar (edit mode only) ===== */}
        {mode === "edit" && (
          <div className="border-t border-gray-700 bg-gray-800">
            <div className="max-w-5xl mx-auto px-4 py-2 flex items-center gap-1 flex-wrap">
              <ToolBtn onClick={() => exec("bold")} title="Bold"><Bold size={16} /></ToolBtn>
              <ToolBtn onClick={() => exec("italic")} title="Italic"><Italic size={16} /></ToolBtn>
              <ToolBtn onClick={() => exec("underline")} title="Underline"><Underline size={16} /></ToolBtn>
              <Divider />
              <ToolBtn onClick={() => exec("formatBlock", "<h2>")} title="Heading"><Heading size={16} /></ToolBtn>
              <ToolBtn onClick={() => exec("insertUnorderedList")} title="Bullet list"><List size={16} /></ToolBtn>
              <ToolBtn onClick={() => exec("insertOrderedList")} title="Numbered list"><ListOrdered size={16} /></ToolBtn>
              <ToolBtn onClick={handleInsertTable} title="Insert table"><TableIcon size={16} /></ToolBtn>
              <Divider />
              <ToolBtn onClick={() => exec("undo")} title="Undo"><Undo size={16} /></ToolBtn>
              <ToolBtn onClick={() => exec("redo")} title="Redo"><Redo size={16} /></ToolBtn>
              <span className="ml-auto text-xs text-gray-400">
                {dirty ? "Unsaved changes" : "No changes yet"}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ===== Document (A4 page) ===== */}
      <div className="py-8 px-4 flex justify-center">
        {loading ? (
          <div className="flex items-center gap-3 text-gray-500 mt-20">
            <Loader2 className="animate-spin" /> Loading document…
          </div>
        ) : mode === "view" ? (
          <div
            className="doc-page bg-white shadow-xl"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <div
            ref={editorRef}
            className="doc-page doc-editable bg-white shadow-xl"
            contentEditable
            suppressContentEditableWarning
            onInput={() => setDirty(true)}
          />
        )}
      </div>

      {/* ===== Styles ===== */}
      <style jsx global>{`
        .doc-page {
          width: 210mm;
          min-height: 297mm;
          padding: 20mm 18mm;
          box-sizing: border-box;
          font-family: "Times New Roman", Georgia, serif;
          font-size: 11pt;
          line-height: 1.5;
          color: #111;
        }
        .doc-editable:focus { outline: 2px solid #06b6d4; outline-offset: 4px; }
        .doc-page p { margin: 0 0 6pt; }
        .doc-page strong { font-weight: 700; }
        .doc-page ul, .doc-page ol { margin: 4pt 0 8pt 18pt; }
        .doc-page table, .doc-page .rep-table {
          border-collapse: collapse;
          width: 100%;
          max-width: 100%;
          table-layout: fixed;
          margin: 8pt 0 14pt;
          font-size: 9pt;
        }
        .doc-page th, .doc-page td {
          border: 1px solid #444;
          padding: 4pt 5pt;
          vertical-align: top;
          text-align: left;
          word-wrap: break-word;
          overflow-wrap: break-word;
          hyphens: auto;
        }
        .doc-page th { background: #f0f0f0; font-weight: 700; }
        .doc-page thead tr { background: #e8e8e8; }
        .doc-page td:first-child { width: 6%; }
        .doc-page td:nth-child(2) { width: 38%; }
        .doc-page td:nth-child(3) { width: 56%; }

        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
          .doc-page {
            box-shadow: none !important;
            width: auto;
            min-height: auto;
            padding: 0;
            margin: 0;
          }
          @page { size: A4; margin: 16mm; }
        }
      `}</style>
    </div>
  );
}

function ToolBtn({
  children, onClick, title,
}: { children: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()} // keep selection
      onClick={onClick}
      title={title}
      className="p-2 rounded hover:bg-gray-700 text-gray-200 transition"
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="w-px h-5 bg-gray-600 mx-1" />;
}
