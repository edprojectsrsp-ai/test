"use client";
/**
 * PPE licence codes — issue a registration code, see who used it, revoke it.
 *
 * Codes previously lived in the PPE_ENROLL_CODES environment variable, so
 * issuing one to a new customer meant editing a Render setting and redeploying,
 * and revoking one meant the same. In practice that means nobody revokes
 * anything. These are rows now, and this is the screen that manages them.
 *
 * Hosted only. The plant-PC build is confined to /ppe by middleware.ts, so this
 * route does not exist on a customer's machine — which is the point, since it
 * mints licences for the product they bought.
 *
 * Sending is a share link rather than a server-side message. WhatsApp's Cloud
 * API only permits business-initiated messages against a pre-approved template,
 * so "send from the server" is gated on a Meta approval that has nothing to do
 * with this code. A wa.me link opens the chat with the text ready and works
 * today, on the phone the admin already has.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { getToken } from "@/lib/auth";

const CLOUD =
  process.env.NEXT_PUBLIC_PPE_CLOUD_URL ||
  "https://project-brain-ppe-lite.onrender.com";

type Agent = {
  id: string;
  name: string;
  enabled: boolean;
  last_seen_at: string | null;
  total_pushed: number;
};

type Code = {
  code: string;
  customer: string;
  label: string;
  active: boolean;
  activations: number;
  last_used_at: string | null;
  created_at: string | null;
  notes: string;
  agents: Agent[];
};

async function callApi(path: string, init: RequestInit = {}) {
  const token = getToken();
  const res = await fetch(`${CLOUD}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  if (res.status === 401) throw new Error("Your session has expired — sign in again.");
  if (res.status === 403) throw new Error("Your account cannot manage licence codes.");
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      if (j?.detail) detail = typeof j.detail === "string" ? j.detail : detail;
    } catch {
      /* keep the status-based message */
    }
    throw new Error(detail);
  }
  return res.json();
}

function whenLast(iso: string | null) {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "never" : d.toLocaleString();
}

export default function PpeLicencesPage() {
  const [codes, setCodes] = useState<Code[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [customer, setCustomer] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await callApi("/api/admin/codes");
      setCodes(r.items || []);
    } catch (e: any) {
      setError(e?.message || "Could not load licence codes.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const issue = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      await callApi("/api/admin/codes", {
        method: "POST",
        body: JSON.stringify({ customer: customer.trim(), label: label.trim() }),
      });
      setCustomer("");
      setLabel("");
      await load();
    } catch (e: any) {
      setError(e?.message || "Could not issue a code.");
    } finally {
      setBusy(false);
    }
  }, [customer, label, load]);

  const toggle = useCallback(
    async (code: string, active: boolean) => {
      setError("");
      try {
        await callApi(`/api/admin/codes/${encodeURIComponent(code)}/active`, {
          method: "POST",
          body: JSON.stringify({ active }),
        });
        await load();
      } catch (e: any) {
        setError(e?.message || "Could not change the code.");
      }
    },
    [load],
  );

  const copy = useCallback(async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      setTimeout(() => setCopied(""), 1800);
    } catch {
      setError("Could not copy — select the code and copy it manually.");
    }
  }, []);

  const shareText = useCallback(
    (c: Code) =>
      encodeURIComponent(
        `PPE Detection registration code: ${c.code}\n\n` +
          `Open PPE Control Room on the plant PC, click "Register this PC" ` +
          `on the amber bar, and enter this code. It is needed once — the PC ` +
          `works offline afterwards.`,
      ),
    [],
  );

  const active = useMemo(() => codes.filter((c) => c.active).length, [codes]);

  return (
    <div className="lic">
      <header className="lic__head">
        <div>
          <h1>PPE licence codes</h1>
          <p>
            Issue a code, send it to the customer, and they enter it once on
            their plant PC. {codes.length} code{codes.length === 1 ? "" : "s"},{" "}
            {active} active.
          </p>
        </div>
        <button type="button" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </header>

      {error ? <div className="lic__err">{error}</div> : null}

      <section className="lic__new">
        <label>
          <span>Customer</span>
          <input
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
            placeholder="e.g. rsp"
            autoComplete="off"
          />
        </label>
        <label>
          <span>Label (optional)</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Blast Furnace control room"
            autoComplete="off"
          />
        </label>
        <button type="button" onClick={issue} disabled={busy || !customer.trim()}>
          {busy ? "Issuing…" : "Issue code"}
        </button>
      </section>

      {loading && codes.length === 0 ? (
        <p className="lic__empty">Loading…</p>
      ) : codes.length === 0 ? (
        <p className="lic__empty">
          No codes yet. Issue one above and send it to the customer.
        </p>
      ) : (
        <ul className="lic__list">
          {codes.map((c) => (
            <li key={c.code} className={c.active ? "" : "is-off"}>
              <div className="lic__row">
                <code className="lic__code">{c.code}</code>
                <span className={`lic__pill ${c.active ? "on" : "off"}`}>
                  {c.active ? "Active" : "Deactivated"}
                </span>
                <span className="lic__meta">
                  {c.customer || "—"}
                  {c.label ? ` · ${c.label}` : ""}
                </span>
                <span className="lic__meta">
                  {c.activations} PC{c.activations === 1 ? "" : "s"} · last used{" "}
                  {whenLast(c.last_used_at)}
                </span>
                <span className="lic__actions">
                  <button type="button" onClick={() => copy(c.code)}>
                    {copied === c.code ? "Copied" : "Copy"}
                  </button>
                  <a
                    href={`https://wa.me/?text=${shareText(c)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    WhatsApp
                  </a>
                  <button
                    type="button"
                    onClick={() => toggle(c.code, !c.active)}
                  >
                    {c.active ? "Deactivate" : "Reactivate"}
                  </button>
                </span>
              </div>
              {c.agents?.length ? (
                <div className="lic__agents">
                  {c.agents.map((a) => (
                    <span key={a.id} title={`last seen ${whenLast(a.last_seen_at)}`}>
                      {a.enabled ? "●" : "○"} {a.name || a.id}
                    </span>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <p className="lic__note">
        Deactivating a code stops it registering any new PC. Machines it already
        registered keep working — their cameras stay online and their recorded
        violations are untouched.
      </p>
    </div>
  );
}
