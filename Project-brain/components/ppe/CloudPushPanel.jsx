"use client";
/**
 * Cloud push control — the operator's "send violations to the dashboard" button.
 *
 * Auto-sync is off by default on the agent, so this button is normally the only
 * way violations leave the plant PC. That is deliberate, and it shapes this UI:
 * the pending count and the filters are shown BEFORE anything is sent, because
 * the decision being made is "should this footage go to a public cloud", and an
 * operator cannot make it from a spinner.
 *
 * Renders only when a local agent is present — there is nothing to push from a
 * remote browser.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  agentStatus,
  fetchSyncStatus,
  pushToCloud,
  subscribeAgent,
} from "../../lib/ppeClient";

export default function CloudPushPanel({ compact = false }) {
  const [agent, setAgent] = useState(agentStatus());
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [open, setOpen] = useState(false);
  const [filters, setFilters] = useState({ camera_id: "", since: "", limit: "" });

  useEffect(() => subscribeAgent((s) => setAgent(s.status)), []);

  const refresh = useCallback(async () => {
    if (agentStatus() !== "online") return;
    try {
      setStatus(await fetchSyncStatus());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh, agent]);

  const send = useCallback(
    async (dryRun) => {
      setBusy(true);
      setResult(null);
      try {
        const payload = { dry_run: dryRun };
        if (filters.camera_id) payload.camera_id = filters.camera_id;
        if (filters.since) payload.since = filters.since;
        if (filters.limit) payload.limit = Number(filters.limit);
        const r = await pushToCloud(payload);
        setResult(r);
        await refresh();
      } catch (e) {
        setResult({ ok: false, error: e?.message || String(e) });
      } finally {
        setBusy(false);
      }
    },
    [filters, refresh],
  );

  if (agent !== "online") return null;

  const pending = status?.pending ?? 0;
  const configured = status?.configured;
  const tone = !configured ? "mute" : pending > 0 ? "warn" : "ok";

  if (compact) {
    return (
      <div className={`ppe-chip ppe-chip--${tone}`} title={describe(status)}>
        <span className="ppe-chip__label">Queued</span>
        <span className="ppe-chip__value">{configured ? pending : "—"}</span>
      </div>
    );
  }

  return (
    <div className="ppe-card" style={{ padding: 14 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: open ? 12 : 0,
        }}
      >
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 800, fontSize: 13 }}>Cloud dashboard</div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>
            {describe(status)}
          </div>
        </div>

        <button
          type="button"
          className="ppe-btn"
          onClick={() => setOpen((v) => !v)}
          disabled={!configured}
        >
          {open ? "Hide options" : "Options"}
        </button>
        <button
          type="button"
          className="ppe-btn ppe-btn--primary"
          onClick={() => send(false)}
          disabled={busy || !configured || pending === 0}
          title={
            !configured
              ? "Set PPE_SYNC_URL, PPE_AGENT_ID and PPE_AGENT_TOKEN in the agent's .env"
              : pending === 0
                ? "Nothing queued"
                : `Send ${pending} violation(s) to the cloud dashboard`
          }
        >
          {busy ? "Sending…" : `Push${pending ? ` ${pending}` : ""}`}
        </button>
      </div>

      {open ? (
        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "flex-end",
            borderTop: "1px solid var(--line-2)",
            paddingTop: 12,
          }}
        >
          <Field label="Camera">
            <input
              value={filters.camera_id}
              onChange={(e) => setFilters((f) => ({ ...f, camera_id: e.target.value }))}
              placeholder="all cameras"
              style={inputStyle}
            />
          </Field>
          <Field label="From date">
            <input
              type="date"
              value={filters.since}
              onChange={(e) => setFilters((f) => ({ ...f, since: e.target.value }))}
              style={inputStyle}
            />
          </Field>
          <Field label="Max rows">
            <input
              type="number"
              min="1"
              value={filters.limit}
              onChange={(e) => setFilters((f) => ({ ...f, limit: e.target.value }))}
              placeholder="no limit"
              style={{ ...inputStyle, width: 110 }}
            />
          </Field>
          <button
            type="button"
            className="ppe-btn"
            onClick={() => send(true)}
            disabled={busy}
            title="Count what these filters would send, without sending it"
          >
            Preview
          </button>
        </div>
      ) : null}

      {result ? (
        <div
          className={`ppe-banner ppe-banner--${result.ok ? "ok" : "danger"}`}
          style={{ marginTop: 12 }}
          role="status"
        >
          {result.dry_run
            ? `${result.pending} violation(s) match — nothing sent.`
            : result.ok
              ? `Sent ${result.sent} violation(s). ${result.pending} still queued.`
              : `Push failed: ${result.error || "unknown error"}`}
        </div>
      ) : null}
    </div>
  );
}

function describe(status) {
  if (!status) return "Checking…";
  if (!status.configured) {
    return "Not linked to a cloud dashboard — violations stay on this PC.";
  }
  const bits = [`${status.pending ?? 0} queued`];
  bits.push(status.auto_sync ? "auto-sync on" : "manual only");
  if (status.last_push_at) {
    const when = new Date(status.last_push_at).toLocaleString();
    bits.push(status.last_ok ? `last sent ${when}` : `last attempt failed (${when})`);
  } else {
    bits.push("never pushed");
  }
  return bits.join(" · ");
}

const inputStyle = {
  padding: "7px 10px",
  borderRadius: 8,
  fontSize: 12.5,
  border: "1px solid var(--line-2)",
  background: "var(--panel-2)",
  color: "var(--ink)",
};

function Field({ label, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "var(--ink-3)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
