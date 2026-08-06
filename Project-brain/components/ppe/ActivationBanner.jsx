"use client";
/**
 * "This PC is not registered" — shown until the agent holds its own credentials.
 *
 * The product installs and runs with no registration at all: detection,
 * recording and this console work offline by design, because a plant PC often
 * has no internet. But nothing ever told the customer they were meant to
 * register, and nothing explained why Push did nothing. The enrolment machinery
 * existed; it was just never surfaced outside a card on the Settings tab.
 *
 * Deliberately non-blocking. Detection is a safety function — refusing to record
 * violations because a PC cannot reach the internet is a worse failure than
 * running unregistered.
 *
 * Registration is one exchange: a code from the supplier is swapped, once, for
 * this machine's own token. The code is not stored afterwards and the PC never
 * asks again.
 */
import React, { useCallback, useEffect, useState } from "react";
import { enrollAgent, fetchSyncStatus } from "../../lib/ppeClient";

const MANAGED_CLOUD_URL = "https://project-brain-ppe-lite.onrender.com";

export default function ActivationBanner() {
  const [status, setStatus] = useState(null);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await fetchSyncStatus());
    } catch {
      // Agent still starting. Silence beats telling an operator their PC is
      // unregistered when we simply could not ask yet.
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30000);
    return () => clearInterval(t);
  }, [refresh]);

  const activate = useCallback(async () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await enrollAgent({
        cloud_url: MANAGED_CLOUD_URL,
        code: trimmed,
        name: name.trim(),
      });
      setResult({ ok: true, message: `This PC is registered as ${r.agent_id}.` });
      setCode("");
      await refresh();
    } catch (e) {
      setResult({
        ok: false,
        message:
          e?.message ||
          "Could not register. Check the code and this PC's internet connection.",
      });
    } finally {
      setBusy(false);
    }
  }, [code, name, refresh]);

  if (!status || status.configured) return null;

  return (
    <div className="ppe-activate">
      <div className="ppe-activate__row">
        <span className="ppe-activate__dot" aria-hidden="true" />
        <div className="ppe-activate__text">
          <strong>This PC is not registered.</strong> Detection and recording are
          running normally and violations are being saved here. Register to send
          them to the cloud dashboard.
        </div>
        <button
          type="button"
          className="ppe-activate__btn"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Not now" : "Register this PC"}
        </button>
      </div>

      {open ? (
        <div className="ppe-activate__form">
          <label className="ppe-activate__field">
            <span>Registration code</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Code from your supplier"
              autoComplete="off"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === "Enter") activate();
              }}
            />
          </label>
          <label className="ppe-activate__field">
            <span>Name for this PC (optional)</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Blast Furnace 3"
              autoComplete="off"
            />
          </label>
          <button
            type="button"
            className="ppe-activate__btn ppe-activate__btn--go"
            onClick={activate}
            disabled={busy || !code.trim()}
          >
            {busy ? "Registering…" : "Register"}
          </button>
          {result ? (
            <div
              className={
                result.ok ? "ppe-activate__ok" : "ppe-activate__err"
              }
            >
              {result.message}
            </div>
          ) : null}
          <div className="ppe-activate__hint">
            Needs internet for this step only. Everything else works offline.
          </div>
        </div>
      ) : null}
    </div>
  );
}
