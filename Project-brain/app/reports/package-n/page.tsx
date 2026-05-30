"use client";

import React, { useEffect, useRef, useState } from "react";

type Mode = "view" | "edit";


const DOCX_URL = "/New Package-N 29.05.2026-F.docx";
const STORAGE_KEY = "project-brain-package-n-report-html";

export default function PackageNReportPage() {
  const [mode, setMode] = useState<Mode>("view");
  const [html, setHtml] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [dirty, setDirty] = useState<boolean>(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [docxViewAvailable, setDocxViewAvailable] = useState<boolean>(false);

  const docxViewRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);

  // Load saved editable HTML from browser storage, if available.
  useEffect(() => {
    try {
      const savedHtml = localStorage.getItem(STORAGE_KEY);
      const savedAt = localStorage.getItem(`${STORAGE_KEY}-updatedAt`);

      if (savedHtml) {
        setHtml(savedHtml);
        setUpdatedAt(savedAt);
      }
    } catch (error) {
      console.error("Unable to read saved Package-N report:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Render DOCX in view mode for closest Word-like print preview.
  useEffect(() => {
    if (mode !== "view") return;

    let cancelled = false;

    async function renderDocx() {
      const container = docxViewRef.current;
      if (!container) return;

      try {
        container.innerHTML = "";

        const response = await fetch(DOCX_URL);
        if (!response.ok) {
          setDocxViewAvailable(false);
          return;
        }

        const blob = await response.blob();
        const { renderAsync } = await import("docx-preview");

        if (cancelled) return;

        await renderAsync(blob, container, undefined, {
          className: "docx",
          inWrapper: false,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: true,
          ignoreLastRenderedPageBreak: false,
          experimental: true,
        });

        setDocxViewAvailable(true);
      } catch (error) {
        console.error("DOCX preview failed. Falling back to saved HTML.", error);
        setDocxViewAvailable(false);
      }
    }

    renderDocx();

    return () => {
      cancelled = true;
    };
  }, [mode]);

  // Keep editor synced when entering edit mode.
  useEffect(() => {
    if (mode === "edit" && editorRef.current) {
      editorRef.current.innerHTML = html || getFallbackEditableHtml();
    }
  }, [mode, html]);

  function getFallbackEditableHtml() {
    return `
      <h2 style="text-align:center;">RSP PROJECTS STATUS</h2>
      <p style="text-align:center;"><strong>Package-N Report</strong></p>
      <p>
        Editable report content will appear here after saving. For best Word-like view,
        keep the original file at <strong>public/New Package-N 29.05.2026-F.docx</strong>.
      </p>
    `;
  }

  function handleEdit() {
    setMode("edit");
  }

  function handleView() {
    if (editorRef.current) {
      const currentHtml = editorRef.current.innerHTML;
      setHtml(currentHtml);
    }
    setMode("view");
  }

  function handleSave() {
    try {
      setSaving(true);

      const currentHtml = editorRef.current?.innerHTML || html;
      const now = new Date().toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      });

      localStorage.setItem(STORAGE_KEY, currentHtml);
      localStorage.setItem(`${STORAGE_KEY}-updatedAt`, now);

      setHtml(currentHtml);
      setUpdatedAt(now);
      setDirty(false);
    } catch (error) {
      console.error("Unable to save Package-N report:", error);
      alert("Unable to save report in browser storage.");
    } finally {
      setSaving(false);
    }
  }

  function handlePrint() {
    if (mode === "edit" && editorRef.current) {
      const currentHtml = editorRef.current.innerHTML;
      setHtml(currentHtml);
      localStorage.setItem(STORAGE_KEY, currentHtml);
    }

    setTimeout(() => {
      window.print();
    }, 100);
  }

  function handleResetEditableCopy() {
    const confirmReset = window.confirm(
      "This will remove the saved editable copy from this browser. Continue?"
    );

    if (!confirmReset) return;

    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(`${STORAGE_KEY}-updatedAt`);
    setHtml("");
    setUpdatedAt(null);
    setDirty(false);

    if (editorRef.current) {
      editorRef.current.innerHTML = getFallbackEditableHtml();
    }
  }

  return (
    <div className="report-shell">
      {/* Toolbar */}
      <div className="report-toolbar no-print">
        <div>
          <div className="report-title">Package-N Report</div>
          <div className="report-subtitle">
            {mode === "view"
              ? "Print preview mode"
              : dirty
              ? "Editing — unsaved changes"
              : "Editing mode"}
            {updatedAt ? ` • Last saved: ${updatedAt}` : ""}
          </div>
        </div>

        <div className="report-actions">
          {mode === "edit" ? (
            <>
              <button className="btn btn-secondary" onClick={handleView}>
                Print View
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={handleEdit}>
              Edit
            </button>
          )}

          <button className="btn btn-secondary" onClick={handlePrint}>
            Print
          </button>

          <button className="btn btn-danger" onClick={handleResetEditableCopy}>
            Reset Edit Copy
          </button>
        </div>
      </div>

      {/* Document Area */}
      <div className="doc-stage">
        {loading ? (
          <div className="loading-card">Loading report...</div>
        ) : mode === "view" ? (
          <div className="doc-page-wrap">
            <div ref={docxViewRef} className="doc-page doc-view" />

            {!docxViewAvailable && (
              <div
                className="doc-page doc-html-fallback"
                dangerouslySetInnerHTML={{
                  __html: html || getFallbackEditableHtml(),
                }}
              />
            )}
          </div>
        ) : (
          <div className="doc-page-wrap">
            <div
              ref={editorRef}
              className="doc-page doc-editable"
              contentEditable
              suppressContentEditableWarning
              onInput={() => setDirty(true)}
            />
          </div>
        )}
      </div>

      <style jsx global>{`
        :root {
          --a4-width: 210mm;
          --a4-height: 297mm;
          --doc-font: Calibri, Arial, Helvetica, sans-serif;
        }

        .report-shell {
          min-height: 100vh;
          background:
            radial-gradient(circle at top left, rgba(59, 130, 246, 0.08), transparent 32%),
            linear-gradient(135deg, #eef2f7 0%, #f8fafc 100%);
          padding: 22px;
        }

        .report-toolbar {
          position: sticky;
          top: 12px;
          z-index: 50;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          max-width: 1180px;
          margin: 0 auto 20px auto;
          padding: 12px 14px;
          background: rgba(255, 255, 255, 0.92);
          border: 1px solid rgba(226, 232, 240, 0.95);
          border-radius: 16px;
          box-shadow: 0 12px 32px rgba(15, 23, 42, 0.10);
          backdrop-filter: blur(12px);
        }

        .report-title {
          font-size: 16px;
          font-weight: 700;
          color: #0f172a;
          letter-spacing: -0.01em;
        }

        .report-subtitle {
          margin-top: 2px;
          font-size: 12px;
          color: #64748b;
        }

        .report-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          justify-content: flex-end;
        }

        .btn {
          border: none;
          outline: none;
          border-radius: 10px;
          padding: 8px 13px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition:
            transform 0.12s ease,
            box-shadow 0.12s ease,
            background 0.12s ease;
        }

        .btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 8px 18px rgba(15, 23, 42, 0.13);
        }

        .btn:disabled {
          opacity: 0.65;
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
        }

        .btn-primary {
          background: #2563eb;
          color: white;
        }

        .btn-primary:hover {
          background: #1d4ed8;
        }

        .btn-secondary {
          background: #e2e8f0;
          color: #0f172a;
        }

        .btn-secondary:hover {
          background: #cbd5e1;
        }

        .btn-danger {
          background: #fee2e2;
          color: #991b1b;
        }

        .btn-danger:hover {
          background: #fecaca;
        }

        .doc-stage {
          width: 100%;
          overflow-x: auto;
          display: flex;
          justify-content: center;
          padding: 4px 0 48px;
        }

        .loading-card {
          margin-top: 40px;
          padding: 18px 24px;
          border-radius: 14px;
          background: white;
          color: #475569;
          box-shadow: 0 12px 28px rgba(15, 23, 42, 0.10);
          font-size: 14px;
        }

        .doc-page-wrap {
          width: var(--a4-width);
          min-height: var(--a4-height);
          background: #ffffff;
          box-shadow:
            0 22px 70px rgba(15, 23, 42, 0.22),
            0 0 0 1px rgba(15, 23, 42, 0.08);
          border-radius: 3px;
          overflow: visible;
        }

        .doc-page {
          width: var(--a4-width);
          min-height: var(--a4-height);
          box-sizing: border-box;
          padding: 10mm 25.4mm 5mm 25.4mm;
          background: white;
          color: #111827;
          font-family: var(--doc-font);
          font-size: 10pt;
          line-height: 1.22;
        }

        .doc-page * {
          box-sizing: border-box;
        }

        .doc-page p {
          margin: 0 0 4pt 0;
        }

        .doc-page h1,
        .doc-page h2,
        .doc-page h3,
        .doc-page h4 {
          font-family: var(--doc-font);
          margin: 6pt 0 4pt;
          line-height: 1.15;
          color: #111827;
        }

        .doc-page h1 {
          font-size: 15pt;
          text-align: center;
        }

        .doc-page h2 {
          font-size: 13pt;
        }

        .doc-page h3 {
          font-size: 11pt;
        }

        .doc-page ul,
        .doc-page ol {
          margin-top: 2pt;
          margin-bottom: 4pt;
          padding-left: 16pt;
        }

        .doc-page li {
          margin-bottom: 2pt;
        }

        .doc-page strong,
        .doc-page b {
          font-weight: 700;
        }

        .doc-page table {
          width: 100% !important;
          max-width: 100% !important;
          border-collapse: collapse !important;
          table-layout: fixed !important;
          margin: 4pt 0 8pt 0;
          font-family: var(--doc-font);
          font-size: 8.7pt;
          line-height: 1.15;
        }

        .doc-page th,
        .doc-page td {
          border: 1px solid #444 !important;
          padding: 3pt 4pt !important;
          vertical-align: top !important;
          text-align: left;
          overflow-wrap: anywhere;
          word-break: normal;
          white-space: normal !important;
        }

        .doc-page th {
          background: #e9ecef !important;
          font-weight: 700;
          text-align: center;
        }

        .doc-page thead th,
        .doc-page thead td {
          background: #e9ecef !important;
          font-weight: 700;
        }

        .doc-page table:has(tr > *:nth-child(6)) {
          font-size: 7.8pt;
        }

        .doc-page table:has(tr > *:nth-child(7)) {
          font-size: 7.2pt;
        }

        .doc-page table:has(tr > *:nth-child(8)) {
          font-size: 6.8pt;
        }

        .doc-page img {
          max-width: 100% !important;
          height: auto !important;
        }

        .doc-editable {
          outline: none;
          caret-color: #2563eb;
        }

        .doc-editable:focus {
          box-shadow: inset 0 0 0 2px rgba(37, 99, 235, 0.28);
        }

        .doc-editable table td,
        .doc-editable table th {
          cursor: text;
        }

        .doc-html-fallback {
          display: none;
        }

        /* docx-preview generated layout correction */
        .doc-view .docx-wrapper {
          background: white !important;
          padding: 0 !important;
        }

        .doc-view .docx {
          box-shadow: none !important;
          margin: 0 !important;
          padding: 0 !important;
          width: 100% !important;
        }

        .doc-view section.docx {
          width: 100% !important;
          min-height: auto !important;
          box-shadow: none !important;
        }

        .doc-view table {
          max-width: 100% !important;
          border-collapse: collapse !important;
        }

        .doc-view td,
        .doc-view th {
          overflow-wrap: anywhere;
          word-break: normal;
        }

        @media screen and (max-width: 900px) {
          .report-shell {
            padding: 12px;
          }

          .report-toolbar {
            align-items: flex-start;
            flex-direction: column;
          }

          .report-actions {
            justify-content: flex-start;
          }

          .doc-stage {
            justify-content: flex-start;
          }
        }

        @media print {
          .no-print,
          .report-toolbar {
            display: none !important;
          }

          html,
          body {
            background: white !important;
            margin: 0 !important;
            padding: 0 !important;
          }

          .report-shell,
          .doc-stage,
          .doc-page-wrap {
            background: white !important;
            padding: 0 !important;
            margin: 0 !important;
            box-shadow: none !important;
            border: none !important;
            width: auto !important;
            min-height: auto !important;
            overflow: visible !important;
            display: block !important;
          }

          .doc-page {
            width: auto !important;
            min-height: auto !important;
            padding: 0 !important;
            margin: 0 !important;
            box-shadow: none !important;
            font-size: 10pt;
            line-height: 1.2;
          }

          .doc-page table {
            page-break-inside: auto;
            break-inside: auto;
          }

          .doc-page tr {
            page-break-inside: avoid;
            break-inside: avoid;
          }

          .doc-page td,
          .doc-page th {
            page-break-inside: avoid;
            break-inside: avoid;
          }

          .doc-view .docx-wrapper,
          .doc-view .docx,
          .doc-view section.docx {
            background: white !important;
            box-shadow: none !important;
            margin: 0 !important;
            padding: 0 !important;
          }

          @page {
            size: A4;
            margin: 10mm 25.4mm 5mm 25.4mm;
          }
        }
      `}</style>
    </div>
  );
}
