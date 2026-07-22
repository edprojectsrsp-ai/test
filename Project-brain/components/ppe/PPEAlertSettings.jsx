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
    </div>
  );
}
