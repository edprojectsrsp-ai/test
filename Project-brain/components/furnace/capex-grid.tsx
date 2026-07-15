"use client";
// CapexGrid v2 — dense planning & actuals grid.
// Parity with rival grid: plan versions (BE/RE + effective month), tree indent with
// collapse, grouped month columns (BE/RE/Actual; RE only from effective month),
// totals row, double-click behaviour (parent = collapse, blocked-parent message),
// month locks, column resize.
// Beyond parity: inline cell editing (no modal), Enter/Tab/Esc keyboard flow,
// variance heat tint, achievement column, Quarterly + FY Summary views with true
// rollups, RE ghost autofill before effective month, one-click CSV.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ThemeToggle } from "@/theme/ThemeProvider";
import { Button, Card, Chip, Field, PageHeader, Segmented, Select, toast } from "@/ui";
import {
  FY_MONTHS, QUARTERS, GridPlan, GridPlanRef, GridRow,
  getGridFyOptions, getGridPlans, getGridPlan,
  saveActualCell, toggleMonthLock, approvePlan, unlockPlan,
  inr, downloadCSV,
} from "@/lib/furnace/gridApi";

type ViewBy = "Monthly" | "Quarterly" | "FY Summary";
type Metric = "be" | "re" | "actual";
const METRIC_LABEL: Record<Metric, string> = { be: "BE", re: "RE", actual: "Actual" };

const mono: React.CSSProperties = { fontFamily: "var(--font-mono, 'IBM Plex Mono', ui-monospace, monospace)" };
const num: React.CSSProperties = { ...mono, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };

const fmt = (v: number) => (v ? inr(v, 2) : "");

interface EditTarget { rowId: number; month: number; }

export default function CapexGridPage() {
  const [fys, setFys] = useState<string[]>([]);
  const [fy, setFy] = useState("");
  const [plans, setPlans] = useState<GridPlanRef[]>([]);
  const [planId, setPlanId] = useState<number | null>(null);
  const [plan, setPlan] = useState<GridPlan | null>(null);
  const [viewBy, setViewBy] = useState<ViewBy>("Monthly");
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [editValue, setEditValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [nameWidth, setNameWidth] = useState(280);
  const [notice, setNotice] = useState("");
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null);

  const say = useCallback((m: string) => {
    setNotice(m);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 3200);
  }, []);

  useEffect(() => { getGridFyOptions().then((o) => { setFys(o); setFy((f) => f || o[0] || ""); }); }, []);
  useEffect(() => {
    if (!fy) return;
    getGridPlans(fy).then((ps) => {
      setPlans(ps);
      setPlanId((cur) => (ps.some((p) => p.id === cur) ? cur : ps[0]?.id ?? null));
    });
  }, [fy]);
  const loadPlan = useCallback(() => { if (planId != null) getGridPlan(planId).then(setPlan); }, [planId]);
  useEffect(() => { loadPlan(); }, [loadPlan]);

  const effMonth = plan?.type === "RE" ? (plan.effMonth ?? 7) : (plans.find((p) => p.type === "RE")?.effMonth ?? null);
  const reMonths = useMemo(() => new Set(effMonth ? FY_MONTHS.map((_, i) => i + 1).filter((m) => m >= effMonth) : []), [effMonth]);
  const approved = plan?.status === "Approved";
  const locked = useMemo(() => new Set(plan?.lockedMonths ?? []), [plan]);
  const fyShort = (i: number) => (i < 9 ? fy.slice(2, 4) : fy.includes("-") ? fy.split("-")[1].slice(-2) : fy.slice(2, 4));

  // ---- tree helpers -------------------------------------------------------
  const rows = plan?.rows ?? [];
  const hasChildren = useCallback((idx: number) => idx >= 0 && idx + 1 < rows.length && rows[idx + 1].indent > rows[idx].indent, [rows]);

  /** Rolled-up cell for any row: leaves read own months; parents sum descendant leaves. */
  const cellOf = useCallback((idx: number, month: number): { be: number; re: number; actual: number } => {
    const row = rows[idx];
    const own = row.months[String(month)];
    if (!hasChildren(idx)) return { be: own?.be ?? 0, re: own?.re ?? 0, actual: own?.actual ?? 0 };
    let be = 0, re = 0, actual = 0;
    for (let j = idx + 1; j < rows.length && rows[j].indent > row.indent; j++) {
      if (!hasChildren(j)) { const c = rows[j].months[String(month)]; be += c?.be ?? 0; re += c?.re ?? 0; actual += c?.actual ?? 0; }
    }
    return { be, re, actual };
  }, [rows, hasChildren]);

  const baseOf = useCallback((idx: number): { gross: number; cum: number; beFy: number; reFy: number } => {
    const row = rows[idx];
    if (!hasChildren(idx)) return { gross: row.gross, cum: row.cum_last_fy, beFy: row.be_fy, reFy: row.re_fy };
    let gross = 0, cum = 0, beFy = 0, reFy = 0;
    for (let j = idx + 1; j < rows.length && rows[j].indent > row.indent; j++) {
      if (!hasChildren(j)) { gross += rows[j].gross; cum += rows[j].cum_last_fy; beFy += rows[j].be_fy; reFy += rows[j].re_fy; }
    }
    return { gross, cum, beFy, reFy };
  }, [rows, hasChildren]);

  const visible = useMemo(() => {
    const out: number[] = []; const hideStack: number[] = [];
    rows.forEach((row, idx) => {
      while (hideStack.length && row.indent <= hideStack[hideStack.length - 1]) hideStack.pop();
      if (!hideStack.length) out.push(idx);
      if (collapsed.has(row.row_id)) hideStack.push(row.indent);
    });
    return out;
  }, [rows, collapsed]);

  const leafIdxs = useMemo(() => visible.filter((i) => !hasChildren(i)), [visible, hasChildren]);

  // ---- column model per view ---------------------------------------------
  interface ColGroup { key: string; label: string; sub: { metric: Metric; month?: number; quarter?: number[] }[]; lockable?: number; }
  const groups: ColGroup[] = useMemo(() => {
    if (viewBy === "Monthly") return FY_MONTHS.map((m, i) => {
      const mo = i + 1;
      const sub: ColGroup["sub"] = [{ metric: "be", month: mo }];
      if (reMonths.has(mo)) sub.push({ metric: "re", month: mo });
      sub.push({ metric: "actual", month: mo });
      return { key: `M${mo}`, label: `${m}-${fyShort(i)}`, sub, lockable: mo };
    });
    if (viewBy === "Quarterly") return QUARTERS.map((q) => {
      const sub: ColGroup["sub"] = [{ metric: "be", quarter: q.months }];
      if (q.months.some((m) => reMonths.has(m))) sub.push({ metric: "re", quarter: q.months });
      sub.push({ metric: "actual", quarter: q.months });
      return { key: q.key, label: q.key, sub };
    });
    return [{ key: "FY", label: `FY ${fy}`, sub: [{ metric: "be", quarter: FY_MONTHS.map((_, i) => i + 1) }, ...(reMonths.size ? [{ metric: "re" as Metric, quarter: FY_MONTHS.map((_, i) => i + 1) }] : []), { metric: "actual", quarter: FY_MONTHS.map((_, i) => i + 1) }] }];
  }, [viewBy, reMonths, fy]); // eslint-disable-line react-hooks/exhaustive-deps

  const valueFor = useCallback((idx: number, sub: ColGroup["sub"][number]): number => {
    const monthsList = sub.month ? [sub.month] : sub.quarter ?? [];
    let v = 0;
    monthsList.forEach((m) => {
      const c = cellOf(idx, m);
      if (sub.metric === "re" && effMonth && m < effMonth) v += c.actual; // RE ghost autofill pre-effective
      else v += c[sub.metric];
    });
    return v;
  }, [cellOf, effMonth]);

  // ---- editing ------------------------------------------------------------
  const beginEdit = useCallback((idx: number, month: number) => {
    const row = rows[idx];
    if (hasChildren(idx)) { setCollapsed((c) => { const n = new Set(c); n.has(row.row_id) ? n.delete(row.row_id) : n.add(row.row_id); return n; }); return; }
    if (row.level !== "Item" && row.level !== "Package") { say("Actual entry for this parent line must be done through its child items."); return; }
    if (locked.has(month)) { say(`${FY_MONTHS[month - 1]} is locked — unlock the month from its header first.`); return; }
    const cur = rows[idx].months[String(month)]?.actual ?? 0;
    setEdit({ rowId: row.row_id, month });
    setEditValue(cur ? String(cur) : "");
  }, [rows, hasChildren, locked, say]);

  const commitEdit = useCallback(async (move: "down" | "right" | "stay") => {
    if (!edit || !plan) return;
    const amount = Number(editValue || 0);
    if (!Number.isFinite(amount) || amount < 0) { say("Enter a valid non-negative amount."); return; }
    setBusy(true);
    try {
      await saveActualCell(plan.fy, edit.rowId, edit.month, amount);
      setPlan((p) => p && ({
        ...p,
        rows: p.rows.map((r) => r.row_id === edit.rowId
          ? { ...r, months: { ...r.months, [String(edit.month)]: { ...(r.months[String(edit.month)] ?? { be: 0, re: 0 }), be: r.months[String(edit.month)]?.be ?? 0, re: r.months[String(edit.month)]?.re ?? 0, actual: amount } } }
          : r),
      }));
      toast(`Actual saved — ${FY_MONTHS[edit.month - 1]} · ₹${inr(amount, 2)} Cr`);
      const curLeafPos = leafIdxs.findIndex((i) => rows[i].row_id === edit.rowId);
      if (move === "down" && curLeafPos >= 0 && curLeafPos + 1 < leafIdxs.length) {
        const nxt = leafIdxs[curLeafPos + 1];
        setEdit({ rowId: rows[nxt].row_id, month: edit.month });
        setEditValue(String(rows[nxt].months[String(edit.month)]?.actual || ""));
      } else if (move === "right" && edit.month < 12) {
        const nm = edit.month + 1;
        setEdit({ rowId: edit.rowId, month: nm });
        const r = rows.find((x) => x.row_id === edit.rowId);
        setEditValue(String(r?.months[String(nm)]?.actual || ""));
      } else setEdit(null);
    } catch (e: any) { say(e?.message || "Save failed"); }
    finally { setBusy(false); }
  }, [edit, editValue, plan, rows, leafIdxs, say]);

  const onEditKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); commitEdit("down"); }
    else if (e.key === "Tab") { e.preventDefault(); commitEdit("right"); }
    else if (e.key === "Escape") setEdit(null);
  };

  // ---- lock / approve / export -------------------------------------------
  const onLockToggle = async (month: number) => {
    if (!plan) return;
    const to = !locked.has(month);
    try { await toggleMonthLock(plan.fy, month, to); setPlan((p) => p && ({ ...p, lockedMonths: to ? [...p.lockedMonths, month] : p.lockedMonths.filter((m) => m !== month) })); toast(`${FY_MONTHS[month - 1]} ${to ? "locked" : "unlocked"}`); }
    catch (e: any) { say(e?.message || "Lock toggle failed"); }
  };
  const onApproveToggle = async () => {
    if (!plan) return;
    try { approved ? await unlockPlan(plan.id) : await approvePlan(plan.id); setPlan((p) => p && ({ ...p, status: approved ? "Draft" : "Approved" })); toast(approved ? "Plan unlocked for edit" : "Plan approved & frozen"); }
    catch (e: any) { say(e?.message || "Action failed"); }
  };
  const exportCsv = () => {
    const header = ["Row", "Level", "Gross Cost", "Cum till last FY", "BE (FY)", "RE (FY)",
      ...groups.flatMap((g) => g.sub.map((s) => `${g.label} ${METRIC_LABEL[s.metric]}`)), "Achv %"];
    const data = visible.map((idx) => {
      const r = rows[idx]; const b = baseOf(idx);
      const cells = groups.flatMap((g) => g.sub.map((s) => valueFor(idx, s)));
      const totBe = groups.flatMap((g) => g.sub.filter((s) => s.metric === "be").map((s) => valueFor(idx, s))).reduce((a, v) => a + v, 0);
      const totAc = groups.flatMap((g) => g.sub.filter((s) => s.metric === "actual").map((s) => valueFor(idx, s))).reduce((a, v) => a + v, 0);
      return ["  ".repeat(r.indent) + r.name, r.level, b.gross, b.cum, b.beFy, b.reFy, ...cells, totBe ? +(totAc / totBe * 100).toFixed(1) : 0];
    });
    downloadCSV(`capex-grid-${fy}-${plan?.type}-${viewBy}`, header, data, `CAPEX ${plan?.type} ${plan?.version} — FY ${fy} (${viewBy})`);
    toast("Grid exported (CSV)");
  };

  // ---- name column resize ---------------------------------------------------
  useEffect(() => {
    const move = (e: MouseEvent) => { if (resizeRef.current) setNameWidth(Math.max(180, Math.min(520, resizeRef.current.startW + e.clientX - resizeRef.current.startX))); };
    const up = () => { resizeRef.current = null; document.body.style.cursor = ""; };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, []);

  // ---- style bits -----------------------------------------------------------
  const th: React.CSSProperties = { padding: "6px 10px", fontSize: 11, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--steel-dim)", borderBottom: "1px solid var(--line)", background: "var(--panel)", position: "sticky", top: 0, zIndex: 3 };
  const subTh: React.CSSProperties = { ...th, top: 29, fontSize: 10.5, zIndex: 2 };
  const td: React.CSSProperties = { padding: "5px 10px", borderBottom: "1px solid var(--grid-line)", fontSize: 12.5 };
  const stickyName = (bg: string): React.CSSProperties => ({ position: "sticky", left: 0, zIndex: 1, background: bg, borderRight: "1px solid var(--line)" });

  const heat = (be: number, actual: number): React.CSSProperties => {
    if (!be && !actual) return {};
    const ratio = be ? actual / be : 1;
    if (!actual) return {};
    if (ratio >= 0.97) return { background: "var(--verdigris-soft)" };
    if (ratio >= 0.8) return { background: "var(--slag-soft)" };
    return { background: "var(--molten-soft)" };
  };

  const totals = useMemo(() => {
    const roots = rows.map((_, i) => i).filter((i) => rows[i].indent === 0);
    const sumSub = (s: ColGroup["sub"][number]) => roots.reduce((a, i) => a + valueFor(i, s), 0);
    const base = roots.reduce((a, i) => { const b = baseOf(i); return { gross: a.gross + b.gross, cum: a.cum + b.cum, beFy: a.beFy + b.beFy, reFy: a.reFy + b.reFy }; }, { gross: 0, cum: 0, beFy: 0, reFy: 0 });
    return { base, sumSub };
  }, [rows, valueFor, baseOf]);

  const grandBe = groups.flatMap((g) => g.sub.filter((s) => s.metric === "be")).reduce((a, s) => a + totals.sumSub(s), 0);
  const grandAc = groups.flatMap((g) => g.sub.filter((s) => s.metric === "actual")).reduce((a, s) => a + totals.sumSub(s), 0);

  return (
    <div className="fz fz-app" style={{ padding: "22px 26px 70px" }}>
      <PageHeader
        title="CAPEX Planning Grid"
        subtitle="BE / RE / Actuals · plan versions with effective month · double-click a leaf Actual to enter"
        right={<>
          <Field label="Financial year"><Select value={fy} onChange={setFy} options={fys.map((f) => ({ value: f, label: `FY ${f}` }))} style={{ minWidth: 130 }} /></Field>
          <Field label="View"><Segmented options={(["Monthly", "Quarterly", "FY Summary"] as ViewBy[]).map((v) => ({ value: v, label: v }))} value={viewBy} onChange={(v) => setViewBy(v as ViewBy)} /></Field>
          <ThemeToggle />
        </>}
      />

      {/* Plan version bar */}
      <Card style={{ marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--steel-dim)" }}>Plan version</span>
          {plans.map((p) => (
            <button key={p.id} onClick={() => setPlanId(p.id)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: "var(--r)",
                border: `1px solid ${p.id === planId ? "var(--steel)" : "var(--line)"}`,
                background: p.id === planId ? "var(--steel-soft)" : "var(--panel)", cursor: "pointer", ...mono, fontSize: 12,
              }}>
              <b>{p.type}</b> {p.version}
              <Chip tone={p.status === "Approved" ? "ok" : "neutral"} dot>{p.status}</Chip>
              {p.type === "RE" && p.effMonth ? <Chip tone="minor">eff {FY_MONTHS[p.effMonth - 1]}</Chip> : null}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <Button onClick={onApproveToggle} kind={approved ? "default" : "accent"}>{approved ? "Unlock plan" : "Approve & freeze"}</Button>
          <Button onClick={exportCsv}>Export CSV</Button>
          <Button onClick={loadPlan}>Refresh</Button>
        </div>
        {notice ? <div style={{ marginTop: 10, padding: "7px 12px", borderRadius: "var(--r)", background: "var(--ember-soft)", border: "1px solid var(--line)", fontSize: 12.5 }}>{notice}</div> : null}
      </Card>

      {/* Grid */}
      <Card pad={false} style={{ marginTop: 14, overflow: "hidden" }}>
        <div style={{ overflow: "auto", maxHeight: "calc(100vh - 320px)" }}>
          <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "max-content", minWidth: "100%" }}>
            <thead>
              <tr>
                <th style={{ ...th, ...stickyName("var(--panel)"), zIndex: 4, textAlign: "left", width: nameWidth, minWidth: nameWidth, maxWidth: nameWidth }} rowSpan={2}>
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    CAPEX Plan (FY)
                    <span onMouseDown={(e) => { resizeRef.current = { startX: e.clientX, startW: nameWidth }; document.body.style.cursor = "col-resize"; }}
                      style={{ cursor: "col-resize", padding: "0 4px", color: "var(--steel-dim)", userSelect: "none" }}>⋮⋮</span>
                  </span>
                </th>
                {["Gross Cost", "Cum till last FY", "BE (FY)", "RE (FY)"].map((c) => <th key={c} style={{ ...th, textAlign: "right" }} rowSpan={2}>{c}</th>)}
                {groups.map((g) => (
                  <th key={g.key} colSpan={g.sub.length} style={{ ...th, textAlign: "center", borderLeft: "1px solid var(--line)" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      {g.label}
                      {g.lockable ? (
                        <button title={locked.has(g.lockable) ? "Unlock month" : "Lock month"} onClick={() => onLockToggle(g.lockable!)}
                          style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 11, color: locked.has(g.lockable) ? "var(--molten)" : "var(--steel-dim)" }}>
                          {locked.has(g.lockable) ? "🔒" : "🔓"}
                        </button>
                      ) : null}
                    </span>
                  </th>
                ))}
                <th style={{ ...th, textAlign: "right", borderLeft: "1px solid var(--line)" }} rowSpan={2}>Achv %</th>
              </tr>
              <tr>
                {groups.flatMap((g) => g.sub.map((s, si) => (
                  <th key={`${g.key}-${s.metric}`} style={{ ...subTh, textAlign: "right", ...(si === 0 ? { borderLeft: "1px solid var(--line)" } : {}) }}>{METRIC_LABEL[s.metric]}</th>
                )))}
              </tr>
            </thead>
            <tbody>
              {visible.map((idx) => {
                const r = rows[idx];
                const parent = hasChildren(idx);
                const b = baseOf(idx);
                const rowBe = groups.flatMap((g) => g.sub.filter((s) => s.metric === "be").map((s) => valueFor(idx, s))).reduce((a, v) => a + v, 0);
                const rowAc = groups.flatMap((g) => g.sub.filter((s) => s.metric === "actual").map((s) => valueFor(idx, s))).reduce((a, v) => a + v, 0);
                const achv = rowBe ? (rowAc / rowBe) * 100 : 0;
                const rowBg = r.indent === 0 ? "var(--bg-tint-cool)" : r.indent === 1 ? "var(--panel)" : "var(--bg)";
                const nameWeight = r.indent === 0 ? 700 : r.indent === 1 ? 600 : 400;
                return (
                  <tr key={r.row_id} style={{ background: rowBg }}>
                    <td style={{ ...td, ...stickyName(rowBg), width: nameWidth, minWidth: nameWidth, maxWidth: nameWidth, fontWeight: nameWeight }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, paddingLeft: r.indent * 16 }}>
                        {parent ? (
                          <button onClick={() => setCollapsed((c) => { const n = new Set(c); n.has(r.row_id) ? n.delete(r.row_id) : n.add(r.row_id); return n; })}
                            style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--steel)", width: 16, ...mono }}>
                            {collapsed.has(r.row_id) ? "▸" : "▾"}
                          </button>
                        ) : <span style={{ width: 16 }} />}
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.name}>{r.name}</span>
                      </span>
                    </td>
                    <td style={{ ...td, ...num }}>{fmt(b.gross)}</td>
                    <td style={{ ...td, ...num }}>{fmt(b.cum)}</td>
                    <td style={{ ...td, ...num }}>{fmt(b.beFy)}</td>
                    <td style={{ ...td, ...num, color: reMonths.size ? undefined : "var(--steel-dim)" }}>{fmt(b.reFy)}</td>
                    {groups.flatMap((g) => g.sub.map((s, si) => {
                      const v = valueFor(idx, s);
                      const isEditing = !parent && s.metric === "actual" && s.month != null && edit?.rowId === r.row_id && edit.month === s.month;
                      const editable = !parent && s.metric === "actual" && s.month != null && (r.level === "Item" || r.level === "Package");
                      const ghost = s.metric === "re" && s.month != null && effMonth != null && s.month < effMonth;
                      const beHere = s.metric === "actual" ? (s.month ? cellOf(idx, s.month).be : valueFor(idx, { metric: "be", quarter: s.quarter })) : 0;
                      return (
                        <td key={`${g.key}-${s.metric}`}
                          onDoubleClick={s.metric === "actual" && s.month != null ? () => beginEdit(idx, s.month!) : undefined}
                          title={editable ? "Double-click to enter actual" : undefined}
                          style={{
                            ...td, ...num, ...(si === 0 ? { borderLeft: "1px solid var(--grid-line)" } : {}),
                            ...(s.metric === "actual" ? heat(beHere, v) : {}),
                            ...(ghost ? { color: "var(--steel-dim)", fontStyle: "italic" } : {}),
                            ...(editable ? { cursor: "cell" } : {}),
                          }}>
                          {isEditing ? (
                            <input autoFocus value={editValue} disabled={busy}
                              onChange={(e) => setEditValue(e.target.value)} onKeyDown={onEditKey} onBlur={() => commitEdit("stay")}
                              style={{ width: 74, ...num, padding: "2px 4px", border: "1px solid var(--steel)", borderRadius: 4, background: "var(--panel)", color: "var(--ink)", outline: "none" }} />
                          ) : fmt(v)}
                        </td>
                      );
                    }))}
                    <td style={{ ...td, ...num, borderLeft: "1px solid var(--grid-line)", color: achv >= 95 ? "var(--verdigris)" : achv >= 75 ? "var(--slag)" : rowAc ? "var(--molten)" : "var(--steel-dim)" }}>
                      {rowBe ? `${inr(achv, 1)}%` : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: "var(--panel)", fontWeight: 700 }}>
                <td style={{ ...td, ...stickyName("var(--panel)"), borderTop: "2px solid var(--line)" }}>TOTAL</td>
                {[totals.base.gross, totals.base.cum, totals.base.beFy, totals.base.reFy].map((v, i) => (
                  <td key={i} style={{ ...td, ...num, borderTop: "2px solid var(--line)" }}>{fmt(v)}</td>
                ))}
                {groups.flatMap((g) => g.sub.map((s, si) => (
                  <td key={`t-${g.key}-${s.metric}`} style={{ ...td, ...num, borderTop: "2px solid var(--line)", ...(si === 0 ? { borderLeft: "1px solid var(--grid-line)" } : {}) }}>{fmt(totals.sumSub(s))}</td>
                )))}
                <td style={{ ...td, ...num, borderTop: "2px solid var(--line)", borderLeft: "1px solid var(--grid-line)" }}>{grandBe ? `${inr((grandAc / grandBe) * 100, 1)}%` : ""}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div style={{ display: "flex", gap: 16, padding: "8px 14px", borderTop: "1px solid var(--line)", fontSize: 11.5, color: "var(--steel-dim)", flexWrap: "wrap" }}>
          <span>▸ double-click parent = expand/collapse</span>
          <span>▸ double-click leaf <b>Actual</b> = inline edit · Enter ↓ next row · Tab → next month · Esc cancel</span>
          <span>▸ <span style={{ background: "var(--verdigris-soft)", padding: "0 6px", borderRadius: 3 }}>≥97%</span> <span style={{ background: "var(--slag-soft)", padding: "0 6px", borderRadius: 3 }}>80–97%</span> <span style={{ background: "var(--molten-soft)", padding: "0 6px", borderRadius: 3 }}>&lt;80%</span> of BE</span>
          <span>▸ italic RE before effective month = auto-filled from Actual</span>
        </div>
      </Card>
    </div>
  );
}
