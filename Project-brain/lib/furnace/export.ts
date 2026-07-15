"use client";
/* Client-side export — CSV (opens in Excel) + print-to-PDF. No dependencies. */

export function exportCSV(filename: string, headers: string[], rows: (string | number)[][], title?: string) {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines: string[] = [];
  if (title) lines.push(esc(title), "");
  lines.push(headers.map(esc).join(","));
  rows.forEach((r) => lines.push(r.map(esc).join(",")));
  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  triggerDownload(blob, filename.endsWith(".csv") ? filename : `${filename}.csv`);
}

function triggerDownload(blob: Blob, name: string) {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

/** Print the current report to PDF via the browser print dialog. For a clean
 *  sheet, the report root should carry data-print="report". */
export function printPDF() {
  if (typeof window !== "undefined") window.print();
}
