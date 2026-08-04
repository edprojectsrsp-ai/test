"use client";
/**
 * Assign / close-out control for a single violation.
 *
 * The workflow this implements is deliberately small: name an owner, set a
 * date, and on close-out record what was actually done. That is the difference
 * between an evidence gallery and something a safety department can run a
 * meeting from — an unowned violation is one nobody fixes, and a "resolved"
 * with no note is indistinguishable from someone clearing their queue.
 *
 * The assignee list is a datalist rather than a dropdown: it suggests known
 * employees and contractors, but still accepts a name that is in neither.
 * On a contractor-heavy site the responsible supervisor is usually in no
 * master data, and refusing the assignment would push the workflow back into
 * WhatsApp, which is exactly what this replaces.
 */
import React, { useCallback, useEffect, useState } from "react";
import { ppeGet, ppePost } from "../../lib/ppeClient";

export default function AssignPanel({ violation, onChange, compact = false }) {
  const [assignees, setAssignees] = useState([]);
  const [name, setName] = useState(violation?.assigned_to || "");
  const [due, setDue] = useState(toDateInput(violation?.due_at));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [mode, setMode] = useState(null); // null | "assign" | "resolve"

  useEffect(() => {
    setName(violation?.assigned_to || "");
    setDue(toDateInput(violation?.due_at));
    setNote("");
    setMode(null);
    setErr("");
  }, [violation?.id, violation?.assigned_to, violation?.due_at]);

  useEffect(() => {
    let alive = true;
    ppeGet("/api/violations/assignees")
      .then((d) => alive && setAssignees(d.assignees || []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const run = useCallback(
    async (fn) => {
      setBusy(true);
      setErr("");
      try {
        const updated = await fn();
        onChange?.(updated);
        setMode(null);
        setNote("");
      } catch (e) {
        setErr(e?.message || String(e));
      } finally {
        setBusy(false);
      }
    },
    [onChange],
  );

  if (!violation) return null;

  const assigned = Boolean(violation.assigned_to);
  const closed =
    violation.status === "resolved" || violation.status === "false_alarm";

  return (
    <div style={{ display: "grid", gap: 8, fontSize: 12.5 }}>
      {/* current state */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ color: "var(--ink-3)", fontSize: 11, fontWeight: 700,
                       textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Owner
        </span>
        {assigned ? (
          <>
            <strong>{violation.assigned_to}</strong>
            {violation.due_at ? (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  padding: "2px 7px",
                  borderRadius: 5,
                  color: violation.overdue ? "var(--molten)" : "var(--ink-3)",
                  background: violation.overdue ? "var(--molten-soft)" : "transparent",
                }}
                title={violation.due_at}
              >
                {violation.overdue ? "OVERDUE " : "due "}
                {new Date(violation.due_at).toLocaleDateString()}
              </span>
            ) : null}
          </>
        ) : (
          <span style={{ color: "var(--ink-3)" }}>unassigned</span>
        )}
      </div>

      {violation.assignment_note ? (
        <div style={{ color: "var(--ink-3)", fontSize: 12 }}>
          “{violation.assignment_note}”
        </div>
      ) : null}

      {closed && violation.resolution_note ? (
        <div
          style={{
            borderLeft: "3px solid var(--verdigris)",
            paddingLeft: 8,
            color: "var(--ink-2, var(--ink))",
          }}
        >
          <div style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 700 }}>
            Closed{violation.resolved_by ? ` by ${violation.resolved_by}` : ""}
          </div>
          {violation.resolution_note}
        </div>
      ) : null}

      {/* actions */}
      {!mode ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {!closed ? (
            <button type="button" className="ppe-btn" onClick={() => setMode("assign")}>
              {assigned ? "Reassign" : "Assign"}
            </button>
          ) : null}
          {!closed ? (
            <button
              type="button"
              className="ppe-btn ppe-btn--primary"
              onClick={() => setMode("resolve")}
            >
              Close out
            </button>
          ) : null}
          {assigned && !closed ? (
            <button
              type="button"
              className="ppe-btn"
              disabled={busy}
              onClick={() =>
                run(() => ppePost(`/api/violations/${violation.id}/unassign`))
              }
            >
              Clear owner
            </button>
          ) : null}
        </div>
      ) : null}

      {mode === "assign" ? (
        <div style={{ display: "grid", gap: 6 }}>
          <input
            list="ppe-assignees"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name or contractor"
            style={inputStyle}
            autoFocus
          />
          <datalist id="ppe-assignees">
            {assignees.map((a) => (
              <option key={`${a.kind}-${a.name}`} value={a.name}>
                {a.department || a.kind}
              </option>
            ))}
          </datalist>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              title="Due date"
              style={inputStyle}
            />
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What needs doing?"
              style={{ ...inputStyle, flex: 1, minWidth: 140 }}
            />
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              className="ppe-btn ppe-btn--primary"
              disabled={busy || !name.trim()}
              onClick={() =>
                run(() =>
                  ppePost(`/api/violations/${violation.id}/assign`, {
                    assigned_to: name.trim(),
                    assigned_to_id:
                      assignees.find((a) => a.name === name.trim())?.id || null,
                    contractor_id:
                      assignees.find((a) => a.name === name.trim())?.contractor_id || null,
                    due_at: due || null,
                    note,
                  }),
                )
              }
            >
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" className="ppe-btn" onClick={() => setMode(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {mode === "resolve" ? (
        <div style={{ display: "grid", gap: 6 }}>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What corrective action was taken?"
            rows={compact ? 2 : 3}
            style={{ ...inputStyle, resize: "vertical" }}
            autoFocus
          />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              type="button"
              className="ppe-btn ppe-btn--primary"
              disabled={busy}
              onClick={() =>
                run(() =>
                  ppePost(`/api/violations/${violation.id}/resolve`, { note }),
                )
              }
            >
              {busy ? "Saving…" : "Resolved"}
            </button>
            <button
              type="button"
              className="ppe-btn"
              disabled={busy}
              title="The detection was wrong — excluded from compliance figures"
              onClick={() =>
                run(() =>
                  ppePost(`/api/violations/${violation.id}/resolve`, {
                    note,
                    false_alarm: true,
                  }),
                )
              }
            >
              False alarm
            </button>
            <button type="button" className="ppe-btn" onClick={() => setMode(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {err ? (
        <div style={{ color: "var(--molten)", fontSize: 12 }}>{err}</div>
      ) : null}
    </div>
  );
}

/** ISO timestamp -> yyyy-mm-dd for <input type="date">. */
function toDateInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

const inputStyle = {
  padding: "7px 10px",
  borderRadius: 8,
  fontSize: 12.5,
  border: "1px solid var(--line-2, var(--line))",
  background: "var(--panel-2)",
  color: "var(--ink)",
  fontFamily: "inherit",
};
