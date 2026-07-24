"use client";
/**
 * PPE Alert Settings — configure Telegram notifications without touching .env.
 *
 * Setup flow the UI enforces, because chat-id discovery is where operators get
 * stuck: paste bot token → Verify (getMe) → message the bot → Detect chats
 * (getUpdates) → tick the chats → Save → Send test.
 *
 * The bot token is never sent back to the browser in full; the API returns a
 * masked hint plus telegram_bot_token_set, and an empty token on save means
 * "leave unchanged".
 */
import React, { useCallback, useEffect, useState } from "react";

const API_BASE = (process.env.NEXT_PUBLIC_PPE_API_URL || "http://127.0.0.1:8004").replace(/\/$/, "");

async function api(path, options = {}) {
  const r = await fetch(`${API_BASE}${path}`, { cache: "no-store", ...options });
  const t = await r.text();
  let body;
  try { body = t ? JSON.parse(t) : {}; } catch { body = { detail: t }; }
  if (!r.ok) throw new Error(body.detail || `HTTP ${r.status}`);
  return body;
}

const C = {
  panel: "var(--panel)", panel2: "var(--panel-2)", ink: "var(--ink)", sub: "var(--ink-3)",
  line: "var(--line)", brand: "var(--steel)", ok: "var(--verdigris)",
  warn: "var(--slag)", danger: "var(--molten)", shadow: "var(--shadow)",
};
const mono = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" };

const GEAR_TYPES = [
  "NO_HELMET", "NO_VEST", "NO_GLOVES", "NO_BOOTS",
  "NO_GOGGLES", "NO_MASK", "NO_HARNESS",
];

const inputStyle = {
  width: "100%", padding: "9px 11px", borderRadius: 8,
  border: `1px solid ${C.line}`, background: C.panel, color: C.ink,
  fontSize: 13, outline: "none",
};

function Btn({ children, onClick, tone = "mute", disabled, style }) {
  const map = {
    primary: { bg: C.brand, fg: "#fff", bd: C.brand },
    ok: { bg: C.ok, fg: "#fff", bd: C.ok },
    mute: { bg: C.panel, fg: C.ink, bd: C.line },
  }[tone];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "8px 16px", borderRadius: 8, fontSize: 12.5, fontWeight: 800,
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
        background: map.bg, color: map.fg, border: `1px solid ${map.bd}`, ...style,
      }}
    >
      {children}
    </button>
  );
}

function Section({ title, hint, children }) {
  return (
    <div style={{
      background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12,
      padding: 18, marginBottom: 16, boxShadow: C.shadow,
    }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: C.ink, marginBottom: 4 }}>{title}</div>
      {hint && <div style={{ fontSize: 12, color: C.sub, marginBottom: 14 }}>{hint}</div>}
      {children}
    </div>
  );
}

export default function PPEAlertSettings() {
  const [cfg, setCfg] = useState(null);
  const [token, setToken] = useState("");
  const [chatIds, setChatIds] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [sendPhoto, setSendPhoto] = useState(true);
  const [cooldown, setCooldown] = useState(60);
  const [gearFilter, setGearFilter] = useState([]);
  // Alert policy — this is what stops the channel filling with duplicates.
  const [keyMode, setKeyMode] = useState("person");
  const [personCooldown, setPersonCooldown] = useState(300);
  const [escalateAfter, setEscalateAfter] = useState(900);
  const [incidentReset, setIncidentReset] = useState(1800);
  const [maxPerMin, setMaxPerMin] = useState(12);
  const [digestWindow, setDigestWindow] = useState(300);
  const [quietFrom, setQuietFrom] = useState(-1);
  const [quietTo, setQuietTo] = useState(-1);
  const [incidents, setIncidents] = useState(null);
  const [discovered, setDiscovered] = useState([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);

  const flash = (tone, text) => {
    setMsg({ tone, text });
    setTimeout(() => setMsg(null), 6000);
  };

  const load = useCallback(async () => {
    try {
      const c = await api("/api/alerts/config");
      setCfg(c);
      setEnabled(!!c.telegram_enabled);
      setSendPhoto(c.telegram_send_photo !== false);
      setChatIds(typeof c.telegram_chat_ids === "string" ? c.telegram_chat_ids : "");
      setCooldown(Number(c.cooldown_s) || 60);
      setGearFilter(Array.isArray(c.telegram_gear_filter) ? c.telegram_gear_filter : []);
      setKeyMode(c.key_mode || "person");
      setPersonCooldown(Number(c.person_cooldown_s) || 0);
      setEscalateAfter(Number(c.escalate_after_s) || 900);
      setIncidentReset(Number(c.incident_reset_s) || 1800);
      setMaxPerMin(Number(c.max_per_minute) ?? 12);
      setDigestWindow(Number(c.digest_window_s) ?? 300);
      setQuietFrom(Number(c.quiet_from) ?? -1);
      setQuietTo(Number(c.quiet_to) ?? -1);
    } catch (e) {
      flash("danger", `Could not load settings: ${e.message}`);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setBusy("save");
    try {
      const body = {
        telegram_enabled: enabled,
        telegram_chat_ids: chatIds,
        telegram_send_photo: sendPhoto,
        telegram_gear_filter: gearFilter,
        cooldown_s: Number(cooldown) || 60,
        key_mode: keyMode,
        person_cooldown_s: Number(personCooldown) || 0,
        escalate_after_s: Number(escalateAfter) || 900,
        incident_reset_s: Number(incidentReset) || 1800,
        max_per_minute: Number(maxPerMin) || 0,
        digest_window_s: Number(digestWindow) || 0,
        quiet_from: Number(quietFrom),
        quiet_to: Number(quietTo),
      };
      if (token.trim()) body.telegram_bot_token = token.trim();
      const saved = await api("/api/alerts/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setCfg(saved);
      setToken("");
      flash("ok", "Settings saved. Alerts route to Telegram immediately — no restart.");
    } catch (e) {
      flash("danger", e.message);
    } finally { setBusy(""); }
  };

  const verify = async () => {
    setBusy("verify");
    try {
      const q = token.trim() ? `?token=${encodeURIComponent(token.trim())}` : "";
      const r = await api(`/api/alerts/telegram/verify${q}`);
      flash("ok", `Token valid — bot @${r.bot_username} (${r.bot_name})`);
    } catch (e) {
      flash("danger", e.message);
    } finally { setBusy(""); }
  };

  const detect = async () => {
    setBusy("detect");
    try {
      const q = token.trim() ? `?token=${encodeURIComponent(token.trim())}` : "";
      const r = await api(`/api/alerts/telegram/chats${q}`);
      setDiscovered(r.chats || []);
      if (!r.chats?.length) flash("warn", r.hint || "No chats found yet.");
      else flash("ok", `Found ${r.chats.length} chat(s).`);
    } catch (e) {
      flash("danger", e.message);
    } finally { setBusy(""); }
  };

  const addChat = (id) => {
    const list = chatIds.split(",").map((s) => s.trim()).filter(Boolean);
    if (!list.includes(id)) setChatIds([...list, id].join(","));
  };

  const test = async () => {
    setBusy("test");
    try {
      const r = await api("/api/alerts/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ camera: "TEST-CAM", violation: "NO_HELMET" }),
      });
      flash("ok", `Test alert delivered to ${r.delivered.length} chat(s). Check Telegram.`);
    } catch (e) {
      flash("danger", e.message);
    } finally { setBusy(""); }
  };

  const loadIncidents = async () => {
    try { setIncidents(await api("/api/alerts/incidents")); }
    catch (e) { flash("danger", e.message); }
  };

  const resetIncidents = async () => {
    try {
      await api("/api/alerts/incidents/reset", { method: "POST" });
      flash("ok", "Incident state cleared — the next violation alerts fresh.");
      loadIncidents();
    } catch (e) { flash("danger", e.message); }
  };

  const toggleGear = (g) => {
    setGearFilter((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));
  };

  if (!cfg) {
    return <div style={{ padding: 24, color: C.sub, fontSize: 13 }}>Loading alert settings…</div>;
  }

  const ready = cfg.telegram_ready;

  return (
    <div style={{ maxWidth: 760 }}>
      {msg && (
        <div style={{
          marginBottom: 14, padding: "10px 14px", borderRadius: 9, fontSize: 12.5, fontWeight: 700,
          background: msg.tone === "ok" ? "#e6f6ef" : msg.tone === "warn" ? "#fdf1e3" : "#fdecee",
          color: msg.tone === "ok" ? "#0a8f5b" : msg.tone === "warn" ? "#b25e00" : "#c02b3c",
          border: `1px solid ${msg.tone === "ok" ? "#b8e6d0" : msg.tone === "warn" ? "#f0d4a8" : "#f5c2c8"}`,
        }}>{msg.text}</div>
      )}

      <Section
        title="Telegram alerts"
        hint="Every confirmed PPE violation is pushed to Telegram with the evidence photo. Cooldown prevents one bare-headed worker producing four hundred messages."
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Enable Telegram notifications</span>
          </label>
          <span style={{
            marginLeft: "auto", fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 999,
            background: ready ? "#e6f6ef" : "#fdf1e3", color: ready ? "#0a8f5b" : "#b25e00",
          }}>{ready ? "READY" : "NOT CONFIGURED"}</span>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.sub, marginBottom: 5 }}>
            Bot token {cfg.telegram_bot_token_set && (
              <span style={{ ...mono, fontWeight: 500 }}>· saved: {cfg.telegram_bot_token}</span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              style={{ ...inputStyle, ...mono }}
              type="password"
              placeholder={cfg.telegram_bot_token_set ? "Leave blank to keep current token" : "123456:ABC-DEF..."}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <Btn onClick={verify} disabled={busy === "verify"}>
              {busy === "verify" ? "…" : "Verify"}
            </Btn>
          </div>
          <div style={{ fontSize: 11, color: C.sub, marginTop: 5 }}>
            Create a bot with @BotFather in Telegram, then paste the token here.
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.sub, marginBottom: 5 }}>
            Chat IDs (comma-separated — users, groups or channels)
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              style={{ ...inputStyle, ...mono }}
              placeholder="-1001234567890, 987654321"
              value={chatIds}
              onChange={(e) => setChatIds(e.target.value)}
            />
            <Btn onClick={detect} disabled={busy === "detect"}>
              {busy === "detect" ? "…" : "Detect"}
            </Btn>
          </div>
          <div style={{ fontSize: 11, color: C.sub, marginTop: 5 }}>
            Send any message to your bot (or add it to a group and post once), then press Detect.
          </div>
          {discovered.length > 0 && (
            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
              {discovered.map((c) => (
                <button
                  key={c.chat_id}
                  onClick={() => addChat(c.chat_id)}
                  style={{
                    padding: "6px 12px", borderRadius: 999, fontSize: 11.5, fontWeight: 700,
                    border: `1px solid ${C.line}`, background: C.panel2, color: C.ink, cursor: "pointer",
                  }}
                >
                  + {c.title} <span style={{ ...mono, color: C.sub }}>({c.type} · {c.chat_id})</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 14 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={sendPhoto} onChange={(e) => setSendPhoto(e.target.checked)} />
            <span style={{ fontSize: 12.5, color: C.ink }}>Attach evidence photo</span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12.5, color: C.ink }}>Cooldown (seconds)</span>
            <input
              type="number" min={0} max={86400} value={cooldown}
              onChange={(e) => setCooldown(e.target.value)}
              style={{ ...inputStyle, ...mono, width: 90 }}
            />
          </label>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.sub, marginBottom: 7 }}>
            Notify only for (none selected = all violation types)
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
            {GEAR_TYPES.map((g) => {
              const on = gearFilter.includes(g);
              return (
                <button
                  key={g}
                  onClick={() => toggleGear(g)}
                  style={{
                    padding: "5px 11px", borderRadius: 999, fontSize: 11, fontWeight: 800,
                    cursor: "pointer", ...mono,
                    background: on ? "#fdecee" : C.panel2,
                    color: on ? "#c02b3c" : C.sub,
                    border: `1px solid ${on ? "#f5c2c8" : C.line}`,
                  }}
                >{g}</button>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <Btn tone="primary" onClick={save} disabled={busy === "save"}>
            {busy === "save" ? "Saving…" : "Save settings"}
          </Btn>
          <Btn tone="ok" onClick={test} disabled={!ready || busy === "test"}>
            {busy === "test" ? "Sending…" : "Send test alert"}
          </Btn>
        </div>
      </Section>

      <Section
        title="Duplicate suppression"
        hint="A channel that floods gets muted, and a muted channel alerts nobody. These rules decide what counts as the same incident."
      >
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.sub, marginBottom: 6 }}>
            Treat as the same incident when…
          </div>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {[
              ["person", "Same person + gear", "Correct for PPE. Ten bare-headed workers = ten alerts."],
              ["camera_gear", "Same camera + gear", "For scene hazards like fire, where who triggered it does not matter."],
              ["camera", "Same camera", "One alert per camera. Very quiet; use only for low-traffic zones."],
            ].map(([val, label, hint]) => (
              <button key={val} onClick={() => setKeyMode(val)} title={hint}
                style={{
                  padding: "7px 13px", borderRadius: 8, fontSize: 12, fontWeight: 700,
                  cursor: "pointer", textAlign: "left",
                  background: keyMode === val ? "#eef4fb" : C.panel2,
                  color: keyMode === val ? "#1c4f82" : C.sub,
                  border: `1px solid ${keyMode === val ? "#9dc0e4" : C.line}`,
                }}>{label}</button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: C.sub, marginTop: 6 }}>
            {keyMode === "person"
              ? "Each worker is tracked separately, so a second violator is never hidden behind the first."
              : keyMode === "camera_gear"
                ? "All people on a camera share one alert per gear type."
                : "Everything on a camera collapses into one alert."}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12 }}>
          {[
            ["Quiet period (s)", personCooldown, setPersonCooldown,
             "Minimum gap between alerts for the same person, including if they leave and re-enter frame. 0 uses the cooldown above."],
            ["Escalate after (s)", escalateAfter, setEscalateAfter,
             "Still violating this long after the first alert? Re-alert as an escalation — uncorrected is worse than new."],
            ["Incident closes after (s)", incidentReset, setIncidentReset,
             "Not seen violating for this long ends the incident. The next violation starts fresh."],
            ["Max alerts / minute", maxPerMin, setMaxPerMin,
             "Burst cap across all cameras. Anything above this rolls into the digest. 0 disables."],
            ["Digest window (s)", digestWindow, setDigestWindow,
             "Suppressed alerts are summarised and sent at this interval. 0 discards them."],
          ].map(([label, val, setter, hint]) => (
            <label key={label} style={{ display: "block" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.sub, marginBottom: 4 }}>{label}</div>
              <input type="number" min={0} value={val}
                onChange={(e) => setter(e.target.value)}
                style={{ ...inputStyle, ...mono }} />
              <div style={{ fontSize: 10.5, color: C.sub, marginTop: 4, lineHeight: 1.4 }}>{hint}</div>
            </label>
          ))}
        </div>

        <div style={{ marginTop: 14, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: C.sub }}>Quiet hours</span>
          <input type="number" min={-1} max={23} value={quietFrom}
            onChange={(e) => setQuietFrom(e.target.value)}
            style={{ ...inputStyle, ...mono, width: 80 }} />
          <span style={{ fontSize: 12, color: C.sub }}>to</span>
          <input type="number" min={-1} max={23} value={quietTo}
            onChange={(e) => setQuietTo(e.target.value)}
            style={{ ...inputStyle, ...mono, width: 80 }} />
          <span style={{ fontSize: 11, color: C.sub }}>
            −1 disables. Escalations still go out during quiet hours.
          </span>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
          <Btn tone="primary" onClick={save} disabled={busy === "save"}>
            {busy === "save" ? "Saving…" : "Save policy"}
          </Btn>
          <Btn onClick={loadIncidents}>View live incidents</Btn>
          {incidents && <Btn onClick={resetIncidents}>Clear incident state</Btn>}
        </div>

        {incidents && (
          <div style={{ marginTop: 14, borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
            <div style={{ fontSize: 12, color: C.sub, marginBottom: 8 }}>
              {incidents.stats.active_incidents} active ·{" "}
              {incidents.stats.sent_last_minute} sent in the last minute ·{" "}
              {incidents.stats.pending_digest} awaiting digest
            </div>
            {incidents.incidents.length === 0 ? (
              <div style={{ fontSize: 12, color: C.sub }}>No incidents currently open.</div>
            ) : (
              <div style={{ maxHeight: 220, overflowY: "auto" }}>
                {incidents.incidents.map((i) => (
                  <div key={i.key} style={{
                    display: "flex", gap: 10, alignItems: "baseline", padding: "5px 0",
                    borderBottom: `1px solid ${C.line}`, fontSize: 12,
                  }}>
                    <span style={{ ...mono, fontWeight: 700 }}>{i.camera}</span>
                    <span style={{ color: "#c02b3c", fontWeight: 700 }}>{i.gear}</span>
                    <span style={{ ...mono, color: C.sub }}>{i.person}</span>
                    <span style={{ marginLeft: "auto", ...mono, color: C.sub }}>
                      {i.observations} seen · {i.alerts} sent
                      {i.escalations > 0 && ` · esc ${i.escalations}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
