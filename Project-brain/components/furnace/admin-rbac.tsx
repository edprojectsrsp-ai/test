"use client";
// Admin Console — Users · Roles · Scheme Access · Settings · Audit (Sprint 2).
// Live API first; mock only when NEXT_PUBLIC_PB_MOCK=1.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ThemeToggle } from "@/theme/ThemeProvider";
import { Button, Card, Chip, Field, PageHeader, Select, Tabs, toast } from "@/ui";
import { API_BASE, MOCK } from "@/lib/furnace/gridApi";
import { authHeaders } from "@/lib/auth";

const mono: React.CSSProperties = { fontFamily: "var(--font-mono, 'IBM Plex Mono', ui-monospace, monospace)" };
const th: React.CSSProperties = { padding: "6px 10px", fontSize: 10.5, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--steel-dim)", borderBottom: "1px solid var(--line)", background: "var(--panel)", textAlign: "left", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "6px 10px", borderBottom: "1px solid var(--grid-line)", fontSize: 12.5 };

interface User {
  user_id: number; username: string; full_name: string; email?: string;
  designation?: string; department?: string; role: string; is_active: boolean;
  last_login_at?: string; failed_login_attempts?: number;
}
interface Matrix { modules: string[]; actions: string[]; matrix: Record<string, Record<string, string[]>>; }
interface AuditEntry { id: number; actor?: string; action: string; target?: string; at: string; }
interface Scheme { scheme_id: number; scheme_name: string }
interface AppSettings {
  header_title: string;
  header_subtitle: string;
  org_name: string;
  logo_url: string;
  primary_color: string;
  daily_progress_backdate_days: number;
  menu_show_ppe: boolean;
  menu_show_ai: boolean;
  menu_show_delay: boolean;
  active_financial_year: string;
}

const MOCK_USERS: User[] = [
  { user_id: 1, username: "pkn", full_name: "PKN (Developer)", role: "admin", is_active: true, last_login_at: "2026-07-04 18:02", designation: "Sr. Engineer", department: "PMC" },
  { user_id: 2, username: "gm.projects", full_name: "GM Projects", role: "pmc", is_active: true, last_login_at: "2026-07-03 10:41", designation: "GM", department: "Projects" },
  { user_id: 3, username: "site.cob7", full_name: "COB-7 Site Engineer", role: "engineer", is_active: true, failed_login_attempts: 1, department: "Coke Ovens" },
  { user_id: 4, username: "mos.viewer", full_name: "Ministry Viewer", role: "viewer", is_active: true },
];
const MOCK_MATRIX: Matrix = {
  modules: ["dashboard", "capex", "scurve", "cpm", "reports", "dpr", "appendix2", "notesheet", "risk", "documents", "ppe", "ai", "admin"],
  actions: ["view", "edit", "approve", "export"],
  matrix: {
    admin: Object.fromEntries(["dashboard", "capex", "scurve", "cpm", "reports", "dpr", "appendix2", "notesheet", "risk", "documents", "ppe", "ai", "admin"].map((m) => [m, ["view", "edit", "approve", "export"]])),
    pmc: Object.fromEntries(["dashboard", "capex", "scurve", "cpm", "reports", "dpr", "appendix2", "notesheet", "risk", "documents", "ppe", "ai"].map((m) => [m, ["view", "edit", "export"]])),
    engineer: { dashboard: ["view", "edit"], capex: ["view", "edit"], scurve: ["view", "edit"], cpm: ["view", "edit"], dpr: ["view", "edit"], appendix2: ["view", "edit"], reports: ["view"], notesheet: ["view"], risk: ["view"], documents: ["view"], ppe: ["view"], ai: ["view"] },
    viewer: Object.fromEntries(["dashboard", "capex", "scurve", "cpm", "reports", "dpr", "appendix2", "notesheet", "risk", "documents", "ppe", "ai"].map((m) => [m, ["view"]])),
  },
};
const MOCK_SETTINGS: AppSettings = {
  header_title: "Rourkela Steel Plant - Project Department",
  header_subtitle: "Capital Project Monitoring · Project Brain",
  org_name: "Rourkela Steel Plant",
  logo_url: "",
  primary_color: "#0b3d91",
  daily_progress_backdate_days: 7,
  menu_show_ppe: true,
  menu_show_ai: true,
  menu_show_delay: true,
  active_financial_year: "",
};

async function api(path: string, init?: RequestInit): Promise<any> {
  const r = await fetch(`${API_BASE}/admin${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(init?.headers || {}),
    },
  });
  if (!r.ok) {
    let detail = `${r.status}`;
    try {
      const j = await r.json();
      detail = j.detail || detail;
    } catch { /* ignore */ }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return r.json();
}

export default function AdminConsole() {
  const [tab, setTab] = useState("users");
  const [users, setUsers] = useState<User[]>(MOCK ? MOCK_USERS : []);
  const [matrix, setMatrix] = useState<Matrix>(MOCK_MATRIX);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [accessUser, setAccessUser] = useState<number>(0);
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [granted, setGranted] = useState<number[]>([]);
  const [nu, setNu] = useState({ username: "", full_name: "", password: "", role: "viewer" });
  const [settings, setSettings] = useState<AppSettings>(MOCK_SETTINGS);
  const [loading, setLoading] = useState(!MOCK);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    if (MOCK) return;
    setLoading(true);
    setErr("");
    try {
      const [u, m, a, s] = await Promise.all([
        api("/users"),
        api("/roles/matrix"),
        api("/audit?limit=100"),
        api("/settings"),
      ]);
      setUsers(u.users || []);
      setMatrix(m);
      setAudit(a.entries || []);
      setSettings({ ...MOCK_SETTINGS, ...s });
      if ((u.users || []).length && !accessUser) {
        const first = (u.users as User[]).find((x) => x.role !== "admin" && x.role !== "pmc")
          || u.users[0];
        setAccessUser(first.user_id);
      }
    } catch (e: any) {
      setErr(e?.message || "Failed to load admin data — are you logged in as admin?");
    } finally {
      setLoading(false);
    }
  }, [accessUser]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (MOCK || !accessUser) return;
    api(`/access/${accessUser}`)
      .then((d) => {
        setGranted(d.granted || []);
        setSchemes(d.schemes || []);
      })
      .catch(() => {});
  }, [accessUser]);

  const roles = useMemo(() => {
    const keys = Object.keys(matrix.matrix || {});
    return keys.length ? keys : ["admin", "pmc", "engineer", "viewer"];
  }, [matrix]);

  const toggleCell = (role: string, module: string, action: string) => {
    setMatrix((m) => {
      const cur = new Set(m.matrix[role]?.[module] ?? []);
      cur.has(action) ? cur.delete(action) : cur.add(action);
      return { ...m, matrix: { ...m.matrix, [role]: { ...m.matrix[role], [module]: [...cur] } } };
    });
  };

  const saveMatrix = async () => {
    if (!(matrix.matrix.admin?.admin ?? []).includes("edit")) {
      toast("Blocked: this matrix would lock admins out of Admin.");
      return;
    }
    try {
      if (!MOCK) await api("/roles/matrix", { method: "PUT", body: JSON.stringify({ matrix: matrix.matrix }) });
      toast("Role matrix saved.");
      load();
    } catch (e: any) {
      toast(e?.message || "Save failed.");
    }
  };

  const patchUser = async (id: number, patch: Partial<User>) => {
    setUsers((u) => u.map((x) => (x.user_id === id ? { ...x, ...patch } : x)));
    try {
      if (!MOCK) await api(`/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      toast("User updated.");
    } catch (e: any) {
      toast(e?.message || "Update failed.");
      load();
    }
  };

  const createUser = async () => {
    if (!nu.username || !nu.full_name || nu.password.length < 8) {
      toast("Fill username, full name and a password of 8+ chars.");
      return;
    }
    try {
      if (!MOCK) {
        await api("/users", { method: "POST", body: JSON.stringify(nu) });
        await load();
      } else {
        setUsers((u) => [...u, {
          user_id: Math.max(0, ...u.map((x) => x.user_id)) + 1,
          username: nu.username, full_name: nu.full_name, role: nu.role, is_active: true,
        }]);
      }
      setNu({ username: "", full_name: "", password: "", role: "viewer" });
      toast("User created.");
    } catch (e: any) {
      toast(e?.message || "Create failed (duplicate username?).");
    }
  };

  const saveAccess = async () => {
    try {
      if (!MOCK) await api(`/access/${accessUser}`, { method: "PUT", body: JSON.stringify({ scheme_ids: granted }) });
      toast(`Access saved — ${granted.length} scheme(s).`);
    } catch (e: any) {
      toast(e?.message || "Save failed.");
    }
  };

  const saveSettings = async () => {
    try {
      if (!MOCK) {
        const d = await api("/settings", { method: "PUT", body: JSON.stringify(settings) });
        setSettings({ ...MOCK_SETTINGS, ...d });
      }
      toast("Settings saved.");
    } catch (e: any) {
      toast(e?.message || "Settings save failed.");
    }
  };

  const inputStyle: React.CSSProperties = {
    padding: "7px 10px", borderRadius: "var(--r)", border: "1px solid var(--line)",
    background: "var(--panel)", color: "var(--ink)", fontSize: 12.5, outline: "none", width: "100%",
  };

  return (
    <div className="fz fz-app" style={{ padding: "22px 26px 70px" }}>
      <PageHeader
        title="Admin Console"
        subtitle="Users · role matrix · scheme access · branding / DPR controls · audit"
        right={<ThemeToggle />}
      />

      {err && (
        <div style={{
          marginTop: 12, padding: "10px 14px", borderRadius: 10,
          border: "1px solid var(--molten)", background: "var(--molten-soft)", color: "var(--molten)", fontSize: 13,
        }}>
          {err}
        </div>
      )}
      {loading && (
        <p style={{ marginTop: 12, fontSize: 13, color: "var(--ink-3)" }}>Loading admin data…</p>
      )}

      <div style={{ marginTop: 14 }}>
        <Tabs
          tabs={[
            { key: "users", label: "Users" },
            { key: "matrix", label: "Roles Matrix" },
            { key: "access", label: "Scheme Access" },
            { key: "settings", label: "Settings" },
            { key: "audit", label: "Audit" },
          ]}
          active={tab}
          onChange={setTab}
        />
      </div>

      {tab === "users" ? (
        <Card pad={false} style={{ marginTop: 12 }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>{["User", "Name", "Dept / Desig", "Role", "Status", "Last login", ""].map((c) => (
                <th key={c} style={th}>{c}</th>
              ))}</tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.user_id} style={{ opacity: u.is_active ? 1 : 0.55 }}>
                  <td style={{ ...td, ...mono, fontWeight: 600 }}>{u.username}</td>
                  <td style={td}>{u.full_name}</td>
                  <td style={{ ...td, color: "var(--steel-dim)" }}>
                    {[u.department, u.designation].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td style={td}>
                    <Select
                      value={u.role}
                      onChange={(v) => patchUser(u.user_id, { role: v })}
                      options={roles.map((r) => ({ value: r, label: r }))}
                      style={{ minWidth: 110 }}
                    />
                  </td>
                  <td style={td}>
                    <Chip tone={u.is_active ? "ok" : "critical"} dot>
                      {u.is_active ? "Active" : "Disabled"}
                    </Chip>
                    {(u.failed_login_attempts ?? 0) >= 5 ? (
                      <Chip tone="moderate" style={{ marginLeft: 6 }}>LOCKED</Chip>
                    ) : null}
                  </td>
                  <td style={{ ...td, ...mono, fontSize: 11.5, color: "var(--steel-dim)" }}>
                    {u.last_login_at ?? "never"}
                  </td>
                  <td style={td}>
                    <Button kind="ghost" onClick={() => patchUser(u.user_id, { is_active: !u.is_active })}>
                      {u.is_active ? "Disable" : "Enable"}
                    </Button>
                  </td>
                </tr>
              ))}
              <tr style={{ background: "var(--bg-tint-cool)" }}>
                <td style={td}>
                  <input placeholder="username" value={nu.username}
                    onChange={(e) => setNu({ ...nu, username: e.target.value })}
                    style={{ ...inputStyle, width: 120 }} />
                </td>
                <td style={td}>
                  <input placeholder="Full name" value={nu.full_name}
                    onChange={(e) => setNu({ ...nu, full_name: e.target.value })}
                    style={{ ...inputStyle, width: 170 }} />
                </td>
                <td style={td}>
                  <input placeholder="password (8+)" type="password" value={nu.password}
                    onChange={(e) => setNu({ ...nu, password: e.target.value })}
                    style={{ ...inputStyle, width: 140 }} />
                </td>
                <td style={td}>
                  <Select value={nu.role} onChange={(v) => setNu({ ...nu, role: v })}
                    options={roles.map((r) => ({ value: r, label: r }))} style={{ minWidth: 110 }} />
                </td>
                <td style={td} colSpan={3}>
                  <Button kind="accent" onClick={createUser}>Add user</Button>
                </td>
              </tr>
            </tbody>
          </table>
        </Card>
      ) : null}

      {tab === "matrix" ? (
        <Card pad={false} style={{ marginTop: 12 }}>
          <div style={{ overflow: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "max-content", minWidth: "100%" }}>
              <thead>
                <tr>
                  <th style={{ ...th, position: "sticky", left: 0, zIndex: 2 }}>Module</th>
                  {roles.map((r) => (
                    <th key={r} colSpan={matrix.actions?.length || 4}
                      style={{ ...th, textAlign: "center", borderLeft: "1px solid var(--line)" }}>{r}</th>
                  ))}
                </tr>
                <tr>
                  <th style={{ ...th, position: "sticky", left: 0, zIndex: 2 }} />
                  {roles.flatMap((r) => (matrix.actions || ["view", "edit", "approve", "export"]).map((a, ai) => (
                    <th key={`${r}-${a}`} style={{
                      ...th, fontSize: 9.5, textAlign: "center",
                      ...(ai === 0 ? { borderLeft: "1px solid var(--line)" } : {}),
                    }}>{a}</th>
                  )))}
                </tr>
              </thead>
              <tbody>
                {(matrix.modules || []).map((m) => (
                  <tr key={m}>
                    <td style={{
                      ...td, position: "sticky", left: 0, background: "var(--bg)",
                      fontWeight: 600, borderRight: "1px solid var(--line)",
                    }}>{m}</td>
                    {roles.flatMap((r) => (matrix.actions || []).map((a, ai) => {
                      const on = (matrix.matrix[r]?.[m] ?? []).includes(a);
                      return (
                        <td key={`${r}-${m}-${a}`} onClick={() => toggleCell(r, m, a)}
                          style={{
                            ...td, textAlign: "center", cursor: "pointer",
                            ...(ai === 0 ? { borderLeft: "1px solid var(--grid-line)" } : {}),
                            background: on ? "var(--verdigris-soft)" : undefined,
                          }}>
                          <span style={{ color: on ? "var(--verdigris)" : "var(--grid-line)", fontWeight: 700 }}>
                            {on ? "✓" : "·"}
                          </span>
                        </td>
                      );
                    }))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{
            display: "flex", gap: 10, padding: "10px 14px",
            borderTop: "1px solid var(--line)", alignItems: "center",
          }}>
            <span style={{ fontSize: 11.5, color: "var(--steel-dim)" }}>
              Click any cell to toggle · admin:admin:edit is protected against self-lockout
            </span>
            <span style={{ flex: 1 }} />
            <Button kind="accent" onClick={saveMatrix}>Save matrix</Button>
          </div>
        </Card>
      ) : null}

      {tab === "access" ? (
        <Card style={{ marginTop: 12 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <Field label="User">
              <Select
                value={String(accessUser || "")}
                onChange={(v) => setAccessUser(Number(v))}
                options={users
                  .filter((u) => u.role !== "admin" && u.role !== "pmc")
                  .map((u) => ({ value: String(u.user_id), label: `${u.username} — ${u.full_name}` }))}
                style={{ minWidth: 260 }}
              />
            </Field>
            <Chip tone="steel">{granted.length} scheme(s) granted</Chip>
            <span style={{ flex: 1 }} />
            <Button onClick={() => setGranted(schemes.map((s) => s.scheme_id))}>Grant all</Button>
            <Button onClick={() => setGranted([])}>Clear</Button>
            <Button kind="accent" onClick={saveAccess} disabled={!accessUser}>Save access</Button>
          </div>
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 8, marginTop: 14,
          }}>
            {schemes.map((s) => {
              const on = granted.includes(s.scheme_id);
              return (
                <button key={s.scheme_id}
                  type="button"
                  onClick={() => setGranted((g) => (on ? g.filter((x) => x !== s.scheme_id) : [...g, s.scheme_id]))}
                  style={{
                    display: "flex", alignItems: "center", gap: 9, padding: "9px 12px",
                    textAlign: "left", cursor: "pointer", borderRadius: "var(--r)",
                    border: `1px solid ${on ? "var(--steel)" : "var(--line)"}`,
                    background: on ? "var(--steel-soft)" : "var(--panel)", color: "var(--ink)",
                  }}>
                  <span style={{
                    width: 15, height: 15, borderRadius: 4, border: "1px solid var(--line-2)",
                    background: on ? "var(--steel)" : "transparent", color: "#fff", fontSize: 11,
                    display: "grid", placeItems: "center",
                  }}>{on ? "✓" : ""}</span>
                  <span style={{ fontSize: 12.5 }}>{s.scheme_name}</span>
                </button>
              );
            })}
            {!schemes.length && (
              <p style={{ fontSize: 12, color: "var(--ink-3)" }}>Select a non-admin user to load schemes.</p>
            )}
          </div>
          <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--steel-dim)" }}>
            admin &amp; pmc roles see all schemes; restricted users use granted list for dashboards/AI.
          </div>
        </Card>
      ) : null}

      {tab === "settings" ? (
        <Card style={{ marginTop: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--steel-dim)", marginBottom: 10 }}>
                Branding
              </p>
              <Field label="Header title">
                <input value={settings.header_title}
                  onChange={(e) => setSettings({ ...settings, header_title: e.target.value })}
                  style={inputStyle} />
              </Field>
              <div style={{ height: 10 }} />
              <Field label="Subtitle">
                <input value={settings.header_subtitle}
                  onChange={(e) => setSettings({ ...settings, header_subtitle: e.target.value })}
                  style={inputStyle} />
              </Field>
              <div style={{ height: 10 }} />
              <Field label="Organisation">
                <input value={settings.org_name}
                  onChange={(e) => setSettings({ ...settings, org_name: e.target.value })}
                  style={inputStyle} />
              </Field>
              <div style={{ height: 10 }} />
              <Field label="Primary colour">
                <input type="color" value={settings.primary_color || "#0b3d91"}
                  onChange={(e) => setSettings({ ...settings, primary_color: e.target.value })}
                  style={{ ...inputStyle, width: 80, padding: 2 }} />
              </Field>
              <div style={{ height: 10 }} />
              <Field label="Logo URL (optional)">
                <input value={settings.logo_url}
                  onChange={(e) => setSettings({ ...settings, logo_url: e.target.value })}
                  style={inputStyle} placeholder="https://… or /uploads/logo.png" />
              </Field>
            </div>
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--steel-dim)", marginBottom: 10 }}>
                DPR controls & menu
              </p>
              <Field label="Allowed DPR backdate days (0–365)">
                <input type="number" min={0} max={365}
                  value={settings.daily_progress_backdate_days}
                  onChange={(e) => setSettings({
                    ...settings,
                    daily_progress_backdate_days: Math.max(0, Math.min(365, Number(e.target.value) || 0)),
                  })}
                  style={{ ...inputStyle, width: 120 }} />
              </Field>
              <p style={{ fontSize: 11.5, color: "var(--steel-dim)", marginTop: 6 }}>
                Officers cannot enter DPR for dates older than this window. Enforced on POST /dpr/actuals.
              </p>
              <div style={{ height: 14 }} />
              <Field label="Active financial year (optional)">
                <input value={settings.active_financial_year}
                  onChange={(e) => setSettings({ ...settings, active_financial_year: e.target.value })}
                  style={inputStyle} placeholder="e.g. 2025-26" />
              </Field>
              <div style={{ height: 14 }} />
              {([
                ["menu_show_ai", "Show AI Assistant in shell"],
                ["menu_show_delay", "Show Delay Analysis"],
                ["menu_show_ppe", "Show PPE Camera"],
              ] as const).map(([key, lab]) => (
                <label key={key} style={{
                  display: "flex", alignItems: "center", gap: 8, marginBottom: 8,
                  fontSize: 13, color: "var(--ink)", cursor: "pointer",
                }}>
                  <input
                    type="checkbox"
                    checked={Boolean(settings[key])}
                    onChange={(e) => setSettings({ ...settings, [key]: e.target.checked })}
                  />
                  {lab}
                </label>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 18, display: "flex", justifyContent: "flex-end" }}>
            <Button kind="accent" onClick={saveSettings}>Save settings</Button>
          </div>
        </Card>
      ) : null}

      {tab === "audit" ? (
        <Card pad={false} style={{ marginTop: 12 }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "flex-end" }}>
            <Button kind="ghost" onClick={load}>Refresh</Button>
          </div>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>{["#", "When", "Actor", "Action", "Target"].map((c) => (
                <th key={c} style={th}>{c}</th>
              ))}</tr>
            </thead>
            <tbody>
              {audit.map((e) => (
                <tr key={e.id}>
                  <td style={{ ...td, ...mono }}>{e.id}</td>
                  <td style={{ ...td, ...mono, fontSize: 11.5 }}>{e.at}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{e.actor ?? "system"}</td>
                  <td style={td}><Chip tone="steel">{e.action}</Chip></td>
                  <td style={{ ...td, color: "var(--steel-dim)" }}>{e.target || "—"}</td>
                </tr>
              ))}
              {!audit.length && (
                <tr>
                  <td colSpan={5} style={{ ...td, color: "var(--ink-3)" }}>
                    No audit entries yet. Admin actions (create user, matrix save, settings) will appear here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}
