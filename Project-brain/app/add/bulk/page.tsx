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
      const res = await fetch("http://localhost:8002/api/v1/schemes/template");
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
      const res = await fetch("http://localhost:8002/api/v1/schemes/bulk-upload", {
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
    <div className="min-h-screen bg-zinc-950 p-8 text-white">
      <div className="max-w-4xl mx-auto">
        
        {/* Navigation */}
        <div className="flex justify-between items-center mb-12">
          <div>
            <h1 className="text-4xl font-black text-white">Bulk <span className="text-emerald-400">Import</span></h1>
            <p className="text-zinc-400 mt-2">Initialize multiple schemes using the stylized Step-1 template.</p>
          </div>
          <Link href="/add">
            <button className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-400 hover:text-white transition-all">
              <ArrowLeft size={18} /> Manual Entry
            </button>
          </Link>
        </div>

        <div className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-8 backdrop-blur-xl shadow-2xl">
          
          {/* Instructions Header */}
          <div className="flex justify-between items-start mb-8 pb-8 border-b border-zinc-800">
            <div className="space-y-2">
              <h3 className="font-bold text-lg text-zinc-200">Mandatory Registration Fields:</h3>
              <div className="flex gap-4 text-xs font-mono">
                <span className="px-2 py-1 bg-zinc-800 rounded text-cyan-400 border border-cyan-900/50">Scheme Name</span>
                <span className="px-2 py-1 bg-zinc-800 rounded text-cyan-400 border border-cyan-900/50">Scheme Type</span>
                <span className="px-2 py-1 bg-zinc-800 rounded text-cyan-400 border border-cyan-900/50">Estimated Cost</span>
                <span className="px-2 py-1 bg-zinc-800 rounded text-cyan-400 border border-cyan-900/50">Current Status</span>
              </div>
            </div>
            <button onClick={handleDownload} className="flex items-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-2xl font-bold text-white shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all">
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
              isDragging ? "border-emerald-400 bg-emerald-900/10" : "border-zinc-700 bg-zinc-950/50 hover:border-zinc-500"
            }`}
          >
            <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            
            {file ? (
              <div className="text-center">
                <FileSpreadsheet size={50} className="text-emerald-400 mx-auto mb-4" />
                <p className="font-bold text-emerald-400">{file.name}</p>
                <button onClick={(e) => { e.stopPropagation(); setFile(null); }} className="text-xs text-zinc-500 mt-2 hover:text-red-400 flex items-center gap-1 mx-auto"><X size={12}/> Remove</button>
              </div>
            ) : (
              <div className="text-center group">
                <UploadCloud size={50} className={`mx-auto mb-4 transition-transform group-hover:scale-110 ${isDragging ? 'text-emerald-400' : 'text-zinc-600'}`} />
                <p className="text-zinc-400">Drag your completed template here or <span className="text-emerald-400 underline">browse</span></p>
              </div>
            )}
          </div>

          {/* Status Message */}
          {status.message && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`mt-6 p-4 rounded-2xl flex items-center gap-3 border ${status.type === "success" ? "bg-emerald-900/20 border-emerald-800 text-emerald-400" : "bg-red-900/20 border-red-800 text-red-400"}`}>
              {status.type === "success" ? <CheckCircle size={20} /> : <AlertTriangle size={20} />}
              <p className="text-sm font-medium">{status.message}</p>
            </motion.div>
          )}

          {/* Upload Action */}
          <div className="mt-8 flex justify-end">
            <button 
              onClick={handleUpload} 
              disabled={!file || isUploading} 
              className={`px-10 py-4 rounded-2xl font-black transition-all ${!file || isUploading ? "bg-zinc-800 text-zinc-600 cursor-not-allowed" : "bg-white text-black hover:bg-emerald-400 hover:scale-105"}`}
            >
              {isUploading ? "PROCESSING..." : "IMPORT PROJECTS"}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
