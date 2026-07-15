"use client";

import React, { useState, useRef } from "react";
import { UploadCloud, FileSpreadsheet, CheckCircle, AlertTriangle, Download, ArrowLeft, X } from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";

export default function BulkUploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error" | null; message: string }>({ type: null, message: "" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDownload = async () => {
    try {
      const res = await fetch("http://localhost:8000/api/v1/schemes/template");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Project_Import_Template.xlsx";
      a.click();
    } catch (e) {
      alert("Backend error while generating template.");
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile?.name.endsWith(".xlsx")) setFile(droppedFile);
    else alert("Please upload a valid .xlsx file");
  };

  const handleUpload = async () => {
    if (!file) return;
    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("http://localhost:8000/api/v1/schemes/bulk-upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        setStatus({ type: "success", message: data.message });
        setFile(null);
      } else {
        setStatus({ type: "error", message: data.detail });
      }
    } catch (e) {
      setStatus({ type: "error", message: "Server connection failed." });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="min-h-screen p-8 text-[var(--ink)]">
      <div className="max-w-4xl mx-auto">

        {/* Navigation */}
        <div className="flex justify-between items-center mb-12">
          <div>
            <h1 className="text-4xl font-black text-[var(--ink)]">Bulk <span className="text-[var(--verdigris)]">Import</span></h1>
            <p className="mt-2 text-[var(--ink-3)]">Initialize multiple schemes using the stylized Step-1 template.</p>
          </div>
          <Link href="/add">
            <button className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4 py-2 text-[var(--ink-3)] transition-all hover:bg-[var(--panel-2)] hover:text-[var(--ink)]">
              <ArrowLeft size={18} /> Manual Entry
            </button>
          </Link>
        </div>

        <div className="rounded-3xl border border-[var(--line)] bg-white p-8 shadow-[var(--shadow-lg)]">

          {/* Instructions Header */}
          <div className="mb-8 flex items-start justify-between border-b border-[var(--line)] pb-8">
            <div className="space-y-2">
              <h3 className="text-lg font-bold text-[var(--ink)]">Mandatory Registration Fields:</h3>
              <div className="flex gap-4 text-xs font-mono">
                <span className="rounded border border-[var(--steel-dim)] bg-[var(--steel-soft)] px-2 py-1 text-[var(--steel)]">Scheme Name</span>
                <span className="rounded border border-[var(--steel-dim)] bg-[var(--steel-soft)] px-2 py-1 text-[var(--steel)]">Scheme Type</span>
                <span className="rounded border border-[var(--steel-dim)] bg-[var(--steel-soft)] px-2 py-1 text-[var(--steel)]">Estimated Cost</span>
                <span className="rounded border border-[var(--steel-dim)] bg-[var(--steel-soft)] px-2 py-1 text-[var(--steel)]">Current Status</span>
              </div>
            </div>
            <button onClick={handleDownload} className="flex items-center gap-2 rounded-2xl border border-[var(--verdigris)] bg-[var(--verdigris)] px-5 py-3 font-bold text-white shadow-[var(--shadow)] transition-all hover:brightness-110">
              <Download size={20} /> Download Template
            </button>
          </div>

          {/* Drag & Drop Area */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`h-64 border-2 border-dashed rounded-3xl flex flex-col items-center justify-center cursor-pointer transition-all duration-300 ${
              isDragging ? "border-[var(--verdigris)] bg-[var(--verdigris-soft)]" : "border-[var(--line-2)] bg-[var(--panel-2)] hover:border-[var(--steel-dim)]"
            }`}
          >
            <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)} />

            {file ? (
              <div className="text-center">
                <FileSpreadsheet size={50} className="mx-auto mb-4 text-[var(--verdigris)]" />
                <p className="font-bold text-[var(--verdigris)]">{file.name}</p>
                <button onClick={(e) => { e.stopPropagation(); setFile(null); }} className="mx-auto mt-2 flex items-center gap-1 text-xs text-[var(--ink-4)] hover:text-[var(--molten)]"><X size={12}/> Remove</button>
              </div>
            ) : (
              <div className="text-center group">
                <UploadCloud size={50} className={`mx-auto mb-4 transition-transform group-hover:scale-110 ${isDragging ? 'text-[var(--verdigris)]' : 'text-[var(--ink-4)]'}`} />
                <p className="text-[var(--ink-3)]">Drag your completed template here or <span className="text-[var(--verdigris)] underline">browse</span></p>
              </div>
            )}
          </div>

          {/* Status Message */}
          {status.message && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`mt-6 flex items-center gap-3 rounded-2xl border p-4 ${status.type === "success" ? "border-[var(--verdigris)] bg-[var(--verdigris-soft)] text-[var(--verdigris)]" : "border-[var(--molten)] bg-[var(--molten-soft)] text-[var(--molten)]"}`}>
              {status.type === "success" ? <CheckCircle size={20} /> : <AlertTriangle size={20} />}
              <p className="text-sm font-medium">{status.message}</p>
            </motion.div>
          )}

          {/* Upload Action */}
          <div className="mt-8 flex justify-end">
            <button
              onClick={handleUpload}
              disabled={!file || isUploading}
              className={`rounded-2xl px-10 py-4 font-black transition-all ${!file || isUploading ? "cursor-not-allowed border border-[var(--line)] bg-[var(--panel-3)] text-[var(--ink-4)]" : "border border-[var(--steel-dim)] bg-[var(--steel)] text-white hover:scale-105 hover:bg-[var(--steel-2)]"}`}
            >
              {isUploading ? "PROCESSING..." : "IMPORT PROJECTS"}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
