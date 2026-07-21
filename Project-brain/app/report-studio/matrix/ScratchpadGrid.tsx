"use client";

/**
 * ScratchpadGrid — a live spreadsheet laid over a matrix run result.
 *
 * The engine fills the left columns (A, B, C … one per measure column) for
 * every visible report row. The user then adds EXTRA columns and writes real
 * spreadsheet formulas against those cells: =A1+B1, =SUM(C1:C9), =D2/E2*100.
 *
 * Ephemeral by design (user chose scratchpad): formulas live in component
 * state + optional localStorage-free in-memory session; a re-run reseeds the
 * engine cells and re-evaluates. Nothing here mutates the saved report.
 *
 * Engine: HyperFormula (Excel-compatible: 400+ functions, ranges, precedence,
 * dependency graph). Engine-filled cells are locked (grey); user cells are
 * editable (type a value or =formula). Errors show the HF error code.
 *
 * Addressing: row R of the report table is spreadsheet row R (1-based, as
 * shown). Column A = first measure, B = second, … then user columns continue
 * the letters. So "M column = A1+B1" is literally =A1+B1 typed into M1.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { HyperFormula } from "hyperformula";
import { Plus, Trash2, X } from "lucide-react";

type Col = { key: string; name: string; measure?: { agg?: string }; decimals?: number };
type RunRow = { id: string; name: string; depth: number; cells: Record<string, number | null> };

function hfCellToString(cv: any): string {
  if (cv == null) return "";
  if (typeof cv === "object" && "value" in cv) return String(cv.value); // DetailedCellError
  return String(cv);
}

const colLetter = (i: number) => {
  let s = "";
  i += 1;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
};

const mono = "var(--font-mono, 'IBM Plex Mono', monospace)";
const cellBase: React.CSSProperties = {
  borderBottom: "1px solid var(--line)", borderRight: "1px solid var(--line)",
  padding: "3px 8px", fontSize: 12, fontFamily: mono, whiteSpace: "nowrap",
  height: 26, minWidth: 90,
};

export default function ScratchpadGrid({ rows, columns, onClose }: {
  rows: RunRow[]; columns: Col[]; onClose?: () => void;
}) {
  // user-added columns (headers only; cell contents live in userCells)
  const [userCols, setUserCols] = useState<string[]>(["Adjusted"]);
  // user cell contents keyed "r,c" where c is absolute column index (engine cols first)
  const [userCells, setUserCells] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [tick, setTick] = useState(0);
  const hfRef = useRef<HyperFormula | null>(null);
  const sheetRef = useRef<number>(0);

  const engineColCount = columns.length;
  const totalCols = engineColCount + userCols.length;

  // (re)build the HF sheet whenever the run result or the user grid shape changes
  useEffect(() => {
    const hf = HyperFormula.buildEmpty({ licenseKey: "gpl-v3" });
    const name = hf.addSheet("scratch");
    const sheet = hf.getSheetId(name)!;
    const data: string[][] = rows.map((r, ri) => {
      const line: string[] = columns.map((c) => {
        const v = r.cells[c.key];
        return v == null ? "" : String(v);
      });
      for (let ci = 0; ci < userCols.length; ci++) {
        line.push(userCells[`${ri},${engineColCount + ci}`] ?? "");
      }
      return line;
    });
    hf.setSheetContent(sheet, data);
    hfRef.current = hf;
    sheetRef.current = sheet;
    // read every cell value back for display
    const out: Record<string, string> = {};
    for (let ri = 0; ri < rows.length; ri++) {
      for (let ci = 0; ci < totalCols; ci++) {
        const cv = hf.getCellValue({ sheet, row: ri, col: ci });
        out[`${ri},${ci}`] = cv == null ? "" : String(cv);
      }
    }
    setValues(out);
    return () => hf.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, columns, userCols.length, tick]);

  const commit = (ri: number, ci: number, raw: string) => {
    setUserCells((m) => ({ ...m, [`${ri},${ci}`]: raw }));
    const hf = hfRef.current;
    if (hf) {
      hf.setCellContents({ sheet: sheetRef.current, row: ri, col: ci }, raw);
      // re-read all (cheap for report-sized grids; keeps dependents fresh)
      const out: Record<string, string> = {};
      for (let r = 0; r < rows.length; r++)
        for (let c = 0; c < totalCols; c++) {
          const cv = hf.getCellValue({ sheet: sheetRef.current, row: r, col: c });
          out[`${r},${c}`] = hfCellToString(cv);
        }
      setValues(out);
    }
    setEditing(null);
  };

  const headers = useMemo(() => [
    ...columns.map((c) => c.name),
    ...userCols,
  ], [columns, userCols]);

  const fmtDisplay = (raw: string) => {
    if (raw === "" || raw == null) return "";
    const n = Number(raw);
    if (!isNaN(n) && isFinite(n)) return n.toLocaleString("en-IN", { maximumFractionDigits: 4 });
    return raw; // error codes (#DIV/0!, #REF! …) and text pass through
  };

  return (
    <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--line)" }}>
        <b style={{ fontSize: 12.5 }}>Spreadsheet scratchpad</b>
        <span style={{ fontSize: 11, color: "var(--ink-4)" }}>
          Engine columns are locked (A, B, C…). Add columns and type values or Excel formulas like <code style={{ fontFamily: mono }}>=A1+B1</code>, <code style={{ fontFamily: mono }}>=SUM(C1:C{rows.length})</code>. Ephemeral — cleared on re-run.
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={() => setUserCols((u) => [...u, `Col ${u.length + 1}`])}
                style={{ ...btnStyle }}><Plus size={12} /> Column</button>
        {onClose && <X size={15} style={{ cursor: "pointer", color: "var(--ink-4)" }} onClick={onClose} />}
      </div>

      <div style={{ overflow: "auto", maxHeight: 460 }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ ...cellBase, position: "sticky", top: 0, left: 0, zIndex: 3, background: "var(--panel-2)",
                           color: "var(--ink-4)", fontWeight: 700, minWidth: 40 }}></th>
              <th style={{ ...cellBase, position: "sticky", top: 0, left: 40, zIndex: 3, background: "var(--panel-2)",
                           color: "var(--ink-3)", fontWeight: 800, minWidth: 220 }}>Category</th>
              {headers.map((h, ci) => (
                <th key={ci} style={{ ...cellBase, position: "sticky", top: 0, zIndex: 2, background: "var(--panel-2)",
                                      color: "var(--ink-3)", fontWeight: 800 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ color: "var(--steel)", fontSize: 10 }}>{colLetter(ci)}</span>
                    {ci >= engineColCount ? (
                      <>
                        <input value={h} onChange={(e) => setUserCols((u) => u.map((x, i) => i === ci - engineColCount ? e.target.value : x))}
                               style={{ background: "transparent", border: "none", color: "var(--ink)", fontSize: 11.5,
                                        fontWeight: 800, width: 90, outline: "none", fontFamily: "inherit" }} />
                        <Trash2 size={11} style={{ cursor: "pointer", color: "var(--ink-4)" }}
                                onClick={() => { setUserCols((u) => u.filter((_, i) => i !== ci - engineColCount)); setTick((t) => t + 1); }} />
                      </>
                    ) : <span>{h}</span>}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={r.id}>
                <td style={{ ...cellBase, position: "sticky", left: 0, background: "var(--panel-2)",
                             color: "var(--ink-4)", textAlign: "center", minWidth: 40 }}>{ri + 1}</td>
                <td style={{ ...cellBase, position: "sticky", left: 40, background: "var(--panel)",
                             paddingLeft: 8 + r.depth * 14, fontFamily: "inherit",
                             fontWeight: r.depth <= 1 ? 700 : 400, color: "var(--ink-2)", minWidth: 220 }}>{r.name}</td>
                {Array.from({ length: totalCols }).map((_, ci) => {
                  const isEngine = ci < engineColCount;
                  const key = `${ri},${ci}`;
                  const disp = fmtDisplay(values[key] ?? "");
                  const isErr = typeof disp === "string" && disp.startsWith("#");
                  if (!isEngine && editing === key) {
                    return (
                      <td key={ci} style={{ ...cellBase, padding: 0 }}>
                        <input autoFocus defaultValue={userCells[key] ?? ""}
                               onBlur={(e) => commit(ri, ci, e.target.value)}
                               onKeyDown={(e) => { if (e.key === "Enter") commit(ri, ci, (e.target as HTMLInputElement).value);
                                                   if (e.key === "Escape") setEditing(null); }}
                               style={{ width: "100%", height: 24, border: "1px solid var(--steel)", borderRadius: 3,
                                        background: "var(--panel-2)", color: "var(--ink)", fontFamily: mono, fontSize: 12, padding: "0 6px", outline: "none" }} />
                      </td>
                    );
                  }
                  return (
                    <td key={ci}
                        onClick={() => { if (!isEngine) setEditing(key); }}
                        title={!isEngine && userCells[key] ? userCells[key] : undefined}
                        style={{ ...cellBase, textAlign: "right",
                                 background: isEngine ? "var(--panel-2)" : "var(--panel)",
                                 color: isErr ? "#e5534b" : isEngine ? "var(--ink-3)" : "var(--ink)",
                                 cursor: isEngine ? "default" : "cell" }}>
                      {disp}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer",
  padding: "5px 9px", borderRadius: 7, fontSize: 11.5, fontWeight: 700,
  border: "1px solid var(--line)", background: "transparent", color: "var(--ink-2)",
};
