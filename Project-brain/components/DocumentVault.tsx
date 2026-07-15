"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authFetch } from "@/lib/auth";

const AI_BASE =
  process.env.NEXT_PUBLIC_AI_API_URL ||
  process.env.NEXT_PUBLIC_AI_BASE ||
  "http://127.0.0.1:8002";

const C = {
  page: "var(--bg)",
  card: "var(--panel)",
  ink: "var(--ink)",
  muted: "var(--ink-3)",
  line: "var(--line)",
  soft: "var(--panel-3)",
  accent: "var(--steel)",
  accentDark: "var(--steel-deep)",
  danger: "var(--molten)",
  ok: "var(--verdigris)",
  body: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};

interface Scheme { scheme_id: number; scheme_code: string; scheme_name: string }
interface Doc {
  document_id: number;
  title: string;
  document_type: string;
  file_name: string;
  file_size_bytes: number | null;
  keywords: string[] | null;
  ingest_channel: string;
  scheme_id: number | null;
  scheme_code: string | null;
  chunk_count: number | null;
  embedded_chunks: number;
  created_at: string;
}
interface ChunkPreview { chunk_id: number; chunk_no: number; preview: string; embedded: boolean }

const DOC_TYPES = [
  ["contract", "Contract"],
  ["correspondence_in", "Letter in"],
  ["correspondence_out", "Letter out"],
  ["record_note", "Record note"],
  ["report", "Report"],
  ["other", "Other"],
] as const;

const textInput: React.CSSProperties = {
  width: "100%",
  border: `1px solid ${C.line}`,
  borderRadius: 12,
  background: C.card,
  color: C.ink,
  padding: "11px 12px",
  outline: "none",
  fontSize: 14,
  fontFamily: C.body,
};

function fmtBytes(n: number | null): string {
  if (!n) return "-";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function Tag({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999, padding: "4px 9px", border: `1px solid ${C.line}`, background: C.soft, color: C.ink, fontSize: 12 }}>
      {label}
      {onRemove && (
        <button onClick={onRemove} style={{ border: "none", background: "transparent", cursor: "pointer", color: C.muted, padding: 0 }} aria-label={`Remove ${label}`}>
          x
        </button>
      )}
    </span>
  );
}

async function openAuthenticatedDownload(url: string, fileName?: string) {
  const response = await authFetch(url);
  if (!response.ok) {
    let message = `Download failed (${response.status})`;
    try {
      const body = await response.json();
      message = body?.detail || message;
    } catch {}
    throw new Error(message);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName || "document";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

function IngestPanel({ schemes, onDone }: { schemes: Scheme[]; onDone: () => void }) {
  const [mode, setMode] = useState<"file" | "text">("file");
  const [docType, setDocType] = useState("contract");
  const [title, setTitle] = useState("");
  const [schemeId, setSchemeId] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [textKind, setTextKind] = useState<"whatsapp" | "correspondence" | "contract">("whatsapp");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const addLabel = () => {
    const next = labelInput.trim();
    if (next && !labels.some((label) => label.toLowerCase() === next.toLowerCase())) {
      setLabels((items) => [...items, next]);
    }
    setLabelInput("");
  };

  const submit = async () => {
    setBusy(true);
    setStatus(null);
    try {
      if (!schemeId) throw new Error("Select the scheme this document belongs to.");
      let response: Response;
      if (mode === "file") {
        if (!file) throw new Error("Choose a file first.");
        const fd = new FormData();
        fd.append("file", file);
        fd.append("document_type", docType);
        fd.append("title", title || file.name);
        fd.append("keywords", labels.join(","));
        fd.append("scheme_id", schemeId);
        response = await authFetch(`${AI_BASE}/ai/ingest/upload`, { method: "POST", body: fd });
      } else {
        if (!text.trim()) throw new Error("Paste text first.");
        response = await authFetch(`${AI_BASE}/ai/ingest/text`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            kind: textKind,
            title,
            scheme_id: Number(schemeId),
            keywords: labels,
          }),
        });
      }

      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || "Ingest failed.");
      setStatus({ ok: true, message: `Ingested ${body.chunks ?? 0} chunks. Original stored.` });
      setTitle("");
      setLabels([]);
      setText("");
      setFile(null);
      onDone();
    } catch (error: any) {
      setStatus({ ok: false, message: error?.message || "Ingest failed." });
    } finally {
      setBusy(false);
    }
  };

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) setFile(dropped);
  }, []);

  return (
    <section style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 24, boxShadow: "0 18px 48px rgba(15, 23, 42, 0.07)", overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", padding: 22, borderBottom: `1px solid ${C.line}` }}>
        <div>
          <div style={{ color: C.muted, fontSize: 13 }}>Document Ingest</div>
          <h1 style={{ margin: "2px 0 0", fontSize: 24, letterSpacing: -0.4 }}>Add knowledge to Project Brain</h1>
        </div>
        <div style={{ display: "flex", background: C.soft, borderRadius: 14, padding: 4 }}>
          {(["file", "text"] as const).map((item) => (
            <button key={item} onClick={() => setMode(item)} style={{ border: "none", borderRadius: 10, padding: "9px 14px", background: mode === item ? C.card : "transparent", boxShadow: mode === item ? "var(--shadow)" : "none", color: C.ink, cursor: "pointer", fontWeight: 700 }}>
              {item === "file" ? "Upload file" : "Paste text"}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: 22, display: "grid", gap: 16 }}>
        {mode === "file" ? (
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            style={{ border: `1.5px dashed ${dragging ? C.accent : C.line}`, borderRadius: 20, background: dragging ? "#ecfdf5" : C.soft, padding: 34, textAlign: "center", cursor: "pointer" }}
          >
            <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.tiff,.bmp" style={{ display: "none" }} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            <div style={{ width: 46, height: 46, margin: "0 auto 12px", borderRadius: 16, background: C.card, display: "grid", placeItems: "center", border: `1px solid ${C.line}`, fontWeight: 900 }}>
              +
            </div>
            <div style={{ fontWeight: 800 }}>{file ? file.name : "Drop a document here or click to browse"}</div>
            <div style={{ color: C.muted, marginTop: 4, fontSize: 13 }}>{file ? fmtBytes(file.size) : "PDF, DOCX, TXT, Markdown, and images are supported"}</div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {(["whatsapp", "correspondence", "contract"] as const).map((kind) => (
                <button key={kind} onClick={() => setTextKind(kind)} style={{ border: `1px solid ${textKind === kind ? C.accent : C.line}`, color: textKind === kind ? C.accentDark : C.ink, background: textKind === kind ? "var(--verdigris-soft)" : C.card, borderRadius: 999, padding: "8px 12px", cursor: "pointer", fontWeight: 700 }}>
                  {kind === "whatsapp" ? "WhatsApp" : kind === "correspondence" ? "Letter or email" : "Contract text"}
                </button>
              ))}
            </div>
            <textarea value={text} onChange={(event) => setText(event.target.value)} rows={8} placeholder="Paste text here..." style={{ ...textInput, resize: "vertical", lineHeight: 1.55 }} />
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) 180px minmax(220px, 300px)", gap: 12 }}>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title, for example COB-7 Main Contract" style={textInput} />
          <select value={docType} onChange={(event) => setDocType(event.target.value)} disabled={mode === "text"} style={textInput}>
            {DOC_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select required aria-label="Scheme (required)" value={schemeId} onChange={(event) => setSchemeId(event.target.value)} style={{ ...textInput, borderColor: schemeId ? C.line : "#f59e0b" }}>
            <option value="">Select scheme (required)</option>
            {schemes.map((scheme) => (
              <option key={scheme.scheme_id} value={scheme.scheme_id}>#{scheme.scheme_id} {scheme.scheme_code ? `${scheme.scheme_code} - ` : ""}{scheme.scheme_name}</option>
            ))}
          </select>
        </div>

        <div style={{ marginTop: -6, color: schemeId ? C.ok : "#9a6700", fontSize: 12 }}>
          {schemeId
            ? `Linked to ${schemes.find((scheme) => String(scheme.scheme_id) === schemeId)?.scheme_name ?? `scheme #${schemeId}`}. Retrieval and the knowledge graph will use this scheme.`
            : "A scheme link is required so citations, retrieval, and graph evidence attach to the correct project."}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {labels.map((label) => <Tag key={label} label={label} onRemove={() => setLabels((items) => items.filter((item) => item !== label))} />)}
          <input
            value={labelInput}
            onChange={(event) => setLabelInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                addLabel();
              }
            }}
            placeholder="Add label and press Enter"
            style={{ ...textInput, width: 230, padding: "8px 11px" }}
          />
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button onClick={() => void submit()} disabled={busy || !schemeId} style={{ border: "none", borderRadius: 14, background: busy || !schemeId ? "#94a3b8" : C.accent, color: "#fff", padding: "12px 18px", cursor: busy ? "wait" : !schemeId ? "not-allowed" : "pointer", fontWeight: 800 }}>
            {busy ? "Ingesting..." : "Ingest document"}
          </button>
          {status && <span style={{ color: status.ok ? C.ok : C.danger, fontSize: 13 }}>{status.message}</span>}
        </div>
      </div>
    </section>
  );
}

function DocRow({ doc, selected, onSelect }: { doc: Doc; selected: boolean; onSelect: () => void }) {
  const chunks = doc.chunk_count ?? 0;
  const percent = chunks > 0 ? Math.round((doc.embedded_chunks / chunks) * 100) : 0;
  const labels = doc.keywords ?? [];

  return (
    <button onClick={onSelect} style={{ width: "100%", border: `1px solid ${selected ? C.accent : C.line}`, background: selected ? "var(--verdigris-soft)" : C.card, color: C.ink, borderRadius: 18, padding: 16, textAlign: "left", cursor: "pointer", display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontWeight: 800 }}>{doc.title}</div>
          <div style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>{doc.document_type} - {doc.scheme_code ?? "No scheme"} - {fmtBytes(doc.file_size_bytes)}</div>
        </div>
        <button
          onClick={async (event) => {
            event.stopPropagation();
            try {
              await openAuthenticatedDownload(`${AI_BASE}/ai/ingest/documents/${doc.document_id}/download`, doc.file_name || doc.title);
            } catch (error) {
              console.error(error);
            }
          }}
          style={{ color: C.accentDark, textDecoration: "none", fontWeight: 800, fontSize: 13, border: "none", background: "transparent", cursor: "pointer", padding: 0 }}
        >
          Download
        </button>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {labels.slice(0, 8).map((label) => <Tag key={label} label={label} />)}
        {labels.length > 8 && <span style={{ color: C.muted, fontSize: 12 }}>+{labels.length - 8}</span>}
      </div>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", color: C.muted, fontSize: 12, marginBottom: 5 }}>
          <span>{chunks} chunks</span>
          <span>{percent}% embedded</span>
        </div>
        <div style={{ height: 6, borderRadius: 999, background: C.soft, overflow: "hidden" }}>
          <div style={{ width: `${percent}%`, height: "100%", background: C.accent }} />
        </div>
      </div>
    </button>
  );
}

export default function DocumentVault() {
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [total, setTotal] = useState(0);
  const [cloud, setCloud] = useState<{ keyword: string; n: number }[]>([]);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [schemeFilter, setSchemeFilter] = useState("");
  const [keywordFilter, setKeywordFilter] = useState("");
  const [selected, setSelected] = useState<Doc | null>(null);
  const [chunks, setChunks] = useState<ChunkPreview[]>([]);
  const [loadError, setLoadError] = useState<string>("");

  const refresh = useCallback(() => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (typeFilter) params.set("document_type", typeFilter);
    if (schemeFilter) params.set("scheme_id", schemeFilter);
    if (keywordFilter) params.set("keyword", keywordFilter);
    authFetch(`${AI_BASE}/ai/ingest/documents?${params}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 401 ? "Document Vault needs a valid login session." : "Failed to load documents.");
        return r.json();
      })
      .then((body) => {
        setDocs(body.documents ?? []);
        setTotal(body.total ?? 0);
        setLoadError("");
      })
      .catch((error: any) => {
        setDocs([]);
        setTotal(0);
        setLoadError(error?.message || "Failed to load documents.");
      });
    authFetch(`${AI_BASE}/ai/ingest/keywords`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setCloud)
      .catch(() => undefined);
  }, [q, typeFilter, schemeFilter, keywordFilter]);

  useEffect(() => {
    authFetch(`${AI_BASE}/ai/ingest/schemes`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setSchemes)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selected) {
      setChunks([]);
      return;
    }
    authFetch(`${AI_BASE}/ai/ingest/documents/${selected.document_id}`)
      .then((r) => (r.ok ? r.json() : { chunks: [] }))
      .then((body) => setChunks(body.chunks ?? []))
      .catch(() => setChunks([]));
  }, [selected]);

  const topLabels = useMemo(() => cloud.slice(0, 12), [cloud]);

  return (
    <div style={{ minHeight: "calc(100vh - 32px)", background: C.page, color: C.ink, fontFamily: C.body, padding: 24, display: "grid", gap: 18 }}>
      <IngestPanel schemes={schemes} onDone={refresh} />

      <section style={{ display: "grid", gridTemplateColumns: selected ? "minmax(0, 1fr) 380px" : "minmax(0, 1fr)", gap: 18, alignItems: "start" }}>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 20, padding: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search documents" style={{ ...textInput, width: 260 }} />
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} style={{ ...textInput, width: 170 }}>
              <option value="">All types</option>
              {DOC_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select aria-label="Filter by scheme" value={schemeFilter} onChange={(event) => setSchemeFilter(event.target.value)} style={{ ...textInput, width: 280 }}>
              <option value="">All schemes</option>
              {schemes.map((scheme) => (
                <option key={scheme.scheme_id} value={scheme.scheme_id}>#{scheme.scheme_id} {scheme.scheme_code ? `${scheme.scheme_code} - ` : ""}{scheme.scheme_name}</option>
              ))}
            </select>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {topLabels.map((label) => (
                <button key={label.keyword} onClick={() => setKeywordFilter(keywordFilter === label.keyword ? "" : label.keyword)} style={{ border: `1px solid ${keywordFilter === label.keyword ? C.accent : C.line}`, borderRadius: 999, background: keywordFilter === label.keyword ? "var(--verdigris-soft)" : C.card, color: keywordFilter === label.keyword ? C.accentDark : C.muted, padding: "7px 10px", cursor: "pointer", fontSize: 12 }}>
                  {label.keyword} {label.n}
                </button>
              ))}
            </div>
            <div style={{ marginLeft: "auto", color: C.muted, fontSize: 13 }}>{total} documents</div>
          </div>

          {loadError && (
            <div style={{ background: "#fff7ed", color: "#9a3412", border: "1px solid #fdba74", borderRadius: 16, padding: "12px 14px", fontSize: 13 }}>
              {loadError}
            </div>
          )}

          <div style={{ display: "grid", gap: 10 }}>
            {docs.length === 0 ? (
              <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 20, padding: 36, textAlign: "center", color: C.muted }}>
                No documents yet. Use the ingest panel above to add the first source.
              </div>
            ) : (
              docs.map((doc) => <DocRow key={doc.document_id} doc={doc} selected={selected?.document_id === doc.document_id} onSelect={() => setSelected(selected?.document_id === doc.document_id ? null : doc)} />)
            )}
          </div>
        </div>

        {selected && (
          <aside style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 22, padding: 16, position: "sticky", top: 16, boxShadow: "0 18px 48px rgba(15, 23, 42, 0.06)" }}>
            <div style={{ color: C.muted, fontSize: 12 }}>Chunk preview - document {selected.document_id}</div>
            <h2 style={{ margin: "4px 0 14px", fontSize: 18 }}>{selected.title}</h2>
            <div style={{ display: "grid", gap: 10, maxHeight: 520, overflowY: "auto" }}>
              {chunks.map((chunk) => (
                <div key={chunk.chunk_id} style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: 12, background: chunk.embedded ? "#fbfffd" : C.soft }}>
                  <div style={{ color: C.muted, fontSize: 12, marginBottom: 6 }}>Chunk {chunk.chunk_no} - {chunk.embedded ? "embedded" : "text-search only"}</div>
                  <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.55, fontSize: 13 }}>{chunk.preview}</div>
                </div>
              ))}
            </div>
          </aside>
        )}
      </section>
    </div>
  );
}
