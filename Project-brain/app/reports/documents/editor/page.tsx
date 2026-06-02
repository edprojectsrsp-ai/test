"use client";

/**
 * Generic report document viewer / editor.
 * Loads any report doc by slug from the backend, renders as an A4 page,
 * allows in-place editing with a formatting toolbar + table column resize,
 * and can export to Word or PDF.
 *
 * Place at: app/reports/documents/editor/page.tsx
 * Backend:  /api/v1/report-docs/{slug}
 */

import { useEffect, useRef, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  Printer, Pencil, Save, X, Bold, Italic, Underline, List, ListOrdered,
  Undo, Redo, Heading, Table as TableIcon, RotateCcw, Download,
  Loader2, FileDown, ArrowLeft, AlignLeft, AlignCenter, AlignRight,
  Strikethrough, Minus,
} from "lucide-react";

const API = "http://localhost:8000/api/v1/report-docs";

type Mode = "view" | "edit";

function ReportDocEditorInner() {
  const searchParams = useSearchParams();
  const slug = searchParams?.get("slug") || "";

  const [mode, setMode] = useState<Mode>("view");
  const [title, setTitle] = useState("");
  const [html, setHtml] = useState("");
  const [savedHtml, setSavedHtml] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);

  // Load document
  useEffect(() => {
    if (!slug) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`${API}/${slug}`);
        if (r.ok) {
          const data = await r.json();
          if (alive) {
            setTitle(data.title || slug);
            setHtml(data.html || "");
            setSavedHtml(data.html || "");
            setUpdatedAt(data.updated_at || null);
          }
        } else {
          if (alive) setNotFound(true);
        }
      } catch {
        if (alive) setNotFound(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [slug]);

  // Push content into editor when entering edit mode
  useEffect(() => {
    if (mode === "edit" && editorRef.current) {
      editorRef.current.innerHTML = html;
      // Make tables resizable
      makeTablesResizable(editorRef.current);
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
      const r = await fetch(`${API}/${slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html: current, title }),
      });
      if (!r.ok) throw new Error(`Save failed (${r.status})`);
      const data = await r.json();
      setHtml(current);
      setSavedHtml(current);
      setUpdatedAt(data.updated_at || new Date().toISOString());
      setDirty(false);
      setMode("view");
    } catch (e: any) {
      alert(`Could not save: ${e.message}`);
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

  const handleInsertTable = () => {
    const rows = parseInt(prompt("Number of rows:", "3") || "0");
    const cols = parseInt(prompt("Number of columns:", "3") || "0");
    if (rows > 0 && cols > 0) {
      const colW = Math.floor(100 / cols);
      let t = '<table style="width:100%;border-collapse:collapse;table-layout:fixed;"><colgroup>';
      for (let c = 0; c < cols; c++) t += `<col style="width:${colW}%">`;
      t += "</colgroup><tbody>";
      for (let r = 0; r < rows; r++) {
        t += "<tr>";
        for (let c = 0; c < cols; c++)
          t += '<td style="border:1px solid #444;padding:4pt 5pt;"><p>&nbsp;</p></td>';
        t += "</tr>";
      }
      t += "</tbody></table><p></p>";
      exec("insertHTML", t);
      if (editorRef.current) makeTablesResizable(editorRef.current);
    }
  };

  const handleInsertHR = () => exec("insertHTML", "<hr style='border:none;border-top:1px solid #888;margin:10pt 0;'/><p></p>");

  if (loading) return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <Loader2 className="animate-spin text-gray-400" size={32} />
    </div>
  );

  if (notFound) return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center text-gray-500 gap-4">
      <p className="text-xl">Document not found: {slug}</p>
      <a href="/reports/documents"  className="text-cyan-600 underline">Back to documents</a>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-100">
      {/* ===== Top toolbar ===== */}
      <div className="no-print sticky top-0 z-30 bg-gray-900 text-white shadow-lg">
        <div className="max-w-[900px] mx-auto px-4 py-3 flex items-center gap-3 flex-wrap">
          <a href="/reports/documents"  className="p-2 rounded-lg hover:bg-gray-700 transition" title="Back">
            <ArrowLeft size={18} />
          </a>

          {mode === "edit" ? (
            <input
              type="text"
              value={title}
              onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
              className="text-lg font-semibold text-cyan-400 bg-transparent border-b border-cyan-700 outline-none flex-1 min-w-[200px]"
            />
          ) : (
            <h1 className="text-lg font-semibold text-cyan-400 flex-1 truncate">{title}</h1>
          )}

          {updatedAt && mode === "view" && (
            <span className="text-xs text-gray-400 hidden sm:inline">
              Last edited {new Date(updatedAt).toLocaleString()}
            </span>
          )}

          {mode === "view" ? (
            <>
              <button onClick={() => window.print()} className="toolbar-btn">
                <Printer size={16} /> Print
              </button>
              <a href={`${API}/${slug}/export?format=docx`} className="toolbar-btn" title="Download Word">
                <FileDown size={16} /> Word
              </a>
              <a href={`${API}/${slug}/export?format=pdf`} className="toolbar-btn" title="Download PDF">
                <Download size={16} /> PDF
              </a>
              <button onClick={() => setMode("edit")} className="toolbar-btn-primary">
                <Pencil size={16} /> Edit
              </button>
            </>
          ) : (
            <>
              <button onClick={handleCancel} className="toolbar-btn">
                <X size={16} /> Cancel
              </button>
              <button onClick={handleSave} disabled={saving} className="toolbar-btn-save">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {saving ? "Saving…" : "Save"}
              </button>
            </>
          )}
        </div>

        {/* ===== Formatting bar ===== */}
        {mode === "edit" && (
          <div className="border-t border-gray-700 bg-gray-800">
            <div className="max-w-[900px] mx-auto px-4 py-2 flex items-center gap-0.5 flex-wrap">
              <FmtBtn onClick={() => exec("bold")} tip="Bold"><Bold size={15} /></FmtBtn>
              <FmtBtn onClick={() => exec("italic")} tip="Italic"><Italic size={15} /></FmtBtn>
              <FmtBtn onClick={() => exec("underline")} tip="Underline"><Underline size={15} /></FmtBtn>
              <FmtBtn onClick={() => exec("strikethrough")} tip="Strikethrough"><Strikethrough size={15} /></FmtBtn>
              <Sep />
              <FmtBtn onClick={() => exec("formatBlock", "<h1>")} tip="Heading 1"><Heading size={15} /><span className="text-[9px]">1</span></FmtBtn>
              <FmtBtn onClick={() => exec("formatBlock", "<h2>")} tip="Heading 2"><Heading size={15} /><span className="text-[9px]">2</span></FmtBtn>
              <FmtBtn onClick={() => exec("formatBlock", "<h3>")} tip="Heading 3"><Heading size={15} /><span className="text-[9px]">3</span></FmtBtn>
              <FmtBtn onClick={() => exec("formatBlock", "<p>")} tip="Normal text">P</FmtBtn>
              <Sep />
              <FmtBtn onClick={() => exec("justifyLeft")} tip="Align left"><AlignLeft size={15} /></FmtBtn>
              <FmtBtn onClick={() => exec("justifyCenter")} tip="Align center"><AlignCenter size={15} /></FmtBtn>
              <FmtBtn onClick={() => exec("justifyRight")} tip="Align right"><AlignRight size={15} /></FmtBtn>
              <Sep />
              <FmtBtn onClick={() => exec("insertUnorderedList")} tip="Bullet list"><List size={15} /></FmtBtn>
              <FmtBtn onClick={() => exec("insertOrderedList")} tip="Numbered list"><ListOrdered size={15} /></FmtBtn>
              <FmtBtn onClick={handleInsertTable} tip="Insert table"><TableIcon size={15} /></FmtBtn>
              <FmtBtn onClick={handleInsertHR} tip="Horizontal rule"><Minus size={15} /></FmtBtn>
              <Sep />
              <FmtBtn onClick={() => exec("undo")} tip="Undo"><Undo size={15} /></FmtBtn>
              <FmtBtn onClick={() => exec("redo")} tip="Redo"><Redo size={15} /></FmtBtn>
              <span className="ml-auto text-xs text-gray-400">
                {dirty ? "● Unsaved" : "✓ Saved"}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ===== A4 Document page ===== */}
      <div className="py-8 px-4 flex justify-center">
        {mode === "view" ? (
          <div className="doc-page bg-white shadow-xl" dangerouslySetInnerHTML={{ __html: html }} />
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
        /* A4 page container */
        .doc-page {
          width: 210mm; min-height: 297mm;
          padding: 18mm 16mm; box-sizing: border-box;
          font-family: "Times New Roman", Georgia, serif;
          font-size: 10.5pt; line-height: 1.45; color: #111;
          overflow-x: hidden;
        }
        .doc-editable:focus { outline: 2px solid #06b6d4; outline-offset: 4px; }

        /* Text */
        .doc-page p { margin: 0 0 5pt; }
        .doc-page strong { font-weight: 700; }
        .doc-page h1 { font-size: 16pt; font-weight: 700; margin: 12pt 0 8pt; }
        .doc-page h2 { font-size: 14pt; font-weight: 700; margin: 10pt 0 6pt; }
        .doc-page h3 { font-size: 12pt; font-weight: 700; margin: 8pt 0 4pt; }
        .doc-page ul, .doc-page ol { margin: 4pt 0 8pt 16pt; }
        .doc-page hr { border: none; border-top: 1px solid #888; margin: 10pt 0; }

        /* Tables — fit A4, allow text wrap, proportional columns */
        .doc-page table {
          border-collapse: collapse; width: 100%; max-width: 100%;
          table-layout: fixed; margin: 8pt 0 12pt; font-size: 9pt;
        }
        .doc-page th, .doc-page td {
          border: 1px solid #555; padding: 3pt 5pt;
          vertical-align: top; text-align: left;
          word-wrap: break-word; overflow-wrap: break-word; hyphens: auto;
        }
        .doc-page th { background: #e8e8e8; font-weight: 700; }
        /* Default column widths for 3-col tables (SI/Name/Status) */
        .doc-page td:first-child, .doc-page th:first-child { width: 6%; }

        /* Column resize handle (edit mode only) */
        .col-resize-handle {
          position: absolute; top: 0; right: -3px; width: 6px; height: 100%;
          cursor: col-resize; background: transparent; z-index: 10;
        }
        .col-resize-handle:hover, .col-resize-handle.active { background: #06b6d4; }

        /* Toolbar buttons */
        .toolbar-btn {
          display: flex; align-items: center; gap: 6px;
          padding: 8px 14px; border-radius: 8px;
          background: #374151; color: #fff; font-size: 13px;
          transition: background 0.15s;
          text-decoration: none;
        }
        .toolbar-btn:hover { background: #4b5563; }
        .toolbar-btn-primary {
          display: flex; align-items: center; gap: 6px;
          padding: 8px 16px; border-radius: 8px;
          background: #0891b2; color: #fff; font-weight: 600; font-size: 13px;
          transition: background 0.15s;
        }
        .toolbar-btn-primary:hover { background: #06b6d4; }
        .toolbar-btn-save {
          display: flex; align-items: center; gap: 6px;
          padding: 8px 16px; border-radius: 8px;
          background: #059669; color: #fff; font-weight: 600; font-size: 13px;
          transition: background 0.15s;
        }
        .toolbar-btn-save:hover { background: #10b981; }
        .toolbar-btn-save:disabled { opacity: 0.5; }

        /* Print */
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
          .doc-page {
            box-shadow: none !important; width: auto;
            min-height: auto; padding: 0; margin: 0;
          }
          @page { size: A4; margin: 15mm; }
        }
      `}</style>
    </div>
  );
}



export default function ReportDocEditorPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-100 flex items-center justify-center"><Loader2 className="animate-spin text-gray-400" size={32} /></div>}>
      <ReportDocEditorInner />
    </Suspense>
  );
}


/* ─── Toolbar sub-components ─── */
function FmtBtn({ children, onClick, tip }: { children: React.ReactNode; onClick: () => void; tip: string }) {
  return (
    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick} title={tip}
      className="p-1.5 rounded hover:bg-gray-700 text-gray-200 transition flex items-center gap-0.5 text-xs">
      {children}
    </button>
  );
}
function Sep() { return <span className="w-px h-5 bg-gray-600 mx-1" />; }


/* ─── Table column resize logic ─── */
function makeTablesResizable(container: HTMLElement) {
  // Remove existing handles
  container.querySelectorAll(".col-resize-handle").forEach((h) => h.remove());

  container.querySelectorAll("table").forEach((table) => {
    let resizeCells = table.querySelectorAll("th, thead td");
    if (resizeCells.length === 0) {
      const firstRow = table.querySelector("tr");
      if (!firstRow) return;
      resizeCells = firstRow.querySelectorAll("td, th");
    }
    if (resizeCells.length === 0) return;

    // Ensure table has colgroup for width control
    let colgroup = table.querySelector("colgroup");
    if (!colgroup) {
      colgroup = document.createElement("colgroup");
      const cellCount = resizeCells.length;
      const w = Math.floor(100 / cellCount);
      for (let i = 0; i < cellCount; i++) {
        const col = document.createElement("col");
        col.style.width = `${w}%`;
        colgroup.appendChild(col);
      }
      table.insertBefore(colgroup, table.firstChild);
    }

    // Add resize handles to header cells
    resizeCells.forEach((cell, idx) => {
      if (idx === resizeCells.length - 1) return; // skip last column
      const el = cell as HTMLElement;
      el.style.position = "relative";

      const handle = document.createElement("div");
      handle.className = "col-resize-handle";
      handle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        handle.classList.add("active");
        const startX = e.clientX;
        const cols = colgroup!.querySelectorAll("col");
        const tableWidth = table.offsetWidth;
        const startW1 = (el.offsetWidth / tableWidth) * 100;
        const nextCell = resizeCells[idx + 1] as HTMLElement;
        const startW2 = (nextCell.offsetWidth / tableWidth) * 100;

        const onMove = (ev: MouseEvent) => {
          const dx = ((ev.clientX - startX) / tableWidth) * 100;
          const newW1 = Math.max(4, startW1 + dx);
          const newW2 = Math.max(4, startW2 - dx);
          if (cols[idx]) (cols[idx] as HTMLElement).style.width = `${newW1}%`;
          if (cols[idx + 1]) (cols[idx + 1] as HTMLElement).style.width = `${newW2}%`;
        };
        const onUp = () => {
          handle.classList.remove("active");
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });
      el.appendChild(handle);
    });

    table.style.tableLayout = "fixed";
  });
}
