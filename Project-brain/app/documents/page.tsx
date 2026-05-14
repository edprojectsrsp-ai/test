"use client";

import { useEffect, useState } from "react";
import { CheckCircle, File as FileIcon, FolderGit2, UploadCloud } from "lucide-react";

const API_URL = "http://localhost:8000/api/v1";

type Scheme = {
  id: number;
  scheme_name: string;
};

export default function DocumentVault() {
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [selectedScheme, setSelectedScheme] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/schemes`)
      .then((res) => res.json())
      .then((data) => {
        setSchemes(data);
        if (data.length > 0) setSelectedScheme(data[0].id.toString());
      });
  }, []);

  const handleUpload = async () => {
    if (!file || !selectedScheme) {
      alert("Select a scheme and a file.");
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${API_URL}/upload/${selectedScheme}/documents`, {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        setUploadSuccess(true);
        setFile(null);
        setTimeout(() => setUploadSuccess(false), 3000);
      } else {
        alert("Upload failed. Ensure file is PDF or Image.");
      }
    } catch (error) {
      console.error(error);
      alert("System offline. Cannot reach document vault.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.05)_0%,transparent_60%)] p-10 pt-20 text-white">
      <div className="mb-10">
        <h1 className="mb-2 flex items-center gap-3 text-4xl font-bold tracking-tight">
          <FolderGit2 className="h-8 w-8 text-blue-400" />
          Project Document Vault
        </h1>
        <p className="text-lg text-zinc-400">Secure storage for Stage approvals, drawings, and DPR evidence.</p>
      </div>

      <div className="max-w-2xl rounded-3xl border border-zinc-800 bg-zinc-900 p-8 shadow-2xl">
        <div className="mb-6">
          <label className="mb-2 block text-sm text-zinc-400">Target Scheme</label>
          <select
            value={selectedScheme}
            onChange={(event) => setSelectedScheme(event.target.value)}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 outline-none focus:border-blue-400"
          >
            {schemes.map((scheme) => (
              <option key={scheme.id} value={scheme.id}>[{scheme.id}] {scheme.scheme_name}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-zinc-700 bg-zinc-950 p-10 text-center transition-colors hover:bg-zinc-900">
          <input
            type="file"
            id="file-upload"
            className="hidden"
            accept=".pdf,.png,.jpg,.jpeg"
            onChange={(event) => setFile(event.target.files ? event.target.files[0] : null)}
          />
          <label htmlFor="file-upload" className="flex cursor-pointer flex-col items-center">
            {file ? (
              <>
                <FileIcon className="mb-4 h-12 w-12 text-blue-400" />
                <span className="font-bold text-white">{file.name}</span>
                <span className="mt-1 text-sm text-zinc-500">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
              </>
            ) : (
              <>
                <UploadCloud className="mb-4 h-12 w-12 text-zinc-500" />
                <span className="text-lg font-bold text-zinc-300">Click to select file</span>
                <span className="mt-2 text-sm text-zinc-500">Supports PDF, PNG, JPG</span>
              </>
            )}
          </label>
        </div>

        <button
          onClick={handleUpload}
          disabled={!file || isUploading}
          className={`mt-6 flex w-full items-center justify-center gap-2 rounded-xl py-4 font-bold transition-all ${
            uploadSuccess
              ? "bg-emerald-500 text-white"
              : !file
                ? "cursor-not-allowed bg-zinc-800 text-zinc-500"
                : "bg-blue-600 text-white hover:bg-blue-500"
          }`}
        >
          {uploadSuccess ? (
            <>
              <CheckCircle className="h-5 w-5" /> Saved to Vault
            </>
          ) : isUploading ? (
            "Encrypting & Uploading..."
          ) : (
            "Upload Document"
          )}
        </button>
      </div>
    </div>
  );
}
