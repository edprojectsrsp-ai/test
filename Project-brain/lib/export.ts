/**
 * Client helper for Sprint 1 export engine.
 * Hits /api/v1/exports/* and triggers a browser download.
 */

import { authHeaders } from "@/lib/auth";

const API = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000/api/v1";

export type ExportFormat = "pdf" | "docx" | "pptx" | "xlsx";

function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const m = /filename="?([^";]+)"?/i.exec(header);
  return m?.[1] || fallback;
}

async function downloadBlob(res: Response, fallbackName: string) {
  if (!res.ok) {
    let detail = `Export failed (${res.status})`;
    try {
      const j = await res.json();
      detail = j.detail || detail;
    } catch {
      try {
        detail = (await res.text()) || detail;
      } catch {
        /* ignore */
      }
    }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  const blob = await res.blob();
  const name = filenameFromDisposition(res.headers.get("Content-Disposition"), fallbackName);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return name;
}

function qs(params: Record<string, string | number | undefined | null>) {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  });
  return sp.toString();
}

/** Dashboard executive pack */
export async function exportDashboard(opts: {
  format: ExportFormat;
  schemeId?: number | null;
  month?: string;
  fy?: string;
}) {
  const q = qs({
    format: opts.format,
    scheme_id: opts.schemeId || undefined,
    month: opts.month,
    fy: opts.fy,
  });
  const res = await fetch(`${API}/exports/dashboard?${q}`, { headers: authHeaders() });
  return downloadBlob(res, `Dashboard.${opts.format === "docx" ? "docx" : opts.format}`);
}

/** Statics / DPR progress grid */
export async function exportStatics(opts: {
  format: ExportFormat;
  schemeId: number | string;
  month?: string;
  packageId?: number | string | null;
}) {
  const q = qs({
    format: opts.format,
    scheme_id: opts.schemeId,
    month: opts.month,
    package_id: opts.packageId || undefined,
  });
  const res = await fetch(`${API}/exports/statics?${q}`, { headers: authHeaders() });
  return downloadBlob(res, `Statics.${opts.format}`);
}

/** MoS CAPEX statement */
export async function exportMosCapex(opts: { format: ExportFormat; reportMonth?: string }) {
  const q = qs({ format: opts.format, report_month: opts.reportMonth });
  const res = await fetch(`${API}/exports/mos-capex?${q}`, { headers: authHeaders() });
  return downloadBlob(res, `MoS_CAPEX.${opts.format}`);
}

/** PMC physical progress pack */
export async function exportPmc(opts: {
  format: ExportFormat;
  schemeId: number | string;
  month?: string;
}) {
  const q = qs({
    format: opts.format,
    scheme_id: opts.schemeId,
    month: opts.month,
  });
  const res = await fetch(`${API}/exports/pmc?${q}`, { headers: authHeaders() });
  return downloadBlob(res, `PMC.${opts.format}`);
}

/** Generic payload render (template designer / what-if) */
export async function exportPayload(opts: {
  format: ExportFormat;
  payload: Record<string, unknown>;
  filenameStem?: string;
}) {
  const res = await fetch(`${API}/exports/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      format: opts.format,
      filename_stem: opts.filenameStem,
      payload: opts.payload,
    }),
  });
  return downloadBlob(res, `${opts.filenameStem || "export"}.${opts.format}`);
}
